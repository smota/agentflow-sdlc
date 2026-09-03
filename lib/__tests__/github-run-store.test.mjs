import { describe, it, expect } from 'vitest'
import { createGitHubRunStore, planGitHubCoordination } from '../sources/github-run-store.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import { recordDigest } from '../core/record-digest.mjs'

function fakeGitHub() {
  const objects = new Map(),
    refs = new Map(),
    requests = []
  let uncertain = false,
    initialized = true,
    overrideTree = null
  const put = (value) => {
    const sha = recordDigest(value)
    objects.set(sha, value)
    return { sha }
  }
  const client = {
    async request(path, options = {}) {
      requests.push({ path, ...options })
      const tail = path.replace('/repos/test/repo', '')
      if (!options.method) {
        if (!tail) return { default_branch: 'main' }
        if (tail.startsWith('/rulesets?')) return []
        if (tail.startsWith('/actions/workflows?')) return { total_count: 0, workflows: [] }
        if (tail === '/git/ref/heads/main' && initialized) return { object: { sha: 'baseline' } }
        if (tail.startsWith('/git/ref/heads/')) {
          const sha = refs.get(tail.slice(15))
          if (!sha) throw Object.assign(new Error('not found'), { status: 404 })
          return { object: { sha } }
        }
        if (tail.startsWith('/git/commits/')) return objects.get(tail.slice(13))
        if (tail.startsWith('/git/trees/'))
          return {
            tree: overrideTree ?? objects.get(tail.slice(11).split('?')[0]).tree,
            truncated: false,
          }
        if (tail.startsWith('/git/blobs/')) {
          const blob = objects.get(tail.slice(11))
          return {
            encoding: 'base64',
            content: Buffer.from(blob.content).toString('base64'),
            size: Buffer.byteLength(blob.content),
          }
        }
      }
      const body = options.body
      if (tail === '/git/blobs') return put(body)
      if (tail === '/git/trees') return put({ tree: body.tree })
      if (tail === '/git/commits') return put({ ...body, tree: { sha: body.tree } })
      if (tail.startsWith('/git/refs')) {
        const branch = body.ref?.replace('refs/heads/', '') ?? tail.slice('/git/refs/heads/'.length)
        const existing = refs.get(branch)
        const commit = objects.get(body.sha)
        if (existing && (body.force !== false || commit.parents[0] !== existing))
          throw Object.assign(new Error('conflict'), { status: 422 })
        refs.set(branch, body.sha)
        if (uncertain) {
          uncertain = false
          throw new Error('connection lost after success')
        }
        return { object: { sha: body.sha } }
      }
      throw new Error(`Unexpected request: ${tail}`)
    },
  }
  return {
    client,
    requests,
    refs,
    objects,
    set uncertain(value) {
      uncertain = value
    },
    set initialized(value) {
      initialized = value
    },
    set overrideTree(value) {
      overrideTree = value
    },
  }
}
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
})
