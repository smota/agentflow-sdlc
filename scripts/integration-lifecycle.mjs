#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_CONFIG = {
  integrationBranch: 'development',
  trunkBranch: 'main',
  closeIntegratedIssues: true,
  addLabels: ['integrated:development', 'awaiting-release'],
  referenceKeywords: ['Implements', 'Closes'],
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function loadIntegrationLifecycleConfig(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, 'agent-workflow.config.json')
  if (!existsSync(path)) return DEFAULT_CONFIG

  const config = JSON.parse(readFileSync(path, 'utf8'))
  const branching = isPlainObject(config.branching) ? config.branching : {}
  const lifecycle = isPlainObject(config.integrationLifecycle) ? config.integrationLifecycle : {}

  return {
    integrationBranch:
      lifecycle.integrationBranch ??
      branching.defaultPrTarget ??
      branching.integration ??
      'development',
    trunkBranch: lifecycle.trunkBranch ?? branching.trunk ?? 'main',
    closeIntegratedIssues: lifecycle.closeIntegratedIssues ?? true,
    addLabels: Array.isArray(lifecycle.addLabels) ? lifecycle.addLabels : DEFAULT_CONFIG.addLabels,
    referenceKeywords: Array.isArray(lifecycle.referenceKeywords)
      ? lifecycle.referenceKeywords
      : DEFAULT_CONFIG.referenceKeywords,
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseIssueReferences(text = '', options = {}) {
  // Only implementation/closure keywords should drive integration lifecycle actions.
  // Related-reference keywords such as "Refs" are intentionally excluded by default.
  const keywords = options.referenceKeywords ?? DEFAULT_CONFIG.referenceKeywords
  const keywordPattern = keywords.map(escapeRegExp).join('|')
  const regex = new RegExp(
    `(?:${keywordPattern})\\s+((?:#\\d+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#\\d+)(?:[\\s,;]+(?:#\\d+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#\\d+))*)`,
    'gi',
  )
  const refs = new Set()
  for (const match of text.matchAll(regex)) {
    for (const ref of match[1].match(/(?:#\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)/g) ?? []) {
      if (!ref.includes('/')) refs.add(ref)
    }
  }
  return [...refs].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}

export function buildIntegrationComment({
  prNumber,
  prUrl,
  baseRefName,
  mergeCommit,
  trunkBranch,
}) {
  return [
    `Integrated into \`${baseRefName}\` by PR #${prNumber}: ${prUrl}`,
    '',
    `Merge commit: \`${mergeCommit ?? 'unknown'}\``,
    `Release/promotion to \`${trunkBranch}\` is tracked separately.`,
  ].join('\n')
}

function gh(args, options = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

function parseArgs(argv) {
  const args = { apply: false, eventPath: process.env.GITHUB_EVENT_PATH }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--event') args.eventPath = argv[++index]
    else if (arg === '--repo') args.repo = argv[++index]
    else if (arg === '--pr') args.pr = argv[++index]
  }
  return args
}

function loadPrFromEvent(eventPath) {
  if (!eventPath) throw new Error('Missing --event or GITHUB_EVENT_PATH')
  const event = JSON.parse(readFileSync(eventPath, 'utf8'))
  return event.pull_request
}

function loadPrFromGh(repo, number) {
  const out = gh([
    'pr',
    'view',
    number,
    '--repo',
    repo,
    '--json',
    'number,url,body,baseRefName,merged,mergeCommit',
  ])
  return JSON.parse(out)
}

function normalizePr(pr) {
  const mergeCommit = pr.merge_commit_sha ?? pr.mergeCommit?.oid ?? pr.mergeCommit?.abbreviatedOid
  return {
    number: pr.number,
    url: pr.html_url ?? pr.url,
    body: pr.body ?? '',
    baseRefName: pr.base?.ref ?? pr.baseRefName,
    merged: pr.merged ?? pr.merged_at !== null,
    mergeCommit,
  }
}

export function planIntegrationLifecycle(pr, config) {
  if (!pr.merged) return { ok: true, skipped: true, reason: 'PR is not merged', issues: [] }
  if (pr.baseRefName !== config.integrationBranch) {
    return {
      ok: true,
      skipped: true,
      reason: `PR base is ${pr.baseRefName}, not ${config.integrationBranch}`,
      issues: [],
    }
  }
  const issues = parseIssueReferences(pr.body, config)
  return {
    ok: true,
    skipped: issues.length === 0,
    reason: issues.length === 0 ? 'No integration issue references found' : undefined,
    issues,
    comment: buildIntegrationComment({
      prNumber: pr.number,
      prUrl: pr.url,
      baseRefName: pr.baseRefName,
      mergeCommit: pr.mergeCommit,
      trunkBranch: config.trunkBranch,
    }),
    labels: config.addLabels,
    close: config.closeIntegratedIssues,
  }
}

function ensureLabel(repo, label) {
  try {
    gh([
      'label',
      'create',
      label,
      '--repo',
      repo,
      '--color',
      '5319e7',
      '--description',
      'Managed by multi-agent-sdlc integration lifecycle automation',
    ])
  } catch {
    // Existing labels are fine; continue so adopting repositories do not need manual setup.
  }
}

function applyPlan(plan, repo) {
  for (const label of plan.labels) ensureLabel(repo, label)
  for (const issue of plan.issues) {
    const number = issue.slice(1)
    gh(['issue', 'comment', number, '--repo', repo, '--body', plan.comment])
    for (const label of plan.labels) {
      gh(['issue', 'edit', number, '--repo', repo, '--add-label', label])
    }
    if (plan.close) gh(['issue', 'close', number, '--repo', repo, '--reason', 'completed'])
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = loadIntegrationLifecycleConfig()
  const pr = normalizePr(
    args.pr ? loadPrFromGh(args.repo, args.pr) : loadPrFromEvent(args.eventPath),
  )
  const plan = planIntegrationLifecycle(pr, config)
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  if (args.apply && !plan.skipped) applyPlan(plan, args.repo ?? process.env.GITHUB_REPOSITORY)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
