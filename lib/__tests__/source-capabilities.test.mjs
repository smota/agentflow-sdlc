import { describe, expect, it, vi } from 'vitest'
import {
  SOURCE_ADAPTER_VERSION,
  SOURCE_CAPABILITIES,
  callSourceCapability,
  isCapabilityAbsent,
  validateSourceAdapter,
} from '../core/source-adapter.mjs'

const fn = () => vi.fn(async () => 'value')
const base = () => ({
  version: 1,
  id: 'fake',
  capabilities: ['read-artifacts'],
  readArtifact: fn(),
})
const mutating = () => ({
  ...base(),
  capabilities: ['read-artifacts', 'mutate-comments'],
  previewMutation: fn(),
  applyMutation: fn(),
  flushReceipt: fn(),
})

describe('optional source capabilities', () => {
  it('stays at version 1 and only adds capabilities', () => {
    expect(SOURCE_ADAPTER_VERSION).toBe(1)
    expect(SOURCE_CAPABILITIES).toEqual([
      'read-artifacts',
      'read-lifecycle',
      'mutate-comments',
      'mutate-artifacts',
      'mutate-lifecycle',
      'claim',
      'ready-predicates',
      'watch',
      'resolve-humans',
      'log-entries',
    ])
    expect(validateSourceAdapter(base())).toEqual({ ok: true, errors: [] })
  })

  it('requires the methods and declarations of each declared optional capability', () => {
    expect(
      validateSourceAdapter({ ...base(), capabilities: ['read-artifacts', 'claim'] }).errors,
    ).toEqual([
      'claim() is required for claim',
      'release() is required for claim',
      'readClaim() is required for claim',
      'claim requires mutate-comments',
      'claim requires a claimMirror name',
    ])
    const claim = {
      ...mutating(),
      capabilities: ['read-artifacts', 'mutate-comments', 'claim'],
      claim: fn(),
      release: fn(),
      readClaim: fn(),
    }
    expect(validateSourceAdapter(claim).errors).toEqual(['claim requires a claimMirror name'])
    expect(validateSourceAdapter({ ...claim, claimMirror: 'assignee' })).toEqual({
      ok: true,
      errors: [],
    })
    const ready = {
      ...base(),
      capabilities: ['read-artifacts', 'ready-predicates'],
      readWorkItem: fn(),
      listWorkItems: fn(),
      toReference: vi.fn(),
    }
    expect(validateSourceAdapter(ready).errors).toEqual([
      'ready-predicates requires a non-empty readyPredicateKinds',
    ])
    expect(
      validateSourceAdapter({ ...ready, readyPredicateKinds: ['label', 'milestone'] }).errors,
    ).toEqual(['unsupported ready predicate kind: milestone'])
    expect(
      validateSourceAdapter({
        ...base(),
        capabilities: ['read-artifacts', 'watch', 'resolve-humans'],
      }).errors,
    ).toEqual(['watch() is required for watch', 'resolveHumans() is required for resolve-humans'])
  })

  it('requires readLogEntries for log-entries and reports its absence', async () => {
    expect(
      validateSourceAdapter({ ...base(), capabilities: ['read-artifacts', 'log-entries'] }).errors,
    ).toEqual(['readLogEntries() is required for log-entries'])
    expect(
      isCapabilityAbsent(await callSourceCapability(base(), 'log-entries', 'readLogEntries')),
    ).toBe(true)
  })

  it('calls a declared capability and propagates its failure', async () => {
    const adapter = {
      ...base(),
      capabilities: ['read-artifacts', 'watch'],
      watch: vi.fn(async (cursor) => ({ cursor: `${cursor}+`, refs: [] })),
    }
    expect(await callSourceCapability(adapter, 'watch', 'watch', '1')).toEqual({
      cursor: '1+',
      refs: [],
    })
    adapter.watch.mockRejectedValueOnce(new Error('source down'))
    await expect(callSourceCapability(adapter, 'watch', 'watch', '1')).rejects.toThrow(
      'source down',
    )
    await expect(callSourceCapability(adapter, 'watch', 'readClaim')).rejects.toThrow(
      'not a watch method',
    )
    expect(isCapabilityAbsent(await callSourceCapability(adapter, 'claim', 'claim'))).toBe(true)
    expect(isCapabilityAbsent({ status: 'free' })).toBe(false)
  })
})
