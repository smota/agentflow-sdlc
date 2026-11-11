import { describe, expect, it } from 'vitest'
import { formatRolePassComment, rolePassIdempotencyKey } from '../core/role-pass-evidence.mjs'
import { validateSourceAdapter } from '../core/source-adapter.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { createGitHubSourceAdapter } from '../sources/github.mjs'
import { createMemorySourceReceiptStore } from '../sources/receipt-store.mjs'
import { createFakeGitHub } from './fixtures/fake-github.mjs'
import { SECOND_WRITER, describeSourceContract } from './source-contract-suite.mjs'

const REPO = 'smota/agentflow-fake'

function setup() {
  const fake = createFakeGitHub({ repo: REPO })
  const make = (login) =>
    createGitHubSourceAdapter({
      repo: REPO,
      client: fake.as(login),
      receiptStore: createMemorySourceReceiptStore(),
    })
  return { fake, make }
}

describeSourceContract('github source (fake client)', async () => {
  const { fake, make } = setup()
  return {
    adapter: make('contract-writer-a'),
    adapterAs: make,
    makeItem: (fields) => {
      const number = fake.seedIssue({
        title: fields.title,
        body: fields.body,
        labels: fields.labels,
        state: fields.lifecycle === 'open' ? 'open' : 'closed',
      })
      return `github:${REPO}#${number}`
    },
    setMirror: () => {},
    untrustedAdapter: make('stranger'),
  }
})

