#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createGatePendingHook } from '../lib/adapters/gate-pending-hook.mjs'
import { detectAgentRuntime } from '../lib/agent-caller.mjs'
import { GATE_CLASSES, createGate } from '../lib/core/gate.mjs'
import {
  HUMAN_PLATFORM,
  answerEntry,
  candidateEntry,
  gateEntry,
  onBehalfEntry,
  gateView,
} from '../lib/core/person-gates.mjs'
import { createReviewAttestation } from '../lib/core/review-attestation.mjs'
import { describeRuntimePlatform } from '../lib/runtime-platforms.mjs'
import { admissionDigest } from '../lib/core/work-altitude.mjs'
import { createFilesystemMedium } from '../lib/sources/filesystem-medium.mjs'
import { parseGateLog } from '../lib/sources/gate-block.mjs'
import { createGitHubClient } from '../lib/sources/github-client.mjs'
import { resolveGitHubToken } from '../lib/sources/github-credential.mjs'
import { createGitHubMedium, githubGoalSubject } from '../lib/sources/github-medium.mjs'

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
    'Usage: agentflow-sdlc gates <open|answer|consent|candidate|on-behalf|sync|waiting> --medium <filesystem|github> [options] [--json]',
    '  filesystem: --root <dir>   (waiting: every goal directory under it)',
    '  github: --repo <owner/repo> --issue <n>   (waiting: every issue in the repo)',
    '  open: --class <adequacy-of-intent|release-of-candidate|agent-escalation> --role <role>',
    '        [--subject-kind <goalRevision|admission|candidateDigest>] [--subject <digest>] [--person <name>]',
    '        [--change-class <class>]   on a goal: admits capabilities of that class (subject kind admission)',
    '  answer: --gate <digest> --decision <agree|changes-requested|blocked> --person <name> [--finding <text>]...',
    '          A person runs this in their own terminal. An agent must not run it, and it refuses',
    '          to run under an agent runtime. The record is not proof of identity.',
    '  consent: --gate <digest> --dir <dir>   writes an agreed gate and its answer as gate.json and',
    '           attestation.json, for phase append --gate-file and --attestation-file. Reads only.',
    '  on-behalf: --principal <person> --actor-platform <slug> --actor-executor <target> --grant <ref>',
    '             --action <text> --subject-kind <kind> --subject <digest>',
    "  candidate: --subject <digest>   records the item's current candidate",
    '  sync: rewrites the GitHub issue-body block when the goal or candidate changed since it was rendered',
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

// A gate the item shows, including a waiting gate for a subject that changed since it was opened.
function findGate(view, ref) {
  if (!ref) throw new Error('Set --gate <digest>')
  const matches = view.gates.filter((gate) => gate.gateDigest.startsWith(ref))
  if (matches.length !== 1) throw new Error(`--gate ${ref} must name exactly one gate on this item`)
  return matches[0]
}

