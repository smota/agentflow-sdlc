// Gate authority (#585): whether a source entry may answer a gate.
//
// Identity: the writer is the source-provided identity of the log entry (comment author, the
// filesystem log `writer`) as read by the adapter. It is resolved to a source handle with the
// adapter's `resolve-humans` capability, checked against the ASCII handle pattern, then matched
// to a roster person. Nothing in the entry's text names the person: the decision marker carries
// only the gate, the decision and the review.
//
// Trust, all fail-closed:
// - no roster → nothing is admitted here; the existing single-person path stays in charge
// - an invalid roster, an absent resolve-humans capability, or an entry without a source writer
//   and address admits nothing
// - an edited entry never agrees or withdraws (`edited-entry`); a high-assurance gate also refuses
//   such an entry whose edit state the adapter did not supply (`edit-state-unknown`). Either still
//   counts as a refusal
// - the gate id binds the current evidence or candidate digest (`<ref>:<name>:<digest>`): a
//   agreement for an earlier digest is `stale-gate`, a refusal or withdrawal carries forward to the
//   new digest, and a gate without a digest (64 hex for high-assurance) admits nothing
// - the adapter's own writer and every configured bridge writer (claim, evidence, assignee mirror)
//   are never authorized, even if a roster handle names them (decision 9)
// - a self-declared writer (filesystem source) cannot answer a high-assurance gate unless the
//   roster sets highAssurance.allowSelfDeclaredWriters
// - a roster person answers only gates their scope covers (gate-router.mjs scopeCovers)
// - a refusal stands until the same person agrees or withdraws; nobody else can override it
// - a decision said in chat or put on a queue row is not a source entry and counts for nothing
import { callSourceCapability, isCapabilityAbsent } from '../core/source-adapter.mjs'
import { requireGate, scopeCovers } from './gate-router.mjs'
import {
  HANDLE,
  HIGH_ASSURANCE_REVIEWS,
  personForHandle,
  validateTeamRoster,
} from './team-roster.mjs'

export const DECISION_MARKER = 'agentflow-gate-decision:'
export const GATE_DECISIONS = Object.freeze(['agree', 'changes-requested', 'blocked', 'withdrawn'])
export const REFUSALS = Object.freeze(['changes-requested', 'blocked'])
// Sources whose writer identity is declared by whoever writes the log, not proven by the source.
export const SELF_DECLARED_SYSTEMS = Object.freeze(['filesystem'])
export const GATE_DIGEST = /^[0-9a-f]{32,64}$/
export const HIGH_ASSURANCE_DIGEST = /^[0-9a-f]{64}$/
const MARKER_LINE = /^<!-- agentflow-gate-decision:(\{.*\}) -->[ \t]*$/
const DECISION_KEYS = ['v', 'gate', 'decision', 'review']
const lower = (value) => String(value).toLowerCase()

function decisionProblems(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['not an object']
  const problems = []
  if (value.v !== 1) problems.push('v must be 1')
  if (
    typeof value.gate !== 'string' ||
    !value.gate ||
    /[\r\n]/.test(value.gate) ||
    value.gate.length > 300
  )
    problems.push('gate must be a single-line id')
  if (!GATE_DECISIONS.includes(value.decision)) problems.push('unknown decision')
  if (value.review !== undefined && !HIGH_ASSURANCE_REVIEWS.includes(value.review))
    problems.push('unknown review')
  for (const key of Object.keys(value))
    if (!DECISION_KEYS.includes(key)) problems.push(`unexpected key ${key}`)
  return problems
}

// A gate id binds the subject it asks about: `<source ref>:<gate name>:<digest>`, where the digest
// is the current evidence or candidate digest (32–64 lowercase hex; a high-assurance gate needs the
// full 64). A new round has a new digest. The caller computes the digest from the source itself.
export function formatGateId({ ref, name, digest }) {
  if (typeof ref !== 'string' || !ref || /\s/.test(ref)) throw new Error('gate ref is required')
  if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name))
    throw new Error('gate name is invalid')
  if (!GATE_DIGEST.test(digest ?? '')) throw new Error('gate digest must be 32-64 lowercase hex')
  return `${ref}:${name}:${digest}`
}

function unbound(gateId) {
  const index = gateId.lastIndexOf(':')
  return index === -1 ? gateId : gateId.slice(0, index)
}

function bindingProblem(gate) {
  const pattern = gate.tier === 'high-assurance' ? HIGH_ASSURANCE_DIGEST : GATE_DIGEST
  if (!pattern.test(gate.digest ?? '')) return 'gate-unbound'
  if (!gate.id.endsWith(`:${gate.digest}`)) return 'gate-unbound'
  return null
}

// The first line of a source comment: <!-- agentflow-gate-decision:{"v":1,"gate":…,"decision":…} -->
export function formatGateDecision({ gate, decision, review }) {
  const value = { v: 1, gate, decision, ...(review ? { review } : {}) }
  const problems = decisionProblems(value)
  if (problems.length) throw new Error(`invalid gate decision: ${problems.join('; ')}`)
  return `<!-- ${DECISION_MARKER}${JSON.stringify(value)} -->`
}

