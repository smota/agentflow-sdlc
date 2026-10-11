import { GATE_CLASSES } from './core/gate.mjs'
import { RETURNS, currentPhase } from './core/phase-graph.mjs'

// The phase seam (#413). The phase says which side a goal is on, so the cockpit needs no squad, seat,
// or execution layer to show it: PM is phases 0 and 1, DEV is phase 2 onward. Three waits are kept
// apart, and a goal shows at most one:
//
// - delivery return: the latest phase is a return to phase 0 or 1. The goal is back with PM.
// - intent stop: a person's adequacy-of-intent decision is waiting. Work stops until the person
//   accepts the intent.
// - phase 1 handoff: PM passed phase 1 and the spec waits for delivery to take it.
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

/** Which side a goal is on and what it waits for, from its transitions and its person gates. */
export function phaseSeam({ transitions = [], gates = [] } = {}) {
  const latest = latestApplied(Array.isArray(transitions) ? transitions : [])
  const back = returnTo(latest)
  if (back === 0 || back === 1) return { side: SIDES.pm, wait: WAITS.deliveryReturn }

  const phase = currentPhase(Array.isArray(transitions) ? transitions : [])
  const side = phase === null || phase <= 1 ? SIDES.pm : SIDES.dev
  const intentWaits = (Array.isArray(gates) ? gates : []).some(
    (gate) => gate?.status === 'waiting' && gate.gateClass === GATE_CLASSES.adequacyOfIntent,
  )
  if (intentWaits) return { side, wait: WAITS.intentStop }
  if (latest?.phase === 1 && latest.status === 'pass') return { side, wait: WAITS.phase1Handoff }
  return { side, wait: null }
}