export async function openGate(args, { client, now, env } = {}) {
  const medium = mediumFrom(args, { client })
  const goal = await medium.readGoal()
  const changeClass = flag(args, '--change-class')
  const gateClass = flag(args, '--class') ?? (changeClass ? GATE_CLASSES.adequacyOfIntent : null)
  const subjectKind =
    flag(args, '--subject-kind') ?? (changeClass ? 'admission' : DEFAULT_SUBJECT_KIND[gateClass])
  if (changeClass && subjectKind !== 'admission') {
    throw new Error('--change-class opens an admission; it takes no other subject kind')
  }
  if (subjectKind === 'admission') {
    if (!changeClass) throw new Error('Set --change-class <class> for an admission')
    if (goal.kind !== 'goal') throw new Error('An admission is opened on a goal record')
  }
  // The default subject is the item's current one: its goal content, the goal content and a class
  // together, or its recorded candidate.
  const current =
    subjectKind === 'goalRevision'
      ? goal.goalSubject
      : subjectKind === 'admission'
        ? admissionDigest({ goalRevision: goal.goalSubject, changeClass })
        : goal.gates.candidate
  if (!current && !flag(args, '--subject')) {
    throw new Error('This item has no candidate; record one with gates candidate first')
  }
  const subjectDigest = flag(args, '--subject') ?? current
  const gate = createGate({
    gateClass,
    subjectKind,
    subjectDigest,
    requiredRole: flag(args, '--role'),
  })
  const result = await medium.appendGateEntry(
    gateEntry(gate, { person: flag(args, '--person'), openedAt: now(), changeClass }),
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
  const gate = findGate((await medium.readGoal()).gates, flag(args, '--gate'))
  const recordedAt = now()
  const attestation = createReviewAttestation({
    subject: `${gate.gateClass} ${gate.subjectKind}`,
    reviewedDigest: gate.subjectDigest,
    reviewer: { platform: HUMAN_PLATFORM, executor: person.trim(), independence: 'human-gate' },
    decision: flag(args, '--decision'),
    timestamp: recordedAt,
    findings: flags(args, '--finding'),
  })
  const goal = await medium.appendGateEntry(
    answerEntry(gate.gateDigest, attestation, { recordedAt }),
  )
  return { goal, attestation }
}

// Writes a person's agreed answer as the two files phase append takes. It decides nothing:
// validateOpen checks the gate and the answer again when a record opens.
export async function exportConsent(args, { client } = {}) {
  const medium = mediumFrom(args, { client })
  const dir = flag(args, '--dir')
  if (!dir) throw new Error('Set --dir <dir>')
  const shown = findGate((await medium.readGoal()).gates, flag(args, '--gate'))
  if (shown.status !== 'agreed') {
    throw new Error(`gate ${shown.gateDigest.slice(0, 12)} is ${shown.status}, not agreed`)
  }
  const log = await medium.readGateLog()
  const { gate } = log.find(
    (entry) => entry?.kind === 'gate' && entry.gate.digest === shown.gateDigest,
  )
  const { attestation } = log.findLast(
    (entry) =>
      entry?.kind === 'answer' &&
      entry.gateDigest === gate.digest &&
      entry.attestation?.decision === 'agree' &&
      entry.attestation.reviewedDigest === gate.subjectDigest,
  )
  const target = resolve(dir)
  mkdirSync(target, { recursive: true })
  const files = { gate: join(target, 'gate.json'), attestation: join(target, 'attestation.json') }
  writeFileSync(files.gate, `${JSON.stringify(gate, null, 2)}\n`)
  writeFileSync(files.attestation, `${JSON.stringify(attestation, null, 2)}\n`)
  return { files }
}

// The filesystem record is read directly, so it has nothing to refresh. On GitHub the issue-body
// block is rewritten from the record when it no longer matches.
export async function syncGates(args, { client } = {}) {
  const medium = mediumFrom(args, { client })
  if (typeof medium.syncGateBlock !== 'function') return { updated: false }
  const { updated } = await medium.syncGateBlock()
  return { updated }
}

export async function recordCandidate(args, { client, now } = {}) {
  const medium = mediumFrom(args, { client })
  const entry = candidateEntry({ candidateDigest: flag(args, '--subject'), recordedAt: now() })
  return { goal: await medium.appendGateEntry(entry) }
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
      const goal = await medium.readGoal()
      items.push({ item: relative(root, dir) || '.', uri: dir, view: goal.gates })
    }
  } else if (flag(args, '--medium') === 'github') {
    const repo = flag(args, '--repo')
    const github = client ?? createGitHubClient({ token: resolveGitHubToken() })
    const issues = await allPages((page) =>
      github.issues(repo, { state: 'all', per_page: 100, page }),
    )
    for (const issue of issues.filter((candidate) => !candidate.pull_request)) {
      const subjects = { goalRevision: githubGoalSubject(issue) }
      items.push({
        item: `#${issue.number}`,
        uri: issue.html_url,
        view: gateView(parseGateLog(issue.body), { subjects }),
      })
    }
  } else {
    throw new Error('Set --medium filesystem or --medium github')
  }
  const matches = (gate) =>
    gate.status === 'waiting' &&
    (!filter.role || gate.who.role === filter.role) &&
    (!filter.person || gate.who.person === filter.person)
  return items.flatMap(({ item, uri, view }) =>
    view.gates.filter(matches).map((gate) => ({
      item,
      uri,
      gateDigest: gate.gateDigest,
      gateClass: gate.gateClass,
      who: gate.who,
      subjectKind: gate.subjectKind,
      subjectDigest: gate.subjectDigest,
      ...(gate.changeClass ? { changeClass: gate.changeClass } : {}),
      openedAt: gate.openedAt,
    })),
  )
}

function renderWaiting(rows) {
  if (!rows.length) return 'No person gate is waiting.'
  return rows
    .map((row) => {
      const person = row.who.person ? `${row.who.person}, ` : ''
      return `${row.item}  ${row.gateClass}  waiting for ${person}${row.who.role} (${row.who.platform})  ${row.subjectKind}${row.changeClass ? ` ${row.changeClass}` : ''} ${row.subjectDigest.slice(0, 12)}  gate ${row.gateDigest.slice(0, 12)}`
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
  const handlers = {
    open: openGate,
    answer: answerGate,
    consent: exportConsent,
    candidate: recordCandidate,
    sync: syncGates,
    'on-behalf': recordOnBehalf,
  }
  if (!handlers[action]) throw new Error(usage())
  const result = await handlers[action](args, context)
  const view = (await mediumFrom(args, { client }).readGoal()).gates
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
