// Source claim ledger (#580). A claim is an append-only log entry in the source system; the
// source-provided writer identity of each entry (comment author, filesystem log writer) decides
// whether it counts. A native field such as an assignee or a lock file is a mirror: written for
// people to see, never read back as truth.
import { randomBytes } from 'node:crypto'
import { callSourceCapability, isCapabilityAbsent } from './source-adapter.mjs'

export const CLAIM_MARKER = 'agentflow-claim:'
const ENTRY_KEYS = ['v', 'type', 'claimId', 'owner', 'at', 'cause']
const CLAIM_ID = /^[0-9a-f]{16}$/
const MARKER_LINE = /^<!-- agentflow-claim:(\{.*\}) -->[ \t]*$/
const nonEmpty = (value) => typeof value === 'string' && value.length > 0

function ownerProblems(owner) {
  if (!owner || typeof owner !== 'object') return ['owner must be an object']
  if (owner.kind === 'rig') {
    const problems = []
    if (!nonEmpty(owner.rig)) problems.push('owner.rig is required for a rig owner')
    if (owner.host !== undefined && !nonEmpty(owner.host))
      problems.push('owner.host must be a non-empty string')
    for (const key of Object.keys(owner)) {
      if (!['kind', 'rig', 'host'].includes(key)) problems.push(`unexpected owner key ${key}`)
    }
    return problems
  }
  if (owner.kind === 'person') {
    const problems = nonEmpty(owner.id) ? [] : ['owner.id is required for a person owner']
    for (const key of Object.keys(owner)) {
      if (!['kind', 'id'].includes(key)) problems.push(`unexpected owner key ${key}`)
    }
    return problems
  }
  return ['owner.kind must be rig or person']
}

function causeProblems(cause) {
  if (cause === null || cause === undefined) return []
  if (typeof cause !== 'object' || cause.kind !== 'mirror-change' || !nonEmpty(cause.actor)) {
    return ['cause must be null or { kind: mirror-change, actor, eventId }']
  }
  return []
}

export function claimEntryProblems(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry))
    return ['entry must be an object']
  const problems = []
  if (entry.v !== 1) problems.push('v must be 1')
  if (!['claim', 'release'].includes(entry.type)) problems.push('type must be claim or release')
  if (!CLAIM_ID.test(entry.claimId ?? ''))
    problems.push('claimId must be 16 lowercase hex characters')
  problems.push(...ownerProblems(entry.owner))
  if (!nonEmpty(entry.at) || Number.isNaN(Date.parse(entry.at)))
    problems.push('at must be an ISO timestamp')
  problems.push(...causeProblems(entry.cause))
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.includes(key)) problems.push(`unexpected key ${key}`)
  }
  return problems
}

function entry(type, { owner, claimId, at, cause = null } = {}) {
  const value = {
    v: 1,
    type,
    claimId: claimId ?? randomBytes(8).toString('hex'),
    owner,
    at: at ?? new Date().toISOString(),
    cause,
  }
  const problems = claimEntryProblems(value)
  if (problems.length) throw new Error(`invalid claim entry: ${problems.join('; ')}`)
  return value
}

export function claimEntry(fields) {
  return entry('claim', fields)
}

export function releaseEntry(fields) {
  return entry('release', fields)
}

export function formatClaimMarker(value) {
  const problems = claimEntryProblems(value)
  if (problems.length) throw new Error(`invalid claim entry: ${problems.join('; ')}`)
  const json = JSON.stringify(value)
  if (json.includes('-->')) throw new Error('claim entry must not contain -->')
  return `<!-- ${CLAIM_MARKER}${json} -->`
}

// The marker must be the first line, as for transitions: a comment quoting one in prose is not a
// claim. A marker that does not hold a valid entry is not a claim either.
export function parseClaimMarker(text) {
  if (typeof text !== 'string') return null
  const match = text.split(/\r?\n/, 1)[0].match(MARKER_LINE)
  if (!match) return null
  try {
    const value = JSON.parse(match[1])
    return claimEntryProblems(value).length ? null : value
  } catch {
    return null
  }
}

export function ownersEqual(a, b) {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'rig') return a.rig === b.rig && (a.host ?? null) === (b.host ?? null)
  if (a.kind === 'person') return a.id === b.id
  return false
}

// entries: [{ entry, writer, position, uri }] as read from the source log. Earliest trusted claim
// wins; only the holder's owner can release it.
export function resolveClaim(entries, { trustedWriters } = {}) {
  if (!Array.isArray(trustedWriters)) throw new Error('resolveClaim requires trustedWriters')
  const trusted = new Set(trustedWriters)
  const ordered = [...(entries ?? [])]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.position ?? a.index) - (b.row.position ?? b.index) || a.index - b.index)
    .map(({ row }) => row)
  const ignored = []
  let held = null
  for (const row of ordered) {
    const ignore = (reason) => ignored.push({ uri: row.uri ?? null, reason })
    if (!trusted.has(row.writer)) {
      ignore('untrusted-writer')
      continue
    }
    if (claimEntryProblems(row.entry).length) {
      ignore('invalid-entry')
      continue
    }
    const { type, owner } = row.entry
    if (type === 'claim') {
      if (!held) held = row
      else ignore(ownersEqual(held.entry.owner, owner) ? 'already-held' : 'held-by-another-owner')
    } else if (!held) {
      ignore('release-while-free')
    } else if (ownersEqual(held.entry.owner, owner)) {
      held = null
    } else {
      ignore('release-by-non-holder')
    }
  }
  if (!held) return { status: 'free', holder: null, entry: null, uri: null, ignored }
  return {
    status: 'held',
    holder: held.entry.owner,
    entry: held.entry,
    uri: held.uri ?? null,
    ignored,
  }
}

// Claim, then yield if another owner holds the item: the losing entry is released so the log
// reads plainly. Returns the capability-absent result for an adapter without claim.
export async function claimOrYield({ adapter, reference, owner }) {
  const state = await callSourceCapability(adapter, 'claim', 'claim', reference, owner)
  if (isCapabilityAbsent(state)) return state
  if (state.status === 'held' && ownersEqual(state.holder, owner)) {
    return { won: true, holder: state.holder }
  }
  await callSourceCapability(adapter, 'claim', 'release', reference, owner)
  return { won: false, holder: state.holder ?? null }
}
