import { describe, expect, it } from 'vitest'
import {
  buildAgentFlowGoalModel,
  buildCommandCenterModel,
  buildReleaseDashboard,
  deriveHumanGate,
  deriveSelectedPath,
  deriveVersionLens,
  DISPLAY_STATES,
} from '../cockpit-goal-model.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import { GATE_CLASSES } from '../core/gate.mjs'

describe('AgentFlow goal model', () => {
  it('derives health score and next-best-actions from GitHub evidence', () => {
    const goal = buildAgentFlowGoalModel({
      issue: issue({ body: '## Acceptance criteria\n- [ ] works\n\n## Test plan\n- pnpm test' }),
      comments: [{ body: '<!-- agentflow:validation-summary -->\npnpm test passed' }],
      pullRequests: [{ number: 1, title: 'PR', merged_at: null }],
    })
    expect(goal.evidenceHealth.score).toBeGreaterThan(60)
    expect(goal.nextBestActions.map((action) => action.id)).toContain('request-review')
    expect(goal.roleContributions.find((item) => item.phase === 'analyst').state).toBe(
      DISPLAY_STATES.recorded,
    )
  })

  it('prioritizes human gate for sensitive goals', () => {
    const goal = buildAgentFlowGoalModel({
      issue: issue({
        body: '## Acceptance criteria\n- [ ] works\n\nRemote auth security high-assurance',
      }),
    })
    expect(goal.nextBestActions[0].id).toBe('request-human-gate')
    expect(goal.status).toBe('blocked')
  })

  it('builds command center metrics and highlight', () => {
    const model = buildCommandCenterModel({
      issues: [issue({ number: 1, title: 'A' }), issue({ number: 2, title: 'B', body: '' })],
    })
    expect(model.metrics.activeGoals).toBe(2)
    expect(model.topActions.length).toBeGreaterThan(0)
    expect(model.highlight).toBeTruthy()
  })

  it('excludes skipped-by-path roles from readiness denominator', () => {
    const goal = buildAgentFlowGoalModel({
      issue: issue({
        body: '## Acceptance criteria\n- [ ] typo fixed\n\n## Test plan\n- docs reviewed\n\ndocs-only bounded low-risk',
      }),
      comments: [{ body: 'validation passed. review complete.' }],
      pullRequests: [{ number: 2, title: 'Docs PR', base: { ref: 'development' } }],
    })
    expect(goal.selectedPath.profile).toBe('bounded')
    expect(goal.roleContributions.find((item) => item.phase === 'architect')).toMatchObject({
      status: 'skipped-by-path',
      scoreImpact: 'excluded',
    })
    expect(goal.evidenceHealth.excluded).not.toContain('roleFlow')
    expect(goal.evidenceHealth.dimensions.find((item) => item.id === 'roleFlow').detail).toContain(
      'applicable roles',
    )
  })

  it('builds first-class release dashboard rollup', () => {
    const model = buildCommandCenterModel({
      issues: [issue({ number: 1, title: 'Ship A', labels: [{ name: 'feature' }] })],
      pullRequestsByIssue: {
        1: [{ number: 3, merged_at: '2026-01-01T00:00:00Z', base: { ref: 'development' } }],
      },
    })
    expect(model.releaseDashboard).toMatchObject({ targetBranch: 'development' })
    expect(model.releaseDashboard.awaitingRelease).toHaveLength(1)
    expect(model.releaseDashboard.needsAssignment).toHaveLength(1)
    expect(model.metrics.missingReleaseNotes).toBe(1)
    expect(buildReleaseDashboard(model.goals).includedGoals).toHaveLength(1)
  })

  it('does not use incidental semver mentions as release candidate', () => {
    const version = deriveVersionLens({
      issue: issue({ body: 'Tests ran on package v2.1.9 but no release was planned.' }),
    })
    expect(version.candidateVersion).toBeNull()
    expect(
      buildReleaseDashboard([buildAgentFlowGoalModel({ issue: issue() })]).releaseCandidate,
    ).toBe('Next release')
  })

  it('derives version lens for merged development work awaiting release', () => {
    const version = deriveVersionLens({
      issue: issue({ labels: [{ name: 'feature' }] }),
      pullRequests: [
        { number: 3, merged_at: '2026-01-01T00:00:00Z', base: { ref: 'development' } },
      ],
    })
    expect(version.state).toBe('awaiting-release')
    expect(version.releaseImpact).toBe('minor')
    expect(version.releaseNoteState).toBe('needs-decision')
  })

  it('infers high-assurance selected path from sensitive work', () => {
    expect(
      deriveSelectedPath({
        issue: issue({ body: '## Acceptance criteria\n- [ ] secure\n\nRemote auth security' }),
      }),
    ).toMatchObject({ profile: 'high-assurance', risk: 'high' })
  })

  it('tracks required human gate status explicitly', () => {
    const selectedPath = deriveSelectedPath({
      issue: issue({ body: '## Acceptance criteria\n- [ ] secure\n\nRemote auth security' }),
    })
    expect(deriveHumanGate({ selectedPath, comments: [] })).toMatchObject({
      required: true,
      status: 'not-requested',
    })
    // A comment merely asking for review moves status to "requested" (informational only) — it
    // grants nothing by itself.
    expect(
      deriveHumanGate({
        selectedPath,
        comments: [{ body: 'human security review requested' }],
      }),
    ).toMatchObject({ status: 'requested' })
    // Prose can no longer forge approval (invariant 9): an agent-authored comment claiming
    // "approved and complete" must NOT satisfy the gate. Only a structural, unforgeable signal
    // (an actual PR review decision) can.
    expect(
      deriveHumanGate({
        selectedPath,
        comments: [{ body: 'human security review approved and complete' }],
      }),
    ).toMatchObject({ status: 'requested' })
    // W8b D2 — DEFECT FIXED: this assertion used to read `toMatchObject({ status: 'approved' })`
    // for a GitHub `reviewDecision: 'APPROVED'` alone, with no satisfied gate at all — the cockpit's
    // human gate completing on GitHub, exactly the checkpoint finding this release fixes. A PR
    // review decision is now only ever an advisory hint (invariant 9): it can never complete the
    // gate by itself, no matter what it says.
    const subjectDigest = 'd'.repeat(64)
    const withReviewDecisionOnly = deriveHumanGate({
      selectedPath,
      comments: [],
      pullRequests: [{ reviewDecision: 'APPROVED' }],
      subjectDigest,
      satisfiedGates: [],
    })
    expect(withReviewDecisionOnly).toMatchObject({ status: 'not-requested', complete: false })
    expect(withReviewDecisionOnly.hints).toContainEqual(
      expect.objectContaining({ id: 'github-review-decision', value: 'APPROVED' }),
    )
    // Only a satisfied gate over the goal's own subject completes it.
    const withSatisfiedGate = deriveHumanGate({
      selectedPath,
      comments: [],
      pullRequests: [{ reviewDecision: 'APPROVED' }],
      subjectDigest,
      satisfiedGates: [{ gateClass: GATE_CLASSES.adequacyOfIntent, subjectDigest }],
    })
    expect(withSatisfiedGate).toMatchObject({ status: 'approved', complete: true })
  })

  it('requires a human gate on every path, and a derivable crossing still sharpens the reason outside the high-assurance profile', () => {
    // W8b2 — DEFECT FIXED: this used to assert `required: false, status: 'not-required'` for a
    // bare exploratory path with no PR open, treating the human gate as absent until a crossing
    // (opening a PR) forced it on. That baseline was itself the W8b2 defect: every posture requires
    // a human at intent freeze (resolvePosture(...).humanGateClasses always includes
    // adequacy-of-intent), so `required` is true here regardless of any crossing — the exact
    // contradiction (bounded/standard/exploratory silently reporting "not-required") this release
    // fixes. What a derivable crossing still does is sharpen `reason`: an exploratory path may only
    // propose, never open a PR unattended, so opening one is an authority-escalation crossing that
    // now reports the specific boundary violation instead of the generic default reason.
    const selectedPath = deriveSelectedPath({
      issue: issue({ body: '## Acceptance criteria\n- [ ] done\n\nExploratory spike' }),
    })
    expect(selectedPath.profile).toBe('exploratory')
    const withoutCrossing = deriveHumanGate({ selectedPath, comments: [], pullRequests: [] })
    expect(withoutCrossing).toMatchObject({ required: true, status: 'not-requested' })
    expect(withoutCrossing.reason).toBe('Selected path requires a human approval gate.')
    const withCrossing = deriveHumanGate({
      selectedPath,
      comments: [],
      pullRequests: [{ number: 1 }],
    })
    expect(withCrossing).toMatchObject({ required: true, status: 'not-requested' })
    expect(withCrossing.reason).toBe('Effective action boundary open-pr widens beyond propose.')
  })
})

