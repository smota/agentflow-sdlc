// Gate authority (#585): whether a source entry may answer a gate.
//
// Identity: the writer is the source-provided identity of the log entry (comment author, the
// filesystem log `writer`) as read by the adapter. It is resolved to a source handle with the
// adapter's `resolve-humans` capability, then to a roster person by handle. Nothing in the entry's
// text names the person: the decision marker carries only the gate, the decision and the review.
//
// Trust, all fail-closed:
// - no roster → nothing is admitted here; the existing single-person path stays in charge
// - an invalid roster, an absent resolve-humans capability, or an entry without a source writer
//   and address admits nothing
// - the adapter's own writer and every configured bridge writer (claim, evidence, assignee mirror)
//   are never authorized, even if a roster handle names them (decision 9: workers cannot approve
//   their own work)
// - a roster person answers only gates their scope covers (gate-router.mjs scopeCovers)
// - a decision said in chat or put on a queue row is not a source entry and counts for nothing
import { callSourceCapability, isCapabilityAbsent } from '../core/source-adapter.mjs'
import { requireGate, scopeCovers } from './gate-router.mjs'
import { HIGH_ASSURANCE_REVIEWS, personForHandle, validateTeamRoster } from './team-roster.mjs'

export const DECISION_MARKER = 'agentflow-gate-decision:'
export const GATE_DECISIONS = Object.freeze(['agree', 'changes-requested', 'blocked'])
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

// The first line of a source comment: <!-- agentflow-gate-decision:{"v":1,"gate":…,"decision":…} -->
export function formatGateDecision({ gate, decision, review }) {
  const value = { v: 1, gate, decision, ...(review ? { review } : {}) }
  const problems = decisionProblems(value)
  if (problems.length) throw new Error(`invalid gate decision: ${problems.join('; ')}`)
  return `<!-- ${DECISION_MARKER}${JSON.stringify(value)} -->`
}

export function parseGateDecision(body) {
  const first = String(body ?? '').split('\n', 1)[0]
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
  if (bots.has(lower(writer))) return refuse('bot-writer')
  const resolved = await callSourceCapability(adapter, 'resolve-humans', 'resolveHumans', [writer])
  if (isCapabilityAbsent(resolved)) return refuse('resolve-humans-absent')
  const handle = (Array.isArray(resolved) ? resolved : []).find(
    (item) => item?.writer === writer,
  )?.handle
  if (!handle || typeof handle.login !== 'string') return refuse('writer-not-on-roster')
  if (bots.has(lower(handle.login))) return refuse('bot-writer')
  const person = personForHandle(roster, handle)
  if (!person) return refuse('writer-not-on-roster')
  if (!scopeCovers(person, { ...checked, type: review ?? checked.type }))
    return refuse('out-of-scope', person.id)
  return { authorized: true, personId: person.id, reason: 'in-scope' }
}

// A source log entry is { writer, body, uri } as read through the source adapter. Anything without
// a source writer and a source address (a queue `resolve`, a chat line) is not recorded in the
// source and is refused before its text is read.
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
  if (parsed.gate !== checked.id) return { ...base, reason: 'other-gate' }
  const highAssurance = checked.tier === 'high-assurance'
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
  }
  if (parsed.decision !== 'agree') return { ...recordedDecision, reason: 'refused' }
  return {
    ...recordedDecision,
    opensGate: true,
    satisfies: [parsed.review ?? checked.type],
    reason: 'in-scope',
  }
}

// decisions: admitted decisions in source order, [{ personId, review, decision }]. The latest
// decision in each review slot holds it; only an agreement fills it.
export function highAssuranceGateState(decisions, { distinctReviewers = false } = {}) {
  const slot = (review) => {
    const last = (decisions ?? []).filter((item) => item.review === review).at(-1)
    return last?.decision === 'agree' ? last.personId : null
  }
  const security = slot('security-review')
  const acceptance = slot('acceptance-review')
  const samePerson = Boolean(security) && security === acceptance
  const satisfied = Boolean(security && acceptance) && !(distinctReviewers && samePerson)
  let reason = 'both-reviews'
  if (!security || !acceptance) reason = 'review-missing'
  else if (!satisfied) reason = 'same-person'
  return { security, acceptance, distinctReviewers, satisfied, reason }
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
    } else if (admitted.reason !== 'not-a-decision') {
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
  const last = decisions.at(-1)
  const satisfied = last?.decision === 'agree'
  return {
    gateId: checked.id,
    satisfied,
    approvedBy: satisfied ? last.personId : null,
    decisions,
    ignored,
  }
}
