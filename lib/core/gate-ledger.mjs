// D5 — cascade: permission cascades, consent never does.
//
// A unit's own closure only ever WIDENS what its dependents may do; it never reaches into another
// unit's own consent. Two independent axes both obey that rule, and this module is the one place
// both are written down:
//
//   1. parent -> children: closing a parent unblocks children who were waiting on it (permission
//      cascades — see `deriveDependencyCascade`), but never closes the children themselves and
//      never satisfies anything they still owe.
//   2. gate class -> gate class, same unit: satisfying an adequacy-of-intent gate never satisfies a
//      release-of-candidate gate bound to the same unit. This is not new logic — it falls straight
//      out of `satisfyGate` in `lib/core/gate.mjs`, which compares `attestation.reviewedDigest`
//      against ONE gate's `subjectDigest`, and the two classes are structurally pinned to different
//      subjects (`ALLOWED_SUBJECT_KINDS`). Re-exported here so callers reason about the cascade
//      rule in one place instead of re-deriving "does this attestation satisfy that other gate?"
//      by hand.
export { satisfyGate } from './gate.mjs'

// units: [{ ref, parentRef, closed }, ...]. A unit is `blockedByParent` only while it declares a
// `parentRef` AND that parent is not (yet) closed — a unit with no parent, or whose parent already
// closed, is never blocked by this rule. The instant a parent's `closed` flips true, every
// dependent whose only blocker was that parent is unblocked in the very same pass (re-ranking a
// goal's next-best-actions after that requires no extra step here: `deriveNextBestActions` and
// `deriveGoalStatus` already recompute statelessly from current input on every call).
//
// Nothing in this function ever reads or writes a dependent's own `closed` flag, its gates, or any
// field describing what THAT unit has itself satisfied — a parent closing cannot close, or open,
// anything belonging to a child. That is the whole of "consent never cascades" on this axis.
export function deriveDependencyCascade(units = []) {
  const byRef = new Map(units.map((unit) => [unit.ref, unit]))
  return units.map((unit) => ({
    ...unit,
    blockedByParent: Boolean(unit.parentRef) && byRef.get(unit.parentRef)?.closed !== true,
  }))
}
