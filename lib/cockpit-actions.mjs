import { createGate, satisfyGate, GATE_CLASSES } from './core/gate.mjs'
import {
  sealDeliveryRecord,
  requireDeliveryRecord,
  requireDigest,
} from './core/delivery-record.mjs'
import { recordDigest } from './core/record-digest.mjs'

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
  'gate-transition',
  'gate-answer',
]

// close-unit is the one intent that terminates something rather than advising on it. It is
// legitimate precisely because — unlike the entries in FORBIDDEN_REMOTE_ACTIONS below — it cannot
// be expressed without a human's own signed, digest-bound attestation over the exact subject being
// closed. mark-review-passed asserts a review happened; close-unit IS the reviewer's decision.
const TERMINAL_INTENTS = new Set(['close-unit'])

// #411: execution control. These actions start work, promote a phase, or hand work to a seat. They
// exist only when the project's own metadata names an execution layer. With none, the cockpit
// records work and runs none of it. Notes (a clarification, a follow-up, a section update, handover
// text, a status or review request) only record context on the source and never need one.
export const EXECUTION_INTENTS = Object.freeze(['start-next-phase', 'gate-transition'])

// OpenRig is the one execution layer. Pi is a runtime platform, not an execution layer.
export const EXECUTION_LAYERS = Object.freeze(['openrig'])

/** The execution layer a project's metadata names, or null for none. Nothing else turns it on. */
export function executionLayerOf(metadata = null) {
  const layer = metadata?.executionLayer
  return EXECUTION_LAYERS.includes(layer) ? layer : null
}

export function hasExecutionControl(executionLayer = null) {
  return EXECUTION_LAYERS.includes(executionLayer)
}

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
  // #384: a person's confirmation line typed into the cockpit answer box. It carries the line and
  // no body, and it promotes no phase.
  if (type === 'gate-answer') {
    return {
      ok: true,
      intent: { type, repo: input.repo, issue: input.issue, line: String(input.line ?? '') },
    }
  }
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
// built from the RESOLVED subjectDigest (a release-of-candidate gate, the same class a formal SDLC
// run uses to require review before shipping a candidate) and satisfyGate is the only path to
// ok:true, exactly as in lib/core/gate.mjs. Nothing here re-derives what counts as a valid
// attestation; that stays owned by validateReviewAttestation.
//
// W8a D2 — `input.subjectDigest` is the CLIENT's claim, not evidence. Before this fix the gate was
// built directly from that claim, so an attacker (or a buggy client) could submit any digest at all
// and have it walk straight through into the sealed gate and the run-store record — the human's
// attestation would be checked against a subject nobody server-side ever verified was the unit
// actually being closed. `input.unit` is the caller's server-resolved description of the real unit
// (the same shape a legitimate release-of-candidate gate for it was opened over, e.g.
// lib/cockpit-readiness-contract.mjs's `releaseCandidateSubject`); the digest is ALWAYS recomputed
// from it here, and the client's claimed subjectDigest is only ever compared against that — never
// trusted on its own.
function resolveUnitSubjectDigest(unit) {
  if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return null
  return recordDigest(unit)
}

