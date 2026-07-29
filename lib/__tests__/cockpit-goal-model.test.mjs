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
    expect(
      deriveHumanGate({
        selectedPath,
        comments: [{ body: 'human security review approved and complete' }],
      }),
    ).toMatchObject({ status: 'approved' })
  })
})

function issue({
  number = 1,
  title = 'Goal',
  body = '## Acceptance criteria\n- [ ] works',
  labels = [{ name: 'drafted-by:pi' }],
} = {}) {
  return { number, title, body, labels, state: 'open' }
}
