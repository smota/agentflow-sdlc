import { describe, expect, it } from 'vitest'
import { validateIssueAgainstSdlc } from '../sdlc-state.mjs'
import { projectedTitle, workProjectionFindings } from '../core/work-projection.mjs'

const marker = (kind, extra = '') =>
  `<!-- agentflow-work:{"kind":"${kind}"} -->\n${extra}`.trimEnd()

describe('work projection', () => {
  it('prefixes a bare title and refuses a different kind prefix', () => {
    expect(projectedTitle('goal', 'See the tree')).toBe('goal: See the tree')
    expect(projectedTitle('goal', 'goal: See the tree')).toBe('goal: See the tree')
    expect(() => projectedTitle('capability', 'goal: See the tree')).toThrow(/goal, not capability/)
  })

  it('accepts a matching title, label, and parent', () => {
    expect(
      workProjectionFindings({
        title: 'capability: project the kind',
        body: marker('capability', 'Part of #386'),
        labels: ['kind:capability', 'feature'],
      }),
    ).toEqual([])
  })

  it('rejects a title, a label, or an epic that names another parent', () => {
    const body = marker('capability', '**Epic:** #371\n\nPart of #386')
    expect(
      workProjectionFindings({
        title: 'goal: project the kind',
        body,
        labels: ['kind:spec'],
      }),
    ).toEqual([
      'the title must start with capability:',
      'the issue must wear kind:capability and no other kind label',
      '**Epic:** must repeat Part of #386 and no other parent',
    ])
  })

  it('rejects a goal that names a parent and a legacy title that wears a kind', () => {
    expect(
      workProjectionFindings({
        title: 'goal: Outcome',
        body: marker('goal', 'Part of #1'),
        labels: ['kind:goal'],
      }),
    ).toEqual(['a goal has no parent'])
    expect(
      workProjectionFindings({
        title: 'fix: keep the bug',
        body: 'No kind here.',
        labels: ['bug'],
      }),
    ).toEqual([])
    expect(
      workProjectionFindings({
        title: 'goal: not really',
        body: 'No marker.',
        labels: [],
      }),
    ).toEqual(['a record with no kind cannot use the title prefix goal:'])
  })

  it('fails issue validation when the projection disagrees', () => {
    const config = {
      labels: { type: ['feature'], forbiddenPrefixes: [] },
    }
    const report = validateIssueAgainstSdlc(
      {
        title: 'feat: loose',
        body: `${marker('capability', 'Part of #1')}\n\n## Acceptance criteria\n- [ ] x`,
        labels: ['feature'],
      },
      config,
    )
    expect(report.ok).toBe(false)
    expect(report.findings.some((item) => item.code === 'issue.work-projection')).toBe(true)
  })
})
