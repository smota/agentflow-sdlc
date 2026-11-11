// GitHub claim ledger (#581b): comment log entries decide the holder, the assignee is a mirror.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sourceMutationIdempotencyKey, validateSourceAdapter } from '../core/source-adapter.mjs'
import {
  claimEntry,
  claimOrYield,
  formatClaimMarker,
  parseClaimMarker,
  releaseEntry,
} from '../core/source-claim.mjs'
import { createGitHubClient } from '../sources/github-client.mjs'
import { createGitHubSourceAdapter } from '../sources/github.mjs'
import { createMemorySourceReceiptStore } from '../sources/receipt-store.mjs'
import { createFakeGitHub } from './fixtures/fake-github.mjs'

const REPO = 'smota/agentflow-fake'
const BOT = 'agentflow-bot'
const BOUNDARY = { effective: 'external-action' }
const rigA = { kind: 'rig', rig: 'agentflow-p-d1', host: 'local' }
const rigB = { kind: 'rig', rig: 'agentflow-p-d2', host: 'local' }

function setup({ writers = [BOT], boundary = BOUNDARY } = {}) {
  const fake = createFakeGitHub({ repo: REPO, login: BOT })
  const make = (login = BOT, client = fake.as(login)) =>
    createGitHubSourceAdapter({
      repo: REPO,
      client,
      receiptStore: createMemorySourceReceiptStore(),
      claimWriters: writers,
      mirrorAssignee: BOT,
      claimBoundary: boundary,
    })
  const number = fake.seedIssue({ title: 'Claim me' })
  return { fake, make, number, reference: { kind: 'issue', number } }
}

const claimComments = (fake) =>
  fake.comments
    .map((comment) => ({ entry: parseClaimMarker(comment.body), comment }))
    .filter((row) => row.entry)

