import { describe, it, expect } from 'vitest'
import {
  defaultDistributionSelection,
  resolveDistribution,
  selectDistributionRoute,
  distributionDrift,
} from '../config/execution-distribution.mjs'
import { resolveExecutionContracts } from '../config/execution-contract.mjs'
const selection = () => defaultDistributionSelection()
describe('versioned subscription distribution', () => {
  it('rejects unlisted or unsafe model overrides and fallback chains sharing only one budget', () => {
    for (const model of ['gpt-6.1-sol;$(id)', 'gpt-unknown-premium', 'gpt-x\u0000']) {
      const options = structuredClone(resolveDistribution(selection()).roles['dev.build'].options)
      options[1].model = model
      expect(() =>
        resolveDistribution({
          ...selection(),
          overrides: { 'dev.build': { reason: 'Review proposed model', options } },
        }),
      ).toThrow()
    }
  })

  it('rejects three models on a single shared subscription as independent fallbacks', () => {
    const p = resolveDistribution(selection()),
      base = p.roles['dev.build'].options[1]
    const options = ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra'].map((model) => ({
      ...base,
      model,
    }))
    expect(() =>
      resolveDistribution({
        ...selection(),
        overrides: { 'dev.build': { reason: 'Same account', options } },
      }),
    ).toThrow(/distinct subscription/)
  })
  it('rejects prototype names as roles and preserves global object state', () => {
    const s = selection(),
      options = resolveDistribution(s).roles['dev.build'].options
    const overrides = JSON.parse(
      JSON.stringify({ constructor: { reason: 'Malformed role', options } }),
    )
    expect(() => resolveDistribution({ ...s, overrides })).toThrow(/Unknown distribution role/)
    const poisoned = JSON.parse(
      '{"__proto__":{"reason":"Malformed role","options":' + JSON.stringify(options) + '}}',
    )
    expect(() => resolveDistribution({ ...s, overrides: poisoned })).toThrow(
      /Unknown distribution role/,
    )
    expect(Object.prototype.options).toBeUndefined()
    expect(() => selectDistributionRoute({ selection: s, role: 'constructor' })).toThrow(
      /Unknown distribution role/,
    )
  })

  it('pins a balanced policy with exactly two subscription fallbacks for every existing/expansion role', () => {
    const p = resolveDistribution(selection())
    expect(p.roles['dev.build'].options.map((o) => o.model)).toEqual([
      'gemini-3.8-flash',
      'gpt-6.1-sol',
      'grok-4.7-build-fast',
    ])
    expect(p.roles['rev.review'].options[0].effort).toBe('medium')
    expect(p.roles['dev.test-eng'].options).toHaveLength(3)
    for (const r of Object.values(p.roles)) {
      expect(r.options).toHaveLength(3)
      for (const o of r.options) {
        expect(o.providerRoute).not.toBe('munito')
        expect(p.subscriptions[o.subscription]).toBeDefined()
        if (r.scope === 'persistent') expect(['low', 'medium']).toContain(o.effort)
      }
    }
  })
  it('refuses silent profile replacement, missing pins and undeclared override fields', () => {
    expect(() => resolveDistribution({ ...selection(), profileDigest: '0'.repeat(64) })).toThrow(
      /digest/i,
    )
    expect(() => resolveDistribution({ profile: 'subscription-balanced-v1' })).toThrow(/digest/i)
    expect(() => resolveDistribution({ ...selection(), runtimeSelection: {} })).toThrow(/unknown/i)
    expect(() =>
      resolveDistribution({ ...selection(), overrides: { 'dev.build': { options: [] } } }),
    ).toThrow()
  })
  it('accepts explicit reasoned project overrides but excludes unapproved subscription routes', () => {
    const p = resolveDistribution(selection())
    const options = structuredClone(p.roles['dev.build'].options).reverse()
    expect(
      resolveDistribution({
        ...selection(),
        overrides: { 'dev.build': { reason: 'Approved project-specific order', options } },
      }).roles['dev.build'].options[0].model,
    ).toBe('grok-4.7-build-fast')
    options[0].providerRoute = 'munito'
    expect(() =>
      resolveDistribution({
        ...selection(),
        overrides: { 'dev.build': { reason: 'Experiment', options } },
      }),
    ).toThrow(/route/i)
  })
  it('proposes a temporary quota fallback without modifying the saved policy', () => {
    const s = selection(),
      before = JSON.stringify(s)
    const r = selectDistributionRoute({
      selection: s,
      role: 'dev.build',
      now: 100,
      availability: [
        { subscription: 'gemini', status: 'unavailable', observedAt: 90, expiresAt: 110 },
        { subscription: 'openai', status: 'healthy', observedAt: 90, expiresAt: 110 },
      ],
    })
    expect(r.selected.model).toBe('gpt-6.1-sol')
    expect(r.fallbackIndex).toBe(1)
    expect(JSON.stringify(s)).toBe(before)
  })
  it('holds unknown/stale availability and skips same-family reviewers without inventing independent quota', () => {
    expect(
      selectDistributionRoute({ selection: selection(), role: 'dev.build', now: 100 }).status,
    ).toBe('held')
    const r = selectDistributionRoute({
      selection: selection(),
      role: 'rev.review',
      excludedFamilies: ['openai'],
      now: 100,
      availability: [
        { subscription: 'openai', status: 'healthy', observedAt: 90, expiresAt: 110 },
        { subscription: 'claude', status: 'healthy', observedAt: 90, expiresAt: 110 },
      ],
    })
    expect(r.selected.model).toBe('claude-sonnet-5-5')
    expect(
      selectDistributionRoute({
        selection: selection(),
        role: 'dev.build-sr',
        now: 100,
        availability: [{ subscription: 'gemini', status: 'healthy', observedAt: 1, expiresAt: 99 }],
      }).status,
    ).toBe('held')
  })
  it('resolves the complete model/effort/client tuple through the actual rig resolver and rejects bypass overrides', () => {
    const args = {
      rig: {
        pods: [
          {
            id: 'dev',
            members: [
              {
                id: 'build',
                runtime: 'codex',
                model: 'gpt-6.1-sol',
                effort: 'high',
                profile: 'builder',
              },
            ],
          },
        ],
      },
      config: { executionDistribution: selection() },
      bundleConfig: {
        seats: { 'dev.build': { runtimes: { pi: 'builder-pi', codex: 'builder' } } },
      },
    }
    const r = resolveExecutionContracts(args)
    expect(r.ok).toBe(true)
    expect(r.contracts[0]).toMatchObject({
      runtime: 'pi',
      model: 'gemini-3.8-flash',
      runnerModel: 'antigravity/gemini-3.8-flash',
      effort: 'medium',
      profile: 'builder-pi',
    })
    expect(
      resolveExecutionContracts({
        ...args,
        overrides: { seats: { 'dev.build': { model: 'qwen/qwen3.8-27b' } } },
      }).ok,
    ).toBe(false)
  })
  it('detects installed drift separately from desired policy and live observation', () => {
    expect(
      distributionDrift({
        selection: selection(),
        installed: [
          { seat: 'dev.build', runtime: 'pi', model: 'munito/qwen/qwen3.8-27b', effort: 'medium' },
        ],
      }).ok,
    ).toBe(false)
    const d = distributionDrift({
      selection: selection(),
      installed: [
        {
          seat: 'dev.build',
          runtime: 'pi',
          model: 'antigravity/gemini-3.8-flash',
          effort: 'medium',
        },
      ],
    })
    expect(d.ok).toBe(true)
    expect(d.liveObservation).toBe('not-performed')
  })
})
