import { createGate, satisfyGate, GATE_CLASSES } from './core/gate.mjs'
import {
  sealDeliveryRecord,
  requireDeliveryRecord,
  requireDigest,
} from './core/delivery-record.mjs'

export const COCKPIT_INTENTS = [
  'ask-status',
  'add-clarification',
  'request-checkpoint',
  'request-human-review',
  'draft-follow-up',
  'update-issue-section',
  'post-handover',
  'start-next-phase',
  'close-unit',
]

// close-unit is the one intent that terminates something rather than advising on it. It is
// legitimate precisely because — unlike the entries in FORBIDDEN_REMOTE_ACTIONS below — it cannot
// be expressed without a human's own signed, digest-bound attestation over the exact subject being
// closed. mark-review-passed asserts a review happened; close-unit IS the reviewer's decision.
const TERMINAL_INTENTS = new Set(['close-unit'])

export const FORBIDDEN_REMOTE_ACTIONS = [
  'mark-validation-passed',
  'mark-review-passed',
  'bypass-human-gate',
  'merge-pr',
  'weaken-acceptance-criteria',
  'delete-evidence',
]

export function parseCockpitIntent(input = {}) {
  const type = input.type || input.intent
  if (!COCKPIT_INTENTS.includes(type)) {
    return { ok: false, errors: [`unknown-intent:${type || 'missing'}`] }
  }
  if (TERMINAL_INTENTS.has(type)) return parseTerminalIntent(input)
  return {
    ok: true,
    intent: {
      type,
      repo: input.repo,
      issue: input.issue,
      body: input.body || '',
      evidenceRefs: input.evidenceRefs || [],
      requiresDurableEvidence: MATERIAL_INTENTS.has(type),
    },
  }
}

// A terminal intent satisfies a gate or it is refused — there is no third outcome. The gate is
// built fresh from the claimed subjectDigest (a release-of-candidate gate, the same class a formal
// SDLC run uses to require review before shipping a candidate) and satisfyGate is the only path to
// ok:true, exactly as in lib/core/gate.mjs. Nothing here re-derives what counts as a valid
// attestation; that stays owned by validateReviewAttestation.
function parseTerminalIntent(input) {
  let gate
  try {
    gate = createGate({
      gateClass: GATE_CLASSES.releaseOfCandidate,
      subjectDigest: input.subjectDigest,
      subjectKind: 'candidateDigest',
      requiredRole: input.requiredRole || 'maintainer',
    })
  } catch (error) {
    return { ok: false, errors: [error.message] }
  }
  const verdict = satisfyGate(gate, input.attestation)
  if (!verdict.ok) return { ok: false, errors: verdict.errors }
  return {
    ok: true,
    intent: {
      type: input.type || input.intent,
      repo: input.repo,
      issue: input.issue,
      body: input.body || '',
      subjectDigest: input.subjectDigest,
      attestation: input.attestation,
      preApprovalRefs: Array.isArray(input.preApprovalRefs) ? input.preApprovalRefs : [],
      evidenceRefs: input.evidenceRefs || [],
      requiresDurableEvidence: true,
      gate,
    },
  }
}

export function evaluateGuardedAction({
  action,
  userRole = 'viewer',
  highAssurance = false,
  confirmation = false,
} = {}) {
  const reasons = []
  if (FORBIDDEN_REMOTE_ACTIONS.includes(action)) reasons.push('forbidden-by-policy')
  if (WRITE_ACTIONS.has(action) && !['operator', 'maintainer', 'admin'].includes(userRole))
    reasons.push('role-cannot-write')
  if (ADMIN_ACTIONS.has(action) && !['maintainer', 'admin'].includes(userRole))
    reasons.push('role-cannot-admin')
  if (highAssurance && HIGH_ASSURANCE_BLOCKED_ACTIONS.has(action))
    reasons.push('high-assurance-human-gate-required')
  if ((WRITE_ACTIONS.has(action) || ADMIN_ACTIONS.has(action)) && !confirmation)
    reasons.push('confirmation-required')
  return { ok: reasons.length === 0, reasons }
}

export function createActionPreview({ action, target, summary, durableEffect } = {}) {
  return {
    action,
    target,
    summary,
    durableEffect,
    requiresConfirmation: WRITE_ACTIONS.has(action) || ADMIN_ACTIONS.has(action),
  }
}

