#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { buildBoard, projectProcessState, renderBoard } from '../lib/core/process-state.mjs'
import { createFilesystemMedium } from '../lib/sources/filesystem-medium.mjs'
import { createGitHubClient } from '../lib/sources/github-client.mjs'
import { resolveGitHubToken } from '../lib/sources/github-credential.mjs'
import {
  githubIntegrationFact,
  parseTransition,
  stateLabelChanges,
} from '../lib/sources/github-medium.mjs'
import {
  SAFE_KEYWORDS,
  loadIntegrationLifecycleConfig,
  parseIssueReferences,
} from './integration-lifecycle.mjs'

function flag(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return null
  return args[index + 1]
}

function usage() {
  return [
    'Usage: agentflow-sdlc board [backfill] --medium <filesystem|github> [options] [--json]',
    '  filesystem: --root <dir>   every goal directory under it',
    '  github: --repo <owner/repo>',
    '  backfill: GitHub only. Prints the label corrections and the correction report.',
    '            Nothing is written unless --apply is passed.',
  ].join('\n')
}

// Goal directories are found under the root. A goal's own transitions directory is not searched.
function goalDirs(root) {
  const found = []
  const walk = (dir) => {
    if (existsSync(join(dir, 'goal.json'))) found.push(dir)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (['transitions', 'node_modules'].includes(entry.name)) continue
      walk(join(dir, entry.name))
    }
  }
  walk(root)
  return found.sort()
}

export async function filesystemItems(root) {
  const items = []
  for (const dir of goalDirs(root)) {
    const goal = await createFilesystemMedium({ root: dir }).readGoal()
    items.push({
      id: relative(root, dir) || '.',
      title: goal.title,
      uri: dir,
      transitions: goal.transitions,
      integration: goal.integration,
      closed: false,
    })
  }
  return items
}

async function allPages(fetchPage) {
  const results = []
  for (let page = 1; ; page += 1) {
    const batch = (await fetchPage(page)) ?? []
    results.push(...batch)
    if (batch.length < 100) return results
  }
}

// Merged pull requests into the integration line or trunk, keyed by the issue they close.
export async function mergedPullRequestsByIssue(client, repo, branches) {
  const byIssue = new Map()
  for (const base of branches) {
    const pulls = await allPages((page) =>
      client.pullRequests(repo, { state: 'closed', base, per_page: 100, page }),
    )
    for (const pull of pulls) {
      if (!pull.merged_at) continue
      const refs = parseIssueReferences(pull.body ?? '', { referenceKeywords: SAFE_KEYWORDS })
      for (const ref of refs) {
        const number = Number(ref.slice(1))
        if (!byIssue.has(number)) byIssue.set(number, { base, url: pull.html_url })
      }
    }
  }
  return byIssue
}

export async function githubItems(client, repo, { branches }) {
  const issues = (
    await allPages((page) => client.issues(repo, { state: 'all', per_page: 100, page }))
  ).filter((issue) => !issue.pull_request)
  const mergedPullRequests = await mergedPullRequestsByIssue(client, repo, branches)
  const items = []
  for (const issue of issues.sort((a, b) => a.number - b.number)) {
    const integration = githubIntegrationFact(issue, { mergedPullRequests })
    const closed = issue.state === 'closed'
    // The phase record only decides an open item without the integration fact.
    const transitions =
      !integration && !closed && issue.comments
        ? (await client.issueComments(repo, issue.number)).map(parseTransition).filter(Boolean)
        : []
    items.push({
      id: `#${issue.number}`,
      number: issue.number,
      title: issue.title,
      uri: issue.html_url,
      transitions,
      integration,
      closed,
      closeReason: closed ? (issue.state_reason ?? null) : null,
      issue,
    })
  }
  return items
}