describe('github claim (581b)', () => {
  it('declares claim with the comment log, the assignee mirror and lifecycle writes', () => {
    const { make } = setup()
    const adapter = make()
    expect(validateSourceAdapter(adapter)).toEqual({ ok: true, errors: [] })
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining(['claim', 'mutate-comments', 'mutate-lifecycle']),
    )
    expect(adapter.claimMirror).toBe('assignee')
    expect(typeof adapter.adoptMirrorChange).toBe('function')
    expect(() =>
      createGitHubSourceAdapter({ repo: REPO, client: {}, claimWriters: [BOT] }),
    ).toThrow('mirrorAssignee')
  })

  it('refuses claim writes without an open-pr or external-action boundary', async () => {
    for (const boundary of [null, { effective: 'read-only' }]) {
      const { fake, make, reference } = setup({ boundary })
      await expect(make().claim(reference, rigA)).rejects.toThrow('boundary')
      expect(fake.comments).toHaveLength(0)
    }
  })

  it('returns the specific rig while every entry and the assignee are the shared bot', async () => {
    const { fake, make, number, reference } = setup()
    const a = make()
    const b = make()
    const won = await a.claim(reference, rigA)
    expect(won).toMatchObject({ status: 'held', holder: rigA, mirror: { diverged: false } })
    expect(fake.assignees(number)).toEqual([BOT])
    const lost = await b.claim(reference, rigB)
    expect(lost.holder).toEqual(rigA)
    expect((await b.readClaim(reference)).holder.rig).toBe('agentflow-p-d1')
    expect(claimComments(fake).every((row) => row.comment.user.login === BOT)).toBe(true)
    // The assignee only names the bot; the rig comes from the log entry.
    expect(fake.assignees(number)).toEqual([BOT])
  })

  it('two interleaved claimers as different trusted writers: one winner, the loser releases', async () => {
    const { fake, make, number, reference } = setup({ writers: ['writer-a', 'writer-b'] })
    const [ra, rb] = await Promise.all([
      claimOrYield({ adapter: make('writer-a'), reference, owner: rigA }),
      claimOrYield({ adapter: make('writer-b'), reference, owner: rigB }),
    ])
    expect([ra.won, rb.won].filter(Boolean)).toHaveLength(1)
    const winner = ra.won ? rigA : rigB
    const loser = ra.won ? rigB : rigA
    expect(ra.holder).toEqual(winner)
    expect(rb.holder).toEqual(winner)
    const entries = claimComments(fake).map((row) => row.entry)
    expect(entries.filter((e) => e.type === 'release' && e.owner.rig === loser.rig)).toHaveLength(1)
    // Lowest comment id wins.
    const firstClaim = claimComments(fake).find((row) => row.entry.type === 'claim')
    expect(firstClaim.entry.owner).toEqual(winner)
    expect((await make('writer-a').readClaim(reference)).holder).toEqual(winner)
    expect(fake.assignees(number)).toEqual([BOT])
  })

  it.each([
    ['different trusted writers', 'writer-a', 'writer-b'],
    ['the same shared bot', BOT, BOT],
  ])(
    'both append before either reads (%s): the earlier comment wins and the loser yields',
    async (_name, writerA, writerB) => {
      const { fake, make, number, reference } = setup({ writers: [...new Set([writerA, writerB])] })
      // Hold every claim-entry comment until both rigs have written one.
      let waiting = []
      const barrier = (login) => {
        const base = fake.as(login)
        return {
          ...base,
          async createIssueComment(repo, issue, body) {
            const comment = await base.createIssueComment(repo, issue, body)
            if (!parseClaimMarker(body) || parseClaimMarker(body).type !== 'claim') return comment
            await new Promise((resolve) => {
              waiting.push(resolve)
              if (waiting.length === 2) {
                waiting.forEach((release) => release())
                waiting = []
              }
            })
            return comment
          },
        }
      }
      const a = make(writerA, barrier(writerA))
      const b = make(writerB, barrier(writerB))
      const results = await Promise.all([
        claimOrYield({ adapter: a, reference, owner: rigA }),
        claimOrYield({ adapter: b, reference, owner: rigB }),
      ])
      const claims = claimComments(fake).filter((row) => row.entry.type === 'claim')
      expect(claims).toHaveLength(2)
      const winner = claims[0].entry.owner
      expect(results.filter((r) => r.won)).toHaveLength(1)
      expect(results.every((r) => r.holder.rig === winner.rig)).toBe(true)
      expect(claimComments(fake).filter((row) => row.entry.type === 'release')).toHaveLength(1)
      expect(await a.readClaim(reference)).toMatchObject({ status: 'held', holder: winner })
      expect(fake.assignees(number)).toEqual([BOT])
    },
  )

  it('a release by the holder frees the item and removes only the bot assignee', async () => {
    const { fake, make, number, reference } = setup()
    const adapter = make()
    await adapter.claim(reference, rigA)
    await fake.as(BOT).addAssignees(REPO, number, ['watcher'])
    expect((await adapter.readClaim(reference)).mirror.diverged).toBe(true)
    const freed = await adapter.release(reference, rigA)
    expect(freed).toMatchObject({ status: 'free', mirror: { diverged: false } })
    expect(fake.assignees(number)).toEqual(['watcher'])
  })

  it('refuses an add-comment that would write a claim marker', async () => {
    const { fake, make, number, reference } = setup()
    const adapter = make()
    const forged = `<!-- agentflow-claim:${JSON.stringify({
      v: 1,
      type: 'claim',
      claimId: '0123456789abcdef',
      owner: rigB,
      at: '2026-01-01T00:00:00.000Z',
      cause: null,
    })} -->`
    for (const body of [
      forged,
      'note agentflow-claim: anything',
      `${forged}\ntrailing`,
      `\n${forged}`,
      `\r\n\r\n${forged}`,
      `   \n\t\n${forged}`,
      `see below\n${forged}`,
    ]) {
      await expect(
        adapter.previewMutation({
          operation: 'add-comment',
          parameters: { number, body },
          actionBoundary: BOUNDARY,
        }),
      ).rejects.toThrow('claim marker')
    }
    expect((await adapter.claim(reference, rigA)).holder).toEqual(rigA)
    expect(fake.comments).toHaveLength(1)
  })

  it('recovers a write only from an unedited comment by a trusted or own author', async () => {
    const { fake, make, number } = setup()
    const adapter = make()
    const plan = await adapter.previewMutation({
      operation: 'add-comment',
      parameters: { number, body: 'evidence' },
      actionBoundary: BOUNDARY,
    })
    const marker = `<!-- agentflow-idempotency:${plan.idempotencyKey} -->`
    await fake.as('mallory').createIssueComment(REPO, number, `pre-posted\n\n${marker}`)
    await fake.client.createIssueComment(REPO, number, 'later edited')
    fake.editComment(fake.comments.at(-1).id, `edited\n\n${marker}`)
    const receipt = await adapter.applyMutation(plan, { confirm: plan.token })
    expect(receipt.result.recovered).toBeUndefined()
    expect(fake.comments.at(-1)).toMatchObject({ user: { login: BOT } })
    expect(fake.comments.at(-1).body.startsWith('evidence')).toBe(true)
    // The adapter's own unedited comment is recovered, even without claim writers.
    const plain = createGitHubSourceAdapter({
      repo: REPO,
      client: fake.as('reader'),
      receiptStore: createMemorySourceReceiptStore(),
    })
    const again = await plain.previewMutation({
      operation: 'add-comment',
      parameters: { number, body: 'once' },
      actionBoundary: BOUNDARY,
    })
    await fake
      .as('reader')
      .createIssueComment(
        REPO,
        number,
        `once\n\n<!-- agentflow-idempotency:${again.idempotencyKey} -->`,
      )
    const count = fake.comments.length
    expect((await plain.applyMutation(again, { confirm: again.token })).result.recovered).toBe(true)
    expect(fake.comments).toHaveLength(count)
  })

  it('ignores claim entries in comments edited after creation', async () => {
    const { fake, make, reference } = setup()
    const adapter = make()
    await adapter.claim(reference, rigA)
    const claimRow = claimComments(fake)[0]
    // Rewrite the holder inside the bot's own comment.
    fake.editComment(
      claimRow.comment.id,
      claimRow.comment.body.replace('agentflow-p-d1', 'agentflow-p-d9'),
    )
    const state = await adapter.readClaim(reference)
    expect(state.status).toBe('free')
    expect(state.ignored).toEqual([{ uri: claimRow.comment.html_url, reason: 'edited-entry' }])
    // A plain bot comment edited into a marker is not an entry either.
    await fake.client.createIssueComment(REPO, reference.number, 'plain')
    const plain = fake.comments.at(-1)
    fake.editComment(plain.id, claimRow.comment.body)
    expect(await adapter.readClaim(reference)).toMatchObject({ status: 'free' })
    expect((await make().claim(reference, rigB)).holder).toEqual(rigB)
  })

  describe('reassignment in the GitHub UI', () => {
    const people = { ann: 'person-ann', bob: 'person-bob' }
    const personFor = async (login) => people[login] ?? null

    it('is reported as divergence and adopted as a release and a person claim', async () => {
      const { fake, make, number, reference } = setup()
      const adapter = make()
      await adapter.claim(reference, rigA)
      fake.reassign(number, 'bob', 'ann')
      const diverged = await adapter.readClaim(reference)
      expect(diverged).toMatchObject({ status: 'held', holder: rigA, mirror: { diverged: true } })
      const before = claimComments(fake).length
      const result = await adapter.adoptMirrorChange(reference, { personFor })
      expect(result.status).toBe('adopted')
      const appended = claimComments(fake)
        .slice(before)
        .map((row) => row.entry)
      const event = fake.events.find((e) => e.event === 'assigned' && e.assignee.login === 'bob')
      const cause = { kind: 'mirror-change', actor: 'ann', eventId: String(event.id) }
      expect(appended).toEqual([
        expect.objectContaining({ type: 'release', owner: rigA, cause }),
        expect.objectContaining({
          type: 'claim',
          owner: { kind: 'person', id: 'person-bob' },
          cause,
        }),
      ])
      expect(result.state).toMatchObject({
        status: 'held',
        holder: { kind: 'person', id: 'person-bob' },
        mirror: { diverged: false },
      })
      expect(fake.assignees(number)).toEqual(['bob'])
      // Adopting again finds no rig holder and appends nothing.
      expect((await adapter.adoptMirrorChange(reference, { personFor })).status).toBe(
        'not-applicable',
      )
      expect(claimComments(fake)).toHaveLength(before + 2)
      // A rig cannot take the item from the person.
      expect((await make().claim(reference, rigB)).holder).toEqual({
        kind: 'person',
        id: 'person-bob',
      })
    })

    it('treats a co-assignee next to the bot as no reassignment', async () => {
      const { fake, make, number, reference } = setup()
      const adapter = make()
      await adapter.claim(reference, rigA)
      await fake.as('ann').addAssignees(REPO, number, ['bob'])
      expect((await adapter.readClaim(reference)).mirror.diverged).toBe(true)
      const result = await adapter.adoptMirrorChange(reference, { personFor })
      expect(result).toMatchObject({
        status: 'ignored',
        reason: 'bot-still-assigned',
        state: { holder: rigA },
      })
      expect(claimComments(fake)).toHaveLength(1)
      expect(fake.assignees(number)).toEqual([BOT, 'bob'])
    })

    it('two concurrent adoptions write one release and one person claim', async () => {
      const { fake, make, number, reference } = setup()
      await make().claim(reference, rigA)
      fake.reassign(number, 'bob', 'ann')
      const results = await Promise.all([
        make().adoptMirrorChange(reference, { personFor }),
        make().adoptMirrorChange(reference, { personFor }),
      ])
      expect(results.some((result) => result.status === 'adopted')).toBe(true)
      const caused = claimComments(fake).filter((row) => row.entry.cause)
      // Both callers derive the same entries from the event; a duplicate comment is the same
      // entry and resolves as ignored.
      const distinct = new Map(caused.map((row) => [row.entry.claimId, row.entry]))
      expect([...distinct.values()].map((entry) => entry.type).sort()).toEqual(['claim', 'release'])
      const state = await make().readClaim(reference)
      expect(state).toMatchObject({ holder: { kind: 'person', id: 'person-bob' } })
      expect(fake.assignees(number)).toEqual(['bob'])
    })

    it('resumes an adoption that crashed between the release and the person claim', async () => {
      const { fake, make, number, reference } = setup()
      await make().claim(reference, rigA)
      fake.reassign(number, 'bob', 'ann')
      const base = fake.as(BOT)
      let fail = true
      const crashing = {
        ...base,
        async createIssueComment(repo, issue, body) {
          const entry = parseClaimMarker(body)
          if (fail && entry?.type === 'claim' && entry.owner.kind === 'person') {
            fail = false
            throw new Error('process died')
          }
          return base.createIssueComment(repo, issue, body)
        },
      }
      await expect(make(BOT, crashing).adoptMirrorChange(reference, { personFor })).rejects.toThrow(
        'process died',
      )
      expect(await make().readClaim(reference)).toMatchObject({ status: 'free' })
      const resumed = await make().adoptMirrorChange(reference, { personFor })
      expect(resumed.status).toBe('adopted')
      expect(resumed.state.holder).toEqual({ kind: 'person', id: 'person-bob' })
      const types = claimComments(fake).map((row) => row.entry.type)
      expect(types).toEqual(['claim', 'release', 'claim'])
      expect(fake.assignees(number)).toEqual(['bob'])
    })

    it('ignores an untrusted comment pre-posting the predictable adoption key', async () => {
      const { fake, make, number, reference } = setup()
      await make().claim(reference, rigA)
      fake.reassign(number, 'bob', 'ann')
      const event = fake.events.find((e) => e.event === 'assigned' && e.assignee.login === 'bob')
      const cause = { kind: 'mirror-change', actor: 'ann', eventId: String(event.id) }
      const entry = releaseEntry({
        owner: rigA,
        cause,
        claimId: createHash('sha256')
          .update(`${REPO}#${number}:${event.id}:release`)
          .digest('hex')
          .slice(0, 16),
        at: event.created_at,
      })
      const key = sourceMutationIdempotencyKey('append-claim-entry', { number, entry })
      await fake
        .as('mallory')
        .createIssueComment(REPO, number, `<!-- agentflow-idempotency:${key} -->`)
      const result = await make().adoptMirrorChange(reference, { personFor })
      expect(result.status).toBe('adopted')
      expect(claimComments(fake).map((row) => row.entry.type)).toEqual([
        'claim',
        'release',
        'claim',
      ])
      expect(claimComments(fake)[1].entry).toEqual(entry)
    })

    it('does not resume a crashed adoption once the log has moved on', async () => {
      const { fake, make, number, reference } = setup()
      await make().claim(reference, rigA)
      fake.reassign(number, 'bob', 'ann')
      const base = fake.as(BOT)
      const crashing = {
        ...base,
        async createIssueComment(repo, issue, body) {
          if (parseClaimMarker(body)?.owner.kind === 'person') throw new Error('process died')
          return base.createIssueComment(repo, issue, body)
        },
      }
      await expect(make(BOT, crashing).adoptMirrorChange(reference, { personFor })).rejects.toThrow(
        'process died',
      )
      const adapter = make()
      await adapter.claim(reference, rigB)
      await adapter.release(reference, rigB)
      fake.reassign(number, 'bob', 'ann')
      const result = await adapter.adoptMirrorChange(reference, { personFor })
      expect(['ignored', 'not-applicable']).toContain(result.status)
      expect(result.state.status).toBe('free')
      expect(claimComments(fake).filter((row) => row.entry.owner.kind === 'person')).toHaveLength(0)
    })

    it('does not resume a crashed adoption when the assignee was removed', async () => {
      const { fake, make, number, reference } = setup()
      await make().claim(reference, rigA)
      fake.reassign(number, 'bob', 'ann')
      const base = fake.as(BOT)
      const crashing = {
        ...base,
        async createIssueComment(repo, issue, body) {
          if (parseClaimMarker(body)?.owner.kind === 'person') throw new Error('process died')
          return base.createIssueComment(repo, issue, body)
        },
      }
      await expect(make(BOT, crashing).adoptMirrorChange(reference, { personFor })).rejects.toThrow(
        'process died',
      )
      fake.reassign(number, null, 'ann')
      const result = await make().adoptMirrorChange(reference, { personFor })
      expect(result.status).toBe('not-applicable')
      expect(claimComments(fake).filter((row) => row.entry.owner.kind === 'person')).toHaveLength(0)
    })

    it('restores the mirror to the rig that claimed between the release and the person claim', async () => {
      const { fake, make, number, reference } = setup()
      await make().claim(reference, rigA)
      fake.reassign(number, 'bob', 'ann')
      const base = fake.as(BOT)
      const racing = {
        ...base,
        async createIssueComment(repo, issue, body) {
          if (parseClaimMarker(body)?.owner.kind === 'person') {
            await base.createIssueComment(
              repo,
              issue,
              formatClaimMarker(claimEntry({ owner: rigB })),
            )
          }
          return base.createIssueComment(repo, issue, body)
        },
      }
      const result = await make(BOT, racing).adoptMirrorChange(reference, { personFor })
      expect(result).toMatchObject({
        status: 'lost',
        state: { holder: rigB, mirror: { diverged: false } },
      })
      expect(fake.assignees(number)).toEqual([BOT])
    })

    it('a person holder with no assignees is consistent', async () => {
      const { fake, make, number, reference } = setup()
      const adapter = make()
      await adapter.claim(reference, rigA)
      fake.reassign(number, 'bob', 'ann')
      await adapter.adoptMirrorChange(reference, { personFor })
      fake.reassign(number, null, 'bob')
      expect(await adapter.readClaim(reference)).toMatchObject({
        holder: { kind: 'person', id: 'person-bob' },
        mirror: { diverged: false },
      })
    })

    it('restores the mirror and appends nothing when the actor is not a known person', async () => {
      const { fake, make, number, reference } = setup()
      const adapter = make()
      await adapter.claim(reference, rigA)
      fake.reassign(number, 'bob', 'mallory')
      const before = fake.comments.length
      const result = await adapter.adoptMirrorChange(reference, { personFor })
      expect(result).toMatchObject({
        status: 'ignored',
        reason: 'actor-not-a-person',
        state: { holder: rigA, mirror: { diverged: false } },
      })
      expect(result.event.actor.login).toBe('mallory')
      expect(fake.comments).toHaveLength(before)
      expect(fake.assignees(number)).toEqual([BOT])
    })

    it('restores the mirror when the new assignee is not a known person', async () => {
      const { fake, make, number, reference } = setup()
      const adapter = make()
      await adapter.claim(reference, rigA)
      fake.reassign(number, 'stranger', 'ann')
      const result = await adapter.adoptMirrorChange(reference, { personFor })
      expect(result).toMatchObject({ status: 'ignored', reason: 'assignee-not-a-person' })
      expect(claimComments(fake)).toHaveLength(1)
      expect(fake.assignees(number)).toEqual([BOT])
    })

    it('restores a plain unassignment and leaves an in-sync mirror alone', async () => {
      const { fake, make, number, reference } = setup()
      const adapter = make()
      await adapter.claim(reference, rigA)
      expect((await adapter.adoptMirrorChange(reference, { personFor })).status).toBe('in-sync')
      fake.reassign(number, null, 'ann')
      const result = await adapter.adoptMirrorChange(reference, { personFor })
      expect(result).toMatchObject({ status: 'ignored', reason: 'no-reassignment-event' })
      expect(fake.assignees(number)).toEqual([BOT])
      expect(claimComments(fake)).toHaveLength(1)
      // A second unassignment is restored again, not replayed from the first receipt.
      fake.reassign(number, null, 'ann')
      expect((await adapter.adoptMirrorChange(reference, { personFor })).status).toBe('ignored')
      expect(fake.assignees(number)).toEqual([BOT])
      await expect(adapter.adoptMirrorChange(reference)).rejects.toThrow('personFor')
    })
  })
})

describe('github client assignee and event calls', () => {
  it('pages issue events and sends assignee writes as JSON bodies', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body })
      const page = Number(new URL(url).searchParams.get('page'))
      const data = url.includes('/events') ? Array(page === 1 ? 100 : 3).fill({ id: 1 }) : {}
      return { ok: true, status: 200, text: async () => JSON.stringify(data) }
    }
    const api = createGitHubClient({ fetchImpl })
    expect(await api.issueEvents('o/r', 7)).toHaveLength(103)
    await api.addAssignees('o/r', 7, ['bot'])
    await api.removeAssignees('o/r', 7, ['bot'])
    expect(calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([
      ['GET', '/repos/o/r/issues/7/events'],
      ['GET', '/repos/o/r/issues/7/events'],
      ['POST', '/repos/o/r/issues/7/assignees'],
      ['DELETE', '/repos/o/r/issues/7/assignees'],
    ])
    expect(JSON.parse(calls[3].body)).toEqual({ assignees: ['bot'] })
  })
})
