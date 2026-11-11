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

// Only evidence written by a trusted evidence writer counts. With no writers configured nothing
// is trusted: every decision then starts from no evidence, which is safe but slow.
export function trustedTransitions(transitions, writers) {
  const trusted = new Set(writers ?? [])
  return (transitions ?? []).filter((item) => trusted.has(item.writer))
}

// Phase 6 pass evidence needs a reviewer: the caller session must hold the review seat on the
// configured rig. The phase graph already fixes phase 6 to the review seat and phase 4 to builder
// seats, so a session holding the review seat can never be a session that recorded the build.
// The session is self-asserted (OPENRIG_SESSION_NAME), as for seat claims: rig identity is the
// boundary.
function reviewerProblem(phase, status, seat, caller, rig) {
  if (phase !== REVIEW_PHASE || status !== 'pass') return null
  if (!caller) {
    return `phase ${REVIEW_PHASE} pass evidence needs the reviewer's OpenRig session (OPENRIG_SESSION_NAME); none was given`
  }
  if (caller.seat !== seat) {
    return `session ${caller.session} does not hold the review seat ${seat}`
  }
  if (rig && caller.rig !== rig) {
    return `session ${caller.session} is not on the configured rig ${rig}`
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
export function buildRolePassRecord(
  input,
  { transitions = [], callerSession = null, stableId, rig = null },
) {
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
  const problem = reviewerProblem(phase, input.status, transition.seat, caller, rig)
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
