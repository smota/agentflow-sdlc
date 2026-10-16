// Admission evidence evaluator, not a runtime controller. Only a trusted host reader may set
// sourceVerified; the bundled compact OpenRig collector deliberately cannot attest a model.
import { evaluateRuntimeCapabilities } from './runtime-capabilities.mjs'

const TUPLE_FIELDS = ['runtime', 'providerRoute', 'model', 'effort', 'profile']
const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$/.test(value)
const sameTuple = (a, b) =>
  TUPLE_FIELDS.every(
    (key) => typeof a?.[key] === 'string' && a[key].length > 0 && a[key] === b?.[key],
  )
const uniqueSeat = (items, seat) => {
  const matches = Array.isArray(items) ? items.filter((item) => item?.seat === seat) : []
  return matches.length === 1 ? matches[0] : null
}

export function evaluateOperationalPreflight({
  contracts = [],
  installedContracts = [],
  daemon = {},
  observations = {},
  task = {},
  now,
  maxAgeMs = 60000,
  runtimeCompatibility = null,
} = {}) {
  const owner = identifier(task.owner) ? task.owner : 'operator'
  const required = Array.isArray(task.requiredSeats) ? task.requiredSeats : []
  const clock = Date.parse(now)
  const scopeVerified =
    identifier(task.rigName) &&
    observations.rigName === task.rigName &&
    observations.complete === true
  const seats = [...new Set(required)].map((rawSeat) => {
    const seat = identifier(rawSeat) ? rawSeat : 'invalid-seat'
    const contract = uniqueSeat(contracts, rawSeat)
    const installed = uniqueSeat(installedContracts, rawSeat)
    const observation = uniqueSeat(observations.entries, rawSeat)
    const binding = task.bindings?.[rawSeat]
    const reasons = []
    // Raw reports are re-evaluated; compatible/sourceVerified booleans supplied by a caller
    // cannot promote an unknown or merely proposed protocol into supported execution.
    const runtimeReport =
      runtimeCompatibility === null ? null : uniqueSeat(runtimeCompatibility, rawSeat)
    const compatibility =
      runtimeCompatibility === null
        ? null
        : evaluateRuntimeCapabilities({
            runtime: contract?.runtime,
            report: runtimeReport?.report,
            expected: { ...contract, ...binding },
            nowMs: clock,
          })
    const runtimeCompatible = compatibility === null || compatibility.compatible === true
    if (!runtimeCompatible) reasons.push('runtime-compatibility-unverified')
    const configured = !!contract && sameTuple(contract, installed)
    if (!contract) reasons.push('required-seat-unavailable')
    else if (!configured) reasons.push('installed-contract-unverified')
    if (!scopeVerified) reasons.push('observation-scope-unverified')
    const eventAt = Date.parse(observation?.eventAt)
    const fresh =
      Number.isFinite(clock) &&
      Number.isFinite(eventAt) &&
      Number.isFinite(maxAgeMs) &&
      maxAgeMs > 0 &&
      eventAt <= clock &&
      clock - eventAt <= maxAgeMs
    const occupantBound =
      identifier(binding?.generation) &&
      identifier(binding?.sessionId) &&
      observation?.generation === binding.generation &&
      observation?.sessionId === binding.sessionId &&
      observation?.occupantVerified === true &&
      observation?.bindingVerified === true
    const observed =
      !!contract &&
      scopeVerified &&
      observation?.sourceVerified === true &&
      sameTuple(contract, observation) &&
      fresh &&
      occupantBound
    if (!observed) reasons.push('observed-execution-unverified')
    if (daemon.state !== 'running')
      reasons.push(daemon.state === 'stopped' ? 'daemon-stopped' : 'daemon-unknown')
    if (observation?.processReady !== true) reasons.push('process-readiness-unverified')
    if (observation?.catchupVerified !== true)
      reasons.push(
        observation?.catchupVerified === false
          ? 'history-catchup-failed'
          : 'history-catchup-unverified',
      )
    const usable =
      configured &&
      observed &&
      daemon.state === 'running' &&
      observation?.processReady === true &&
      observation?.catchupVerified === true &&
      runtimeCompatible
    // Role authority is meaningful only when tied to this exact observed occupant and task.
    const authorized = observed && observation?.authorized === true
    if (!authorized)
      reasons.push(
        observation?.authorized === false ? 'task-unauthorized' : 'task-authorization-unverified',
      )
    const admitted = usable && authorized
    const explicitFailure =
      !contract ||
      (installed && !configured) ||
      observation?.catchupVerified === false ||
      observation?.authorized === false ||
      daemon.state === 'stopped'
    return {
      seat,
      configured,
      observed,
      usable,
      authorized,
      status: admitted ? 'admitted' : explicitFailure ? 'held' : 'unknown',
      reasons,
      nextAction: admitted
        ? null
        : { owner, action: 'verify-execution-and-task-authority', checkAfterMs: 60000 },
    }
  })
  return {
    admitted: seats.length > 0 && seats.every((seat) => seat.status === 'admitted'),
    seats,
    effects: [],
  }
}

export const COMPACT_NODE_FIELDS =
  'rigId,rigName,logicalId,podId,podNamespace,canonicalSessionName,runtime,sessionStatus,startupStatus,restoreOutcome,lifecycleState,terminalActive,agentActivity'

// Compact ps supplies inventory/process hints only. Never promote declared runtime/model or
// collection time to actual execution/freshness. Never return raw errors or resume material.
export function parseCompactObservation(stdout, rigName) {
  let value
  try {
    value = JSON.parse(stdout)
  } catch {
    return { rigName, complete: false, entries: [] }
  }
  const complete =
    value &&
    Array.isArray(value.entries) &&
    value.truncated === false &&
    Number.isInteger(value.totalNodes) &&
    value.totalNodes === value.entries.length &&
    value.entries.every((entry) => entry?.rigName === rigName) &&
    (!value.scope || value.scope === rigName || value.scope?.rigName === rigName)
  if (!complete) return { rigName, complete: false, entries: [] }
  const entries = value.entries.map((entry) => {
    const logicalId = identifier(entry.logicalId) ? entry.logicalId : null
    const seat = logicalId?.includes('.')
      ? logicalId
      : identifier(entry.podId) && logicalId
        ? `${entry.podId}.${logicalId}`
        : 'unknown-seat'
    return { seat, processReady: entry.startupStatus === 'READY', sourceVerified: false }
  })
  if (
    entries.some((entry) => entry.seat === 'unknown-seat') ||
    new Set(entries.map((entry) => entry.seat)).size !== entries.length
  )
    return { rigName, complete: false, entries: [] }
  return { rigName, complete: true, entries }
}
