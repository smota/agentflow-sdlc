import { describe, expect, it } from 'vitest'
import { createRunService } from '../application/run-service.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import {
  planProjection,
  publishProjection,
  reconcileProjection,
} from '../application/publication-service.mjs'

async function fixture() {
  const store = createMemoryRunStore({ durable: true })
  const authority = { owner: 'operator', generation: 0 }
  const comments = [],
    requests = []
  let afterRead = null
  const client = {
    request: async (path, options = {}) => {
      requests.push({ path, ...options })
      if (options.method === 'POST')
        comments.push({
          id: comments.length + 1,
          body: options.body.body,
          html_url: 'https://example.test/comment',
        })
      if (!options.method && afterRead) {
        const hook = afterRead
        afterRead = null
        await hook()
      }
      return structuredClone(comments)
    },
  }
  const service = createRunService({
    store,
    authorize: async () => true,
    reconcileOperation: async (op) => reconcileProjection({ client, plan: op.plan }),
  })
  await service.start({
    runId: 'demo',
    goalRef: 'issue:265',
    owner: 'operator',
    boundary: 'external-action',
    authority,
  })
  let sequence = 0
  const event = async (kind, payload = {}) => {
    const { revision } = await store.read()
    await store.append(
      createRunEvent({
        runId: 'demo',
        id: `test-${++sequence}`,
        kind,
        payload,
        previousDigest: revision,
      }),
      revision,
    )
  }
  const plan = async () =>
    planProjection({ status: await service.status(), repo: 'test/repo', issueNumber: 265 })
  const publish = async (projection) => {
    projection ??= await plan()
    return publishProjection({
      service,
      client,
      plan: projection,
      confirm: projection.digest,
      authority,
    })
  }
  return {
    store,
    service,
    client,
    comments,
    requests,
    event,
    plan,
    publish,
    onRead: (hook) => {
      afterRead = hook
    },
  }
}

