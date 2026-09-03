import { describe, expect, it } from 'vitest'
import { createRunEvent, reduceRun } from '../core/run-state.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { createRunService } from '../application/run-service.mjs'

function event(kind, payload, previous = null, generation = 0) {
  return createRunEvent({
    runId: 'demo',
    id: `${kind}-${previous?.digest ?? 'first'}`,
    kind,
    payload,
    previousDigest: previous?.digest ?? null,
    generation,
  })
}
const start = () =>
  event('started', {
    goalRef: 'https://example.org/issue/1',
    owner: 'writer',
    profile: 'standard',
    boundary: 'mutate-worktree',
  })
describe('durable run reducer', () => {
  it('deduplicates identical events but rejects conflicting parents', () => {
    const first = start()
    expect(reduceRun([first, first]).history).toHaveLength(1)
    expect(() => reduceRun([first, event('checkpoint', {}, null)])).toThrow('parent')
  })
  it('requires confirmed writer termination and narrower authority', () => {
    const first = start()
    expect(() =>
      reduceRun([
        first,
        event(
          'resumed',
          { owner: 'second', boundary: 'external-action', previousOwnerStopped: true },
          first,
        ),
      ]),
    ).toThrow('widen')
    expect(() =>
      reduceRun([
        first,
        event(
          'resumed',
          { owner: 'second', boundary: 'observe', previousOwnerStopped: false },
          first,
        ),
      ]),
    ).toThrow('stopped')
    expect(
      reduceRun([
        first,
        event(
          'resumed',
          { owner: 'second', boundary: 'observe', previousOwnerStopped: true },
          first,
        ),
      ]).generation,
    ).toBe(1)
  })
  it('serializes competing updates', async () => {
    const store = createMemoryRunStore()
    const first = start()
    await store.append(first, null)
    await store.append(event('checkpoint', {}, first), first.digest)
    await expect(
      store.append(event('paused', { reason: 'different writer' }, first), first.digest),
    ).rejects.toThrow('conflict')
  })
  it('refuses blind replay of an unknown external action', () => {
    const events = [start()]
    for (const state of ['planned', 'submitted', 'unknown'])
      events.push(
        event('operation', { id: 'release', payloadDigest: 'a'.repeat(64), state }, events.at(-1)),
      )
    expect(() =>
      reduceRun([
        ...events,
        event(
          'operation',
          { id: 'release', payloadDigest: 'a'.repeat(64), state: 'submitted' },
          events.at(-1),
        ),
      ]),
    ).toThrow('operation transition')
  })
  it('rebuilds recovery from a new service without previous context', async () => {
    const store = createMemoryRunStore({ durable: true })
    const ports = {
      store,
      authorize: async () => true,
      observeWriter: async () => ({ stopped: true, identity: 'old-process' }),
      observeWorkspace: async () => ({ verified: true, candidateDigest: null }),
    }
    const original = createRunService(ports)
    await original.start({
      runId: 'demo',
      goalRef: 'issue:1',
      owner: 'old',
      boundary: 'mutate-worktree',
    })
    const replacement = createRunService(ports)
    const plan = await replacement.recoveryPlan({
      owner: 'new',
      boundary: 'mutate-worktree',
      writer: { host: 'test', pid: 123, instance: 'new-process' },
    })
    expect(
      (await replacement.resume({ plan, authority: { owner: 'new', generation: 0 } })).generation,
    ).toBe(1)
    await expect(replacement.resume({ plan })).rejects.toThrow('changed')
  })
  it('does not infer liveness or permission from a checkpoint', async () => {
    const service = createRunService({ store: createMemoryRunStore(), authorize: async () => true })
    await service.start({ runId: 'demo', goalRef: 'issue:1', owner: 'old' })
    const plan = await service.recoveryPlan({ owner: 'new', boundary: 'observe' })
    expect(plan.blocked).toBe(true)
    await expect(service.resume({ plan })).rejects.toThrow('blocked')
  })
})