// The fenced block below is the ONLY thing readCockpitIntentEnvelope ever looks at. The prose above
// it is for humans; it is never parsed back into a decision, however convincingly it reads.
const INTENT_ENVELOPE_LANGUAGE = 'agentflow-intent'
const INTENT_ENVELOPE_FENCE = new RegExp('```' + INTENT_ENVELOPE_LANGUAGE + '\\n([\\s\\S]*?)\\n```')

// The typed payload that survives the write boundary: intent type, subject digest, actor, verdict,
// timestamp (D2), plus a reference to whatever pre-approval exchange preceded the decision (D4) —
// a reference, never a copied transcript. Sealed with sealDeliveryRecord so the envelope carries its
// own digest and self-tampering (edit the fields, forget to recompute the hash) is caught for free
// by requireDeliveryRecord in readCockpitIntentEnvelope.
export function buildTerminalIntentEnvelope({
  intentType,
  subjectDigest,
  attestation,
  preApprovalRefs = [],
}) {
  requireDigest(subjectDigest, 'subjectDigest')
  return sealDeliveryRecord('cockpit-intent-envelope', {
    intentType,
    subjectDigest,
    actor: attestation?.reviewer,
    verdict: attestation?.decision,
    timestamp: attestation?.timestamp,
    preApprovalRefs,
  })
}

export function formatDurableActionBody(intent) {
  const body = intent.body || ''
  if (TERMINAL_INTENTS.has(intent.type)) {
    const envelope = buildTerminalIntentEnvelope({
      intentType: intent.type,
      subjectDigest: intent.subjectDigest,
      attestation: intent.attestation,
      preApprovalRefs: intent.preApprovalRefs,
    })
    const prose = body || `Closing this unit — recorded decision: ${envelope.verdict}.`
    return `${prose}\n\n\`\`\`${INTENT_ENVELOPE_LANGUAGE}\n${JSON.stringify(envelope, null, 2)}\n\`\`\``
  }
  if (intent.type === 'post-handover') return `<!-- agent-handover -->\n${body}`
  if (intent.type === 'request-human-review')
    return `<!-- agentflow:human-review-request -->\n${body}`
  if (intent.type === 'draft-follow-up') return `<!-- agentflow:follow-up-proposal -->\n${body}`
  if (intent.type === 'add-clarification') return `Clarification:\n\n${body}`
  if (intent.type === 'request-checkpoint') return `Checkpoint requested:\n\n${body}`
  return body
}

// Reads a decision back the only legitimate way: parse the fenced envelope, validate it as a
// sealed delivery record (version, type, and digest self-consistency), and never look at the prose
// around it. There is no regex here that matches on words like "approved" or "closed" — a comment
// with no fenced block, or a malformed one, is simply not an intent.
export function readCockpitIntentEnvelope(commentBody) {
  const match = INTENT_ENVELOPE_FENCE.exec(commentBody || '')
  if (!match) return { ok: false, errors: ['no-intent-envelope'] }
  let envelope
  try {
    envelope = JSON.parse(match[1])
  } catch {
    return { ok: false, errors: ['invalid-envelope-json'] }
  }
  try {
    requireDeliveryRecord(envelope, 'cockpit-intent-envelope')
  } catch (error) {
    return { ok: false, errors: [error.message] }
  }
  return { ok: true, envelope }
}

// The visible GitHub comment is mutable; the run-store event is not. A reader compares the
// content-addressed digest of what the comment currently claims against the digest that was
// actually anchored at write time. Editing the comment's prose changes nothing (it was never
// authoritative); editing the envelope — however carefully, even re-hashing it into a
// self-consistent forgery — cannot reproduce the digest already committed to the append-only log.
export function detectCommentDivergence(commentEnvelope, anchoredEnvelope) {
  if (!commentEnvelope || !anchoredEnvelope)
    return { diverged: true, reasons: ['missing-envelope'] }
  if (commentEnvelope.digest !== anchoredEnvelope.digest)
    return { diverged: true, reasons: ['digest-mismatch'] }
  return { diverged: false, reasons: [] }
}

const MATERIAL_INTENTS = new Set([
  'add-clarification',
  'request-checkpoint',
  'request-human-review',
  'draft-follow-up',
  'update-issue-section',
  'post-handover',
  'start-next-phase',
])

const WRITE_ACTIONS = new Set([
  'add-clarification',
  'request-human-review',
  'draft-follow-up',
  'update-issue-section',
  'post-handover',
  'close-unit',
])

const ADMIN_ACTIONS = new Set(['start-next-phase'])

const HIGH_ASSURANCE_BLOCKED_ACTIONS = new Set(['start-next-phase'])
