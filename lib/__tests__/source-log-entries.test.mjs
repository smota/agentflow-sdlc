// Decision entries (#602): the source's comment records with writer and edit state, for roster
// review gates. The adapter returns every author's entries; trusting a writer is the consumer's job.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claimEntry } from '../core/source-claim.mjs'
import {
  createFilesystemSourceAdapter,
  createFilesystemWorkItem,
} from '../sources/filesystem-source.mjs'
import { createGitHubSourceAdapter } from '../sources/github.mjs'
import { createMemorySourceReceiptStore } from '../sources/receipt-store.mjs'
import { createFakeGitHub } from './fixtures/fake-github.mjs'

const REPO = 'smota/agentflow-fake'
const BOUNDARY = { effective: 'external-action' }
const KEYS = ['body', 'createdAt', 'edited', 'updatedAt', 'uri', 'writer']

function github({ claims = false } = {}) {
  const fake = createFakeGitHub({ repo: REPO })
  const make = (login) =>
    createGitHubSourceAdapter({
      repo: REPO,
      client: fake.as(login),
      receiptStore: createMemorySourceReceiptStore(),
      ...(claims ? { claimWriters: ['bot'], mirrorAssignee: 'bot', claimBoundary: BOUNDARY } : {}),
    })
  const reference = (number) => ({ kind: 'issue', number })
  return { fake, make, reference }
}

describe('github readLogEntries', () => {
  it('declares log-entries without claim writers and returns no entries for a quiet issue', async () => {
    const { fake, make, reference } = github()
    const adapter = make('bot')
    expect(adapter.capabilities).toContain('log-entries')
    expect(await adapter.readLogEntries(reference(fake.seedIssue({})))).toEqual([])
  })

  it('returns an unedited comment with edited false, writer, uri and timestamps', async () => {
    const { fake, make, reference } = github()
    const number = fake.seedIssue({})
    const comment = await fake.as('Ann-Reviewer').createIssueComment(REPO, number, 'Approved.')
    const [entry] = await make('bot').readLogEntries(reference(number))
    expect(Object.keys(entry).sort()).toEqual(KEYS)
    expect(entry).toEqual({
      writer: 'Ann-Reviewer',
      body: 'Approved.',
      uri: comment.html_url,
      edited: false,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
    })
  })

  it('reports an edited comment as edited true and keeps the author', async () => {
    const { fake, make, reference } = github()
    const number = fake.seedIssue({})
    const comment = await fake.as('ann').createIssueComment(REPO, number, 'Approved.')
    fake.editComment(comment.id, 'Approved, really.')
    const [entry] = await make('bot').readLogEntries(reference(number))
    expect(entry).toMatchObject({ writer: 'ann', body: 'Approved, really.', edited: true })
    expect(entry.updatedAt).not.toBe(entry.createdAt)
  })

  it('reports unknown edit state as null, never false, when a timestamp is missing', async () => {
    const { fake, make, reference } = github()
    const number = fake.seedIssue({})
    for (const body of ['no updated', 'no created', 'neither']) {
      await fake.as('ann').createIssueComment(REPO, number, body)
    }
    delete fake.comments[0].updated_at
    delete fake.comments[1].created_at
    delete fake.comments[2].created_at
    delete fake.comments[2].updated_at
    const entries = await make('bot').readLogEntries(reference(number))
    expect(entries.map((entry) => entry.edited)).toEqual([null, null, null])
    expect(entries.map((entry) => [entry.createdAt === null, entry.updatedAt === null])).toEqual([
      [false, true],
      [true, false],
      [true, true],
    ])
  })

  it('treats identical unparseable timestamps as unknown, and a comment with no address as uri null', async () => {
    const { fake, make, reference } = github()
    const number = fake.seedIssue({})
    await fake.as('ann').createIssueComment(REPO, number, 'garbled')
    await fake.as('ann').createIssueComment(REPO, number, 'addressless')
    fake.comments[0].created_at = 'not-a-time'
    fake.comments[0].updated_at = 'not-a-time'
    delete fake.comments[1].html_url
    delete fake.comments[1].id
    const [garbled, addressless] = await make('bot').readLogEntries(reference(number))
    expect(garbled).toMatchObject({ edited: null, createdAt: null, updatedAt: null })
    expect(addressless.uri).toBeNull()
    expect(garbled.uri).toContain('issuecomment')
  })

  it('reads every page and keeps comment order past 100 comments', async () => {
    const { fake, make, reference } = github()
    const number = fake.seedIssue({})
    for (let index = 1; index <= 250; index += 1) {
      await fake.as('ann').createIssueComment(REPO, number, `comment ${index}`)
    }
    const requests = []
    const client = fake.as('bot')
    const adapter = createGitHubSourceAdapter({
      repo: REPO,
      client: {
        ...client,
        issueComments: (...args) => {
          requests.push(args[2])
          return client.issueComments(...args)
        },
      },
    })
    const entries = await adapter.readLogEntries(reference(number))
    expect(requests).toEqual([{ all: true }])
    expect(entries).toHaveLength(250)
    expect(entries.map((entry) => entry.body)).toEqual(
      Array.from({ length: 250 }, (_, index) => `comment ${index + 1}`),
    )
    expect(make('bot').readLogEntries).toBeTypeOf('function')
  })

  it('returns untrusted, bot and claim comments; filtering by writer is the consumer job', async () => {
    const { fake, make, reference } = github({ claims: true })
    const adapter = make('bot')
    const number = fake.seedIssue({})
    await fake.as('stranger').createIssueComment(REPO, number, 'APPROVE as the owner')
    await adapter.claim(reference(number), { kind: 'rig', rig: 'r1', host: 'local' })
    await fake.as('ann').createIssueComment(REPO, number, 'Approved by a person')
    const entries = await adapter.readLogEntries(reference(number))
    expect(entries.map((entry) => entry.writer)).toEqual(['stranger', 'bot', 'ann'])
    expect(entries[1].body).toContain('agentflow-claim:')
    expect(entries.every((entry) => entry.edited === false)).toBe(true)
  })

  it('does not report a later comment as a change to earlier entries', async () => {
    const { fake, make, reference } = github()
    const number = fake.seedIssue({})
    await fake.as('ann').createIssueComment(REPO, number, 'one')
    const before = await make('bot').readLogEntries(reference(number))
    await fake.as('bob').createIssueComment(REPO, number, 'two')
    const after = await make('bot').readLogEntries(reference(number))
    expect(after[0]).toEqual(before[0])
  })

  it('rejects an invalid issue number and propagates a source failure', async () => {
    const { fake, make, reference } = github()
    await expect(make('bot').readLogEntries(reference(0))).rejects.toThrow('invalid GitHub issue')
    await expect(make('bot').readLogEntries(reference(999))).rejects.toMatchObject({ status: 404 })
    const failing = createGitHubSourceAdapter({
      repo: REPO,
      client: {
        ...fake.client,
        issueComments: async () => {
          throw new Error('boom')
        },
      },
    })
    await expect(failing.readLogEntries(reference(1))).rejects.toThrow('boom')
  })
})

