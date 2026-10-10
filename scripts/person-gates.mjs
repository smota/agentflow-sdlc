#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createGatePendingHook } from '../lib/adapters/gate-pending-hook.mjs'
import { detectAgentRuntime } from '../lib/agent-caller.mjs'
import { GATE_CLASSES, createGate } from '../lib/core/gate.mjs'
import {
  HUMAN_PLATFORM,
  answerEntry,
  gateEntry,
  onBehalfEntry,
  gateView,
  waitingGates,
} from '../lib/core/person-gates.mjs'
import { createReviewAttestation } from '../lib/core/review-attestation.mjs'
import { describeRuntimePlatform } from '../lib/runtime-platforms.mjs'
import { createFilesystemMedium } from '../lib/sources/filesystem-medium.mjs'
import { parseGateLog } from '../lib/sources/gate-block.mjs'
import { createGitHubClient } from '../lib/sources/github-client.mjs'
import { resolveGitHubToken } from '../lib/sources/github-credential.mjs'
import { createGitHubMedium } from '../lib/sources/github-medium.mjs'

const DEFAULT_SUBJECT_KIND = {
  [GATE_CLASSES.adequacyOfIntent]: 'goalRevision',
  [GATE_CLASSES.releaseOfCandidate]: 'candidateDigest',
  [GATE_CLASSES.agentEscalation]: 'goalRevision',
}

function flag(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return null
  return args[index + 1]
}

function flags(args, name) {
  return args.flatMap((arg, index) =>
    arg === name && index + 1 < args.length ? [args[index + 1]] : [],
  )
}

function usage() {
  return [
    'Usage: agentflow-sdlc gates <open|answer|on-behalf|waiting> --medium <filesystem|github> [options] [--json]',
    '  filesystem: --root <dir>   (waiting: every goal directory under it)',
    '  github: --repo <owner/repo> --issue <n>   (waiting: every issue in the repo)',
    '  open: --class <adequacy-of-intent|release-of-candidate|agent-escalation> --role <role>',
    '        [--subject-kind <goalRevision|candidateDigest>] [--subject <digest>] [--person <name>]',
    '  answer: --gate <digest> --decision <agree|changes-requested|blocked> --person <name> [--finding <text>]...',
    '          A person runs this in their own terminal. An agent must not run it, and it refuses',
    '          to run under an agent runtime. The record is not proof of identity.',
    '  on-behalf: --principal <person> --actor-platform <slug> --actor-executor <target> --grant <ref>',
    '             --action <text> --subject-kind <kind> --subject <digest>',
    '  waiting: [--role <role>] [--person <name>]',
  ].join('\n')
}

function mediumFrom(args, { client } = {}) {
  const kind = flag(args, '--medium')
  if (kind === 'filesystem')
    return createFilesystemMedium({ root: resolve(flag(args, '--root') ?? '.') })
  if (kind === 'github') {
    if (!flag(args, '--issue')) throw new Error('Set --issue <n> for a GitHub work item')
    return createGitHubMedium({
      repo: flag(args, '--repo'),
      number: Number(flag(args, '--issue')),
      client: client ?? createGitHubClient({ token: resolveGitHubToken() }),
    })
  }
  throw new Error('Set --medium filesystem or --medium github')
}

function findGate(log, ref) {
  if (!ref) throw new Error('Set --gate <digest>')
  const matches = log.filter((entry) => entry.kind === 'gate' && entry.gate.digest.startsWith(ref))
  if (matches.length !== 1) throw new Error(`--gate ${ref} must name exactly one gate on this item`)
  return matches[0].gate
}

export async function openGate(args, { client, now, env } = {}) {
  const medium = mediumFrom(args, { client })
  const goal = await medium.readGoal()
  const gateClass = flag(args, '--class')
  const subjectKind = flag(args, '--subject-kind') ?? DEFAULT_SUBJECT_KIND[gateClass]
  const subjectDigest =
    flag(args, '--subject') ?? (subjectKind === 'goalRevision' ? goal.revision : null)
  const gate = createGate({
    gateClass,
    subjectKind,
    subjectDigest,
    requiredRole: flag(args, '--role'),
  })
  const result = await medium.appendGateEntry(
    gateEntry(gate, { person: flag(args, '--person'), openedAt: now() }),
  )
  // The existing optional hook. With no hook configured nothing is sent and nothing fails.
  const hook = createGatePendingHook({
    gateNotifications: { hookUrl: env.AGENTFLOW_GATE_HOOK_URL },
  })
  const notice = await hook.emit(gate, goal.uri)
  return { goal: result, gate, notified: notice.delivered }
}

