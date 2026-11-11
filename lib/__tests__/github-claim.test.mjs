// GitHub claim ledger (#581b): comment log entries decide the holder, the assignee is a mirror.
import { describe, expect, it } from 'vitest'
import { validateSourceAdapter } from '../core/source-adapter.mjs'
import { claimOrYield, parseClaimMarker } from '../core/source-claim.mjs'
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

  it('both append before either reads: the earlier comment wins and the loser yields', async () => {
    const { fake, make, number, reference } = setup({ writers: ['writer-a', 'writer-b'] })
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
    const a = make('writer-a', barrier('writer-a'))
    const b = make('writer-b', barrier('writer-b'))
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
  })

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
