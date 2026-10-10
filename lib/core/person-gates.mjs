import { hasCurrentDigest, recordDigest } from './record-digest.mjs'
import { createGate, satisfyGate } from './gate.mjs'
import { validateReviewAttestation } from './review-attestation.mjs'
import { describeRuntimePlatform } from '../runtime-platforms.mjs'
import { parseConfirmationPhrase } from './confirmation-phrase.mjs'
import { admissionDigest } from './work-altitude.mjs'

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

// An admission gate names the change class it admits. The class only says which subject is
// current for this gate; the sealed subject digest is what the person agrees to.
export function gateEntry(gate, { person = null, openedAt, changeClass = null } = {}) {
  if (gate?.type !== 'gate' || !hasCurrentDigest(gate)) {
    throw new Error('A gate entry needs a sealed gate record')
  }
  const admission = gate.subjectKind === 'admission'
  if (!admission && changeClass) throw new Error('Only an admission gate names a change class')
  return {
    kind: 'gate',
    gate,
    who: gateWho(gate, { person }),
    openedAt: text(openedAt, 'openedAt'),
    ...(admission ? { changeClass: text(changeClass, 'changeClass') } : {}),
  }
}

// A seat may copy a person's confirmation line onto the record (#383). The filing keeps the line as
// the person sent it and names the seat that filed it, apart from the person the line names. The
// line must say what the answer says, so an edited line, or an answer that differs from its line,
// never stands. The record is not proof of identity: a seat files only a line it was sent.
export function filingErrors(filing, { gateDigest, attestation } = {}) {
  if (typeof filing?.line !== 'string') return ['a filing keeps the person’s line']
  if (typeof filing.filedBy?.seat !== 'string' || !filing.filedBy.seat.trim()) {
    return ['a filing names the seat that filed the line']
  }
  const phrase = parseConfirmationPhrase(filing.line)
  if (!phrase.ok) return [`the filed line is not a confirmation phrase: ${phrase.reason}`]
  const errors = []
  if (!String(gateDigest ?? '').startsWith(phrase.subject)) {
    errors.push('the filed line names another gate')
  }
  if (attestation?.decision !== phrase.decision)
    errors.push('the answer is not the line’s decision')
  if (attestation?.reviewer?.executor !== phrase.name) {
    errors.push('the answer does not name the person in the line')
  }
  if (describeRuntimePlatform(phrase.name)) errors.push(`${phrase.name} is a runtime platform`)
  return errors
}

