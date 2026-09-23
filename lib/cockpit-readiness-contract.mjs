import { GATE_CLASSES, createGate } from './core/gate.mjs'
import { deriveDependencyCascade } from './core/gate-ledger.mjs'

// D1 — the readiness contract.
//
// This module does not rank anything. It reads the ranking `lib/cockpit-goal-model.mjs` already
// computed (a `buildCommandCenterModel(...)` result: per-goal `status` from `deriveGoalStatus`, and
// the cross-ranked `topActions` from `deriveNextBestActions`) and re-expresses it as data any
// caller — a scheduled actuator, a human decision queue, the cockpit UI — can consume without
// re-deriving priorities. If you find yourself computing a priority number in this file, stop: that
// means you are rebuilding `deriveNextBestActions`, which the spec forbids.

// `goal.id` IS the canonical identity (W8c D1) — stable across edits, namespaced by source and
// repo. The actuator (scripts/actuate-readiness.mjs) derives its run id from THIS field, via the
// same unitRunId(unitIdentity(...)) pair a human's close-unit (scripts/cockpit-server.mjs) derives
// its own run id from, so the two always land on the same run for the same unit.
export function unitRef(goal) {
  return { kind: 'goal', id: goal.id, number: goal.number, revision: goal.revision }
}

function gateSummary(gate) {
  return {
    gateClass: gate.gateClass,
    subjectDigest: gate.subjectDigest,
    subjectKind: gate.subjectKind,
    requiredRole: gate.requiredRole,
    // Only present for the honest "no candidate yet" representation deriveGateForAction returns
    // below (W8b D4) — a real sealed gate never carries this field.
    ...(gate.status ? { status: gate.status } : {}),
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

// W8b D4 — a release-of-candidate gate ranges over `candidateDigest` for a reason: it must be the
// real fingerprint a run produced from the candidate's actual files (lib/verification/workspace.mjs's
// `fingerprintCandidate`), the one true meaning of that field everywhere else in the product. The
// cockpit works from GitHub issues and usually has no run at all; when a unit has no run, it has no
// candidate, and therefore no candidate digest to gate on. The honest representation of that is a
// release gate PENDING a candidate — not a digest of goal metadata invented to fill the field (the
// deleted `releaseCandidateSubject` recipe did exactly that: it hashed
// `{goalRevision, targetBranch, releaseImpact}`, which can never match the candidate a real run
// produces). `candidateDigest`, when the caller has one (e.g. a completed run), is accepted as input
// here — wiring the run-store read-back that resolves it automatically is W8c, out of scope here.
function pendingReleaseGate() {
  return {
    gateClass: GATE_CLASSES.releaseOfCandidate,
    subjectKind: 'candidateDigest',
    subjectDigest: null,
    requiredRole: 'pr-readiness',
    status: 'pending-candidate',
  }
}

export function deriveGateForAction(goal, action, { candidateDigest = null } = {}) {
  if (action.id === 'request-human-gate' && !unitClosed(goal) && goal.humanGate.required) {
    // W8b D3 — the formal gate is never suppressed by the weak, GitHub-derived status. Whether this
    // gate exists depends only on whether a human is actually required (goal.humanGate.required,
    // itself now posture-derived — see deriveHumanGate); goal.humanGate.status (which can read
    // 'approved' only from a satisfied gate as of W8b D2, never from reviewDecision) plays no part
    // in whether the gate is created, only in what a UI shows about its current standing.
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
    if (!candidateDigest) return pendingReleaseGate()
    return createGate({
      gateClass: GATE_CLASSES.releaseOfCandidate,
      subjectDigest: candidateDigest,
      subjectKind: 'candidateDigest',
      requiredRole: 'pr-readiness',
    })
  }
  return null
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
    // D3 (W8c) — identity, never revision: see deriveUnitGraph below for why.
    parentRef: goal.partOf?.identity ?? null,
    actions: goal.nextBestActions.map((action) => contractEntry(goal, action)),
  }))
  const topActions = model.topActions.map((entry) => {
    const { goal, ...action } = entry
    return contractEntry(goal, action)
  })
  // D4 — the inversion. `buildCommandCenterModel` ranks units for a human to choose *from*; the
  // queue is the opposite cut: only the entries an agent structurally cannot resolve itself, i.e.
  // only entries that carry an open gate WITH an actual subject to decide over. Work an agent can do
  // (clarify-scope, connect-pr, record-validation, request-review, continue-flow, ...) is never a
  // queue item — and neither is a release gate still pending a candidate (W8b D4): nobody, human or
  // agent, can act on a decision whose subject does not exist yet.
  const queue = units
    .flatMap((unit) => unit.actions.filter((entry) => entry.gate?.subjectDigest))
    .sort((a, b) => b.action.priority - a.action.priority)
  return { version: 1, units, topActions, queue }
}

// D5 (permission axis) — units decorated with `blockedByParent`, derived from the opaque `partOf`
// graph `cockpit-goal-model.mjs` already reconstructs. See `lib/core/gate-ledger.mjs` for the
// cascade rule itself (permission cascades, consent never does).
//
// W8c D3/D4 — DEFECT FIXED. This used to key by `goal.number` (fine only by accident, within a
// single repo/batch — see unit-identity.mjs for why identity is the real key) and use
// `goal.status === 'done'` as "closed" — the SECOND, wrong definition of closed that lived in this
// file (the correct one, `unitClosed` above, already excludes a unit still `awaiting-release`).
// `deriveGoalStatus` (cockpit-goal-model.mjs) reports `done` the instant a delivery PR merges, which
// is exactly the awaiting-release window — so a merged-but-not-released parent used to read as
// `closed: true` here and cascade permission to unblock its children before it was truly closed.
// `unitClosed` is now the ONE definition of closed, used everywhere in this file.
export function deriveUnitGraph(goals) {
  const units = goals.map((goal) => ({
    ref: goal.id,
    parentRef: goal.partOf?.identity ?? null,
    closed: unitClosed(goal),
    goal,
  }))
  return deriveDependencyCascade(units)
}
