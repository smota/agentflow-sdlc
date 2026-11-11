// Role-pass evidence written back to the source by the bridge (#582). The record is checked
// against the phase graph and the provenance vocabularies before anything is written, and the
// reviewer of a change must not be the session that built it (phase 6 vs phase 4).
import { validateTransition } from '../core/phase-graph.mjs'
import { rolePassIdempotencyKey } from '../core/role-pass-evidence.mjs'
import { callerSeat } from '../core/seat-claim.mjs'
import { DELEGATION_BOUNDARIES, TRANSPORTS, isKnownExecutionTarget } from '../execution-targets.mjs'
import { RUNTIME_PLATFORM_SLUGS } from '../runtime-platforms.mjs'

export class EvidenceRefusal extends Error {
  constructor(message) {
    super(message)
    this.code = 'evidence-refused'
  }
}

const SEAT = /^[a-z][a-z0-9.-]*$/
const BUILD_PHASE = 4
const REVIEW_PHASE = 6

function requireEnum(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new EvidenceRefusal(
      `${name} must be one of ${allowed.join(', ')} (got ${value ?? 'nothing'})`,
    )
  }
}

function provenance(input) {
  requireEnum('executedBy', input.executedBy, RUNTIME_PLATFORM_SLUGS)
  requireEnum('launcher', input.launcher, RUNTIME_PLATFORM_SLUGS)
  if (!isKnownExecutionTarget(input.executor)) {
    throw new EvidenceRefusal(
      `executor ${input.executor ?? 'nothing'} is not a known execution target`,
    )
  }
  requireEnum('transport', input.transport, TRANSPORTS)
  requireEnum('delegationBoundary', input.delegationBoundary, DELEGATION_BOUNDARIES)
  const model = input.model ?? null
  if (model !== null && (typeof model !== 'string' || /[\r\n]/.test(model) || !model.trim())) {
    throw new EvidenceRefusal('model must be a single line')
  }
  return {
    executedBy: input.executedBy,
    launcher: input.launcher,
    executor: input.executor,
    transport: input.transport,
    delegationBoundary: input.delegationBoundary,
    model,
  }
}

// Review must not be done by the seat or session that built the change.
function separationProblem(phase, seat, caller, transitions) {
  if (phase !== REVIEW_PHASE) return null
  for (const build of transitions.filter((item) => item.phase === BUILD_PHASE)) {
    if (build.seat === seat) return `seat ${seat} recorded phase ${BUILD_PHASE}; it cannot review`
    const sameRig = !build.seatRig || build.seatRig === caller?.rig
    if (caller && build.seat === caller.seat && sameRig) {
      return `session ${caller.session} built this change (phase ${BUILD_PHASE}); it cannot review it`
    }
  }
  return null
}

// A retry of the latest applied transition (same phase, status and seat) is not a new pass.
export function findRecordedRetry(input, transitions) {
  const applied = transitions.filter((item) => item.status === 'pass' || item.status === 'skipped')
  const latest = applied.at(-1)
  if (!latest) return null
  return latest.phase === input.phase &&
    latest.status === input.status &&
    latest.seat === input.seat
    ? latest
    : null
}

// Builds the role-pass record for formatRolePassComment. Throws EvidenceRefusal (or the phase
// graph's Error) when the evidence must not be written.
export function buildRolePassRecord(input, { transitions = [], callerSession = null, stableId }) {
  if (!SEAT.test(input.seat ?? '')) throw new EvidenceRefusal('seat is required')
  const phase = Number(input.phase)
  let transition
  try {
    transition = validateTransition({
      transitions,
      phase,
      status: input.status,
      seat: input.seat,
      reason: input.reason ?? undefined,
    })
  } catch (error) {
    throw new EvidenceRefusal(error.message)
  }
  const caller = callerSeat(callerSession)
  const problem = separationProblem(phase, transition.seat, caller, transitions)
  if (problem) throw new EvidenceRefusal(problem)
  const attempt = transitions.filter((item) => item.phase === phase).length + 1
  const seatVerified = caller?.seat === transition.seat
  return {
    idempotencyKey: rolePassIdempotencyKey({ stableId, phase, status: input.status, attempt }),
    phase,
    role: transition.role,
    status: input.status,
    seat: transition.seat,
    seatVerified,
    seatRig: seatVerified ? caller.rig : null,
    reason: input.reason ?? null,
    ...provenance(input),
    body: input.body ?? '',
  }
}