function parseTerminalIntent(input) {
  const resolvedSubjectDigest = resolveUnitSubjectDigest(input.unit)
  if (!resolvedSubjectDigest) {
    return { ok: false, errors: ['unit is required to resolve the real subjectDigest'] }
  }
  if (input.subjectDigest !== resolvedSubjectDigest) {
    return { ok: false, errors: ['subjectDigest does not match the unit'] }
  }
  let gate
  try {
    gate = createGate({
      gateClass: GATE_CLASSES.releaseOfCandidate,
      subjectDigest: resolvedSubjectDigest,
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
      subjectDigest: resolvedSubjectDigest,
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
  actorId = null,
  authorId = null,
  waiver = null,
  executionLayer = null,
} = {}) {
  const reasons = []
  if (FORBIDDEN_REMOTE_ACTIONS.includes(action)) reasons.push('forbidden-by-policy')
  if (EXECUTION_INTENTS.includes(action) && !hasExecutionControl(executionLayer))
    reasons.push('no-execution-layer')
  if (
    (WRITE_ACTIONS.has(action) || ANSWER_ACTIONS.has(action)) &&
    !['operator', 'maintainer', 'admin'].includes(userRole)
  )
    reasons.push('role-cannot-write')
  if (ADMIN_ACTIONS.has(action) && !['maintainer', 'admin'].includes(userRole))
    reasons.push('role-cannot-admin')
  if (highAssurance && HIGH_ASSURANCE_BLOCKED_ACTIONS.has(action))
    reasons.push('high-assurance-human-gate-required')
  if ((WRITE_ACTIONS.has(action) || ADMIN_ACTIONS.has(action)) && !confirmation)
    reasons.push('confirmation-required')

  if (highAssurance && actorId && authorId && actorId === authorId) {
    reasons.push('dual-control-violation-author-cannot-approve')
  }

  if (waiver) {
    if (!waiver.reason || waiver.reason.trim().length < 10) {
      reasons.push('waiver-reason-required')
    }
    if (highAssurance && (!waiver.approverId || (authorId && waiver.approverId === authorId))) {
      reasons.push('dual-control-violation-waiver-author-cannot-approve')
    }
  }

  return { ok: reasons.length === 0, reasons }
}

export function evaluateGateTransition({
  currentPhase,
  targetPhase,
  readinessHealth = {},
  selectedPath = {},
  authorId = null,
  approverId = null,
  waiver = null,
  userRole = 'operator',
  confirmation = false,
} = {}) {
  const isHighAssurance =
    selectedPath.profile === 'high-assurance' ||
    selectedPath.risk === 'high' ||
    selectedPath.risk === 'critical'
  const reasons = []

  if (!['operator', 'maintainer', 'admin'].includes(userRole)) {
    reasons.push('role-cannot-promote')
  }

  if (isHighAssurance && authorId && approverId && authorId === approverId) {
    reasons.push('dual-control-violation-author-cannot-approve')
  }

  if (!confirmation) {
    reasons.push('confirmation-required')
  }

  const score = readinessHealth.score ?? 0
  const isHealthy = readinessHealth.grade === 'healthy' || score >= 80

  if (!isHealthy) {
    if (!waiver) {
      reasons.push('readiness-check-incomplete-waiver-required')
    } else {
      if (!waiver.reason || waiver.reason.trim().length < 15) {
        reasons.push('waiver-reason-too-short')
      }
      if (isHighAssurance && (!waiver.approverId || (authorId && waiver.approverId === authorId))) {
        reasons.push('dual-control-violation-waiver-author-cannot-approve')
      }
    }
  }

  return {
    allowed: reasons.length === 0,
    isHighAssurance,
    currentPhase,
    targetPhase,
    reasons,
    waiverApplied: Boolean(waiver && reasons.length === 0 && !isHealthy),
  }
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
    // W8d D4 — the full attestation is anchored too, not just the display-shaped actor/verdict/
    // timestamp fields above. Without it, a reader could only reconstruct a shape resembling a
    // human decision, never re-verify one: resolveAnchoredHumanGate needs the actual attestation to
    // hand to satisfyGate (lib/core/gate.mjs) at read time, alongside a gate rebuilt from
    // `subjectDigest` — completion is decided by satisfyGate accepting the pair, never by trusting
    // that this envelope's shape looks right.
    attestation: attestation ?? null,
  })
}

// A cockpit write to the source: a note becomes a comment and a follow-up becomes an issue. An
// execution action is refused here as well as in the guard, before anything is written, so a
// direct request writes nothing when the project names no execution layer.
export async function writeCockpitAction({
  intent,
  client,
  repo,
  title = null,
  executionLayer = null,
} = {}) {
  if (EXECUTION_INTENTS.includes(intent?.type) && !hasExecutionControl(executionLayer)) {
    return { ok: false, errors: ['no-execution-layer'] }
  }
  const body = formatDurableActionBody(intent)
  const result =
    intent.type === 'draft-follow-up'
      ? await client.createIssue(repo, {
          title: title || `Follow-up from #${intent.issue}`,
          body,
          labels: ['drafted-by:pi'],
        })
      : await client.createIssueComment(repo, intent.issue, body)
  return { ok: true, result }
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
  if (intent.type === 'gate-transition') {
    const waiverText = intent.waiver
      ? `\n\n**Waiver Justification:** ${intent.waiver.reason}\n**Waiver Approver:** ${intent.waiver.approverId}`
      : ''
    return `<!-- agentflow:gate-transition -->\n### Gate Transition: ${intent.currentPhase || 'current'} → ${intent.targetPhase || 'target'}\n\n${body}${waiverText}`
  }
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
  'gate-transition',
])

const WRITE_ACTIONS = new Set([
  'add-clarification',
  'request-human-review',
  'draft-follow-up',
  'update-issue-section',
  'post-handover',
  'close-unit',
  'gate-transition',
])

// The person's line is the whole answer, so the answer box asks for no second confirmation.
const ANSWER_ACTIONS = new Set(['gate-answer'])

const ADMIN_ACTIONS = new Set(['start-next-phase'])

const HIGH_ASSURANCE_BLOCKED_ACTIONS = new Set(['start-next-phase'])
