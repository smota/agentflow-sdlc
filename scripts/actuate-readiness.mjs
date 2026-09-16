import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGitHubClient } from '../lib/sources/github-client.mjs'
import { createGitHubRunStore } from '../lib/sources/github-run-store.mjs'
import { buildCommandCenterModel } from '../lib/cockpit-goal-model.mjs'
import { buildReadinessContract } from '../lib/cockpit-readiness-contract.mjs'
import { relatedPullRequests } from '../lib/cockpit-replay-github.mjs'
import { createGate, createGatePendingEvent } from '../lib/core/gate.mjs'
import { createRunEvent, reduceRun } from '../lib/core/run-state.mjs'

// D2 — the default actuator is a scheduled CI job, not a daemon.
//
// This script does one pass: read the readiness contract (D1), take the single highest-priority
// item in its human decision queue (D4 — the inversion; work an agent can do is never queued), and
// record durably that the decision is owed. It holds no state between invocations and starts no
// server: everything it needs is either recomputed statelessly from source (the ranking) or read
// fresh from the durable run store before every decision (D3). A cron trigger firing this script
// once an hour IS the orchestrator this framework asks for — nothing here is a substitute for one.
//
// D3 — the state split, made concrete:
//   - DURABLE governance state: the gate-pending record this script appends to the run store on
//     `refs/heads/agentflow-state` (see lib/sources/github-run-store.mjs). If every local checkout
//     vanished, replaying that branch reconstructs it completely.
//   - LOCAL operational state: `createLocalCursorStore` below. It is a perf hint only — a cache of
//     "where I last looked" — never consulted for correctness. Deleting it costs one extra fetch,
//     never a lost or duplicated actuation, because `actuateTopAction` always re-reads the durable
//     store immediately before deciding whether to write.

export function selectTopQueueItem(contract) {
  return contract.queue[0] ?? null
}

function unitRefLabel(unitRef) {
  return `${unitRef.kind}:${unitRef.number}`
}

// The event id is a pure function of (unit, gate class, subject digest) — never of wall-clock time
// or which runner computed it. Two actuators racing on the identical open gate compute the
// identical id, which is what lets the durable store's own compare-and-swap (non-force
// fast-forward ref update; see github-run-store.mjs) collapse them to one write instead of two.
function deterministicEventId(item) {
  return `gate-pending:${unitRefLabel(item.unitRef)}:${item.gate.gateClass}:${item.gate.subjectDigest}`
}

// Reseals the queue item's gate summary back into a real gate record (createGate is deterministic:
// same inputs, same digest) and wraps it in a `gate-pending` event — "a decision is owed and by
// whom," carrying no instruction about how anyone is notified (see gate.mjs). The record is carried
// as the payload of a `checkpoint` run-event: `checkpoint` is already a kind lib/core/run-state.mjs
// accepts unconditionally (including on a paused/blocked run), so recording that a gate opened
// needs no new event kind and no change to the run state machine.
export function buildGateActuationEvent({
  item,
  runId,
  previousDigest,
  generation,
  eventId,
  timestamp,
}) {
  const gate = createGate({
    gateClass: item.gate.gateClass,
    subjectDigest: item.gate.subjectDigest,
    subjectKind: item.gate.subjectKind,
    requiredRole: item.gate.requiredRole,
  })
  const gatePending = createGatePendingEvent(gate, unitRefLabel(item.unitRef))
  return createRunEvent({
    runId,
    id: eventId,
    previousDigest,
    generation,
    kind: 'checkpoint',
    payload: { kind: 'gate-actuation', gatePending, action: item.action },
    timestamp,
  })
}

