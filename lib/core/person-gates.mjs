import { hasCurrentDigest } from './record-digest.mjs'
import { satisfyGate } from './gate.mjs'
import { validateReviewAttestation } from './review-attestation.mjs'
import { describeRuntimePlatform } from '../runtime-platforms.mjs'

// Person gates on the work record. The log is append-only: a gate opens, a person answers, and an
// agent may act on a person's behalf. Statuses are projected from the log, never stored. A gate
// status is not a process state and never changes one, and a phase transition is never an answer.
//
// The decision rule stays in satisfyGate (lib/core/gate.mjs). judgeAnswer only names, with a
// distinct reason, why a record does not satisfy a gate; it never accepts what satisfyGate refuses.

export const HUMAN_PLATFORM = 'human'
export const GATE_STATUSES = Object.freeze(['waiting', 'agreed', 'refused', 'stale'])
export const ON_BEHALF_LABEL = 'agent action on behalf of the person'

export const REJECTIONS = Object.freeze({
  agentSignature: 'agent-signature',
  staleSubject: 'stale-subject',
  alteredGate: 'altered-gate',
  grantAsAgreement: 'grant-as-agreement',
  refusalAsSatisfaction: 'refusal-as-satisfaction',
  invalidAnswer: 'invalid-answer',
})