/** The label corrections that make every issue show its projected state, and nothing else. */
export function planBackfill(items) {
  const changes = []
  const correction = []
  for (const item of items) {
    const state = projectProcessState(item)
    const { add, remove } = stateLabelChanges(item.issue, state)
    // A fact found only from a merged pull request becomes the label the lifecycle writes, so a
    // later read of the single issue sees the same state as the board.
    if (item.integration && !item.integration.evidence.startsWith('label:')) {
      add.push(`integrated:${item.integration.line}`)
    }
    if (add.length || remove.length) changes.push({ number: item.number, state, add, remove })
    if (state === null) {
      correction.push({
        number: item.number,
        title: item.title,
        uri: item.uri,
        closeReason: item.closeReason,
        needsDecision: item.closeReason === 'completed',
      })
    }
  }
  return { changes, correction }
}

export async function applyBackfill(client, repo, plan) {
  for (const change of plan.changes) {
    for (const label of change.remove) await client.removeLabel(repo, change.number, label)
    if (change.add.length) await client.addLabels(repo, change.number, change.add)
  }
}

function renderBackfill(plan, applied) {
  const lines = [`${applied ? 'Applied' : 'Dry run'}: ${plan.changes.length} issues to relabel`]
  for (const change of plan.changes) {
    const add = change.add.length ? ` +${change.add.join(' +')}` : ''
    const remove = change.remove.length ? ` -${change.remove.join(' -')}` : ''
    lines.push(`  #${change.number} ${change.state ?? 'no state'}:${add}${remove}`)
  }
  const decide = plan.correction.filter((item) => item.needsDecision)
  lines.push(
    `Correction report: ${plan.correction.length} closed without an integration fact, ${decide.length} closed as completed need a human decision`,
  )
  for (const item of plan.correction) {
    lines.push(
      `  #${item.number} ${item.closeReason ?? 'closed'}${item.needsDecision ? ' (decide)' : ''}  ${item.title}`,
    )
  }
  return lines.join('\n')
}

function boardJson(board) {
  return {
    groups: board.groups.map((group) => ({ state: group.name, items: group.items })),
    excludedCount: board.excludedCount,
    excluded: board.excluded,
  }
}

export async function main(argv, { client: injected, stdout = process.stdout } = {}) {
  const backfill = argv[0] === 'backfill'
  const args = backfill ? argv.slice(1) : argv
  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(`${usage()}\n`)
    return 0
  }
  const json = args.includes('--json')
  const medium = flag(args, '--medium')
  if (medium === 'filesystem') {
    if (backfill) throw new Error('Backfill is for GitHub. The filesystem board needs none.')
    const items = await filesystemItems(resolve(flag(args, '--root') ?? '.'))
    const board = buildBoard(items)
    stdout.write(`${json ? JSON.stringify(boardJson(board), null, 2) : renderBoard(board)}\n`)
    return 0
  }
  if (medium !== 'github') throw new Error(usage())
  const repo = flag(args, '--repo')
  if (!repo) throw new Error('Set --repo <owner/repo>')
  const client = injected ?? createGitHubClient({ token: resolveGitHubToken() })
  const lifecycle = loadIntegrationLifecycleConfig(resolve(flag(args, '--target') ?? '.'))
  const branches = [...new Set([lifecycle.integrationBranch, lifecycle.trunkBranch])]
  const items = await githubItems(client, repo, { branches })
  if (!backfill) {
    const board = buildBoard(items)
    stdout.write(`${json ? JSON.stringify(boardJson(board), null, 2) : renderBoard(board)}\n`)
    return 0
  }
  const plan = planBackfill(items)
  const apply = args.includes('--apply')
  if (apply) await applyBackfill(client, repo, plan)
  stdout.write(
    `${json ? JSON.stringify({ applied: apply, ...plan }, null, 2) : renderBackfill(plan, apply)}\n`,
  )
  return 0
}

const invoked = process.argv[1]?.endsWith('process-board.mjs')
if (invoked) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    },
  )
}
