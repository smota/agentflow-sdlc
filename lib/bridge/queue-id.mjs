// Stable ids for rig queue rows that carry source work (#582). Every id is derived from the
// source reference alone, so the same item always maps to the same row and a repeated push is an
// idempotent re-delivery, never a second row. See docs/openrig-bridge.md.
import { createHash } from 'node:crypto'

const MAX_ID_LENGTH = 64
const LIVE_ROW_STATES = ['pending', 'in-progress', 'blocked']
const LIVE_INSTANCE_STATES = ['active', 'waiting']
const TIER_BY_CHANGE_CLASS = {
  bounded: 'fast',
  standard: 'routine',
  'high-assurance': 'critical',
}

function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex')
}

export function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function stableQueueId({ system, scope, id } = {}) {
  const head = `af-${slug(system)}-${sha256(scope).slice(0, 8)}-`
  const tail = slug(id)
  if (!slug(system) || !tail) throw new Error('stableQueueId requires system and id')
  return `${head}${tail}`.slice(0, MAX_ID_LENGTH)
}

export function sliceIdFor({ system, id } = {}) {
  return `${slug(system)}-${slug(id)}`
}

// The id of the n-th intake of the same item, used once the base row is terminal and the item is
// ready again. Generation 1 is the base id itself.
export function generationId(base, n) {
  if (!Number.isInteger(n) || n < 2) throw new Error('generation must be an integer >= 2')
  return `${base}-g${n}`
}

// One offer row per delivery rig (#586). Kept here so every id rule lives in one module.
export function offerQueueId(base, rig) {
  return `${base}-${sha256(rig).slice(0, 6)}`
}

export function itemTag(stableId) {
  return `af:${stableId}`
}

export function stableIdFromTags(tags) {
  const tag = (tags ?? []).find((value) => typeof value === 'string' && value.startsWith('af:'))
  return tag ? tag.slice(3) : null
}

export function tierForChangeClass(changeClass) {
  return TIER_BY_CHANGE_CLASS[changeClass] ?? 'routine'
}

export function reviewGate(stableId) {
  return `external:review:${stableId}`
}

export function mergeGate(stableId) {
  return `external:merge:${stableId}`
}

export function replayGate(stableId) {
  return `external:reconcile-replay:${stableId}`
}

// The OpenRig session that holds a seat on a rig: the inverse of callerSeat
// (lib/core/seat-claim.mjs), which turns the first hyphen of the logical name into a dot.
export function sessionForSeat(seat, rig) {
  if (!seat || !rig) throw new Error('sessionForSeat requires seat and rig')
  return `${String(seat).replace('.', '-')}@${rig}`
}

export function isLiveRow(row) {
  return LIVE_ROW_STATES.includes(row?.state)
}

export function isLiveInstance(instance) {
  return LIVE_INSTANCE_STATES.includes(instance?.status)
}

export { LIVE_ROW_STATES, LIVE_INSTANCE_STATES }