const REASON_TEXT = {
  [REJECTIONS.agentSignature]:
    'the answer is not from the registered human platform with human-gate independence',
  [REJECTIONS.staleSubject]: "the answer is not bound to the gate's current subject",
  [REJECTIONS.alteredGate]: 'the gate was altered after it was sealed',
  [REJECTIONS.grantAsAgreement]:
    "an on-behalf action or delegation grant is not the person's answer",
  [REJECTIONS.refusalAsSatisfaction]: 'a refusal does not satisfy a gate; only agree does',
  [REJECTIONS.invalidAnswer]: 'the answer record is malformed',
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function isAgentPlatform(slug) {
  const platform = describeRuntimePlatform(slug)
  return Boolean(platform) && platform.kind !== 'human'
}

// An on-behalf entry or a grant carries a principal, a grant, or a grant binding. A person's answer
// carries none of them.
function looksLikeGrant(record) {
  return (
    record?.kind === 'on-behalf' ||
    record?.principal !== undefined ||
    record?.grantRef !== undefined ||
    record?.binding !== undefined ||
    record?.issuerActor !== undefined
  )
}

/** Who must answer: the required role on the registered human platform, and a named person only
 * when the project names one. An agent is never the who. */
export function gateWho(gate, { person = null } = {}) {
  const who = { role: gate.requiredRole, platform: HUMAN_PLATFORM, person: null }
  if (person !== null && person !== undefined) {
    const name = text(person, 'person')
    if (describeRuntimePlatform(name)) {
      throw new Error(`${name} is a runtime platform, not a person; an agent is never the who`)
    }
    who.person = name
  }
  return who
}

export function gateEntry(gate, { person = null, openedAt } = {}) {
  if (gate?.type !== 'gate' || !hasCurrentDigest(gate)) {
    throw new Error('A gate entry needs a sealed gate record')
  }
  return {
    kind: 'gate',
    gate,
    who: gateWho(gate, { person }),
    openedAt: text(openedAt, 'openedAt'),
  }
}

export function answerEntry(gateDigest, attestation, { recordedAt } = {}) {
  return {
    kind: 'answer',
    gateDigest: text(gateDigest, 'gateDigest'),
    attestation,
    recordedAt: text(recordedAt, 'recordedAt'),
  }
}

export function onBehalfEntry({
  principal,
  actor,
  grantRef,
  action,
  subjectKind,
  subjectDigest,
  recordedAt,
} = {}) {
  const platform = text(actor?.platform, 'actor.platform')
  if (!isAgentPlatform(platform)) {
    throw new Error('An on-behalf actor is an agent runtime platform, never the person')
  }
  if (!/^[a-f0-9]{64}$/.test(subjectDigest ?? '')) {
    throw new Error('subjectDigest must be a SHA-256 digest')
  }
  return {
    kind: 'on-behalf',
    label: ON_BEHALF_LABEL,
    principal: text(principal, 'principal'),
    actor: { platform, executor: text(actor?.executor, 'actor.executor') },
    grantRef: text(grantRef, 'grantRef'),
    action: text(action, 'action'),
    subjectKind: text(subjectKind, 'subjectKind'),
    subjectDigest,
    recordedAt: text(recordedAt, 'recordedAt'),
  }
}

/**
 * Decides whether one answer satisfies one gate, and names every reason it does not.
 * `currentSubjectDigest` is the subject of the newest gate of the same class on the item.
 */
export function judgeAnswer(gate, answer, { currentSubjectDigest = gate?.subjectDigest } = {}) {
  const reasons = []
  if (gate?.type !== 'gate' || !hasCurrentDigest(gate)) reasons.push(REJECTIONS.alteredGate)
  if (looksLikeGrant(answer)) {
    reasons.push(REJECTIONS.grantAsAgreement)
    return verdict(reasons)
  }
  const shape = validateReviewAttestation(answer)
  if (!shape.ok) {
    reasons.push(REJECTIONS.invalidAnswer)
    return verdict(reasons, shape.errors)
  }
  const reviewer = answer.reviewer ?? {}
  if (
    reviewer.independence !== 'human-gate' ||
    describeRuntimePlatform(reviewer.platform)?.kind !== 'human'
  ) {
    reasons.push(REJECTIONS.agentSignature)
  }
  if (
    answer.reviewedDigest !== gate?.subjectDigest ||
    gate?.subjectDigest !== currentSubjectDigest
  ) {
    reasons.push(REJECTIONS.staleSubject)
  }
  if (answer.decision !== 'agree') reasons.push(REJECTIONS.refusalAsSatisfaction)
  // The existing rule has the last word. Nothing here may accept what it refuses.
  if (!reasons.length) {
    const decided = satisfyGate(gate, answer)
    if (!decided.ok) return verdict([REJECTIONS.invalidAnswer], decided.errors)
  }
  return verdict(reasons)
}

function verdict(reasons, details = []) {
  return {
    ok: reasons.length === 0,
    reasons,
    messages: [...reasons.map((reason) => REASON_TEXT[reason]), ...details],
  }
}

// A person's answer to this gate: human, well formed, on this gate's own subject, and the gate is
// intact. Only such an answer moves the status. Anything else is reported and ignored.
function personAnswered(judged) {
  const disqualifying = [
    REJECTIONS.agentSignature,
    REJECTIONS.alteredGate,
    REJECTIONS.grantAsAgreement,
    REJECTIONS.invalidAnswer,
  ]
  return !judged.reasons.some((reason) => disqualifying.includes(reason))
}

/** Projects every gate entry's status, the on-behalf entries, and a verdict for every answer. */
export function projectGates(log = []) {
  const entries = Array.isArray(log) ? log : []
  const gates = entries.filter((entry) => entry?.kind === 'gate')
  const answers = entries.filter((entry) => entry?.kind === 'answer')
  const onBehalf = entries.filter((entry) => entry?.kind === 'on-behalf')
  // The newest gate of a class holds the current subject. An older one is stale.
  const currentByClass = new Map()
  for (const entry of gates) currentByClass.set(entry.gate.gateClass, entry.gate.subjectDigest)

  const verdicts = []
  const projected = gates.map((entry) => {
    const { gate } = entry
    const current = currentByClass.get(gate.gateClass)
    let status = gate.subjectDigest === current ? 'waiting' : 'stale'
    let answer = null
    for (const item of answers.filter((candidate) => candidate.gateDigest === gate.digest)) {
      const judged = judgeAnswer(gate, item.attestation, { currentSubjectDigest: current })
      verdicts.push({
        gateDigest: gate.digest,
        decision: item.attestation?.decision ?? null,
        ok: judged.ok,
        reasons: judged.reasons,
      })
      // An answer to a different subject than this gate's own is not an answer to this gate.
      if (!personAnswered(judged) || item.attestation.reviewedDigest !== gate.subjectDigest)
        continue
      answer = {
        decision: item.attestation.decision,
        person: item.attestation.reviewer.executor,
        at: item.attestation.timestamp,
        subjectDigest: item.attestation.reviewedDigest,
        findings: item.attestation.findings ?? [],
      }
      if (gate.subjectDigest !== current) status = 'stale'
      else status = item.attestation.decision === 'agree' ? 'agreed' : 'refused'
    }
    return {
      gateDigest: gate.digest,
      gateClass: gate.gateClass,
      status,
      satisfied: status === 'agreed',
      who: entry.who,
      subjectKind: gate.subjectKind,
      subjectDigest: gate.subjectDigest,
      openedAt: entry.openedAt,
      answer,
    }
  })
  return {
    gates: projected,
    onBehalf: onBehalf.map((entry) => ({ ...entry })),
    verdicts,
  }
}

/** Checks every record in a log. Gate seals, answer bindings, and on-behalf shape. */
export function validateGateLog(log = []) {
  const findings = []
  const entries = Array.isArray(log) ? log : []
  const gateDigests = new Set()
  for (const [index, entry] of entries.entries()) {
    if (entry?.kind === 'gate') {
      if (entry.gate?.type !== 'gate' || !hasCurrentDigest(entry.gate)) {
        findings.push({ index, reason: REJECTIONS.alteredGate })
      }
      if (
        entry.who?.platform !== HUMAN_PLATFORM ||
        describeRuntimePlatform(entry.who?.person ?? '')
      ) {
        findings.push({ index, reason: REJECTIONS.agentSignature })
      }
      gateDigests.add(entry.gate?.digest)
    } else if (entry?.kind === 'answer') {
      if (!gateDigests.has(entry.gateDigest))
        findings.push({ index, reason: REJECTIONS.staleSubject })
    } else if (entry?.kind !== 'on-behalf') {
      findings.push({ index, reason: REJECTIONS.invalidAnswer })
    }
  }
  const { verdicts } = projectGates(entries)
  for (const item of verdicts) {
    for (const reason of item.reasons) {
      if (reason === REJECTIONS.refusalAsSatisfaction) continue
      findings.push({ gateDigest: item.gateDigest, reason })
    }
  }
  return { ok: findings.length === 0, findings }
}

export function waitingGates(log = [], { role = null, person = null } = {}) {
  return projectGates(log).gates.filter(
    (gate) =>
      gate.status === 'waiting' &&
      (!role || gate.who.role === role) &&
      (!person || gate.who.person === person),
  )
}

/**
 * Checks one new entry against the log before a medium appends it. Returns the entry to store, or
 * null when the same gate is already open. Throws with the rejection reason otherwise.
 */
export function admitGateEntry(log = [], entry) {
  if (entry?.kind === 'gate') {
    const admitted = gateEntry(entry.gate, { person: entry.who?.person, openedAt: entry.openedAt })
    if (entry.who?.role !== entry.gate.requiredRole || entry.who?.platform !== HUMAN_PLATFORM) {
      throw new Error('A gate entry names its required role on the human platform')
    }
    const open = log.some((item) => item?.kind === 'gate' && item.gate.digest === entry.gate.digest)
    return open ? null : admitted
  }
  if (entry?.kind === 'on-behalf') return onBehalfEntry(entry)
  if (entry?.kind !== 'answer')
    throw new Error('A gate log entry is a gate, an answer, or on-behalf')
  const target = log.find((item) => item?.kind === 'gate' && item.gate.digest === entry.gateDigest)
  if (!target)
    throw new Error(`${REJECTIONS.staleSubject}: no gate ${entry.gateDigest} is open here`)
  const current = [...log]
    .reverse()
    .find((item) => item?.kind === 'gate' && item.gate.gateClass === target.gate.gateClass)
    .gate.subjectDigest
  const judged = judgeAnswer(target.gate, entry.attestation, { currentSubjectDigest: current })
  const blocking = judged.reasons.filter((reason) => reason !== REJECTIONS.refusalAsSatisfaction)
  if (blocking.length) throw new Error(`${blocking.join(', ')}: ${judged.messages.join('; ')}`)
  return answerEntry(entry.gateDigest, entry.attestation, { recordedAt: entry.recordedAt })
}

/** What a reader of one work item sees: projected gates, on-behalf actions, and the verdicts. */
export function gateView(log = []) {
  return { ...projectGates(log), validation: validateGateLog(log) }
}
