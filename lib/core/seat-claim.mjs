// A transition may name a seat only when that seat wrote it. The caller is the OpenRig session
// `<logical>@<rig>`; the logical name maps to a phase seat by turning its first hyphen into a dot.
// This is the local trust model, not a signature: it stops one known seat from appending as
// another, and it marks a transition with no seat identity as unverified.

const SESSION = /^([^@\s]+)@([^@\s]+)$/

/** The caller seat from a session name, or null when it is missing, empty, or not one session. */
export function callerSeat(sessionName) {
  if (typeof sessionName !== 'string') return null
  const match = sessionName.trim().match(SESSION)
  if (!match) return null
  const [, logical, rig] = match
  return { session: match[0], seat: logical.replace('-', '.'), rig }
}

/**
 * Checks that the caller may write a transition naming `seat`, before anything is written.
 * Returns the fields the transition records. A different known seat is refused.
 */
export function claimSeat({ seat, caller }) {
  if (!caller) return { seatVerified: false, seatRig: null }
  if (caller.seat !== seat) {
    throw new Error(
      `Session ${caller.session} holds seat ${caller.seat} and cannot append a transition as seat ${seat}`,
    )
  }
  return { seatVerified: true, seatRig: caller.rig }
}

/**
 * Checks a repeated idempotency key. The same caller gets the existing transition back; a
 * different known seat, or the same seat from another rig, is refused. Nothing is written either way.
 */
export function claimExisting({ existing, caller }) {
  if (!caller) return
  const otherRig = existing.seatRig && existing.seatRig !== caller.rig
  if (existing.seat !== caller.seat || otherRig) {
    throw new Error(
      `Session ${caller.session} cannot reuse key ${existing.idempotencyKey}, which seat ${existing.seat} recorded`,
    )
  }
}
