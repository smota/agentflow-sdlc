import { describe, expect, it } from 'vitest'
import {
  renderGoalBoard,
  renderMetricsDashboard,
  renderGateTransitionModal,
} from '../cockpit-ui.mjs'

describe('Cockpit Visual Showcase & Operational Dashboard (#284)', () => {
  const mockCommandCenter = {
    metrics: {
      activeGoals: 3,
      awaitingRelease: 1,
      needAttention: 1,
      evidenceHealthAverage: 88,
    },
    goals: [
      {
        number: 275,
        title: 'Taxonomy and adaptive execution',
        status: 'Implementation',
        highlights: [{ value: 'In progress' }],
        selectedPath: { profile: 'standard', risk: 'medium' },
        versionLens: { state: 'unreleased' },
        evidenceHealth: { score: 85, grade: 'good', dimensions: [] },
        relationships: { blockedBy: [] },
      },
      {
        number: 276,
        title: 'Interactive human-in-the-loop gate dialogs',
        status: 'Planned',
        highlights: [{ value: 'Blocked by prerequisite' }],
        selectedPath: { profile: 'high-assurance', risk: 'high' },
        versionLens: { state: 'unreleased' },
        evidenceHealth: { score: 65, grade: 'needs-attention', dimensions: [] },
        relationships: { blockedBy: [275] },
        author: 'author-alice',
      },
    ],
  }

  it('1. Renders "Metrics & Spans" tab in navigation bar', () => {
    const htmlGoals = renderGoalBoard(mockCommandCenter, { view: 'goals' })
    expect(htmlGoals).toContain('Metrics & Spans')
    expect(htmlGoals).toContain('view=metrics')
    expect(htmlGoals).not.toContain('class="active" href="/?view=metrics"')

    const htmlMetrics = renderGoalBoard(mockCommandCenter, { view: 'metrics' })
    expect(htmlMetrics).toContain('class="active" href="/?view=metrics"')
    expect(htmlMetrics).toContain('DORA Cycle Metrics & Role Flow Ledger')
  })

  it('2. Goal card renders blocked badge, dimmed card class, and Gate Sign-off button when dependencies exist', () => {
    const html = renderGoalBoard(mockCommandCenter, { view: 'goals' })

    // Unblocked goal
    expect(html).toContain('Goal #275')

    // Blocked goal
    expect(html).toContain('Goal #276')
    expect(html).toContain('goal-card-blocked')
    expect(html).toContain('badge-blocked')
    expect(html).toContain('⛔ Blocked by: #275')
    expect(html).toContain('Gate Sign-off')
    expect(html).toContain('modal=gate-transition&issue=276')
  })

  it('3. Renders interactive Gate Transition Modal when modal=gate-transition is active', () => {
    const targetGoal = mockCommandCenter.goals[1]
    const htmlWithModal = renderGoalBoard(mockCommandCenter, {
      view: 'goals',
      modal: 'gate-transition',
      modalGoal: targetGoal,
      user: 'reviewer-bob',
      csrfToken: 'test-csrf-token',
    })

    expect(htmlWithModal).toContain('Gate Transition & Readiness Verification')
    expect(htmlWithModal).toContain('Goal: <strong>#276')
    expect(htmlWithModal).toContain('high-assurance')
    expect(htmlWithModal).toContain('Human Waiver Request')
    expect(htmlWithModal).toContain('Evaluate & Transition')
    // Reviewer bob is NOT author-alice -> no dual-control violation alert
    expect(htmlWithModal).not.toContain('Dual-Control Violation')
  })

  it('4. Dual-Control violation is triggered when author attempts to self-approve high-assurance gate', () => {
    const targetGoal = mockCommandCenter.goals[1]
    const htmlWithAuthor = renderGoalBoard(mockCommandCenter, {
      view: 'goals',
      modal: 'gate-transition',
      modalGoal: targetGoal,
      user: 'author-alice',
      csrfToken: 'test-csrf-token',
    })

    expect(htmlWithAuthor).toContain('Dual-Control Violation')
    expect(htmlWithAuthor).toContain('As the author (author-alice)')
    expect(htmlWithAuthor).toContain('disabled')
  })

  it('5. Metrics Dashboard renders DORA KPIs, actor distribution, and topological dependency tree', () => {
    const html = renderMetricsDashboard(mockCommandCenter, 'smota/agentflow-sdlc')

    // DORA KPIs
    expect(html).toContain('Lead Time to Delivery')
    expect(html).toContain('First-Pass Yield')
    expect(html).toContain('Ledger Integrity')
    expect(html).toContain('✓ SHA-256 Chained')
    expect(html).toContain('Blocked Dependencies')

    // Actor effort distribution
    expect(html).toContain('Actor Effort Distribution')
    expect(html).toContain('Agent 68%')
    expect(html).toContain('Human 24%')
    expect(html).toContain('System 8%')

    // Role Span table
    expect(html).toContain('Role Span Cycle Durations')
    expect(html).toContain('Analyst (Phase 1)')
    expect(html).toContain('Architect (Phase 2)')
    expect(html).toContain('Black-Box QA (Phase 5)')
    expect(html).toContain('Review &amp; Dual-Control (Phase 6)')

    // Topological dependency tree
    expect(html).toContain('Topological Dependency Tree')
    expect(html).toContain('#275 Taxonomy and adaptive execution')
    expect(html).toContain('✓ Unblocked')
    expect(html).toContain('#276 Interactive human-in-the-loop gate dialogs')
    expect(html).toContain('⛔ Blocked by: #275')
  })
})
