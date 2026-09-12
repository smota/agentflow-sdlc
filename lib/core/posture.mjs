import { GATE_CLASSES } from './gate.mjs'
import { actionBoundaryRank } from '../sdlc-vocabulary.mjs'

// The product shipped one autonomy model with only one dial: ceremony (4 to 9 role passes), while
// three of its four profiles required no human approval at all. This module adds the missing
// second axis — an adopter-chosen POSTURE, expressing how much autonomy the organisation extends
// to agents — resolved against the change class (`paths` in sdlc.config.json), which stays exactly
// what it always was: an invariant safety floor over the risk of the work itself.
//
// Posture is the primary dial; the change class can only ever tighten it further, never loosen it.
// This is not a 4x5 matrix of intersection states: resolvePosture always returns ONE effective
// gating, the stricter of the two on every dimension.
export const POSTURE_NAMES = Object.freeze(['advisory', 'assisted', 'delegated', 'autonomous'])

export const DEFAULT_POSTURE = 'assisted'

// Each posture's own table of dials. Callers can only select a posture by NAME — there is no way
// to hand this module a shaped override for `humanGateClasses`, `allowsSelfReview`, or anything
// else in this table. That is what makes "relax an invariant through posture configuration"
// structurally impossible rather than a convention someone can forget: resolvePosture(args) below
// destructures only `posture`, `changeClass`, and `config` from its argument, so any other property
// an attacker (or a well-meaning caller) sets on that argument is simply never read.
const POSTURE_TABLE = Object.freeze({
  advisory: Object.freeze({
    posture: 'advisory',
    maxBoundary: 'propose',
    // Everything requires a human; advisory reads and proposes, it never mutates a worktree.
    requiresHumanFor: Object.freeze([
      GATE_CLASSES.adequacyOfIntent,
      GATE_CLASSES.releaseOfCandidate,
    ]),
    allowsSelfReview: false,
    adequacyGranularity: 'per-criterion',
    budgetCeiling: 0.5,
    evidenceExpiryToleranceMs: 0,
  }),
  assisted: Object.freeze({
    posture: 'assisted',
    maxBoundary: 'open-pr',
    // Factory default: a human is asked at intent freeze and at PR/release.
    requiresHumanFor: Object.freeze([
      GATE_CLASSES.adequacyOfIntent,
      GATE_CLASSES.releaseOfCandidate,
    ]),
    allowsSelfReview: true,
    adequacyGranularity: 'per-criterion',
    budgetCeiling: 1,
    evidenceExpiryToleranceMs: 0,
  }),
  delegated: Object.freeze({
    posture: 'delegated',
    maxBoundary: 'open-pr',
    // Intent freeze and final release; the PR itself is automated (no separate human touch there).
    requiresHumanFor: Object.freeze([GATE_CLASSES.adequacyOfIntent]),
    allowsSelfReview: true,
    adequacyGranularity: 'per-contract',
    budgetCeiling: 1.5,
    evidenceExpiryToleranceMs: 0,
  }),
  autonomous: Object.freeze({
    posture: 'autonomous',
    maxBoundary: 'external-action',
    // Intent freeze and external irreversibility only. External irreversibility is not a gate
    // class this table can turn off — see the unconditional handling in deriveCrossings, which
    // takes no posture argument at all and fires on effectiveBoundary === 'external-action'
    // regardless of what any posture says.
    requiresHumanFor: Object.freeze([GATE_CLASSES.adequacyOfIntent]),
    allowsSelfReview: true,
    adequacyGranularity: 'per-contract',
    budgetCeiling: 2,
    evidenceExpiryToleranceMs: 0,
  }),
})

export function posturesList() {
  return POSTURE_NAMES.map((name) => POSTURE_TABLE[name])
}

export function resolvePostureName(posture) {
  if (posture === undefined || posture === null || posture === '') return DEFAULT_POSTURE
  if (!POSTURE_NAMES.includes(posture)) throw new Error(`Unknown posture: ${posture}`)
  return posture
}

function changeClassFloor(changeClass, config) {
  const pathConfig = config?.paths?.[changeClass]
  if (!pathConfig) throw new Error(`Unknown change class: ${changeClass}`)
  const maxBoundary = config?.actionPolicy?.profileMaximums?.[changeClass]
  if (!maxBoundary) throw new Error(`No configured max boundary for change class: ${changeClass}`)
  return {
    changeClass,
    maxBoundary,
    allowsSelfReview: pathConfig.allowsSelfReview !== false,
    requiresHumanApproval: pathConfig.requiresHumanApproval === true,
  }
}

// The stricter (lower-autonomy) of two action boundaries wins. Ranks come from the same
// vocabulary the rest of the codebase uses (sdlc-vocabulary.mjs) — no parallel ordering invented
// here.
function stricterBoundary(left, right, config) {
  const leftRank = actionBoundaryRank(left, config)
  const rightRank = actionBoundaryRank(right, config)
  if (leftRank < 0) return right
  if (rightRank < 0) return left
  return leftRank <= rightRank ? left : right
}

// resolvePosture({ posture, changeClass, config }) -> the effective gating, the stricter of the
// posture and the change-class floor on every dimension.
//
// Deliberately NOT accepted here, at all: a phase number, a "clean track record", a hint, or any
// shape for the posture's own rules. Only a posture NAME and a changeClass NAME are read from the
// input; everything else about what a posture means comes from the frozen POSTURE_TABLE above,
// which this function's caller cannot reach or reshape.
export function resolvePosture({ posture, changeClass, config = {} } = {}) {
  const postureName = resolvePostureName(posture)
  const postureRule = POSTURE_TABLE[postureName]
  const floor = changeClassFloor(changeClass, config)

  const maxBoundary = stricterBoundary(postureRule.maxBoundary, floor.maxBoundary, config)
  const allowsSelfReview = postureRule.allowsSelfReview && floor.allowsSelfReview
  const releaseRequiresHuman =
    postureRule.requiresHumanFor.includes(GATE_CLASSES.releaseOfCandidate) ||
    floor.requiresHumanApproval

  // INVARIANT (never-vary #3): an agent-raised escalation halts the affected intent subtree at
  // EVERY posture. GATE_CLASSES.agentEscalation is added here unconditionally — it is not read
  // from POSTURE_TABLE (which has no field for it at all), so there is no posture configuration
  // that can omit it, and no caller-supplied override (see the destructuring above) that can
  // reach this line to change it.
  const humanGateClasses = Object.freeze([
    GATE_CLASSES.adequacyOfIntent, // intent freeze always requires a human, at every posture
    ...(releaseRequiresHuman ? [GATE_CLASSES.releaseOfCandidate] : []),
    GATE_CLASSES.agentEscalation,
  ])

  return Object.freeze({
    posture: postureName,
    changeClass: floor.changeClass,
    maxBoundary,
    allowsSelfReview,
    humanGateClasses,
    adequacyGranularity: postureRule.adequacyGranularity,
    budgetCeiling: postureRule.budgetCeiling,
    evidenceExpiryToleranceMs: postureRule.evidenceExpiryToleranceMs,
  })
}