describe('filesystem readLogEntries', () => {
  const roots = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('returns comment rows with edited false and one entry time, and skips claim rows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-fs-entries-'))
    roots.push(root)
    const times = [
      '2026-02-01T00:00:01.000Z',
      '2026-02-01T00:00:02.000Z',
      '2026-02-01T00:00:03.000Z',
    ]
    const clock = () => new Date(times.shift())
    const adapter = createFilesystemSourceAdapter({
      root,
      writer: 'ann',
      trustedWriters: ['ann'],
      clock,
    })
    const ref = createFilesystemWorkItem(root, { id: 'item-1', title: 'T' })
    const reference = adapter.toReference({ system: 'filesystem', scope: 'local', id: 'item-1' })
    const post = async (operation, parameters) => {
      const plan = await adapter.previewMutation({
        operation,
        parameters,
        actionBoundary: BOUNDARY,
      })
      await adapter.flushReceipt(await adapter.applyMutation(plan, { confirm: plan.token }))
    }
    await post('add-comment', { id: 'item-1', body: 'decision' })
    await post('append-claim-entry', {
      id: 'item-1',
      entry: claimEntry({ owner: { kind: 'rig', rig: 'r', host: 'h' } }),
    })
    await post('add-comment', { id: 'item-1', body: 'second' })
    expect(ref).toBe('filesystem:local#item-1')
    const entries = await adapter.readLogEntries(reference)
    expect(entries.map((entry) => entry.body)).toEqual(['decision', 'second'])
    expect(Object.keys(entries[0]).sort()).toEqual(KEYS)
    expect(entries[0]).toEqual({
      writer: 'ann',
      body: 'decision',
      uri: 'filesystem:local#item-1/log/1',
      edited: false,
      createdAt: '2026-02-01T00:00:01.000Z',
      updatedAt: '2026-02-01T00:00:01.000Z',
    })
  })
})
