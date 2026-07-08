import { describe, expect, it } from 'vitest'
import { parseIssueReferences, planIntegrationLifecycle } from '../integration-lifecycle.mjs'

describe('integration lifecycle', () => {
  it('parses implementation references and de-duplicates local issues', () => {
    const refs = parseIssueReferences(`
      Implements #24, #25
      Refs #25; #26
      Implements other/repo#99
      Closes #123
    `)

    expect(refs).toEqual(['#24', '#25', '#26'])
  })

  it('plans issue closure only for merged integration PRs', () => {
    const plan = planIntegrationLifecycle(
      {
        number: 42,
        url: 'https://github.com/acme/app/pull/42',
        body: 'Implements #24\nRefs #25',
        baseRefName: 'development',
        merged: true,
        mergeCommit: 'abc123',
      },
      {
        integrationBranch: 'development',
        trunkBranch: 'main',
        addLabels: ['integrated:development', 'awaiting-release'],
        closeIntegratedIssues: true,
        referenceKeywords: ['Implements', 'Refs'],
      },
    )

    expect(plan.skipped).toBe(false)
    expect(plan.issues).toEqual(['#24', '#25'])
    expect(plan.close).toBe(true)
    expect(plan.labels).toEqual(['integrated:development', 'awaiting-release'])
    expect(plan.comment).toContain('Integrated into `development`')
  })

  it('skips non-integration PRs', () => {
    const plan = planIntegrationLifecycle(
      {
        number: 42,
        url: 'https://github.com/acme/app/pull/42',
        body: 'Implements #24',
        baseRefName: 'main',
        merged: true,
      },
      { integrationBranch: 'development', referenceKeywords: ['Implements', 'Refs'] },
    )

    expect(plan.skipped).toBe(true)
    expect(plan.reason).toContain('not development')
  })
})
