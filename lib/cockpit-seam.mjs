import { GATE_CLASSES } from './core/gate.mjs'
import { RETURNS, currentPhase } from './core/phase-graph.mjs'

// The phase seam (#413). The phase says which side a goal is on, so the cockpit needs no squad, seat,
// or execution layer to show it: PM is phases 0 and 1, DEV is phase 2 onward. Three waits are kept
// apart, and a goal shows at most one:
//
// - delivery return: the latest transition is a return to phase 0 or 1. The goal is back with PM,
//   and the return's reason is shown with it.
// - intent stop: a person's adequacy-of-intent gate is waiting or refused. Work stops until the
//   person accepts the intent.
// - phase 1 handoff: the latest pass is phase 0 or 1 and no phase 2 pass follows it. The spec waits
//   for delivery to take it.
//
// The door judgment is made through the intent gate. It is not tester evidence or a reviewer verdict,
// so neither of those is read here.

export const SIDES = Object.freeze({ pm: 'PM', dev: 'DEV' })

export const WAITS = Object.freeze({
  deliveryReturn: 'delivery return',
  intentStop: 'intent stop',
  phase1Handoff: 'phase 1 handoff',
})

function latestApplied(transitions) {
  return transitions.filter((item) => item?.status === 'pass' || item?.status === 'skipped').at(-1)
}

// The phase a skipped transition returns to, when it names a legal return.
function returnTo(transition) {
  if (transition?.status !== 'skipped') return null
  const named = Number(String(transition.reason ?? '').match(/return to phase (\d+)/i)?.[1])
  return (RETURNS[transition.phase] ?? []).includes(named) ? named : null
}

// A refused intent stops the work as surely as one still waiting for the person.
const STOPPED_INTENT = new Set(['waiting', 'refused'])

// The latest pass is phase 0 or 1, so no phase 2 pass has come after it. A phase 2 pass from before
// a return does not count: once PM passes again, the spec waits for delivery again.
function handedOff(transitions) {
  const last = transitions.filter((item) => item?.status === 'pass').at(-1)
  return last?.phase === 0 || last?.phase === 1
}

/**
 * Which side a goal is on and what it waits for, from its transitions and its person gates. A
 * delivery return also carries the return's reason.
 */
export function phaseSeam({ transitions = [], gates = [] } = {}) {
  const history = Array.isArray(transitions) ? transitions : []
  const latest = latestApplied(history)
  const back = returnTo(latest)
  if (back === 0 || back === 1) {
    return { side: SIDES.pm, wait: WAITS.deliveryReturn, reason: latest.reason }
  }

  const phase = currentPhase(history)
  const side = phase === null || phase <= 1 ? SIDES.pm : SIDES.dev
  const intentStopped = (Array.isArray(gates) ? gates : []).some(
    (gate) => STOPPED_INTENT.has(gate?.status) && gate.gateClass === GATE_CLASSES.adequacyOfIntent,
  )
  if (intentStopped) return { side, wait: WAITS.intentStop }
  if (handedOff(history)) return { side, wait: WAITS.phase1Handoff }
  return { side, wait: null }
}
