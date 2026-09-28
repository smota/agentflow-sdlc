import { describe, expect, it } from 'vitest'
import {
  buildRunContext,
  materializeRunContext,
  MAX_CONTROL_CONTEXT_BYTES,
  MAX_POLICY_INDEX_BYTES,
} from '../application/context-service.mjs'

const digest = (letter) => letter.repeat(64)
function state() {
  return {
    runId: 'context-run',
    goalRef: 'issue:303',
    revision: digest('a'),
    phase: 4,
    owner: 'writer',
    generation: 2,
    boundary: 'external-action',
    candidateDigest: digest('c'),
    contract: {
      criteria: Array.from({ length: 12 }, (_, i) => ({
        id: `criterion-${i}`,
        description: `Check the exact source and reviewed candidate for outcome ${i}.`,
        definitionDigest: digest('d'),
      })),
    },
    openRework: {},
    operations: {},
  }
}

describe('bounded source-derived run context', () => {
  it('reuses only the exact current common digest while preserving dynamic authority and pending work', () => {
    const current = state()
    const policyIndex = {
      sections: Array.from({ length: 18 }, (_, i) => ({
        id: `policy-${i}`,
        ref: `docs/policy-${i}.md`,
        summary: `Current approved rule ${i}.`,
      })),
    }
    const first = buildRunContext({ state: current, policyIndex })
    const cached = first.common
    expect(first.commonDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(first.bytes).toBe(Buffer.byteLength(JSON.stringify(first)))
    expect(first.policyBytes).toBe(Buffer.byteLength(JSON.stringify(policyIndex)))
    current.revision = digest('b')
    current.generation = 3
    current.operations.pending = { id: 'pending', state: 'unknown' }
    const repeated = buildRunContext({
      state: current,
      policyIndex,
      knownCommonDigest: first.commonDigest,
    })
    expect(repeated.common).toBeUndefined()
    expect(repeated.commonRef.digest).toBe(first.commonDigest)
    expect(repeated.repeatedBytesAvoided).toBeGreaterThan(0)
    expect(repeated.revision).toBe(digest('b'))
    expect(repeated.generation).toBe(3)
    expect(repeated.pendingOperationIds).toEqual(['pending'])
    expect(materializeRunContext({ context: repeated, cachedCommon: cached })).toMatchObject({
      revision: digest('b'),
      generation: 3,
      pendingOperationIds: ['pending'],
      contract: current.contract,
      policyIndex,
    })
    expect(() => materializeRunContext({ context: repeated })).toThrow(/Missing or stale/)
    expect(() =>
      materializeRunContext({
        context: repeated,
        cachedCommon: { ...cached, contract: { criteria: [] } },
      }),
    ).toThrow(/Missing or stale/)
    current.contract.criteria[0].description = 'Policy drift changes this common content.'
    const drifted = buildRunContext({
      state: current,
      policyIndex,
      knownCommonDigest: first.commonDigest,
    })
    expect(drifted.common).toBeDefined()
    expect(drifted.commonRef).toBeUndefined()
    expect(drifted.commonDigest).not.toBe(first.commonDigest)
    const changedPolicy = {
      sections: [...policyIndex.sections, { id: 'new', ref: 'docs/new.md', summary: 'New rule.' }],
    }
    const policyDrift = buildRunContext({
      state: state(),
      policyIndex: changedPolicy,
      knownCommonDigest: first.commonDigest,
    })
    expect(policyDrift.common).toBeDefined()
    expect(policyDrift.commonDigest).not.toBe(first.commonDigest)
  })

  it('fails closed on policy and complete-control bounds without truncation', () => {
    const current = state()
    expect(() =>
      buildRunContext({
        state: current,
        policyIndex: { text: 'x'.repeat(MAX_POLICY_INDEX_BYTES) },
      }),
    ).toThrow(/Policy index exceeds/)
    current.contract.criteria[0].description = 'x'.repeat(MAX_CONTROL_CONTEXT_BYTES)
    expect(() => buildRunContext({ state: current })).toThrow(/Complete control context exceeds/)
    const oversizedDigest = 'x'.repeat(64)
    expect(() => buildRunContext({ state: current, knownCommonDigest: oversizedDigest })).toThrow(
      /Complete control context exceeds/,
    )
  })

  it('measures a fixed repeated-context workload without claiming live transport savings', () => {
    const current = state()
    const policyIndex = {
      sections: Array.from({ length: 20 }, (_, i) => ({
        ref: `docs/contract-${i}.md`,
        summary: `Requirement ${i}: current review evidence must bind the source revision.`,
      })),
    }
    const count = 20
    const baseline = []
    const optimized = []
    let knownCommonDigest = null
    for (let index = 0; index < count; index++) {
      current.revision = index.toString(16).padStart(64, '0')
      baseline.push(buildRunContext({ state: current, policyIndex }))
      const packet = buildRunContext({ state: current, policyIndex, knownCommonDigest })
      optimized.push(packet)
      knownCommonDigest = packet.commonDigest
    }
    const originalBytes = baseline.reduce((sum, packet) => sum + packet.bytes, 0)
    const currentBytes = optimized.reduce((sum, packet) => sum + packet.bytes, 0)
    const repeatedBytesAvoided = optimized.reduce(
      (sum, packet) => sum + packet.repeatedBytesAvoided,
      0,
    )
    expect(currentBytes).toBeLessThan(originalBytes)
    expect(repeatedBytesAvoided).toBeGreaterThan(0)
    expect(optimized.every((packet) => packet.bytes <= MAX_CONTROL_CONTEXT_BYTES)).toBe(true)
    console.info(
      JSON.stringify({
        workload: '20 source-derived checkpoint projections in one process; no network',
        originalBytes,
        currentBytes,
        repeatedBytesAvoided,
        savedPercent: Number((((originalBytes - currentBytes) / originalBytes) * 100).toFixed(1)),
      }),
    )
  })
})
