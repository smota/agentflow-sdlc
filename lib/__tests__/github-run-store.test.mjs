import { describe, it, expect } from 'vitest'
import { createGitHubRunStore, planGitHubCoordination } from '../sources/github-run-store.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import { fakeGitHub, patchBarrier, awaitPatchBarrier } from './github-run-store.fixture.mjs'

const started = () =>
  createRunEvent({
    runId: 'demo',
    id: 'start',
    kind: 'started',
    payload: {
      goalRef: 'issue:1',
      owner: 'writer',
      profile: 'standard',
      boundary: 'external-action',
    },
  })
const storeFor = (fake) =>
  createGitHubRunStore({
    repo: 'test/repo',
    runId: 'demo',
    client: fake.client,
    boundary: 'external-action',
    setupConfirm: fake.setupConfirm,
  })
describe('GitHub coordination protocol', () => {
  it('reconciles a successful ref write after connection loss without duplicating it', async () => {
    const fake = fakeGitHub()
    fake.setupConfirm = (
      await planGitHubCoordination({ repo: 'test/repo', client: fake.client })
    ).digest
    const store = storeFor(fake),
      event = started()
    fake.uncertain = true
    await store.append(event, null)
    await store.append(event, null)
    expect((await store.read()).events).toHaveLength(1)
    expect(fake.requests.filter((r) => r.path.endsWith('/git/refs') && r.method)).toHaveLength(1)
  })
  it('requires initialized product history before any source mutation', async () => {
    const fake = fakeGitHub()
    fake.initialized = false
    await expect(storeFor(fake).append(started(), null)).rejects.toThrow()
    expect(fake.requests.filter((r) => r.method)).toHaveLength(0)
  })
  it('rejects obsolete head updates and never forces', async () => {
    const fake = fakeGitHub()
    fake.setupConfirm = (
      await planGitHubCoordination({ repo: 'test/repo', client: fake.client })
    ).digest
    const store = storeFor(fake),
      first = started()
    await store.append(first, null)
    const next = createRunEvent({
      runId: 'demo',
      id: 'next',
      kind: 'checkpoint',
      previousDigest: first.digest,
    })
    await store.append(next, first.digest)
    await expect(
      store.append(
        createRunEvent({
          runId: 'demo',
          id: 'other',
          kind: 'checkpoint',
          previousDigest: first.digest,
        }),
        first.digest,
      ),
    ).rejects.toThrow('conflict')
    expect(
      fake.requests.filter((r) => r.method === 'PATCH').every((r) => r.body.force === false),
    ).toBe(true)
  })
  it('rejects executable/symlink payloads on the state branch', async () => {
    const fake = fakeGitHub()
    fake.setupConfirm = (
      await planGitHubCoordination({ repo: 'test/repo', client: fake.client })
    ).digest
    const store = storeFor(fake)
    await store.append(started(), null)
    fake.overrideTree = [{ path: 'runs/demo.json', type: 'blob', mode: '120000', sha: 'link' }]
    await expect(store.read()).rejects.toThrow('unmanaged')
  })

  it('serializes genuinely concurrent divergent commits using single parents and non-force updates', async () => {
    const fake = fakeGitHub()
    fake.setupConfirm = (
      await planGitHubCoordination({ repo: 'test/repo', client: fake.client })
    ).digest
    const first = started()
    await storeFor(fake).append(first, null)
    const base = fake.refs.get('agentflow-state')
    const barrier = patchBarrier(fake)
    const events = ['left', 'right'].map((id) =>
      createRunEvent({
        runId: 'demo',
        id,
        kind: 'checkpoint',
        previousDigest: first.digest,
      }),
    )
    const attempts = events.map((event) => storeFor(fake).append(event, first.digest))
    const settled = Promise.allSettled(attempts)
    await awaitPatchBarrier(barrier, attempts)
    expect(barrier.writes).toHaveLength(2)
    expect(barrier.writes.map(({ body }) => fake.objects.get(body.sha).parents)).toEqual([
      [base],
      [base],
    ])
    expect(barrier.writes.every(({ body }) => body.force === false)).toBe(true)
    expect(new Set(barrier.writes.map(({ body }) => body.sha)).size).toBe(2)
    barrier.writes[0].release.resolve()
    await attempts[0]
    barrier.writes[1].release.resolve()
    const outcomes = await settled
    expect(outcomes.map(({ status }) => status)).toEqual(['fulfilled', 'rejected'])
    expect(outcomes[1].reason.message).toMatch(/conflict/)
    expect((await storeFor(fake).read()).events.map(({ id }) => id)).toEqual(['start', 'left'])
  })
})