export function parseGateDecision(body) {
  const first = String(body ?? '')
    .split('\n', 1)[0]
    .replace(/\r$/, '')
  const match = first.match(MARKER_LINE)
  if (!match) return null
  let value
  try {
    value = JSON.parse(match[1])
  } catch {
    return null
  }
  if (decisionProblems(value).length) return null
  return { gate: value.gate, decision: value.decision, review: value.review ?? null }
}

// From the adapter: `edited` (boolean), or `createdAt` and `updatedAt`. Anything else is unknown.
export function entryEditState(entry) {
  if (entry?.edited === true) return 'edited'
  if (entry?.edited === false) return 'unedited'
  if (typeof entry?.createdAt === 'string' && entry.createdAt) {
    if (entry.updatedAt === undefined || entry.updatedAt === null) return 'unknown'
    return entry.updatedAt === entry.createdAt ? 'unedited' : 'edited'
  }
  return 'unknown'
}

// Writers that act for the rig or the bridge: claim writers, evidence writers, assignee mirror.
export function botWritersFromBridge(raw) {
  const source = raw?.source ?? {}
  const names = [
    ...(Array.isArray(source.claimWriters) ? source.claimWriters : []),
    ...(Array.isArray(source.evidenceWriters) ? source.evidenceWriters : []),
    source.mirrorAssignee,
  ]
  return [...new Set(names.filter((name) => typeof name === 'string' && name))]
}

const refuse = (reason, personId = null) => ({ authorized: false, personId, reason })

// → { authorized, personId|null, reason }. `review` is the high-assurance review being answered;
// it replaces the gate type in the scope check.
export async function authorizeWriter({
  writer,
  roster,
  adapter,
  gate,
  review = null,
  botWriters = [],
}) {
  if (!roster) return refuse('no-roster')
  const checked = requireGate(gate)
  // Structural check only: a handle that names a bot writer is refused below as bot-writer.
  if (!validateTeamRoster(roster).ok) return refuse('invalid-roster')
  if (typeof writer !== 'string' || !writer) return refuse('no-writer')
  const bots = new Set([...botWriters, adapter?.writer].filter(Boolean).map(lower))
  if (bots.has(lower(writer)) || bots.has(lower(writer.trim()))) return refuse('bot-writer')
  const resolved = await callSourceCapability(adapter, 'resolve-humans', 'resolveHumans', [writer])
  if (isCapabilityAbsent(resolved)) return refuse('resolve-humans-absent')
  const handle = (Array.isArray(resolved) ? resolved : []).find(
    (item) => item?.writer === writer,
  )?.handle
  if (!handle || typeof handle.login !== 'string' || typeof handle.system !== 'string')
    return refuse('writer-not-on-roster')
  if (!HANDLE.test(handle.login)) return refuse('invalid-handle')
  if (bots.has(lower(handle.login))) return refuse('bot-writer')
  const person = personForHandle(roster, handle)
  if (!person) return refuse('writer-not-on-roster')
  if (
    checked.tier === 'high-assurance' &&
    SELF_DECLARED_SYSTEMS.includes(handle.system) &&
    roster.highAssurance?.allowSelfDeclaredWriters !== true
  )
    return refuse('self-declared-writer', person.id)
  if (!scopeCovers(person, { ...checked, type: review ?? checked.type }))
    return refuse('out-of-scope', person.id)
  return { authorized: true, personId: person.id, reason: 'in-scope' }
}

