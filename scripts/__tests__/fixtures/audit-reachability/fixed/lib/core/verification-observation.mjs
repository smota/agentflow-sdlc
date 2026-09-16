// Minimal fixture stand-in for the real lib/core/verification-observation.mjs. Only the shape D3's
// enforcement pair cares about matters here: an export named `verifyObservation` that the role-pass
// gate imports and calls — the audit's detector C checks that the import is wired, not the runtime
// behavior of the function it points at.
export function verifyObservation({ observation } = {}) {
  const errors = []
  if (!observation) errors.push('observation is required')
  return { ok: !errors.length, errors }
}