export async function answerGate(args, { client, now, env } = {}) {
  // The platform is never taken from the caller. The process itself must not be an agent runtime.
  if (args.includes('--platform')) throw new Error('gates answer does not accept --platform')
  const agent = detectAgentRuntime(env)
  if (agent) {
    throw new Error(
      `gates answer refuses to run under ${agent.runtime} (${agent.name} is set). A person records the answer in their own terminal.`,
    )
  }
  const person = flag(args, '--person')
  if (!person || !person.trim()) throw new Error('Set --person <name>')
  if (describeRuntimePlatform(person)) {
    throw new Error(`${person} is a runtime platform, not a person`)
  }
  const medium = mediumFrom(args, { client })
  const gate = findGate(await medium.readGateLog(), flag(args, '--gate'))
  const recordedAt = now()
  const attestation = createReviewAttestation({
    subject: `${gate.gateClass} ${gate.subjectKind}`,
    reviewedDigest: gate.subjectDigest,
    reviewer: { platform: HUMAN_PLATFORM, executor: person.trim(), independence: 'human-gate' },
    decision: flag(args, '--decision'),
    timestamp: recordedAt,
    findings: flags(args, '--finding'),
  })
  const goal = await medium.appendGateEntry(answerEntry(gate.digest, attestation, { recordedAt }))
  return { goal, attestation }
}

export async function recordOnBehalf(args, { client, now } = {}) {
  const medium = mediumFrom(args, { client })
  const entry = onBehalfEntry({
    principal: flag(args, '--principal'),
    actor: { platform: flag(args, '--actor-platform'), executor: flag(args, '--actor-executor') },
    grantRef: flag(args, '--grant'),
    action: flag(args, '--action'),
    subjectKind: flag(args, '--subject-kind'),
    subjectDigest: flag(args, '--subject'),
    recordedAt: now(),
  })
  return { goal: await medium.appendGateEntry(entry) }
}

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

async function allPages(fetchPage) {
  const results = []
  for (let page = 1; ; page += 1) {
    const batch = (await fetchPage(page)) ?? []
    results.push(...batch)
    if (batch.length < 100) return results
  }
}

export async function listWaiting(args, { client } = {}) {
  const filter = { role: flag(args, '--role'), person: flag(args, '--person') }
  const items = []
  if (flag(args, '--medium') === 'filesystem') {
    const root = resolve(flag(args, '--root') ?? '.')
    for (const dir of goalDirs(root)) {
      const medium = createFilesystemMedium({ root: dir })
      items.push({ item: relative(root, dir) || '.', uri: dir, log: await medium.readGateLog() })
    }
  } else if (flag(args, '--medium') === 'github') {
    const repo = flag(args, '--repo')
    const github = client ?? createGitHubClient({ token: resolveGitHubToken() })
    const issues = await allPages((page) =>
      github.issues(repo, { state: 'all', per_page: 100, page }),
    )
    for (const issue of issues.filter((candidate) => !candidate.pull_request)) {
      items.push({ item: `#${issue.number}`, uri: issue.html_url, log: parseGateLog(issue.body) })
    }
  } else {
    throw new Error('Set --medium filesystem or --medium github')
  }
  return items.flatMap(({ item, uri, log }) =>
    waitingGates(log, filter).map((gate) => ({
      item,
      uri,
      gateDigest: gate.gateDigest,
      gateClass: gate.gateClass,
      who: gate.who,
      subjectKind: gate.subjectKind,
      subjectDigest: gate.subjectDigest,
      openedAt: gate.openedAt,
    })),
  )
}

function renderWaiting(rows) {
  if (!rows.length) return 'No person gate is waiting.'
  return rows
    .map((row) => {
      const person = row.who.person ? `${row.who.person}, ` : ''
      return `${row.item}  ${row.gateClass}  waiting for ${person}${row.who.role} (${row.who.platform})  ${row.subjectKind} ${row.subjectDigest.slice(0, 12)}  gate ${row.gateDigest.slice(0, 12)}`
    })
    .join('\n')
}

export async function main(
  argv,
  { client, stdout = process.stdout, env = process.env, now = () => new Date().toISOString() } = {},
) {
  const [action, ...args] = argv
  if (!action || args.includes('--help') || args.includes('-h')) {
    stdout.write(`${usage()}\n`)
    return action ? 0 : 1
  }
  const json = args.includes('--json')
  const context = { client, env, now }
  if (action === 'waiting') {
    const rows = await listWaiting(args, context)
    stdout.write(`${json ? JSON.stringify(rows, null, 2) : renderWaiting(rows)}\n`)
    return 0
  }
  const handlers = { open: openGate, answer: answerGate, 'on-behalf': recordOnBehalf }
  if (!handlers[action]) throw new Error(usage())
  const result = await handlers[action](args, context)
  const view = gateView(await mediumFrom(args, { client }).readGateLog())
  stdout.write(`${JSON.stringify({ ...result, gates: view }, null, 2)}\n`)
  return 0
}

const invoked = process.argv[1]?.endsWith('person-gates.mjs')
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
