// A transition may name a seat only when that seat wrote it. The caller is the OpenRig session
// `<logical>@<rig>`; the logical name maps to a phase seat by turning its first hyphen into a dot.
// Filesystem lease verification is composed by the runtime seat-claim adapter.

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
 * Checks a repeated idempotency key. The same caller gets the existing transition back; a
 * different known seat, or the same seat from another rig, is refused. Nothing is written either way.
 */
export function claimExisting(first, second) {
  let existing
  let caller

  if (first && typeof first === 'object' && ('existing' in first || 'caller' in first)) {
    existing = first.existing
    caller =
      first.caller && typeof first.caller === 'object' ? first.caller : callerSeat(first.caller)
  } else {
    existing = first
    caller = second && typeof second === 'object' ? second : callerSeat(second)
  }

  if (!caller || !existing) return
  const otherRig = existing.seatRig && existing.seatRig !== caller.rig
  if (existing.seat !== caller.seat || otherRig) {
    throw new Error(
      `Session ${caller.session} cannot reuse key ${existing.idempotencyKey}, which seat ${existing.seat} recorded`,
    )
  }
}