describe('github source adapter readiness (581a)', () => {
  const evidence = (overrides = {}) =>
    formatRolePassComment({
      idempotencyKey: rolePassIdempotencyKey({ stableId: 'af-github-1', phase: 1, status: 'pass' }),
      phase: 1,
      role: 'analyst',
      status: 'pass',
      seat: 'pm.analyst',
      executedBy: 'codex',
      launcher: 'codex',
      executor: 'codex-cli',
      transport: 'local-cli',
      delegationBoundary: 'current-session',
      model: null,
      body: 'done',
      ...overrides,
    })

  it('does not declare claim or watch and reports them absent', async () => {
    const { make } = setup()
    const adapter = make('bot')
    expect(validateSourceAdapter(adapter).ok).toBe(true)
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining(['ready-predicates', 'resolve-humans']),
    )
    expect(adapter.capabilities).not.toContain('claim')
    expect(adapter.capabilities).not.toContain('watch')
    expect(adapter.readyPredicateKinds).toEqual(['label', 'lifecycle'])
    expect(adapter.claimMirror).toBeUndefined()
  })

  it('keeps the revision stable when only updated_at moves, and changes it on content', async () => {
    const { fake, make } = setup()
    const adapter = make('bot')
    const number = fake.seedIssue({ title: 'T', body: 'B', labels: ['a'] })
    const reference = adapter.toReference({ system: 'github', scope: REPO, id: String(number) })
    const before = await adapter.readWorkItem(reference)
    await fake.client.createIssueComment(REPO, number, 'a plain comment')
    expect((await adapter.readWorkItem(reference)).revision).toBe(before.revision)
    fake.editIssue(number, { body: 'B2' })
    expect((await adapter.readWorkItem(reference)).revision).not.toBe(before.revision)
    fake.editIssue(number, { labels: ['a', 'agentflow:ready'] })
    expect((await adapter.readWorkItem(reference)).labels).toEqual(['a', 'agentflow:ready'])
    // legacy readArtifact is unchanged
    expect((await adapter.readArtifact({ kind: 'issue', number })).ref.revision).toBe(
      String(number),
    )
  })

  it('maps lifecycle: open, closed, merged; lists issues and merged PRs, paged', async () => {
    const { fake, make } = setup()
    const adapter = make('bot')
    const open = fake.seedIssue({ title: 'o' })
    const closed = fake.seedIssue({ title: 'c', state: 'closed' })
    const merged = fake.seedIssue({ title: 'm', state: 'closed', merged: true })
    fake.seedIssue({ title: 'pr', pullRequest: true })
    for (let i = 0; i < 105; i += 1) fake.seedIssue({ title: `bulk ${i}` })
    const byLifecycle = async (lifecycle) =>
      (await adapter.listWorkItems({ lifecycle })).map((item) => Number(item.id))
    const opens = await byLifecycle('open')
    expect(opens).toHaveLength(106)
    expect(opens).toContain(open)
    expect(await byLifecycle('closed')).toEqual([closed])
    expect(await byLifecycle('merged')).toEqual([merged])
    expect(await byLifecycle(null)).toHaveLength(108)
    await expect(adapter.listWorkItems({ lifecycle: 'bogus' })).rejects.toThrow('lifecycle')
  })

  it('reads role-pass comments as transitions and counts waiting gates', async () => {
    const { fake, make } = setup()
    const adapter = make('agentflow-bot')
    const number = fake.seedIssue({
      title: 'G',
      body: 'Part of #578\n\n<!-- agentflow-work:{"changeClass":"standard"} -->',
    })
    const reference = adapter.toReference({ system: 'github', scope: REPO, id: String(number) })
    const plan = await adapter.previewMutation({
      operation: 'add-comment',
      parameters: { reference, body: evidence() },
      actionBoundary: { effective: 'external-action' },
    })
    const receipt = await adapter.applyMutation(plan, { confirm: plan.token })
    await adapter.flushReceipt(receipt)
    await fake.as('someone-else').createIssueComment(REPO, number, 'unrelated')
    const item = await adapter.readWorkItem(reference)
    expect(item).toMatchObject({
      kind: 'issue',
      partOf: '578',
      changeClass: 'standard',
      openGates: 0,
      status: null,
    })
    expect(item.transitions).toHaveLength(1)
    expect(item.transitions[0]).toMatchObject({
      phase: 1,
      status: 'pass',
      seat: 'pm.analyst',
      writer: 'agentflow-bot',
      uri: expect.stringContaining('issuecomment-'),
    })
    // plan used the content revision: the comment write did not stale a second plan
    const second = await adapter.previewMutation({
      operation: 'add-comment',
      parameters: { number, body: 'again' },
      actionBoundary: { effective: 'external-action' },
    })
    await fake.client.createIssueComment(REPO, number, 'racing comment')
    await expect(adapter.applyMutation(second, { confirm: second.token })).resolves.toBeTruthy()
  })

  it('refuses a stale plan after content changes and a foreign reference', async () => {
    const { fake, make } = setup()
    const adapter = make('bot')
    const number = fake.seedIssue({ title: 'S', body: 'one' })
    const plan = await adapter.previewMutation({
      operation: 'add-comment',
      parameters: { number, body: 'x' },
      actionBoundary: { effective: 'external-action' },
    })
    fake.editIssue(number, { body: 'two' })
    await expect(adapter.applyMutation(plan, { confirm: plan.token })).rejects.toThrow('stale')
    expect(() => adapter.toReference({ system: 'github', scope: 'other/repo', id: '1' })).toThrow()
    await expect(adapter.readWorkItem({ kind: 'issue', number: NaN })).rejects.toThrow('invalid')
    await expect(
      adapter.previewMutation({
        operation: 'add-comment',
        parameters: { body: 'x' },
        actionBoundary: { effective: 'external-action' },
      }),
    ).rejects.toThrow('invalid')
    expect(parseSourceRef(`github:${REPO}#${number}`)).toMatchObject({ id: String(number) })
  })

  it('resolves GitHub logins case-insensitively and deduplicates', async () => {
    const adapter = setup().make('bot')
    expect(await adapter.resolveHumans(['Octo-Cat', 'Octo-Cat'])).toEqual([
      { writer: 'Octo-Cat', handle: { system: 'github', login: 'octo-cat' } },
    ])
  })

  it('treats an unreadable gate block as one open gate', async () => {
    const { fake, make } = setup()
    const adapter = make('bot')
    const record = Buffer.from('not json').toString('base64')
    const body = `<!-- agentflow-gates -->\n<!-- agentflow-gates-record:${record} -->\n<!-- /agentflow-gates -->`
    const number = fake.seedIssue({ body })
    const item = await adapter.readWorkItem({ kind: 'issue', number })
    expect(item.openGates).toBe(1)
  })
})
