import { describe, expect, it } from 'vitest'
import {
  buildAgentFlowGoalModel,
  buildCommandCenterModel,
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
})

function issue({ number = 1, title = 'Goal', body = '## Acceptance criteria\n- [ ] works' } = {}) {
  return { number, title, body, labels: [{ name: 'drafted-by:pi' }], state: 'open' }
}
