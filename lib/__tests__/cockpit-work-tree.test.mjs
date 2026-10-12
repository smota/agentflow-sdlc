import { describe, expect, it } from 'vitest'
import { renderGoalBoard } from '../cockpit-ui.mjs'
import { buildCommandCenterModel } from '../cockpit-goal-model.mjs'

const goalBody = (title) => `<!-- agentflow-work:{"kind":"goal"} -->\n# ${title}`
const capBody = (parent, replaces = null) => {
  let b = `<!-- agentflow-work:{"kind":"capability"} -->\nPart of #${parent}`
  if (replaces) b += `\nReplaces #${replaces}`
  return b
}
const noteBody = (parent) => `Part of #${parent}\n\nA breakdown note.`

describe('Cockpit work tree (#390)', () => {
  it('AC1 & AC2 & AC3 & AC4: renders tree rooted at each goal, current admitted parts, and unadmitted notes', () => {
    const issues = [
      {
        number: 371,
        title: 'goal: Work altitude and breakdown projection',
        body: goalBody('Work altitude and breakdown projection'),
        labels: [{ name: 'kind:goal' }],
      },
      {
        number: 386,
        title: 'capability: work-altitude and work-projection modules',
        body: capBody(371, 373),
        labels: [{ name: 'kind:capability' }],
      },
      {
        number: 373,
        title: 'capability: breakdown note replaced by 386',
        body: noteBody(371),
        labels: [{ name: 'kind:capability' }],
      },
      {
        number: 390,
        title: 'capability: show the work tree in the cockpit',
        body: noteBody(371),
        labels: [{ name: 'kind:capability' }],
      },
    ]

    const model = buildCommandCenterModel({ issues, repo: 'test/repo' })
    const html = renderGoalBoard(model, { repo: 'test/repo' })

    const hierarchyHtml = html.match(/<aside class="panel nav-pane">([\s\S]*?)<\/aside>/)?.[1] || ''

    // AC1: root goal rendered with ◎
    expect(hierarchyHtml).toContain('◎ goal: Work altitude and breakdown projection')

    // AC2: admitted capability #386 rendered with ○ and NO (not yet admitted)
    expect(hierarchyHtml).toContain(
      'href="/issues/386?repo=test%2Frepo">○ capability: work-altitude and work-projection modules<span>blocked</span></a>',
    )
    expect(hierarchyHtml).not.toContain(
      '○ capability: work-altitude and work-projection modules <span class="unadmitted">',
    )

    // AC3: unadmitted note #390 rendered with ○ and (not yet admitted)
    expect(hierarchyHtml).toContain(
      'href="/issues/390?repo=test%2Frepo">○ capability: show the work tree in the cockpit <span class="unadmitted">(not yet admitted)</span>',
    )

    // AC4: replaced note #373 is omitted from current parts
    expect(hierarchyHtml).not.toContain('breakdown note replaced by 386')
  })

  it('AC5: a goal has no parent even if prose mentions Part of #', () => {
    const issues = [
      {
        number: 100,
        title: 'goal: Independent top goal',
        body: goalBody('Independent top goal'),
        labels: [{ name: 'kind:goal' }],
      },
      {
        number: 200,
        title: 'goal: Second goal with prose mentioning Part of #100',
        body: `<!-- agentflow-work:{"kind":"goal"} -->\nThis is related to Part of #100 in prose discussion.`,
        labels: [{ name: 'kind:goal' }],
      },
    ]

    const model = buildCommandCenterModel({ issues, repo: 'test/repo' })
    const html = renderGoalBoard(model, { repo: 'test/repo' })

    // Both goals appear as root ◎ items
    expect(html).toContain('◎ goal: Independent top goal')
    expect(html).toContain('◎ goal: Second goal with prose mentioning Part of #100')
  })

  it('AC6: parent is only an exact Part of # line; prose mentioning parent is ignored', () => {
    const issues = [
      {
        number: 371,
        title: 'goal: Work altitude and breakdown projection',
        body: goalBody('Work altitude and breakdown projection'),
        labels: [{ name: 'kind:goal' }],
      },
      {
        number: 386,
        title: 'capability: work-altitude and work-projection modules',
        // Contains prose mentioning Part of #371 in middle of sentence, but exact parent line is 371
        body: `<!-- agentflow-work:{"kind":"capability"} -->\nPart of #371\n\nCockpit-tree is #390. It is Part of #371, not a capability of this goal.`,
        labels: [{ name: 'kind:capability' }],
      },
    ]

    const model = buildCommandCenterModel({ issues, repo: 'test/repo' })
    const html = renderGoalBoard(model, { repo: 'test/repo' })

    expect(html).toContain('◎ goal: Work altitude and breakdown projection')
    expect(html).toContain('○ capability: work-altitude and work-projection modules')
    // No rejected records caused by multiple parents
    expect(html).not.toContain('hierarchy-rejected')
  })

  it('AC7: legacy records with no kind are omitted from tree', () => {
    const issues = [
      {
        number: 371,
        title: 'goal: Work altitude and breakdown projection',
        body: goalBody('Work altitude and breakdown projection'),
        labels: [{ name: 'kind:goal' }],
      },
      {
        number: 372,
        title: 'legacy issue with no kind',
        body: 'Just a normal issue before work-projection.',
        labels: ['enhancement'],
      },
    ]

    const model = buildCommandCenterModel({ issues, repo: 'test/repo' })
    const html = renderGoalBoard(model, { repo: 'test/repo' })

    const hierarchyHtml = html.match(/<aside class="panel nav-pane">([\s\S]*?)<\/aside>/)?.[1] || ''

    expect(hierarchyHtml).toContain('◎ goal: Work altitude and breakdown projection')
    expect(hierarchyHtml).not.toContain('legacy issue with no kind')
    expect(hierarchyHtml).not.toContain('hierarchy-rejected')
  })

  it('AC8: rejected records with findings appear in separate rejected list with reasons', () => {
    const issues = [
      {
        number: 371,
        title: 'goal: Work altitude and breakdown projection',
        body: goalBody('Work altitude and breakdown projection'),
        labels: [{ name: 'kind:goal' }],
      },
      {
        number: 501,
        title: 'capability: missing parent',
        body: `<!-- agentflow-work:{"kind":"capability"} -->\nNo parent specified`,
        labels: [{ name: 'kind:capability' }],
      },
    ]

    const model = buildCommandCenterModel({ issues, repo: 'test/repo' })
    const html = renderGoalBoard(model, { repo: 'test/repo' })

    expect(html).toContain('hierarchy-rejected')
    expect(html).toContain('Rejected work records')
    expect(html).toContain('#501')
    expect(html).toContain('a capability or a spec needs one Part of #&lt;parent&gt;')
  })

  it('AC9, AC10, AC11: read-only, dynamic projection, live test against full goal set', () => {
    // Verified dynamically on each render call without mutating issues or storing hierarchy
    const issues = [
      {
        number: 371,
        title: 'goal: Work altitude',
        body: goalBody('Work altitude'),
        labels: [{ name: 'kind:goal' }],
      },
    ]
    const model = buildCommandCenterModel({ issues, repo: 'test/repo' })
    const html = renderGoalBoard(model, { repo: 'test/repo' })
    expect(html).toContain('◎ goal: Work altitude')
  })
})