describe('AgentFlow intent identity (W2)', () => {
  const repo = 'smota/agentflow-sdlc'

  it('produces different revisions for the same issue number when title/body differ', () => {
    const a = buildAgentFlowGoalModel({
      issue: issue({
        number: 42,
        title: 'Title A',
        body: '## Acceptance criteria\n- [ ] a',
        updated_at: '2026-01-01T00:00:00Z',
      }),
      repo,
    })
    const b = buildAgentFlowGoalModel({
      issue: issue({
        number: 42,
        title: 'Title B',
        body: '## Acceptance criteria\n- [ ] b',
        updated_at: '2026-01-01T00:00:00Z',
      }),
      repo,
    })
    expect(a.revision).not.toBe(b.revision)
  })

  it('produces the same revision for identical issue content (stability)', () => {
    const build = () =>
      buildAgentFlowGoalModel({
        issue: issue({
          number: 42,
          title: 'Stable title',
          body: '## Acceptance criteria\n- [ ] x',
          updated_at: '2026-01-01T00:00:00Z',
        }),
        repo,
      })
    expect(build().revision).toBe(build().revision)
  })

  it('computes the same revision as the run track recipe for the same input (anti-divergence)', () => {
    const number = 77
    const title = 'Ship the thing'
    const body = '## Acceptance criteria\n- [ ] shipped'
    const updated_at = '2026-03-01T12:00:00Z'
    const goal = buildAgentFlowGoalModel({
      issue: issue({ number, title, body, updated_at }),
      repo,
    })
    const runTrackRevision = recordDigest({
      repo,
      number,
      title,
      body,
      updatedAt: updated_at,
    })
    expect(goal.revision).toBe(runTrackRevision)
  })

  it('treats an intent with children and one without as the same type', () => {
    const parent = issue({ number: 100, title: 'Parent goal' })
    const child = issue({
      number: 101,
      title: 'Child goal',
      body: '## Acceptance criteria\n- [ ] child\n\nPart of #100',
    })
    const model = buildCommandCenterModel({ issues: [parent, child], repo })
    const parentGoal = model.goals.find((item) => item.number === 100)
    const childGoal = model.goals.find((item) => item.number === 101)
    expect(parentGoal.goalType).toBeUndefined()
    expect(childGoal.goalType).toBeUndefined()
    expect(Object.keys(parentGoal).sort()).toEqual(Object.keys(childGoal).sort())
    expect(JSON.stringify(model.goals)).not.toContain('goal-group')
  })

  it('reconstructs a depth-3 tree from opaque partOf references alone', () => {
    const grandparent = issue({ number: 1, title: 'Grandparent' })
    const parent = issue({
      number: 2,
      title: 'Parent',
      body: '## Acceptance criteria\n- [ ] x\n\nPart of #1',
    })
    const child = issue({
      number: 3,
      title: 'Child',
      body: '## Acceptance criteria\n- [ ] x\n\nPart of #2',
    })
    const model = buildCommandCenterModel({ issues: [grandparent, parent, child], repo })
    const byNumber = Object.fromEntries(model.goals.map((item) => [item.number, item]))
    expect(byNumber[1].partOf).toBeNull()
    expect(byNumber[2].partOf.number).toBe(1)
    expect(byNumber[2].partOf.revision).toBe(byNumber[1].revision)
    expect(byNumber[3].partOf.number).toBe(2)
    expect(byNumber[3].partOf.revision).toBe(byNumber[2].revision)
  })

  it('changes the revision when the issue body is edited (drift is visible)', () => {
    const original = buildAgentFlowGoalModel({
      issue: issue({
        number: 9,
        title: 'Drift',
        body: '## Acceptance criteria\n- [ ] v1',
        updated_at: '2026-01-01T00:00:00Z',
      }),
      repo,
    })
    const edited = buildAgentFlowGoalModel({
      issue: issue({
        number: 9,
        title: 'Drift',
        body: '## Acceptance criteria\n- [ ] v2 (edited)',
        updated_at: '2026-01-01T00:00:00Z',
      }),
      repo,
    })
    expect(edited.revision).not.toBe(original.revision)
  })
})

function issue({
  number = 1,
  title = 'Goal',
  body = '## Acceptance criteria\n- [ ] works',
  labels = [{ name: 'drafted-by:pi' }],
  updated_at,
} = {}) {
  return { number, title, body, labels, state: 'open', updated_at }
}
