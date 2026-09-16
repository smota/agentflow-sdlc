import { GATE_CLASSES, createGate } from './core/gate.mjs'
import { recordDigest } from './core/record-digest.mjs'
import { deriveDependencyCascade } from './core/gate-ledger.mjs'

// D1 — the readiness contract.
//
// This module does not rank anything. It reads the ranking `lib/cockpit-goal-model.mjs` already
// computed (a `buildCommandCenterModel(...)` result: per-goal `status` from `deriveGoalStatus`, and
// the cross-ranked `topActions` from `deriveNextBestActions`) and re-expresses it as data any
// caller — a scheduled actuator, a human decision queue, the cockpit UI — can consume without
// re-deriving priorities. If you find yourself computing a priority number in this file, stop: that
// means you are rebuilding `deriveNextBestActions`, which the spec forbids.

export function unitRef(goal) {
  return { kind: 'goal', id: goal.id, number: goal.number, revision: goal.revision }
}

function gateSummary(gate) {
  return {
    gateClass: gate.gateClass,
    subjectDigest: gate.subjectDigest,
    subjectKind: gate.subjectKind,
    requiredRole: gate.requiredRole,
  }
}

// The only two gate classes a cockpit unit ever opens, both built from `lib/core/gate.mjs` — no
// parallel gate concept lives here.
//
// - `adequacy-of-intent` ranges over the goal's own revision. `goal.humanGate` (deriveHumanGate,
//   which already calls gate.mjs's own `deriveCrossings`) is the existing, single answer to
//   "does a human have to act here?" — this just seals it into a real gate record instead of the
//   boolean-shaped summary the UI used privately.
// - `release-of-candidate` ranges over the delivered candidate this goal is waiting to release.
//   Cockpit has no run-scoped candidateDigest (that concept belongs to lib/core/run-state.mjs, a
//   different layer), so the subject digest is sealed here the same way `goal.revision` itself is
//   sealed (`recordDigest` over the identifying fields) rather than invented ad hoc.
//
// A gate EXPIRES the moment its unit is truly closed: a decision nobody can act on any more is not
// open work (D5 — "expire that unit's own gates" on close). "Truly closed" is narrower than
// `goal.status === 'done'`: `deriveGoalStatus` also reports `done` the instant a delivery PR
// merges, which is exactly when a release decision becomes relevant — so a merged-but-not-yet-
// released goal must not have its release gate expire out from under it. `versionLens.state ===
// 'delivered-or-closed'` is the one signal that means "nothing further is owed here" (the issue is
// closed AND it is not sitting in the awaiting-release window).
function unitClosed(goal) {
  return goal.versionLens.state === 'delivered-or-closed'
}

export function deriveGateForAction(goal, action) {
  if (
    action.id === 'request-human-gate' &&
    !unitClosed(goal) &&
    goal.humanGate.required &&
    goal.humanGate.status !== 'approved'
  ) {
    return createGate({
      gateClass: GATE_CLASSES.adequacyOfIntent,
      subjectDigest: goal.revision,
      subjectKind: 'goalRevision',
      requiredRole: 'reviewer',
    })
  }
  if (
    action.id === 'decide-release-impact' &&
    !unitClosed(goal) &&
    goal.versionLens.releaseNoteState === 'needs-decision'
  ) {
    return createGate({
      gateClass: GATE_CLASSES.releaseOfCandidate,
      subjectDigest: recordDigest(releaseCandidateSubject(goal)),
      subjectKind: 'candidateDigest',
      requiredRole: 'pr-readiness',
    })
  }
  return null
}

// W8a D2 — the exact fields a release-of-candidate gate's subjectDigest is sealed from, for THIS
// goal. Exported so a caller that needs to resolve "what is this unit's real subject, independent
// of any client's claim" (lib/cockpit-actions.mjs's close-unit intent, via scripts/cockpit-server.mjs)
// hashes the identical shape a reviewer actually attested against, instead of maintaining a second
// formula that could silently drift from this one.
export function releaseCandidateSubject(goal) {
  return {
    goalRevision: goal.revision,
    targetBranch: goal.versionLens.targetBranch,
    releaseImpact: goal.versionLens.releaseImpact,
  }
}

function contractEntry(goal, action) {
  const gate = deriveGateForAction(goal, action)
  return {
    unitRef: unitRef(goal),
    status: goal.status,
    action: {
      id: action.id,
      label: action.label,
      reason: action.reason,
      priority: action.priority,
    },
    gate: gate ? gateSummary(gate) : null,
  }
}

// D1: expose per-unit status and the SAME cross-ranked `topActions` `buildCommandCenterModel`
// already produced, decorated with a unit reference and — where the next step is a human decision
// — the gate class and subject digest a caller needs to act without re-deriving anything.
//
// `model` must already be a `buildCommandCenterModel(...)` result: this function maps it in place,
// it never recomputes `status` or `priority` itself (test 2 enforces this: the same input must
// yield the same order here as it does straight out of `buildCommandCenterModel`).
export function buildReadinessContract(model) {
  const units = model.goals.map((goal) => ({
    unitRef: unitRef(goal),
    status: goal.status,
    parentRef: goal.partOf?.number ?? null,
    actions: goal.nextBestActions.map((action) => contractEntry(goal, action)),
  }))
  const topActions = model.topActions.map((entry) => {
    const { goal, ...action } = entry
    return contractEntry(goal, action)
  })
  // D4 — the inversion. `buildCommandCenterModel` ranks units for a human to choose *from*; the
  // queue is the opposite cut: only the entries an agent structurally cannot resolve itself, i.e.
  // only entries that carry an open gate. Work an agent can do (clarify-scope, connect-pr,
  // record-validation, request-review, continue-flow, ...) is never a queue item.
  const queue = units
    .flatMap((unit) => unit.actions.filter((entry) => entry.gate))
    .sort((a, b) => b.action.priority - a.action.priority)
  return { version: 1, units, topActions, queue }
}

// D5 (permission axis) — units decorated with `blockedByParent`, derived from the opaque `partOf`
// graph `cockpit-goal-model.mjs` already reconstructs. See `lib/core/gate-ledger.mjs` for the
// cascade rule itself (permission cascades, consent never does).
export function deriveUnitGraph(goals) {
  const units = goals.map((goal) => ({
    ref: goal.number,
    parentRef: goal.partOf?.number ?? null,
    closed: goal.status === 'done',
    goal,
  }))
  return deriveDependencyCascade(units)
}