describe('human projection coalescing', () => {
  it('reuses unchanged meaningful content after journal revisions without dropping journal events', async () => {
    const f = await fixture()
    const first = await f.plan()
    expect((await f.publish(first)).state).toBe('confirmed')
    await f.event('checkpoint', { note: 'durable internal progress' })
    const before = await f.store.read()
    f.requests.length = 0
    const result = await f.publish()
    expect(result).toMatchObject({
      verified: true,
      coalesced: true,
      projectedRevision: first.revision,
      observedRevision: before.revision,
    })
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].method).toBeUndefined()
    expect(await f.store.read()).toEqual(before)
    expect(f.comments).toHaveLength(1)
    expect(
      before.events
        .filter((event) => event.kind === 'operation')
        .map((event) => event.payload.state),
    ).toEqual(['planned', 'submitted', 'confirmed'])
  })

  it('verifies remote bytes again even when the exact operation was previously confirmed', async () => {
    const f = await fixture()
    const plan = await f.plan()
    await f.publish(plan)
    f.requests.length = 0
    expect((await f.publish(plan)).state).toBe('confirmed')
    expect(f.requests).toHaveLength(1)
    f.comments[0].body += ' concurrent edit'
    expect((await f.publish(plan)).state).toBe('unknown')
    expect(f.requests.every(({ method }) => !method)).toBe(true)
  })

  it.each(['candidate', 'phase', 'status'])(
    'publishes substantive %s changes with full operation evidence',
    async (change) => {
      const f = await fixture()
      await f.publish()
      if (change === 'candidate') await f.event('candidate', { digest: 'a'.repeat(64) })
      if (change === 'phase')
        await f.event('advanced', {
          from: 0,
          to: 1,
          candidateDigest: null,
          acceptanceDigest: 'b'.repeat(64),
        })
      if (change === 'status') await f.event('cancelled')
      expect((await f.publish()).state).toBe('confirmed')
      expect(f.comments).toHaveLength(2)
      expect(
        (await f.store.read()).events.filter((event) => event.kind === 'operation'),
      ).toHaveLength(6)
    },
  )

  it.each(['edit', 'delete', 'duplicate', 'competing'])(
    'detects remote %s and never blindly republishes',
    async (change) => {
      const f = await fixture()
      await f.publish()
      if (change === 'edit') f.comments[0].body += ' changed'
      if (change === 'delete') f.comments.length = 0
      if (change === 'duplicate') f.comments.push({ ...f.comments[0], id: 2 })
      if (change === 'competing')
        f.comments.push({ ...f.comments[0], id: 2, body: f.comments[0].body + ' competing' })
      f.requests.length = 0
      expect((await f.publish()).state).toBe('unknown')
      expect(f.requests.every(({ method }) => !method)).toBe(true)
    },
  )

  it.each(['paused', 'blocked'])(
    'preserves the %s run guard against new publication effects',
    async (kind) => {
      const f = await fixture()
      await f.publish()
      await f.event(kind, { reason: 'operator checkpoint' })
      f.requests.length = 0
      const before = await f.store.read()
      await expect(f.publish()).rejects.toThrow('Inactive runs may only reconcile operations')
      expect(f.requests.every(({ method }) => !method)).toBe(true)
      expect(await f.store.read()).toEqual(before)
    },
  )

  it('does not mistake an older matching projection for the latest deleted projection', async () => {
    const f = await fixture()
    await f.publish()
    await f.event('candidate', { digest: 'a'.repeat(64) })
    await f.publish()
    f.comments.pop()
    f.requests.length = 0
    expect((await f.publish()).state).toBe('unknown')
    expect(f.requests.every(({ method }) => !method)).toBe(true)
  })

  it('rejects no-op evidence if authority revision changes during the remote read', async () => {
    const f = await fixture()
    await f.publish()
    const plan = await f.plan()
    f.onRead(() => f.event('paused', { reason: 'concurrent change' }))
    f.requests.length = 0
    await expect(f.publish(plan)).rejects.toThrow('stale during remote observation')
    expect(f.requests.every(({ method }) => !method)).toBe(true)
  })

  it('ignores ordinary human comments without editing or removing them', async () => {
    const f = await fixture()
    await f.publish()
    f.comments.push({ id: 2, body: 'Please continue', html_url: 'https://example.test/human' })
    expect((await f.publish()).coalesced).toBe(true)
    expect(f.comments[1].body).toBe('Please continue')
  })

  it('keeps ambiguous submission reconciliation-only, including a newly generated plan', async () => {
    const f = await fixture()
    const request = f.client.request
    f.client.request = async (path, options = {}) => {
      const result = await request(path, options)
      if (options.method === 'POST') throw new Error('lost response')
      return result
    }
    const original = await f.plan()
    expect((await f.publish(original)).state).toBe('unknown')
    const postCount = f.requests.filter(({ method }) => method === 'POST').length
    expect((await f.publish()).state).toBe('unknown')
    expect(f.requests.filter(({ method }) => method === 'POST')).toHaveLength(postCount)
    expect((await f.publish(original)).state).toBe('confirmed')
    expect((await f.publish()).coalesced).toBe(true)
    expect(f.requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
  })

  it('does not confirm a duplicate marker whose other copy was edited', async () => {
    const f = await fixture()
    const plan = await f.plan()
    await f.publish(plan)
    f.comments.push({ ...f.comments[0], id: 2, body: f.comments[0].body + ' edited duplicate' })
    expect((await f.publish(plan)).state).toBe('unknown')
    expect(f.requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
  })

  it('fails closed when remote projection evidence exceeds the bounded read capacity', async () => {
    const f = await fixture()
    await f.publish()
    f.comments.push({ id: 2, body: 'x'.repeat(8 * 1024 * 1024) })
    f.requests.length = 0
    expect(await f.publish()).toMatchObject({
      state: 'unknown',
      reason: 'Incomplete comment pagination',
    })
    expect(f.requests.every(({ method }) => !method)).toBe(true)
  })
})
