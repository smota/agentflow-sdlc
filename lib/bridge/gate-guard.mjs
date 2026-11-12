// Steering stays outside the rig (decision 9, #585 follow-up wired in #586). Bridge gate rows are
// resolved only by the out-of-rig bridge: a person, a relay or CI pushing an event. A call made
// from a delivery seat's OpenRig session (a worker) is refused, so a worker cannot open the gate on
// its own work.
//
// A session is refused when it is a seat session (`<pod>-<member>@<rig>`) and either
//   - its seat (canonical, through manifests/seats.json) is on the delivery or eval plane, or
//   - its rig is a configured delivery rig other than the control rig.
// Anything that is not a seat session (no OPENRIG_SESSION_NAME, `human@…`) is not refused here.
import { fileURLToPath } from 'node:url'
import { callerSeat } from '../core/seat-claim.mjs'
import { canonicalSeat } from '../core/seat-table.mjs'
import { loadSeatTable } from '../seat-table-io.mjs'

const WORKER_PLANES = new Set(['delivery', 'eval'])
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

let defaultTable = null
function packageSeatTable() {
  defaultTable ??= loadSeatTable(PACKAGE_ROOT)
  return defaultTable
}

// → null when the session may resolve gates, else the reason it may not.
export function gateResolutionRefusal({ session, rigs, seatTable = null }) {
  if (session === null || session === undefined || session === '') return null
  const caller = callerSeat(session)
  if (!caller || !caller.seat.includes('.')) return null
  const table = seatTable ?? packageSeatTable()
  const seat = canonicalSeat(table, caller.seat)
  const plane = (table?.seats ?? []).find((item) => item.id === seat)?.plane ?? null
  if (plane && WORKER_PLANES.has(plane)) {
    return `session ${caller.session} holds the ${plane} seat ${seat}; gate rows are resolved only outside the rig`
  }
  const delivery = rigs?.delivery ?? []
  if (delivery.includes(caller.rig) && caller.rig !== rigs?.control) {
    return `session ${caller.session} is on delivery rig ${caller.rig}; gate rows are resolved only outside the rig`
  }
  return null
}
