import { readSeatLease } from './seat-lease.mjs'
import { callerSeat } from '../core/seat-claim.mjs'
export { callerSeat, claimExisting } from '../core/seat-claim.mjs'

/**
 * Checks that the caller may write a transition naming `seat`, before anything is written.
 * Supports both `claimSeat({ seat, caller }, options)` and `claimSeat(session, seat, options)`.
 * Returns the fields the transition records. A different known seat is refused.
 */
export function claimSeat(first, second, third = {}) {
  let seat
  let caller
  let rawSession = null
  let options = {}

  if (first && typeof first === 'object' && ('seat' in first || 'caller' in first)) {
    seat = first.seat
    if (first.caller && typeof first.caller === 'object') {
      caller = first.caller
    } else if (typeof first.caller === 'string') {
      rawSession = first.caller.trim()
      caller = callerSeat(first.caller)
    } else if (typeof first.session === 'string') {
      rawSession = first.session.trim()
      caller = callerSeat(first.session)
    } else {
      caller = null
    }
    options = { ...first, ...(second || {}) }
  } else {
    seat = second
    if (first && typeof first === 'object') {
      caller = first
    } else if (typeof first === 'string') {
      rawSession = first.trim()
      caller = callerSeat(first)
    } else {
      caller = null
    }
    options = third || {}
  }

  if (caller) {
    if (caller.seat !== seat) {
      throw new Error(
        `Session ${caller.session} holds seat ${caller.seat} and cannot append a transition as seat ${seat}`,
      )
    }
    return { seatVerified: true, seatRig: caller.rig }
  }

  if (options.targetDir && rawSession) {
    const lease = readSeatLease(options.targetDir, seat, { now: options.now })
    if (lease && !lease.expired && lease.occupantSession === rawSession) {
      return {
        seatVerified: true,
        seatRig: lease.platform || 'local-lease',
        lease: true,
      }
    }
  }

  return { seatVerified: false, seatRig: null }
}
