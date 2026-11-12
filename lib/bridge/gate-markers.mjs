// Open-gate markers (#586). Backpressure counts open person gates from the source alone, so the
// bridge records each gate a row parks on as a source comment line:
//   <!-- agentflow-gate:waiting:<name> -->   when it parks or observes the row
//   <!-- agentflow-gate:closed:<name> -->    when it resolves the gate or the row stops waiting
// A source adapter reports `openGates` = names with a waiting marker and no closed marker (the
// filesystem source does). The name is `<gate>@<qitem id>`, unique per parked row, so a gate that
// parks again in a later round is a new name and counts again.
import { createHash } from 'node:crypto'

const MARKER = /<!-- agentflow-gate:(waiting|closed):([^\s>]+) -->/g
// Gates the bridge itself names (queue-id.mjs): review, merge, reconcile replay.
const BRIDGE_GATE = /^external:(review|merge|reconcile-replay):(.+)$/

export function formatGateMarker(state, name) {
  if (state !== 'waiting' && state !== 'closed') throw new Error(`unknown gate state ${state}`)
  if (typeof name !== 'string' || !name || /[\s>]/.test(name))
    throw new Error('gate marker name must be one token')
  return `<!-- agentflow-gate:${state}:${name} -->`
}

export function gateMarkerName(blockedOn, qitemId) {
  return `${blockedOn}@${qitemId}`
}

// The stable id a bridge gate belongs to, or null for any other block.
export function stableIdFromGate(blockedOn) {
  return BRIDGE_GATE.exec(String(blockedOn ?? ''))?.[2] ?? null
}

// Bridge marker names still waiting, from source log entries in order.
export function openGateMarkers(entries) {
  const waiting = new Set()
  const closed = new Set()
  for (const entry of entries ?? []) {
    for (const [, state, name] of String(entry?.body ?? '').matchAll(MARKER)) {
      const at = name.lastIndexOf('@')
      if (at === -1 || !stableIdFromGate(name.slice(0, at))) continue
      ;(state === 'waiting' ? waiting : closed).add(name)
    }
  }
  return new Set([...waiting].filter((name) => !closed.has(name)))
}

// One source entry per marker: retries are idempotent.
export function gateMarkerKey(state, name) {
  return `gate-${state}-${createHash('sha256').update(name).digest('hex').slice(0, 24)}`
}
