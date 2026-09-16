// Anchors a terminal cockpit intent in the append-only coordination log instead of leaving it as
// only a GitHub comment. This module is the one place that routes intent writes through
// createGitHubRunStore (D3): it builds no parallel store, no parallel event kind, and adds no new
// guard — it reuses `checkpoint`, the run-state event kind that already carries an opaque payload
// through reduceRun without touching phase/candidate/rework state, and lets the store's existing
// idempotency-by-digest, optimistic-concurrency, non-force-fast-forward, and size-cap guards do
// their job untouched.
import { createGitHubRunStore } from './sources/github-run-store.mjs'
import { createRunEvent } from './core/run-state.mjs'
import { requireDeliveryRecord } from './core/delivery-record.mjs'
import { buildTerminalIntentEnvelope } from './cockpit-actions.mjs'

// Deterministic from the subject alone, so resubmitting the exact same closure (same subject
// digest) is naturally idempotent through the store's own duplicate-id-with-matching-digest path,
// and re-attempting with a genuinely different decision over the same subject is naturally a
// conflict — both for free, from append()'s existing guard.
export function terminalIntentEventId(subjectDigest) {
  return `close-unit:${subjectDigest}`
}

export async function appendTerminalIntent({
  client,
  repo,
  runId,
  intent,
  boundary = 'external-action',
}) {
  const store = createGitHubRunStore({ repo, runId, client, boundary })
  const envelope = buildTerminalIntentEnvelope({
    intentType: intent.type,
    subjectDigest: intent.subjectDigest,
    attestation: intent.attestation,
    preApprovalRefs: intent.preApprovalRefs,
  })
  const current = await store.read()
  const event = createRunEvent({
    runId,
    id: terminalIntentEventId(intent.subjectDigest),
    previousDigest: current.revision,
    kind: 'checkpoint',
    payload: { agentflowIntent: envelope },
  })
  const result = await store.append(event, current.revision)
  return { envelope, event, result }
}

export async function readAnchoredTerminalIntent({
  client,
  repo,
  runId,
  subjectDigest,
  boundary = 'observe',
}) {
  const store = createGitHubRunStore({ repo, runId, client, boundary })
  const { events } = await store.read()
  const event = events.find((item) => item.id === terminalIntentEventId(subjectDigest))
  if (!event) return null
  return requireDeliveryRecord(event.payload.agentflowIntent, 'cockpit-intent-envelope')
}
