import { describe, expect, it } from 'vitest'

describe('integration lifecycle', () => {
  it('parses implementation references and de-duplicates local issues', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    const refs = parseIssueReferences(`
      Implements #24, #25
      Refs #25; #26
      Implements other/repo#99
      Closes #123
    `)

    expect(refs).toEqual(['#24', '#25', '#123'])
  })

  it('ignores related references by default', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    const refs = parseIssueReferences(`
      Refs #27
      Related to #28
      Implements #29
      Closes #30
    `)

    expect(refs).toEqual(['#29', '#30'])
  })

  it('plans issue closure only for merged integration PRs', async () => {
    const { planIntegrationLifecycle } = await import('../integration-lifecycle.mjs')
    const plan = planIntegrationLifecycle(
      {
        number: 42,
        url: 'https://github.com/acme/app/pull/42',
        body: 'Implements #24\nRefs #25\nCloses #26',
        baseRefName: 'development',
        merged: true,
        mergeCommit: 'abc123',
      },
      {
        integrationBranch: 'development',
        trunkBranch: 'main',
        addLabels: ['integrated:development', 'awaiting-release'],
        closeIntegratedIssues: true,
        referenceKeywords: ['Implements', 'Closes'],
      },
    )

    expect(plan.skipped).toBe(false)
    expect(plan.issues).toEqual(['#24', '#26'])
    expect(plan.close).toBe(true)
    expect(plan.labels).toEqual(['integrated:development', 'awaiting-release'])
    expect(plan.comment).toContain('Integrated into `development`')
  })

  it('skips non-integration PRs', async () => {
    const { planIntegrationLifecycle } = await import('../integration-lifecycle.mjs')
    const plan = planIntegrationLifecycle(
      {
        number: 42,
        url: 'https://github.com/acme/app/pull/42',
        body: 'Implements #24',
        baseRefName: 'main',
        merged: true,
      },
      { integrationBranch: 'development', referenceKeywords: ['Implements', 'Closes'] },
    )

    expect(plan.skipped).toBe(true)
    expect(plan.reason).toContain('not development')
  })

  it('applies lifecycle mutations through a source adapter', async () => {
    const { applyIntegrationPlan } = await import('../integration-lifecycle.mjs')
    const calls = []
    const source = {
      previewMutation: async ({ operation, parameters }) => ({
        operation,
        parameters,
        token: `${operation}-token`,
      }),
      applyMutation: async (preview, { confirm }) => {
        expect(confirm).toBe(preview.token)
        calls.push([preview.operation, preview.parameters])
        return { receiptToken: `${preview.operation}-receipt` }
      },
      flushReceipt: async () => {},
    }
    await applyIntegrationPlan(
      {
        labels: ['integrated:development'],
        issues: ['#24'],
        comment: 'integrated',
        close: true,
      },
      source,
    )
    expect(calls).toEqual([
      ['ensure-label', { label: 'integrated:development' }],
      ['add-comment', { number: '24', body: 'integrated' }],
      ['add-labels', { number: '24', labels: ['integrated:development'] }],
      ['close-artifact', { number: '24' }],
    ])
  })
})
