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
import { GATE_CLASSES, createGate, satisfyGate } from './core/gate.mjs'
import {
  buildTerminalIntentEnvelope,
  readCockpitIntentEnvelope,
  detectCommentDivergence,
} from './cockpit-actions.mjs'

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

// D5 (W8c) — wires the read-back that was built and never called: the cockpit reads a human's
// anchored close-unit decision back the only legitimate way (readAnchoredTerminalIntent, from the
// durable run store), never from GitHub comment prose alone. The visible comment is compared
// against the anchor purely as a tamper check (detectCommentDivergence): if someone edits the
// comment after the fact — or no matching comment exists any more — the decision is not honored.
//
// W8d D4 — DEFECT FIXED. This used to return a plain `{ gateClass, subjectDigest }` object: no gate
// was ever sealed, no attestation was ever re-checked, so a well-formed shape alone completed a
// human gate downstream in `deriveHumanGate`. It now rebuilds the actual adequacy-of-intent gate
// this subject would have (createGate, lib/core/gate.mjs — read-only, called here, never
// reimplemented) and re-verifies the anchored attestation against it with `satisfyGate` BEFORE ever
// producing a satisfiedGates entry: an anchored record whose attestation does not satisfy the gate
// (wrong decision, not a human reviewer, stale digest, ...) yields no entry at all, exactly like no
// decision having been anchored. `deriveHumanGate` independently calls `satisfyGate` again at the
// decision point (defense in depth — it never trusts that this function did it correctly), but this
// function no longer hands it something merely shaped like a satisfied gate.
export async function resolveAnchoredHumanGate({
  client,
  repo,
  runId,
  subjectDigest,
  comments = [],
}) {
  const anchored = await readAnchoredTerminalIntent({ client, repo, runId, subjectDigest })
  if (!anchored) return []
  const commentEnvelope = comments
    .map((comment) => readCockpitIntentEnvelope(comment.body || ''))
    .filter((read) => read.ok)
    .map((read) => read.envelope)
    .find((envelope) => envelope.subjectDigest === subjectDigest)
  if (detectCommentDivergence(commentEnvelope, anchored).diverged) return []
  let gate
  try {
    gate = createGate({
      gateClass: GATE_CLASSES.adequacyOfIntent,
      subjectDigest: anchored.subjectDigest,
      subjectKind: 'goalRevision',
      requiredRole: 'reviewer',
    })
  } catch {
    return []
  }
  const attestation = anchored.attestation
  if (!satisfyGate(gate, attestation).ok) return []
  return [{ gate, attestation }]
}