// Actuates the single top item in the readiness contract's human decision queue against `runStore`
// (any store implementing the `{ read, append }` contract from lib/sources/*-run-store.mjs — the
// GitHub-backed one in production, the in-memory or file-backed ones in tests). No lock is held in
// memory anywhere: single actuation under concurrency comes entirely from re-reading the durable
// store immediately before writing, and from the store's own compare-and-swap append.
export async function actuateTopAction({
  contract,
  runStore,
  runId,
  now = () => new Date().toISOString(),
}) {
  const item = selectTopQueueItem(contract)
  if (!item) return { actuated: false, reason: 'queue-empty' }
  const eventId = deterministicEventId(item)
  const current = await runStore.read()
  const alreadyRecorded = current.events.find((event) => event.id === eventId)
  if (alreadyRecorded) {
    return {
      actuated: true,
      reason: 'already-recorded',
      unitRef: item.unitRef,
      event: alreadyRecorded,
    }
  }
  const generation = reduceRun(current.events)?.generation ?? 0
  const event = buildGateActuationEvent({
    item,
    runId,
    previousDigest: current.revision,
    generation,
    eventId,
    timestamp: now(),
  })
  try {
    const result = await runStore.append(event, current.revision)
    return { actuated: true, unitRef: item.unitRef, event, result }
  } catch (error) {
    // Lost (or arrived after) another actuator's write for the identical gate. Never retry blindly
    // on a guess — read back once and check identity: if the same gate is durably recorded, this
    // run converged with the winner instead of failing; otherwise it is a real, reportable error.
    const reconciled = await runStore.read()
    const settled = reconciled.events.find((candidate) => candidate.id === eventId)
    if (settled)
      return { actuated: true, reason: 'converged', unitRef: item.unitRef, event: settled }
    return { actuated: false, reason: 'error', error: error.message }
  }
}

// LOCAL, DISPOSABLE operational state — see the D3 note above. Never treat a value read from here
// as authoritative; it exists purely so a re-run in the same checkout can skip work it already did.
export function createLocalCursorStore(path) {
  return {
    path,
    read() {
      if (!existsSync(path)) return { lastRevision: null, lastEventId: null }
      try {
        return JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        return { lastRevision: null, lastEventId: null }
      }
    },
    write(cursor) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(cursor))
    },
  }
}

async function loadCommandCenterInputs({ client, repo }) {
  const openIssues = await client.issues(repo, { state: 'open', per_page: 100 })
  const issues = openIssues.filter((issue) => !issue.pull_request)
  const commentsByIssue = {}
  const pullRequestsByIssue = {}
  for (const issue of issues) {
    commentsByIssue[issue.number] = await client.issueComments(repo, issue.number)
    pullRequestsByIssue[issue.number] = await relatedPullRequests({
      client,
      repo,
      issueNumber: issue.number,
      goal: issue,
    })
  }
  return { issues, commentsByIssue, pullRequestsByIssue }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!repo || !token) {
    throw new Error('actuate-readiness requires GITHUB_REPOSITORY and GITHUB_TOKEN (or GH_TOKEN)')
  }
  const client = createGitHubClient({ token })
  const { issues, commentsByIssue, pullRequestsByIssue } = await loadCommandCenterInputs({
    client,
    repo,
  })
  const model = buildCommandCenterModel({ issues, commentsByIssue, pullRequestsByIssue, repo })
  const contract = buildReadinessContract(model)
  const item = selectTopQueueItem(contract)
  if (!item) {
    process.stdout.write('No open human gate to actuate.\n')
    return
  }
  const cursorPath = resolve(
    process.env.AGENTFLOW_ACTUATOR_CURSOR || '.agent-runs/actuator-cursor.json',
  )
  const cursor = createLocalCursorStore(cursorPath)
  const runId = `readiness-${item.unitRef.number}`
  const runStore = createGitHubRunStore({
    repo,
    runId,
    client,
    boundary: 'external-action',
    setupConfirm: process.env.AGENTFLOW_COORDINATION_CONFIRM,
  })
  const result = await actuateTopAction({ contract, runStore, runId })
  if (result.actuated)
    cursor.write({
      lastRevision: result.event?.digest ?? null,
      lastEventId: result.event?.id ?? null,
    })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const invokedPath = process.argv[1]?.replace(/\\/g, '/')
const invokedDirectly = invokedPath?.endsWith('/scripts/actuate-readiness.mjs')
if (
  !process.env.VITEST_WORKER_ID &&
  process.env.npm_lifecycle_event !== 'test' &&
  invokedDirectly &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
