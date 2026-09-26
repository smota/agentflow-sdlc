import { describe, expect, it } from 'vitest'
import { createGitHubRunStore, planGitHubCoordination } from '../sources/github-run-store.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import { fakeGitHub } from './github-run-store.fixture.mjs'

async function fixture(options = {}) {
  const fake = fakeGitHub()
  const setupConfirm = (await planGitHubCoordination({ repo: 'test/repo', client: fake.client }))
    .digest
  const store = createGitHubRunStore({
    repo: 'test/repo',
    runId: 'demo',
    client: fake.client,
    boundary: 'external-action',
    setupConfirm,
    ...options,
  })
  const start = createRunEvent({
    runId: 'demo',
    id: 'start',
    kind: 'started',
    payload: {
      goalRef: 'issue:265',
      owner: 'writer',
      profile: 'standard',
      boundary: 'external-action',
    },
  })
  await store.append(start, null)
  fake.requests.length = 0
  return { fake, store, start }
}

function checkpoint(start, id = 'next') {
  return createRunEvent({ runId: 'demo', id, kind: 'checkpoint', previousDigest: start.digest })
}

describe('immutable source read efficiency', () => {
  it('reduces actual source request calls 75% on warm reads, with one fresh ref per read', async () => {
    const { fake, store } = await fixture()
    const cold = await store.read()
    expect(fake.requests).toHaveLength(4)
    fake.requests.length = 0
    for (let i = 0; i < 10; i++) expect(await store.read()).toEqual(cold)
    expect(fake.requests).toHaveLength(10)
    expect(
      fake.requests.every(
        ({ path, method }) => !method && path.endsWith('/git/ref/heads/agentflow-state'),
      ),
    ).toBe(true)
    expect(1 - fake.requests.length / (10 * 4)).toBe(0.75)
  })

  it('never exposes mutable cached arrays or nested event payloads', async () => {
    const { store } = await fixture()
    const first = await store.read()
    first.events[0].payload.owner = 'attacker'
    first.events.push({ kind: 'invented' })
    const second = await store.read()
    expect(second.events).toHaveLength(1)
    expect(second.events[0].payload.owner).toBe('writer')
    second.events.length = 0
    expect((await store.read()).events).toHaveLength(1)
  })

  it('invalidates on another writer revision and rejects obsolete admission before writing', async () => {
    const { fake, store, start } = await fixture()
    await store.read()
    const other = createGitHubRunStore({
      repo: 'test/repo',
      runId: 'demo',
      client: fake.client,
      boundary: 'external-action',
    })
    const next = checkpoint(start)
    await other.append(next, start.digest)
    fake.requests.length = 0
    await expect(store.append(checkpoint(start, 'stale'), start.digest)).rejects.toThrow('conflict')
    expect(fake.requests).toHaveLength(4)
    expect(fake.requests.every(({ method }) => !method)).toBe(true)
    expect((await store.read()).revision).toBe(next.digest)
  })

  it('evicts the prior snapshot when a ref is force changed, including a return to older history', async () => {
    const { fake, store, start } = await fixture()
    const original = await store.read()
    await store.append(checkpoint(start), start.digest)
    const current = await store.read()
    expect(current.revision).not.toBe(original.revision)
    fake.refs.set('agentflow-state', original.sourceRevision)
    fake.requests.length = 0
    expect(await store.read()).toEqual(original)
    expect(fake.requests).toHaveLength(4)
  })

  it('does not use cached authority when the fresh ref is missing or unavailable', async () => {
    const { fake, store } = await fixture()
    const original = await store.read()
    fake.refs.delete('agentflow-state')
    expect(await store.read()).toEqual({ events: [], revision: null, sourceRevision: null })
    fake.refs.set('agentflow-state', original.sourceRevision)
    fake.requests.length = 0
    await store.read()
    expect(fake.requests).toHaveLength(4)
    const request = fake.client.request
    fake.client.request = async () => {
      throw new Error('source unavailable')
    }
    await expect(store.read()).rejects.toThrow('source unavailable')
    fake.client.request = request
    fake.requests.length = 0
    await store.read()
    expect(fake.requests).toHaveLength(4)
  })

  it('does not cache corrupt new history and retries validation on subsequent reads', async () => {
    const { fake, store, start } = await fixture()
    await store.read()
    await store.append(checkpoint(start), start.digest)
    fake.overrideTree = [{ path: 'runs/demo.json', type: 'blob', mode: '120000', sha: 'bad' }]
    await expect(store.read()).rejects.toThrow('unmanaged')
    fake.requests.length = 0
    await expect(store.read()).rejects.toThrow('unmanaged')
    expect(fake.requests).toHaveLength(3)
    fake.overrideTree = null
    expect((await store.read()).events).toHaveLength(2)
  })

  it('keeps confirmation a full fresh source read after a warm admission', async () => {
    const { fake, store, start } = await fixture()
    await store.read()
    fake.requests.length = 0
    await store.append(checkpoint(start), start.digest)
    const patch = fake.requests.findIndex(({ method }) => method === 'PATCH')
    expect(
      fake.requests.slice(patch + 1).map(({ path }) => path.split('/git/')[1].split('/')[0]),
    ).toEqual(['ref', 'commits', 'trees', 'blobs'])
  })

  it('never caches unknown source identities', async () => {
    const { fake, store } = await fixture()
    const original = await store.read()
    fake.objects.set('unknown', fake.objects.get(original.sourceRevision))
    fake.refs.set('agentflow-state', 'unknown')
    await store.read()
    fake.requests.length = 0
    await store.read()
    expect(fake.requests).toHaveLength(4)
  })

  it('does not cache a corrupted event digest even when the new ref looks immutable', async () => {
    const { fake, store } = await fixture()
    const original = await store.read()
    const commit = fake.objects.get(original.sourceRevision)
    const tree = fake.objects.get(commit.tree.sha)
    const blob = fake.objects.get(tree.tree[0].sha)
    const events = JSON.parse(blob.content)
    events[0].payload.owner = 'forged'
    blob.content = JSON.stringify(events)
    // New source identity invalidates the warm snapshot; neither failed replay is cached.
    fake.objects.set('f'.repeat(64), commit)
    fake.refs.set('agentflow-state', 'f'.repeat(64))
    await expect(store.read()).rejects.toThrow()
    fake.requests.length = 0
    await expect(store.read()).rejects.toThrow()
    expect(fake.requests).toHaveLength(4)
  })

  it('evicts cached history when the ref response loses its identity', async () => {
    const { fake, store } = await fixture()
    await store.read()
    const request = fake.client.request
    fake.client.request = async () => ({ object: {} })
    await expect(store.read()).rejects.toThrow('Missing coordination revision')
    fake.client.request = request
    fake.requests.length = 0
    await store.read()
    expect(fake.requests).toHaveLength(4)
  })

  it.each([0, 1])(
    'does not retain snapshots above the configured byte capacity %s',
    async (readCacheBytes) => {
      const { fake, store } = await fixture({ readCacheBytes })
      await store.read()
      fake.requests.length = 0
      await store.read()
      expect(fake.requests).toHaveLength(4)
    },
  )

  it.each([-1, NaN, Infinity, 2 * 1024 * 1024 + 1])(
    'rejects invalid cache capacity %s',
    (readCacheBytes) => {
      expect(() =>
        createGitHubRunStore({ repo: 'test/repo', runId: 'demo', readCacheBytes }),
      ).toThrow('capacity')
    },
  )
})
