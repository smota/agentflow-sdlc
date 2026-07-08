import { describe, expect, it } from 'vitest'
import { extractSection, fieldValue, parseMarkdownTable } from '../markdown-sections.mjs'
import {
  deriveContextBoundary,
  rowsFromTable,
  validateRoleAttributionMatrix,
} from '../role-attribution.mjs'

function matrixMarkdown(rows) {
  const header =
    '| Phase | Role | Planned owner | Actual agent | Executor | Context boundary | Independence boundary | Status |'
  const separator = '| --- | --- | --- | --- | --- | --- | --- | --- |'
  return [header, separator, ...rows].join('\n')
}

function rowsFromMarkdown(markdown) {
  return rowsFromTable(parseMarkdownTable(markdown))
}

const developerRow = (actualAgent, plannedOwner = 'claude') =>
  `| 4 | developer | ${plannedOwner} | ${actualAgent} | ${actualAgent}-cli | current-session | not-applicable | pass |`

const reviewRow = (actualAgent, { plannedOwner = 'agy', independence = 'independent' } = {}) =>
  `| 6 | review | ${plannedOwner} | ${actualAgent} | ${actualAgent}-cli | current-session | ${independence} | pass |`

describe('markdown-sections', () => {
  it('extracts a level-2 section body up to the next level-2 heading', () => {
    const content = '## A\n\nbody a\n\n## B\n\nbody b\n'
    expect(extractSection(content, 'A')).toBe('body a')
    expect(extractSection(content, 'B')).toBe('body b')
    expect(extractSection(content, 'C')).toBeNull()
  })

  it('extracts a level-3 section without breaking on level-2 headings', () => {
    const content =
      '## Workflow Status\n\n**Mode:** multi-agent\n\n### Role attribution matrix\n\ntable\n\n---\n'
    expect(extractSection(content, 'Role attribution matrix', 3)).toBe('table\n\n---')
  })

  it('reads bullet and bold field values', () => {
    expect(fieldValue('- Mode: multi-agent', 'Mode')).toBe('multi-agent')
    expect(fieldValue('**Mode:** multi-agent', 'Mode')).toBe('multi-agent')
    expect(fieldValue('- Mode: multi-agent', 'Missing')).toBeNull()
  })

  it('parses a markdown table into header/rows', () => {
    const table = parseMarkdownTable(matrixMarkdown([developerRow('claude')]))
    expect(table.header).toEqual([
      'Phase',
      'Role',
      'Planned owner',
      'Actual agent',
      'Executor',
      'Context boundary',
      'Independence boundary',
      'Status',
    ])
    expect(table.rows).toHaveLength(1)
  })
})

