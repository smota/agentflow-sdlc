// Backpressure (#586): the bridge stops projecting new work while the open person gates on the
// source reach the team's capacity to answer them. More rigs only help while people keep up.
//
// openGates is derived from the source alone: the sum of `openGates` over the source's open work
// items. The bridge keeps it true by writing an open-gate marker (gate-markers.mjs) for every row
// parked on a review, merge or replay gate, and a closed marker when the gate resolves; a source
// that cannot write comments cannot record gates, so intake is held. Capacity is the sum of the roster people's `capacity` (default 3 each, lib/roster); with no
// roster it is `maxOpenGates` (default 3, one person). These defaults are unmeasured: record gate
// wait time and open-gate counts to revise them (docs/openrig-bridge.md).
import {
  callSourceCapability,
  isCapabilityAbsent,
  sourceCapability,
} from '../core/source-adapter.mjs'
import { capacityFor } from '../roster/team-roster.mjs'

export const DEFAULT_MAX_OPEN_GATES = 3

export function gateCapacity({ roster = null, maxOpenGates = DEFAULT_MAX_OPEN_GATES } = {}) {
  const people = Array.isArray(roster?.people) ? roster.people : []
  if (people.length) return people.reduce((sum, person) => sum + capacityFor(person), 0)
  return Number.isInteger(maxOpenGates) && maxOpenGates > 0 ? maxOpenGates : DEFAULT_MAX_OPEN_GATES
}

export function countOpenGates(workItems) {
  return (workItems ?? [])
    .filter((item) => item?.lifecycle === 'open')
    .reduce((sum, item) => sum + (Number.isInteger(item.openGates) ? item.openGates : 0), 0)
}

// An admission port for createBridge. Each call re-reads the source unless the caller passes the
// open items it already listed (reconcile does, to keep one pass one listing). `pending` counts
// items already admitted in the same pass against capacity, so one reconcile does not overshoot.
// Concurrent intakes can still overshoot by the number running at once (docs/openrig-bridge.md).
// → async ({ openItems, pending }) => { admit, open, openGates, pending, capacity, reason }
export function gateCapacityAdmission({
  source,
  roster = null,
  maxOpenGates = DEFAULT_MAX_OPEN_GATES,
}) {
  const capacity = gateCapacity({ roster, maxOpenGates })
  return async ({ openItems = null, pending = 0 } = {}) => {
    if (!sourceCapability(source, 'mutate-comments').available) {
      // Gates the source cannot record cannot be counted; hold rather than guess.
      return {
        admit: false,
        open: false,
        openGates: null,
        capacity,
        reason: 'gate-markers-unwritable',
      }
    }
    if (typeof source.readLogEntries !== 'function') {
      // Without the log the bridge cannot tell one park from the next; hold rather than guess.
      return {
        admit: false,
        open: false,
        openGates: null,
        capacity,
        reason: 'gate-log-unreadable',
      }
    }
    let items = openItems
    if (!items) {
      items = await callSourceCapability(source, 'ready-predicates', 'listWorkItems', {
        lifecycle: 'open',
      })
      if (isCapabilityAbsent(items)) {
        // Without a listing the gate count is unknown; hold intake rather than guess.
        return {
          admit: false,
          open: false,
          openGates: null,
          capacity,
          reason: 'gate-count-unavailable',
        }
      }
    }
    const openGates = countOpenGates(items)
    const open = openGates + pending < capacity
    return {
      admit: open,
      open,
      openGates,
      ...(pending ? { pending } : {}),
      capacity,
      reason: open ? null : 'gate-capacity',
    }
  }
}
