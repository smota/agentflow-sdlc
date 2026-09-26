import { describe, expect, it } from 'vitest'
import { extractIssueRelationships, extractIssueTaxonomy } from '../cockpit-markdown.mjs'
import {
  buildAgentFlowGoalModel,
  buildCommandCenterModel,
  deriveSelectedPath,
  DISPLAY_STATES,
} from '../cockpit-goal-model.mjs'

function issue(overrides = {}) {
  return {
    number: 100,
    title: 'Test issue',
    body: '## Acceptance criteria\n- [ ] works\n\n## Technical Design\nDesigned.',
    labels: [{ name: 'feature' }],
    state: 'open',
    url: 'https://github.com/example/repo/issues/100',
    updated_at: '2026-09-26T12:00:00Z',
    ...overrides,
  }
}

describe('Risk-Aware Card Taxonomy and Adaptive Execution Paths (Issue #275)', () => {
  describe('extractIssueRelationships', () => {
    it('extracts blocked_by, derived_from, and discovered_from relationships', () => {
      const body = `
## Background & Problem Statement
Some context.

blocked_by: #201
Derived from: #150
discovered_from: #99
`
      const relationships = extractIssueRelationships({ body })
      expect(relationships.blockedBy).toEqual([201])
      expect(relationships.derivedFrom).toEqual([150])
      expect(relationships.discoveredFrom).toEqual([99])
    })

    it('extracts multiple blocker references without duplicates', () => {
      const body = `
Blocked by: #101
blocked-by: #102
blocks: #101
`
      const relationships = extractIssueRelationships({ body })
      expect(relationships.blockedBy).toEqual([101, 102])
    })
  })

  describe('extractIssueTaxonomy', () => {
    it('extracts explicit risk levels and assurance paths', () => {
      const body = `
Risk level: critical
Assurance path: high-assurance
`
      const taxonomy = extractIssueTaxonomy({ body })
      expect(taxonomy.riskLevel).toBe('critical')
      expect(taxonomy.assurancePath).toBe('high-assurance')
    })

    it('extracts light path and low risk taxonomy', () => {
      const body = `
risk: low
path: light
`
      const taxonomy = extractIssueTaxonomy({ body })
      expect(taxonomy.riskLevel).toBe('low')
      expect(taxonomy.assurancePath).toBe('light')
    })
  })

  describe('Adaptive execution paths and role skipping', () => {
    it('routes light path without readiness penalty on skipped architecture', () => {
      const goal = buildAgentFlowGoalModel({
        issue: issue({
          body: `
## Acceptance criteria
- [ ] fast fix

path: light
risk: low
`,
        }),
      })

      expect(goal.selectedPath.profile).toBe('light')
      expect(goal.selectedPath.risk).toBe('low')
      const architectRole = goal.roleContributions.find((r) => r.phase === 'architect')
      expect(architectRole).toMatchObject({
        status: 'skipped-by-path',
        scoreImpact: 'excluded',
      })
      expect(architectRole.summary).toContain('skipped by light low-risk path')
    })

    it('enforces all roles for high-assurance paths', () => {
      const goal = buildAgentFlowGoalModel({
        issue: issue({
          body: `
## Acceptance criteria
- [ ] critical migration

path: high-assurance
risk: critical
`,
        }),
      })

      expect(goal.selectedPath.profile).toBe('high-assurance')
      expect(goal.selectedPath.risk).toBe('critical')
      expect(goal.selectedPath.skippedRoles).toHaveLength(0)
      expect(goal.selectedPath.applicableRoles).toContain('architect')
      expect(goal.selectedPath.applicableRoles).toContain('product-manager')
    })
  })

  describe('Dependency blocker enforcement', () => {
    it('marks goal as blocked when blocked_by references an open issue', () => {
      const targetIssue = issue({
        number: 50,
        body: '## Acceptance criteria\n- [ ] task\n\nblocked_by: #40',
      })
      const blockerIssue = issue({
        number: 40,
        state: 'open',
      })

      const goal = buildAgentFlowGoalModel({
        issue: targetIssue,
        allIssues: [targetIssue, blockerIssue],
      })

      expect(goal.status).toBe('blocked')
      const blockerAction = goal.nextBestActions.find((a) => a.id === 'resolve-blockers')
      expect(blockerAction).toBeDefined()
      expect(blockerAction.priority).toBe(98)
      expect(blockerAction.reason).toContain('#40')
    })

    it('unblocks goal when all blocking issues are closed', () => {
      const targetIssue = issue({
        number: 50,
        body: '## Acceptance criteria\n- [ ] task\n\nblocked_by: #40',
      })
      const closedBlocker = issue({
        number: 40,
        state: 'closed',
      })

      const goal = buildAgentFlowGoalModel({
        issue: targetIssue,
        allIssues: [targetIssue, closedBlocker],
      })

      const blockerAction = goal.nextBestActions.find((a) => a.id === 'resolve-blockers')
      expect(blockerAction).toBeUndefined()
      expect(goal.status).not.toBe('blocked')
    })

    it('enforces blockers across the Command Center model', () => {
      const issueA = issue({ number: 1, state: 'open' })
      const issueB = issue({
        number: 2,
        state: 'open',
        body: '## Acceptance criteria\n- [ ] b\n\nblocked_by: #1',
      })

      const model = buildCommandCenterModel({
        issues: [issueA, issueB],
      })

      const goalB = model.goals.find((g) => g.number === 2)
      expect(goalB.status).toBe('blocked')
      expect(goalB.nextBestActions[0].id).toBe('resolve-blockers')
    })
  })
})
