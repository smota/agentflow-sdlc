import { describe, it, expect } from 'vitest'
import {
  budgetAdmission,
  normalizeUsage,
  journeyCoverage,
  resolveLifecycle,
  validateDeliveryContract,
  resolveDeliveryPolicy,
} from '../core/delivery-policy.mjs'

describe('delivery policy', () => {
  it('requires explicit stable release evidence and keeps environment targets separate', () => {
    const observation = {
      id: 'rc',
      kind: 'release',
      target: 'v2',
      candidateDigest: 'candidate',
      sourceVerified: true,
      outcome: 'pass',
      ageMs: 0,
      prerelease: true,
    }
    const resolve = (observations, required) =>
      resolveLifecycle({ candidateDigest: 'candidate', observations, required })
    const stable = [{ kind: 'release', target: 'v2', channel: 'stable' }]
    expect(resolve([observation], stable).status).toBe('blocked')
    expect(resolve([{ ...observation, prerelease: null }], stable).status).toBe('blocked')
    expect(resolve([{ ...observation, prerelease: false }], stable).status).toBe('pass')
    expect(resolve([observation], [{ ...stable[0], channel: 'prerelease' }]).status).toBe('pass')
    expect(
      resolve(
        [{ ...observation, kind: 'deployment', target: 'staging' }],
        [{ kind: 'deployment', target: 'production' }],
      ).status,
    ).toBe('blocked')
    expect(() => resolve([], [{ ...stable[0], channel: 'latest' }])).toThrow('channel')
    expect(() => resolve([], [{ ...stable[0], maxAgeMs: -1 }])).toThrow('lifetime')
  })
  it('enforces domain invariants and budget maxima over operational choices', () => {
    expect(() => resolveDeliveryPolicy({ sourceAcknowledgmentRequired: false })).toThrow(
      'Unsupported',
    )
    expect(() =>
      resolveDeliveryPolicy(
        { budgetMaxima: { tokens: 100 } },
        { level: 'advisory', unit: 'tokens', limit: 10 },
      ),
    ).toThrow('maximum')
    expect(() =>
      resolveDeliveryPolicy(
        { budgetMaxima: { tokens: 100 } },
        { level: 'admission-enforced', unit: 'tokens', limit: 101 },
      ),
    ).toThrow('maximum')
    expect(
      resolveDeliveryPolicy(
        { budgetMaxima: { tokens: 100 } },
        { level: 'admission-enforced', unit: 'tokens', limit: 100 },
      ).budgetMaxima.tokens,
    ).toBe(100)
  })
  it('refuses weak deterministic evidence policies', () => {
    expect(
      validateDeliveryContract({
        version: 2,
        goalRevision: 'issue:1',
        criteria: [
          {
            id: 'test',
            definitionDigest: 'a'.repeat(64),
            assertions: ['works'],
            allowedOrigins: ['agent-reported'],
          },
        ],
      }).ok,
    ).toBe(false)
  })
  it('counts cumulative usage once, requires epochs for reset, and preserves unknowns', () => {
    const m = {
      id: '1',
      provider: 'test',
      epoch: 'run',
      available: true,
      mode: 'cumulative',
      counters: { tokens: 20 },
    }
    const second = { ...m, id: '2', counters: { tokens: 30 } }
    expect(normalizeUsage([m, m, second]).totals['test:tokens']).toBe(30)
    expect(() => normalizeUsage([second, m])).toThrow('epoch')
    expect(normalizeUsage([{ ...m, available: false }]).unknown).toHaveLength(1)
  })
  it('does not enforce a hard ceiling with unknown usage or unsupported cancellation', () => {
    expect(
      budgetAdmission({
        budget: { level: 'admission-enforced', limit: 100 },
        used: null,
        estimatedNext: 1,
      }).admitted,
    ).toBe(false)
    expect(
      budgetAdmission({
        budget: { level: 'provider-enforced', limit: 100 },
        used: 1,
        estimatedNext: 1,
      }).admitted,
    ).toBe(false)
    expect(
      budgetAdmission({ budget: { level: 'advisory', limit: 100 }, used: 101, estimatedNext: 1 })
        .admitted,
    ).toBe(true)
  })
  it('treats journey coverage as more than test counts', () => {
    const projection = journeyCoverage({
      journeys: [{ id: 'search', criteria: ['exact-query'] }],
      criteria: [{ id: 'exact-query' }],
      observations: [
        { criterionId: 'exact-query', candidateDigest: 'old', resolution: { status: 'pass' } },
      ],
      candidateDigest: 'new',
    })
    expect(projection.status).toBe('blocked')
    expect(journeyCoverage({ candidateDigest: 'new' }).status).toBe('pass')
  })
  it('keeps release and deployment separate and requires exercised rollback when configured', () => {
    const observations = [
      {
        id: 'release',
        kind: 'release',
        target: 'v2',
        candidateDigest: 'candidate',
        sourceVerified: true,
        outcome: 'pass',
        ageMs: 0,
      },
    ]
    expect(
      resolveLifecycle({
        candidateDigest: 'candidate',
        observations,
        required: [
          { kind: 'release', target: 'v2' },
          { kind: 'deployment', target: 'production' },
        ],
      }).status,
    ).toBe('blocked')
    expect(
      resolveLifecycle({
        candidateDigest: 'candidate',
        observations: [{ ...observations[0], kind: 'rollback', exercised: false }],
        required: [{ kind: 'rollback', target: 'v2', exercised: true }],
      }).status,
    ).toBe('blocked')
  })
})