describe('role-attribution', () => {
  it('derives contextBoundary from transport/delegationBoundary without a separate stored field', () => {
    expect(
      deriveContextBoundary({ transport: 'local-cli', delegationBoundary: 'current-session' }),
    ).toBe('current-session')
    expect(
      deriveContextBoundary({ transport: 'pi-subagent', delegationBoundary: 'child-subagent' }),
    ).toBe('forked-context')
    expect(
      deriveContextBoundary({ transport: 'manual', delegationBoundary: 'human-handoff' }),
    ).toBe('human-handoff')
    expect(
      deriveContextBoundary({ transport: 'unknown', delegationBoundary: 'unknown' }),
    ).toBeNull()
  })

  it('is always ok when there is no multi-agent claim, even with no rows', () => {
    const result = validateRoleAttributionMatrix({ rows: [], multiAgentClaim: false })
    expect(result).toEqual({ ok: true, errors: [], warnings: [] })
  })

  it('flags a multi-agent claim with a missing role attribution matrix', () => {
    const result = validateRoleAttributionMatrix({ rows: [], multiAgentClaim: true })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('requires a role attribution matrix')
  })

  it('flags a multi-agent claim backed by only one role intelligence', () => {
    const rows = rowsFromMarkdown(
      matrixMarkdown([
        developerRow('claude', 'claude'),
        reviewRow('claude', { plannedOwner: 'claude', independence: 'self-review' }),
      ]),
    )
    const result = validateRoleAttributionMatrix({
      rows,
      multiAgentClaim: true,
      selfReviewDisclosure: 'same agent performed both roles; rationale recorded',
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('at least two distinct role intelligences')
  })

  it('accepts a multi-agent claim with two distinct role intelligences and independent developer/review', () => {
    const rows = rowsFromMarkdown(matrixMarkdown([developerRow('claude'), reviewRow('agy')]))
    const result = validateRoleAttributionMatrix({ rows, multiAgentClaim: true })
    expect(result.ok).toBe(true)
  })

  it('flags developer/reviewer using the same intelligence without self-review disclosure', () => {
    const rows = rowsFromMarkdown(
      matrixMarkdown([
        developerRow('claude', 'claude'),
        reviewRow('claude', { plannedOwner: 'claude', independence: 'independent' }),
        `| 2 | architect | agy | agy | agy-cli | current-session | not-applicable | pass |`,
      ]),
    )
    const result = validateRoleAttributionMatrix({ rows, multiAgentClaim: true })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('self-review disclosure')
  })

  it('accepts developer/reviewer using the same intelligence when explicitly disclosed', () => {
    const rows = rowsFromMarkdown(
      matrixMarkdown([
        developerRow('claude', 'claude'),
        reviewRow('claude', { plannedOwner: 'claude', independence: 'self-review' }),
        `| 2 | architect | agy | agy | agy-cli | current-session | not-applicable | pass |`,
      ]),
    )
    const result = validateRoleAttributionMatrix({
      rows,
      multiAgentClaim: true,
      selfReviewDisclosure: 'no agy availability this session; claude self-reviewed with rationale',
      workflowProfile: 'standard',
    })
    expect(result.ok).toBe(true)
  })

  it('forbids self-review under a high-assurance workflow profile even when disclosed', () => {
    const rows = rowsFromMarkdown(
      matrixMarkdown([
        developerRow('claude', 'claude'),
        reviewRow('claude', { plannedOwner: 'claude', independence: 'self-review' }),
      ]),
    )
    const result = validateRoleAttributionMatrix({
      rows,
      multiAgentClaim: true,
      selfReviewDisclosure: 'rationale',
      workflowProfile: 'high-assurance',
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain(
      'high-assurance workflow profile forbids self-review',
    )
  })

  it('flags a row missing a planned owner, so a fallback cannot be verified', () => {
    const rows = rowsFromMarkdown(
      matrixMarkdown([
        '| 4 | developer |  | claude | claude-cli | current-session | not-applicable | pass |',
        reviewRow('agy'),
      ]),
    )
    const result = validateRoleAttributionMatrix({ rows, multiAgentClaim: true })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('missing a planned owner')
  })

  it('records a fallback correctly when planned and actual owners differ but are both valid', () => {
    const rows = rowsFromMarkdown(
      matrixMarkdown([developerRow('codex', 'claude'), reviewRow('agy')]),
    )
    const result = validateRoleAttributionMatrix({ rows, multiAgentClaim: true })
    expect(result.ok).toBe(true)
  })

  it('rejects an unsupported agent slug in a matrix row', () => {
    const rows = rowsFromMarkdown(
      matrixMarkdown([
        '| 4 | developer | claude | robot | robot-cli | current-session | not-applicable | pass |',
        reviewRow('agy'),
      ]),
    )
    const result = validateRoleAttributionMatrix({ rows, multiAgentClaim: true })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unsupported actual agent')
  })

  it('rejects invalid context and independence boundary values', () => {
    const rows = rowsFromMarkdown(
      matrixMarkdown([
        '| 4 | developer | claude | claude | claude-cli | typo-context | not-applicable | pass |',
        '| 6 | review | agy | agy | agy-cli | current-session | typo-independence | pass |',
      ]),
    )
    const result = validateRoleAttributionMatrix({ rows, multiAgentClaim: true })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('invalid context boundary')
    expect(result.errors.join('\n')).toContain('invalid independence boundary')
  })
})
