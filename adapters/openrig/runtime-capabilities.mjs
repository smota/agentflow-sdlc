// This registry describes a local upstream candidate, not installed/public support. No
// accepted runtime protocol is registered yet. Version strings cannot grant compatibility.
export const RUNTIME_OBSERVATION_PROTOCOLS = Object.freeze([
  Object.freeze({
    runtime: 'pi',
    protocol: 'openrig.pi-runner-observation',
    version: 1,
    publiclySupported: false,
    deployed: false,
  }),
])
const text = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/.test(value)
export function evaluateRuntimeCapabilities({ runtime, report, expected = {}, nowMs } = {}) {
  const reasons = []
  const known = RUNTIME_OBSERVATION_PROTOCOLS.find(
    (item) =>
      item.runtime === runtime &&
      item.protocol === report?.protocol &&
      item.version === report?.version,
  )
  const snapshot = report?.observation
  const recognized = known && snapshot?.observationProtocolVersion === known.version
  if (!recognized) reasons.push('runtime-observation-protocol-unsupported')
  else reasons.push('runtime-observation-candidate-not-public-or-deployed')
  const trusted = recognized && report?.sourceVerified === true
  if (!trusted) reasons.push('runtime-observation-source-unverified')
  const actual = snapshot?.observedExecution
  const observedAt = Date.parse(actual?.observedAt)
  const fresh =
    Number.isFinite(nowMs) &&
    Number.isFinite(observedAt) &&
    observedAt <= nowMs &&
    nowMs - observedAt <= 60000
  const actualExecutionVerified =
    !!trusted &&
    fresh &&
    ['providerRoute', 'model', 'effort'].every(
      (key) => text(expected[key]) && actual?.[key] === expected[key],
    )
  if (!actualExecutionVerified) reasons.push('runtime-actual-execution-unverified')
  // Carried launch/generation values are correlation only. External source identity proof
  // remains necessary; an activity-hook generation is never a hook schema version.
  const occupantVerified =
    !!trusted &&
    report.occupantVerified === true &&
    ['generation', 'sessionId', 'launchId'].every(
      (key) => text(expected[key]) && actual?.[key] === expected[key],
    )
  if (!occupantVerified) reasons.push('runtime-occupant-unverified')
  const hookOccupantVerified =
    !!trusted &&
    report.hookSourceVerified === true &&
    text(expected.generation) &&
    report.hookGeneration === expected.generation
  if (!hookOccupantVerified) reasons.push('hook-occupant-unverified')
  const historyVerified =
    !!trusted && snapshot.catchupStatus === 'verified' && snapshot.catchupVerified === true
  if (!historyVerified)
    reasons.push(
      snapshot?.catchupStatus === 'failed'
        ? 'runtime-history-failed'
        : 'runtime-history-unverified',
    )
  return {
    compatible: false,
    status: recognized ? 'candidate-only' : 'unsupported',
    processReady: !!trusted && snapshot.processReady === true,
    historyVerified,
    actualExecutionVerified,
    occupantVerified,
    hookOccupantVerified: !!hookOccupantVerified,
    hookSchemaCompatibility: 'unknown',
    reasons,
    effects: [],
  }
}