// A source log entry is { writer, body, uri, edited | createdAt+updatedAt } as read through the
// source adapter. Anything without a source writer and a source address (a queue `resolve`, a
// chat line) is not recorded in the source and is refused before its text is read.
export async function admitGateDecision({ entry, gate, roster, adapter, botWriters = [] }) {
  const base = { recorded: true, opensGate: false, satisfies: [], personId: null }
  if (
    !entry ||
    typeof entry.writer !== 'string' ||
    !entry.writer ||
    typeof entry.uri !== 'string' ||
    !entry.uri
  ) {
    return { ...base, recorded: false, reason: 'not-recorded-in-source' }
  }
  const checked = requireGate(gate)
  const parsed = parseGateDecision(entry.body)
  if (!parsed) return { ...base, reason: 'not-a-decision' }
  const highAssurance = checked.tier === 'high-assurance'
  const refusal = REFUSALS.includes(parsed.decision)
  // An edited entry, or one of unknown edit state on a high-assurance gate, is not trusted to
  // agree or withdraw. It still counts as a refusal: blocking is the safe direction.
  const editState = entryEditState(entry)
  const trusted = editState === 'unedited' || (editState === 'unknown' && !highAssurance)
  if (!trusted && !refusal)
    return { ...base, reason: editState === 'edited' ? 'edited-entry' : 'edit-state-unknown' }
  const binding = bindingProblem(checked)
  if (binding) return { ...base, reason: binding }
  // A decision for an earlier digest of the same gate: an agreement never carries forward; a
  // refusal or a withdrawal does, so a new digest cannot wipe a standing refusal.
  let carriedFrom = null
  if (parsed.gate !== checked.id) {
    if (unbound(parsed.gate) !== unbound(checked.id)) return { ...base, reason: 'other-gate' }
    if (parsed.decision === 'agree') return { ...base, reason: 'stale-gate' }
    carriedFrom = parsed.gate
  }
  if (highAssurance && !parsed.review) return { ...base, reason: 'review-required' }
  if (!highAssurance && parsed.review) return { ...base, reason: 'unexpected-review' }
  const auth = await authorizeWriter({
    writer: entry.writer,
    roster,
    adapter,
    gate: checked,
    review: parsed.review,
    botWriters,
  })
  if (!auth.authorized) return { ...base, personId: auth.personId, reason: auth.reason }
  const recordedDecision = {
    ...base,
    personId: auth.personId,
    decision: parsed.decision,
    review: parsed.review,
    ...(carriedFrom ? { carriedFrom } : {}),
    ...(trusted ? {} : { editState }),
  }
  if (parsed.decision === 'withdrawn') return { ...recordedDecision, reason: 'withdrawn' }
  if (refusal) return { ...recordedDecision, reason: 'refused' }
  return {
    ...recordedDecision,
    opensGate: true,
    satisfies: [parsed.review ?? checked.type],
    reason: 'in-scope',
  }
}

// One review slot from admitted decisions in source order. Each person's latest decision is what
// they stand on: a refusal from anyone blocks the slot until that same person agrees or withdraws.
// Returns { agreed: [personId…], refusedBy: [personId…] }.
function slotState(decisions, review) {
  const latest = new Map()
  for (const item of decisions ?? []) {
    if (item.review !== review) continue
    latest.set(item.personId, item.decision)
  }
  const agreed = []
  const refusedBy = []
  for (const [personId, decision] of latest) {
    if (decision === 'agree') agreed.push(personId)
    else if (REFUSALS.includes(decision)) refusedBy.push(personId)
  }
  return { agreed, refusedBy }
}

// decisions: admitted decisions in source order, [{ personId, review, decision }].
export function highAssuranceGateState(decisions, { distinctReviewers = false } = {}) {
  const security = slotState(decisions, 'security-review')
  const acceptance = slotState(decisions, 'acceptance-review')
  const securityOpen = security.refusedBy.length === 0 ? security.agreed : []
  const acceptanceOpen = acceptance.refusedBy.length === 0 ? acceptance.agreed : []
  let pair = null
  for (const s of securityOpen) {
    const a = acceptanceOpen.find((person) => !distinctReviewers || person !== s)
    if (a) {
      pair = [s, a]
      break
    }
  }
  const refusedBy = [...new Set([...security.refusedBy, ...acceptance.refusedBy])]
  let reason = 'both-reviews'
  if (!pair) {
    if (refusedBy.length) reason = 'refused'
    else if (!securityOpen.length || !acceptanceOpen.length) reason = 'review-missing'
    else reason = 'same-person'
  }
  return {
    security: pair ? pair[0] : (securityOpen[0] ?? null),
    acceptance: pair ? pair[1] : (acceptanceOpen[0] ?? null),
    refusedBy,
    distinctReviewers,
    satisfied: Boolean(pair),
    reason,
  }
}

// The gate's state from the source log alone: entries in source order. Never reads the queue.
export async function gateDecisionState({ entries, gate, roster, adapter, botWriters = [] }) {
  const checked = requireGate(gate)
  if (!roster)
    return { gateId: checked.id, satisfied: false, reason: 'no-roster', fallback: 'single-person' }
  const decisions = []
  const ignored = []
  for (const item of entries ?? []) {
    const admitted = await admitGateDecision({
      entry: item,
      gate: checked,
      roster,
      adapter,
      botWriters,
    })
    if (admitted.decision) {
      decisions.push({
        personId: admitted.personId,
        decision: admitted.decision,
        review: admitted.review,
        uri: item.uri,
      })
    } else {
      ignored.push({ uri: item?.uri ?? null, reason: admitted.reason })
    }
  }
  if (checked.tier === 'high-assurance') {
    const highAssurance = highAssuranceGateState(decisions, {
      distinctReviewers: roster.highAssurance?.distinctReviewers === true,
    })
    return {
      gateId: checked.id,
      satisfied: highAssurance.satisfied,
      highAssurance,
      decisions,
      ignored,
    }
  }
  const slot = slotState(
    decisions.map((item) => ({ ...item, review: null })),
    null,
  )
  const satisfied = slot.refusedBy.length === 0 && slot.agreed.length > 0
  return {
    gateId: checked.id,
    satisfied,
    approvedBy: satisfied ? slot.agreed[0] : null,
    refusedBy: slot.refusedBy,
    decisions,
    ignored,
  }
}
