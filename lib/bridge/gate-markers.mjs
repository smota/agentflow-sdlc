// Open-gate markers (#586). Backpressure counts open person gates from the source alone, so the
// bridge records each park of a row on a bridge gate as source comment lines:
//   <!-- agentflow-gate:waiting:<name> -->   when it parks or observes the row
//   <!-- agentflow-gate:closed:<name> -->    when it resolves the gate or the row stops waiting
// A source adapter reports `openGates` = names with a waiting marker and no closed marker, counting
// only markers written by its trusted writers (the filesystem source does).
//
// The name is `<gate>@<qitem id>~<n>`: one name per park, so a row that parks again after a
// resolve gets a new name (and a new idempotency key) and counts again. Only markers written by
// trusted writers are read; anyone else's marker is ignored.
import { createHash } from 'node:crypto'

const MARKER = /<!-- agentflow-gate:(waiting|closed):([^\s>]+) -->/g
// Gates the bridge itself names (queue-id.mjs): review, merge, reconcile replay, failed start.
const BRIDGE_GATE = /^external:(review|merge|reconcile-replay|start-failed):(.+)$/
const NAME = /^(.+)~(\d+)$/

export function formatGateMarker(state, name) {
  if (state !== 'waiting' && state !== 'closed') throw new Error(`unknown gate state ${state}`)
  if (typeof name !== 'string' || !name || /[\s>]/.test(name))
    throw new Error('gate marker name must be one token')
  return `<!-- agentflow-gate:${state}:${name} -->`
}

// The park a name belongs to: `<gate>@<qitem id>`.
export function parkBase(blockedOn, qitemId) {
  return `${blockedOn}@${qitemId}`
}

export function gateMarkerName(base, seq) {
  return `${base}~${seq}`
}

// The stable id a bridge gate belongs to, or null for any other block.
export function stableIdFromGate(blockedOn) {
  return BRIDGE_GATE.exec(String(blockedOn ?? ''))?.[2] ?? null
}

function parseName(name) {
  const match = NAME.exec(name)
  if (!match) return null
  const at = match[1].lastIndexOf('@')
  if (at === -1 || !stableIdFromGate(match[1].slice(0, at))) return null
  return { base: match[1], seq: Number(match[2]) }
}

// From source log entries in order, counting only trusted writers' markers:
// { open: Map(base → name), lastSeq: Map(base → n) }.
export function gateMarkerState(entries, trustedWriters) {
  const trusted = new Set(trustedWriters ?? [])
  const waiting = new Set()
  const closed = new Set()
  const lastSeq = new Map()
  for (const entry of entries ?? []) {
    if (!trusted.has(entry?.writer)) continue
    for (const [, state, name] of String(entry?.body ?? '').matchAll(MARKER)) {
      const parsed = parseName(name)
      if (!parsed) continue
      lastSeq.set(parsed.base, Math.max(lastSeq.get(parsed.base) ?? 0, parsed.seq))
      ;(state === 'waiting' ? waiting : closed).add(name)
    }
  }
  const open = new Map()
  for (const name of waiting) {
    if (!closed.has(name)) open.set(parseName(name).base, name)
  }
  return { open, lastSeq }
}

// One source entry per marker: retries are idempotent, a new park is a new name and a new key.
export function gateMarkerKey(state, name) {
  return `gate-${state}-${createHash('sha256').update(name).digest('hex').slice(0, 24)}`
}