export function answerEntry(gateDigest, attestation, { recordedAt, filing = null } = {}) {
  const entry = {
    kind: 'answer',
    gateDigest: text(gateDigest, 'gateDigest'),
    attestation,
    recordedAt: text(recordedAt, 'recordedAt'),
  }
  if (filing === null || filing === undefined) return entry
  const errors = filingErrors(filing, entry)
  if (errors.length) throw new Error(`${REJECTIONS.invalidAnswer}: ${errors.join('; ')}`)
  const filedBy = { seat: filing.filedBy.seat.trim() }
  if (filing.filedBy.runtime) filedBy.runtime = text(filing.filedBy.runtime, 'filedBy.runtime')
  return { ...entry, filing: { line: filing.line, filedBy } }
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

/**
 * The subject a goal gate is bound to: what the person reads and agrees to. A phase pass, a label,
 * or the gate record itself is not a change to it. Both media compute it the same way.
 */
export function goalSubjectDigest({
  title,
  body = '',
  kind = null,
  parent = null,
  changeClass = null,
} = {}) {
  return recordDigest({
    type: 'goal-subject',
    title,
    body: String(body ?? '').trim(),
    kind,
    parent,
    changeClass,
  })
}

// One current subject per key. Each admission class is its own key, apart from the goal gate.
const keyOf = ({ gate, changeClass }) =>
  gate.subjectKind === 'admission'
    ? `${gate.gateClass}|admission|${changeClass}`
    : `${gate.gateClass}|${gate.subjectKind}`

const NO_SUBJECT = 'none'

// The subject a gate entry is current on, from the goal subject the medium computed.
function currentSubjectOf(entry, known) {
  const { gate } = entry
  if (gate.subjectKind === 'goalRevision') return known.goalRevision ?? null
  if (gate.subjectKind === 'admission') {
    if (!known.goalRevision) return null
    // An admission entry with no class has no current subject, so it is never shown as current.
    if (!entry.changeClass) return NO_SUBJECT
    return admissionDigest({ goalRevision: known.goalRevision, changeClass: entry.changeClass })
  }
  return known.candidateDigest ?? null
}

const withCandidate = (log, subjects) => ({ ...subjects, candidateDigest: currentCandidate(log) })

export function candidateEntry({ candidateDigest, recordedAt } = {}) {
  if (!/^[a-f0-9]{64}$/.test(candidateDigest ?? '')) {
    throw new Error('candidateDigest must be a SHA-256 digest')
  }
  return { kind: 'candidate', candidateDigest, recordedAt: text(recordedAt, 'recordedAt') }
}

// The work item's current candidate is the newest candidate it recorded. None means none.
export function currentCandidate(log = []) {
  const recorded = (Array.isArray(log) ? log : []).filter((entry) => entry?.kind === 'candidate')
  return recorded.length ? recorded[recorded.length - 1].candidateDigest : null
}

// The current subject of each gate class and subject kind. The goal subject comes from the medium,
// and the candidate from the item's own record. A gate never makes its own subject current.
function currentSubjects(gates, known = {}) {
  const current = new Map()
  for (const entry of gates) {
    const subject =
      entry.gate.subjectKind === 'candidateDigest'
        ? currentSubjectOf(entry, known)
        : (currentSubjectOf(entry, known) ?? entry.gate.subjectDigest)
    current.set(keyOf(entry), subject)
  }
  return current
}

// When the subject moved and no gate covers the new one yet, the item owes a decision on the new
// subject. That gate is derived from the newest gate of its kind, and recorded when it is answered.
function derivedGates(gates, current) {
  const newest = new Map()
  for (const entry of gates) newest.set(keyOf(entry), entry)
  const derived = []
  for (const [key, entry] of newest) {
    const subject = current.get(key)
    if (!subject || subject === NO_SUBJECT) continue
    if (gates.some((item) => keyOf(item) === key && item.gate.subjectDigest === subject)) continue
    const gate = createGate({
      gateClass: entry.gate.gateClass,
      subjectKind: entry.gate.subjectKind,
      subjectDigest: subject,
      requiredRole: entry.gate.requiredRole,
    })
    const changeClass = entry.changeClass ? { changeClass: entry.changeClass } : {}
    derived.push({
      kind: 'gate',
      gate,
      who: entry.who,
      openedAt: null,
      ...changeClass,
      derived: true,
    })
  }
  return derived
}

/** Projects every gate entry's status, the on-behalf entries, and a verdict for every answer. */
export function projectGates(log = [], { subjects = {} } = {}) {
  const entries = Array.isArray(log) ? log : []
  const recorded = entries.filter((entry) => entry?.kind === 'gate')
  const answers = entries.filter((entry) => entry?.kind === 'answer')
  const onBehalf = entries.filter((entry) => entry?.kind === 'on-behalf')
  const current = currentSubjects(recorded, withCandidate(entries, subjects))
  const gates = [...recorded, ...derivedGates(recorded, current)]

  const verdicts = []
  const projected = gates.map((entry) => {
    const { gate } = entry
    const subject = current.get(keyOf(entry))
    let status = gate.subjectDigest === subject ? 'waiting' : 'stale'
    let answer = null
    for (const item of answers.filter((candidate) => candidate.gateDigest === gate.digest)) {
      const judged = judgeAnswer(gate, item.attestation, { currentSubjectDigest: subject })
      // A filed line that does not say what its answer says is not the person's answer.
      if ('filing' in item && filingErrors(item.filing, item).length) {
        judged.ok = false
        judged.reasons = [...judged.reasons, REJECTIONS.invalidAnswer]
      }
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
        ...(item.filing ? { line: item.filing.line, filedBy: item.filing.filedBy } : {}),
      }
      if (gate.subjectDigest !== subject) status = 'stale'
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
      ...(entry.changeClass ? { changeClass: entry.changeClass } : {}),
      openedAt: entry.openedAt,
      ...(entry.derived ? { derived: true } : {}),
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
export function validateGateLog(log = [], { subjects = {} } = {}) {
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
      if (entry.gate?.subjectKind === 'admission' && !entry.changeClass) {
        findings.push({ index, reason: REJECTIONS.invalidAnswer })
      }
      gateDigests.add(entry.gate?.digest)
    } else if (entry?.kind === 'answer') {
      if (!gateDigests.has(entry.gateDigest))
        findings.push({ index, reason: REJECTIONS.staleSubject })
      if ('filing' in entry && filingErrors(entry.filing, entry).length)
        findings.push({ index, reason: REJECTIONS.invalidAnswer })
    } else if (!['on-behalf', 'candidate'].includes(entry?.kind)) {
      findings.push({ index, reason: REJECTIONS.invalidAnswer })
    }
  }
  const { gates, verdicts } = projectGates(entries, { subjects })
  for (const item of verdicts) {
    // A refusal is a valid record. A stale answer is history, shown on its gate as stale.
    for (const reason of item.reasons) {
      if (reason === REJECTIONS.refusalAsSatisfaction) continue
      const gate = gates.find((candidate) => candidate.gateDigest === item.gateDigest)
      if (reason === REJECTIONS.staleSubject && gate?.status === 'stale') continue
      findings.push({ gateDigest: item.gateDigest, reason })
    }
  }
  return { ok: findings.length === 0, findings }
}

/**
 * Checks one new entry against the log before a medium appends it. Returns the entries to store:
 * none when the same gate is already open, and a derived gate before the answer that closes it.
 * Throws with the rejection reason otherwise.
 */
export function admitGateEntry(log = [], entry, { subjects = {} } = {}) {
  const known = withCandidate(log, subjects)
  if (entry?.kind === 'candidate') return [candidateEntry(entry)]
  if (entry?.kind === 'gate') {
    const admitted = gateEntry(entry.gate, {
      person: entry.who?.person,
      openedAt: entry.openedAt,
      changeClass: entry.changeClass ?? null,
    })
    if (entry.who?.role !== entry.gate.requiredRole || entry.who?.platform !== HUMAN_PLATFORM) {
      throw new Error('A gate entry names its required role on the human platform')
    }
    // A gate opens only on the item's current subject. No candidate is invented.
    const subject = currentSubjectOf(admitted, known)
    if (entry.gate.subjectKind === 'candidateDigest' && !subject) {
      throw new Error('This item has no candidate; record one before opening a candidate gate')
    }
    if (subject && entry.gate.subjectDigest !== subject) {
      throw new Error(
        `${REJECTIONS.staleSubject}: a gate opens on the item's current ${entry.gate.subjectKind}`,
      )
    }
    const open = log.some((item) => item?.kind === 'gate' && item.gate.digest === entry.gate.digest)
    return open ? [] : [admitted]
  }
  if (entry?.kind === 'on-behalf') return [onBehalfEntry(entry)]
  if (entry?.kind !== 'answer')
    throw new Error('A gate log entry is a gate, an answer, or on-behalf')
  const recorded = log.filter((item) => item?.kind === 'gate')
  const current = currentSubjects(recorded, known)
  let target = recorded.find((item) => item.gate.digest === entry.gateDigest)
  const opened = []
  if (!target) {
    target = derivedGates(recorded, current).find((item) => item.gate.digest === entry.gateDigest)
    if (!target)
      throw new Error(`${REJECTIONS.staleSubject}: no gate ${entry.gateDigest} is open here`)
    opened.push(
      gateEntry(target.gate, {
        person: target.who.person,
        openedAt: entry.recordedAt,
        changeClass: target.changeClass ?? null,
      }),
    )
  }
  const judged = judgeAnswer(target.gate, entry.attestation, {
    currentSubjectDigest: current.get(keyOf(target)),
  })
  const blocking = judged.reasons.filter((reason) => reason !== REJECTIONS.refusalAsSatisfaction)
  if (blocking.length) throw new Error(`${blocking.join(', ')}: ${judged.messages.join('; ')}`)
  return [
    ...opened,
    answerEntry(entry.gateDigest, entry.attestation, {
      recordedAt: entry.recordedAt,
      filing: entry.filing ?? null,
    }),
  ]
}

/** What a reader of one work item sees: projected gates, on-behalf actions, and the verdicts. */
export function gateView(log = [], { subjects = {} } = {}) {
  return {
    ...projectGates(log, { subjects }),
    candidate: currentCandidate(log),
    validation: validateGateLog(log, { subjects }),
  }
}
