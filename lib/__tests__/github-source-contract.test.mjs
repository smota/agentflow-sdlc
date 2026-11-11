import { describe, expect, it } from 'vitest'
import { formatRolePassComment, rolePassIdempotencyKey } from '../core/role-pass-evidence.mjs'
import { validateSourceAdapter } from '../core/source-adapter.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { createGitHubSourceAdapter } from '../sources/github.mjs'
import { createMemorySourceReceiptStore } from '../sources/receipt-store.mjs'
import { createFakeGitHub } from './fixtures/fake-github.mjs'
import { SECOND_WRITER, describeSourceContract } from './source-contract-suite.mjs'

const REPO = 'smota/agentflow-fake'

const BOT = 'agentflow-bot'
const CLAIM_WRITERS = ['contract-writer-a', SECOND_WRITER]

function setup({ claims = true } = {}) {
  const fake = createFakeGitHub({ repo: REPO })
  const make = (login) =>
    createGitHubSourceAdapter({
      repo: REPO,
      client: fake.as(login),
      receiptStore: createMemorySourceReceiptStore(),
      ...(claims
        ? {
            claimWriters: CLAIM_WRITERS,
            mirrorAssignee: BOT,
            claimBoundary: { effective: 'external-action' },
          }
        : {}),
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
    // A person edits the assignee in the GitHub UI: some other login for another holder, none for
    // no holder.
    setMirror: (refText, { holder }) =>
      fake.reassign(Number(parseSourceRef(refText).id), holder ? 'someone-else' : null, 'a-person'),
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

  it('without claimWriters declares neither claim nor watch', async () => {
    const { make } = setup({ claims: false })
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

  const read = async (fields) => {
    const { fake, make } = setup()
    const adapter = make('bot')
    const number = fake.seedIssue(fields)
    return adapter.readWorkItem({ kind: 'issue', number })
  }
  const gateBlock = (record) => `<!-- agentflow-gates -->\n${record}\n<!-- /agentflow-gates -->`

  it('returns partOf as a number for a body the medium wrote (marker parent is a URL)', async () => {
    const body = [
      '<!-- agentflow-work:{"kind":"goal","parent":"https://github.com/o/r/issues/578","changeClass":"standard","admission":null} -->',
      'Do the thing.',
      '',
      'Part of #578',
    ].join('\n')
    expect(await read({ body })).toMatchObject({ partOf: '578', changeClass: 'standard' })
    expect(
      await read({ body: '<!-- agentflow-work:{"parent":"https://x/1"} -->\nno line' }),
    ).toMatchObject({ partOf: null })
  })

  it('reads Part of only as its own line', async () => {
    for (const body of [
      'see o/r#12',
      'Part of o/r#12',
      'not part of #12',
      'we are part of #12 now',
    ]) {
      expect((await read({ body })).partOf, body).toBeNull()
    }
    expect((await read({ body: 'x\nPart of #12\ny' })).partOf).toBe('12')
  })

  it('fails closed on an unreadable marker or an unknown change class', async () => {
    const { fake, make } = setup()
    const adapter = make('bot')
    for (const marker of [
      '<!-- agentflow-work:{oops} -->',
      '<!-- agentflow-work:garbage -->',
      '<!-- agentflow-work:[] -->',
      '<!-- agentflow-work:{"changeClass":"High-Assurance"} -->',
      '<!-- agentflow-work:{"changeClass":7} -->',
    ]) {
      const number = fake.seedIssue({ body: marker })
      await expect(adapter.readWorkItem({ kind: 'issue', number }), marker).rejects.toThrow(
        /agentflow-work|change class/,
      )
    }
    expect(
      await read({ body: '<!-- agentflow-work:{"changeClass":"high-assurance","parent":7} -->' }),
    ).toMatchObject({ changeClass: 'high-assurance', partOf: null })
  })

  it('counts a gate block as one open gate whenever it cannot be read cleanly', async () => {
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64')
    const bodies = {
      'no record': gateBlock('no record line'),
      unterminated: `<!-- agentflow-gates -->\n<!-- agentflow-gates-record:${b64([])} -->`,
      'non-array': gateBlock(`<!-- agentflow-gates-record:${b64({ a: 1 })} -->`),
      'invalid log': gateBlock(
        `<!-- agentflow-gates-record:${b64([{ kind: 'gate', gate: { type: 'x' } }])} -->`,
      ),
    }
    for (const [name, body] of Object.entries(bodies)) {
      expect((await read({ body })).openGates, name).toBe(1)
    }
    expect(
      (await read({ body: gateBlock(`<!-- agentflow-gates-record:${b64([])} -->`) })).openGates,
    ).toBe(0)
  })

  it('plans one comment for reference.number and number, and rejects a conflict', async () => {
    const { fake, make } = setup()
    const adapter = make('bot')
    const number = fake.seedIssue({ title: 'I' })
    const boundary = { effective: 'external-action' }
    const a = await adapter.previewMutation({
      operation: 'add-comment',
      parameters: { number, body: 'same' },
      actionBoundary: boundary,
    })
    const b = await adapter.previewMutation({
      operation: 'add-comment',
      parameters: { reference: { kind: 'issue', number }, body: 'same' },
      actionBoundary: boundary,
    })
    expect(a.idempotencyKey).toBe(b.idempotencyKey)
    await adapter.applyMutation(a, { confirm: a.token })
    await adapter.applyMutation(b, { confirm: b.token })
    expect(fake.comments.filter((comment) => comment.body.startsWith('same'))).toHaveLength(1)
    await expect(
      adapter.previewMutation({
        operation: 'add-comment',
        parameters: { number, reference: { number: number + 1 }, body: 'x' },
        actionBoundary: boundary,
      }),
    ).rejects.toThrow('conflicting')
  })

  it('drops role-pass records whose phase is not an integer', async () => {
    const { fake, make } = setup()
    const adapter = make('bot')
    const number = fake.seedIssue({})
    const good = evidence()
    await fake.client.createIssueComment(REPO, number, good.replace('phase: 1', 'phase: x'))
    await fake.client.createIssueComment(REPO, number, good)
    const item = await adapter.readWorkItem({ kind: 'issue', number })
    expect(item.transitions.map((t) => t.phase)).toEqual([1])
  })

  it('lowercases before dedupe and drops empty writers', async () => {
    const adapter = setup().make('bot')
    expect(await adapter.resolveHumans(['Ann', 'ann', '', null, '  ', 'Bob'])).toEqual([
      { writer: 'Ann', handle: { system: 'github', login: 'ann' } },
      { writer: 'Bob', handle: { system: 'github', login: 'bob' } },
    ])
  })

  it('treats a missing state as unreadable and a missing issue as a 404', async () => {
    const { fake, make } = setup()
    const adapter = make('bot')
    const number = fake.seedIssue({})
    fake.editIssue(number, { state: undefined })
    await expect(adapter.readWorkItem({ kind: 'issue', number })).rejects.toThrow('state')
    await expect(adapter.readWorkItem({ kind: 'issue', number: 9999 })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('skips an unreadable issue when listing, reports it, and still throws on transport errors', async () => {
    const { fake, make } = setup()
    const adapter = make('bot')
    const good = fake.seedIssue({ title: 'good' })
    const bad = fake.seedIssue({ body: '<!-- agentflow-work:{oops} -->' })
    const other = fake.seedIssue({ title: 'good 2' })
    const seen = []
    const listed = await adapter.listWorkItems({ onUnreadable: (entry) => seen.push(entry) })
    expect(listed.map((item) => Number(item.id))).toEqual([good, other])
    expect(seen.map((entry) => entry.reference)).toEqual([`github:${REPO}#${bad}`])
    expect(seen[0].error.name).toBe('UnreadableWorkItemError')
    expect((await adapter.listWorkItems()).map((item) => Number(item.id))).toEqual([good, other])
    const failing = createGitHubSourceAdapter({
      repo: REPO,
      client: {
        ...fake.client,
        issueComments: async () => {
          throw Object.assign(new Error('boom'), { status: 502 })
        },
      },
    })
    await expect(failing.listWorkItems()).rejects.toThrow('boom')
  })
})
