import { describe, expect, it } from 'vitest'
import { buildCockpitIssueView, buildEpicRollup, buildGoalBoard } from '../cockpit-read-model.mjs'

describe('cockpit read model', () => {
  it('builds opinionated issue SDLC view from GitHub issue shape', () => {
    const view = buildCockpitIssueView({
      issue: managedIssue({ number: 122, title: 'Read-only MVP' }),
      comments: [{ body: '<!-- agent-handover -->\nNext: tester' }],
    })
    expect(view.number).toBe(122)
    expect(view.classification.isAgentFlowManaged).toBe(true)
    expect(view.commentLanes.Handover).toHaveLength(1)
    expect(view.evidenceHealth.status).toBe('complete')
    expect(view.goal.title).toBe('Read-only MVP')
    expect(view.goal.nextBestActions.length).toBeGreaterThan(0)
  })

  it('builds command center metrics with attention surfaced', () => {
    const board = buildGoalBoard({
      issues: [
        managedIssue({ number: 1, title: 'Good' }),
        { number: 2, title: 'Missing', labels: [], body: '' },
      ],
    })
    expect(board.metrics.activeGoals).toBe(2)
    expect(board.goals).toHaveLength(2)
    expect(board.topActions.length).toBeGreaterThan(0)
  })

  it('rolls up epic child evidence', () => {
    const rollup = buildEpicRollup({
      epic: managedIssue({
        number: 119,
        title: 'Cockpit',
        labels: [{ name: 'epic' }, { name: 'drafted-by:pi' }],
      }),
      childIssues: [
        managedIssue({ number: 120, title: 'Domain' }),
        { number: 121, title: 'Auth', labels: [], body: '' },
      ],
    })
    expect(rollup.totals.children).toBe(2)
    expect(rollup.totals.blocked).toBe(2)
    expect(rollup.totals.evidenceComplete).toBe(1)
  })
})

function managedIssue({ number, title, labels = [{ name: 'drafted-by:pi' }], body } = {}) {
  return {
    number,
    title,
    state: 'open',
    labels,
    body:
      body ??
      '## Acceptance criteria\n- [ ] done\n\n## Test plan\n- pnpm test\n\n<!-- agentflow:workflow-status -->',
  }
}
