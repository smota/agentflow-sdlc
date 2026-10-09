// The SDLC phase machine. A medium stores transitions. It does not decide them.

export const PHASES = Object.freeze([
  { phase: 0, role: 'product-manager', seat: 'orch.arch' },
  { phase: 1, role: 'analyst', seat: 'orch.arch' },
  { phase: 2, role: 'architect', seat: 'orch.arch' },
  { phase: 3, role: 'implementation-planner', seat: 'orch.arch' },
  { phase: 4, role: 'developer', seats: ['dev.build-jr', 'dev.build', 'dev.build-sr'] },
  { phase: 5, role: 'tester', seat: 'dev.qa' },
  { phase: 6, role: 'reviewer', seat: 'rev.review' },
  { phase: 7, role: 'technical-writer', seat: 'orch.arch' },
  { phase: 8, role: 'pr-readiness', seat: 'orch.arch' },
])

const FORWARD = Object.freeze({
  0: [1],
  1: [2],
  2: [3],
  3: [4],
  4: [5],
  5: [6],
  6: [7],
  7: [8],
  8: [],
})

// Review, docs, and PR readiness return to the developer. A planning defect returns to the planner.
const RETURNS = Object.freeze({
  4: [3],
  6: [4],
  7: [4],
  8: [4],
})

export function phaseSpec(phase) {
  const spec = PHASES.find((item) => item.phase === phase)
  if (!spec) throw new Error(`Unknown phase: ${phase}`)
  return spec
}

export function seatsFor(phase) {
  const spec = phaseSpec(phase)
  return spec.seats ?? [spec.seat]
}

export function currentPhase(transitions = []) {
  const applied = transitions.filter((item) => item.status === 'pass' || item.status === 'skipped')
  if (!applied.length) return null
  return applied[applied.length - 1].phase
}

export function allowedNext(transitions = []) {
  const current = currentPhase(transitions)
  if (current === null) return [0]
  return [...(FORWARD[current] ?? []), ...(RETURNS[current] ?? [])]
}

export function validateTransition({ transitions = [], phase, status, seat, reason }) {
  if (!['pass', 'skipped'].includes(status)) {
    throw new Error('A transition status must be pass or skipped')
  }
  if (!Number.isInteger(phase) || phase < 0 || phase > 8) {
    throw new Error('A transition phase must be an integer from 0 to 8')
  }
  if (status === 'skipped' && (!reason || !String(reason).trim())) {
    throw new Error('A skipped phase requires a reason')
  }
  const next = allowedNext(transitions)
  if (!next.includes(phase)) {
    const current = currentPhase(transitions)
    throw new Error(
      `Phase ${phase} is not allowed after ${current === null ? 'no transitions' : `phase ${current}`}. Allowed: ${next.join(', ') || 'none'}`,
    )
  }
  if (!seatsFor(phase).includes(seat)) {
    throw new Error(`Seat ${seat} does not own phase ${phase} (${phaseSpec(phase).role})`)
  }
  return { phase, role: phaseSpec(phase).role, seat, status, reason: reason ?? null }
}
