import { describe, expect, it } from 'vitest'
import { buildCommandCenterModel } from '../cockpit-goal-model.mjs'
import {
  buildReadinessContract,
  deriveGateForAction,
  deriveUnitGraph,
} from '../cockpit-readiness-contract.mjs'
import { GATE_CLASSES, satisfyGate } from '../core/gate.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'

function issue({
  number = 1,
  title = 'Goal',
  body = '## Acceptance criteria\n- [ ] works',
  labels = [],
  state = 'open',
} = {}) {
  return { number, title, body, labels, state }
}

function highAssuranceIssue(overrides = {}) {
  return issue({
    body: '## Acceptance criteria\n- [ ] secure\n\nRemote auth security high-assurance',
    ...overrides,
  })
}

function ordinaryIssue(overrides = {}) {
  return issue({
    body: '## Acceptance criteria\n- [ ] typo\n\ndocs-only bounded low-risk',
    ...overrides,
  })
}

describe('readiness contract (D1)', () => {
  it('1. carries, for every open gate in the queue, its class and subject digest — no re-derivation needed', () => {
    const model = buildCommandCenterModel({ issues: [highAssuranceIssue({ number: 5 })] })
    const contract = buildReadinessContract(model)
    const gated = contract.queue.filter((entry) => entry.action.id === 'request-human-gate')
    expect(gated.length).toBeGreaterThan(0)
    for (const entry of gated) {
      expect(entry.gate.gateClass).toBe(GATE_CLASSES.adequacyOfIntent)
      expect(entry.gate.subjectKind).toBe('goalRevision')
      // The digest is the goal's OWN revision (already computed by buildAgentFlowGoalModel), not a
      // value this module invented — a caller can act on it without recomputing anything.
      expect(entry.gate.subjectDigest).toBe(entry.unitRef.revision)
      expect(entry.gate.subjectDigest).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it("2. topActions preserve buildCommandCenterModel's own cross-ranked order for the same input — this is not a second priority table", () => {
    const issues = [
      highAssuranceIssue({ number: 1 }),
      ordinaryIssue({ number: 2 }),
      issue({ number: 3, body: '' }),
    ]
    const model = buildCommandCenterModel({ issues })
    const contract = buildReadinessContract(model)
    expect(
      contract.topActions.map((entry) => `${entry.unitRef.number}:${entry.action.id}`),
    ).toEqual(model.topActions.map((entry) => `${entry.goal.number}:${entry.id}`))
    expect(contract.topActions.map((entry) => entry.action.priority)).toEqual(
      model.topActions.map((entry) => entry.priority),
    )
  })

  it('5. closing a parent unblocks its children without closing them (permission cascades, consent does not)', () => {
    const parent = issue({ number: 100, title: 'Parent goal', state: 'closed' })
    const child = issue({
      number: 101,
      title: 'Child goal',
      body: '## Acceptance criteria\n- [ ] child\n\nPart of #100',
    })
    const model = buildCommandCenterModel({ issues: [parent, child] })
    const graph = deriveUnitGraph(model.goals)
    // W8c D3 — the unit graph is keyed by IDENTITY (goal.id), never the issue number alone: two
    // repositories with the same number must not collide in the same graph.
    const parentUnit = graph.find((unit) => unit.goal.number === 100)
    const childUnit = graph.find((unit) => unit.goal.number === 101)
    expect(parentUnit.ref).toBe(parentUnit.goal.id)
    expect(childUnit.parentRef).toBe(parentUnit.goal.id)
    expect(parentUnit.closed).toBe(true)
    // The child is unblocked because its only blocker (the parent) closed...
    expect(childUnit.blockedByParent).toBe(false)
    // ...but the child itself was never closed by that cascade: its own status is derived purely
    // from its own evidence, exactly as buildAgentFlowGoalModel computed it.
    expect(childUnit.closed).toBe(false)
    expect(childUnit.goal.status).not.toBe('done')
  })

  it('5b (W8c D3/D4 DEFECT FIXED). a parent merged but still awaiting release is NOT closed, and its child stays blocked', () => {
    // Before this fix, deriveUnitGraph used `goal.status === 'done'` as its definition of "closed"
    // — a SECOND, wrong definition living alongside the correct one (`unitClosed`, using
    // `versionLens.state === 'delivered-or-closed'`) in this same file. `deriveGoalStatus` reports
    // `done` the instant a delivery PR merges, which is exactly the awaiting-release window — so a
    // merged-but-not-released parent used to read as closed and prematurely unblock its child.
    const parent = issue({
      number: 200,
      title: 'Parent goal',
      labels: [{ name: 'feature' }],
    })
    const child = issue({
      number: 201,
      title: 'Child goal',
      body: '## Acceptance criteria\n- [ ] child\n\nPart of #200',
    })
    const model = buildCommandCenterModel({
      issues: [parent, child],
      pullRequestsByIssue: {
        200: [{ number: 9, merged_at: '2026-01-01T00:00:00Z', base: { ref: 'development' } }],
      },
    })
    const parentGoal = model.goals.find((goal) => goal.number === 200)
    // The defect's precondition: status says "done" (a PR merged)...
    expect(parentGoal.status).toBe('done')
    // ...but the release lens says the release itself is still pending.
    expect(parentGoal.versionLens.state).toBe('awaiting-release')
    const graph = deriveUnitGraph(model.goals)
    const parentUnit = graph.find((unit) => unit.goal.number === 200)
    const childUnit = graph.find((unit) => unit.goal.number === 201)
    expect(parentUnit.closed).toBe(false)
    expect(childUnit.blockedByParent).toBe(true)
  })

  it('6. satisfying an adequacy-of-intent gate does not satisfy a release-of-candidate gate for the same unit', () => {
    // A single still-open goal can owe BOTH decisions at once: whether its intent is adequate
    // (adequacy-of-intent, unconditioned on delivery) and, independently, what its release impact
    // is (release-of-candidate) — release impact is a body/label signal, not something that waits
    // for a merged PR. Neither gate has been satisfied or expired: the goal is not closed.
    const goal = buildCommandCenterModel({
      issues: [highAssuranceIssue({ number: 7, labels: [{ name: 'feature' }] })],
    }).goals[0]
    const adequacyAction = goal.nextBestActions.find((action) => action.id === 'request-human-gate')
    const releaseAction = goal.nextBestActions.find(
      (action) => action.id === 'decide-release-impact',
    )
    expect(adequacyAction).toBeTruthy()
    expect(releaseAction).toBeTruthy()
    const adequacyGate = deriveGateForAction(goal, adequacyAction)
    // W8b D4 — DEFECT FIXED: this test used to call `deriveGateForAction(goal, releaseAction)` with
    // no candidate at all, and it still got back a real, sealed release-of-candidate gate — because
    // `releaseCandidateSubject` hashed goal metadata (goalRevision/targetBranch/releaseImpact) to
    // invent a subject, standing in for a candidate that was never built. That recipe is deleted: a
    // release gate now needs the REAL candidate digest a run produced (fingerprintCandidate over the
    // candidate's files). This test supplies one explicitly, the way a caller with a completed run
    // would, instead of relying on the deleted metadata path.
    const candidateDigest = 'f'.repeat(64)
    const releaseGate = deriveGateForAction(goal, releaseAction, { candidateDigest })
    expect(releaseGate.subjectDigest).toBe(candidateDigest)
    expect(adequacyGate.gateClass).toBe(GATE_CLASSES.adequacyOfIntent)
    expect(releaseGate.gateClass).toBe(GATE_CLASSES.releaseOfCandidate)
    expect(adequacyGate.subjectDigest).not.toBe(releaseGate.subjectDigest)
    // A human attestation that satisfies the adequacy gate...
    // W8a defect fixture: this used to set `platform: 'github'` — not the registered human
    // platform (manifests/runtime-platforms.json has no 'github' entry at all) — and still expected
    // satisfyGate to accept it. It only passed because satisfyGate never checked reviewer identity.
    // Fixed to the registered human platform so this demonstrates real human consent.
    const attestation = createReviewAttestation({
      subject: 'goal-adequacy',
      reviewedDigest: adequacyGate.subjectDigest,
      reviewer: { platform: 'human', executor: 'human-reviewer', independence: 'human-gate' },
      decision: 'agree',
      timestamp: new Date(0).toISOString(),
    })
    expect(satisfyGate(adequacyGate, attestation).ok).toBe(true)
    // ...never satisfies the release gate for the SAME unit, because they range over different
    // subjects (see lib/core/gate.mjs).
    expect(satisfyGate(releaseGate, attestation).ok).toBe(false)
  })

  it('7. the queue contains only items a human must decide; agent-actionable work is absent', () => {
    const model = buildCommandCenterModel({
      issues: [ordinaryIssue({ number: 1 }), highAssuranceIssue({ number: 2 })],
    })
    const contract = buildReadinessContract(model)
    const agentActionIds = [
      'clarify-scope',
      'check-design',
      'connect-pr',
      'record-validation',
      'request-review',
      'continue-flow',
    ]
    expect(contract.queue.length).toBeGreaterThan(0)
    for (const entry of contract.queue) {
      expect(agentActionIds).not.toContain(entry.action.id)
      expect(entry.gate).toBeTruthy()
    }
  })

  it('a closed unit\'s gate has expired: no open-gate action survives goal.status === "done"', () => {
    const model = buildCommandCenterModel({
      issues: [highAssuranceIssue({ number: 9, state: 'closed' })],
    })
    const contract = buildReadinessContract(model)
    expect(contract.queue.some((entry) => entry.unitRef.number === 9)).toBe(false)
  })
})
