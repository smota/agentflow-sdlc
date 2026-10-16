import { describe, expect, it } from 'vitest'
import { resolveExecutionContracts } from '../config/execution-contract.mjs'

// Test-engineering fixtures: invented routes/models avoid coupling the contract to live accounts.
function fixture() {
  return {
    rig: {
      pods: [
        {
          id: 'dev',
          members: [
            {
              id: 'build',
              runtime: 'codex',
              profile: 'builder',
              model: 'codex-old',
              effort: 'medium',
            },
          ],
        },
        {
          id: 'eval',
          members: [
            {
              id: 'tester',
              runtime: 'codex',
              profile: 'eval-tester',
              model: 'eval-pinned',
              effort: 'low',
            },
          ],
        },
      ],
    },
    bundleConfig: {
      recommended: 'delivery',
      presets: {
        delivery: {
          'dev.build': { runtime: 'pi', providerRoute: 'munito', capabilityTier: 'balanced' },
        },
      },
      seats: {
        'dev.build': { runtimes: { pi: 'builder-pi', codex: 'builder' } },
        'eval.tester': { runtimes: { codex: 'eval-tester' } },
      },
      capability_tiers: {
        balanced: {
          effort: 'medium',
          models: {
            'pi:munito': {
              runtime: 'pi',
              providerFamily: 'qwen',
              model: 'qwen/test-balanced',
              effort: 'medium',
              recommended2026Model: 'qwen/advisory-only',
            },
            'codex:openai-codex': {
              runtime: 'codex',
              providerFamily: 'openai',
              model: 'codex-balanced',
              effort: 'medium',
            },
          },
        },
      },
    },
    preset: 'delivery',
  }
}
const build = (result) => result.contracts.find((item) => item.seat === 'dev.build')
const errors = (result) => result.diagnostics.filter((item) => item.severity === 'error')

describe('effective execution contract: independent observable acceptance', () => {
  it('resolves a coherent selected runtime, mapped profile, provider route and tier model', () => {
    const result = resolveExecutionContracts(fixture())
    expect(result.ok).toBe(true)
    expect(build(result)).toMatchObject({
      runtime: 'pi',
      executionTarget: expect.stringMatching(/^pi-/),
      profile: 'builder-pi',
      providerRoute: 'munito',
      providerFamily: 'qwen',
      model: 'qwen/test-balanced',
      effort: 'medium',
      capabilityTier: 'balanced',
      support: 'unknown',
    })
    expect(build(result).providerRoute).not.toContain('pi:')
    expect(build(result).model).not.toBe('qwen/advisory-only')
  })

  it('preserves a compatible legacy pin without turning advisory recommendations into policy', () => {
    const input = fixture()
    input.bundleConfig.presets.delivery['dev.build'] = 'pi'
    Object.assign(input.rig.pods[0].members[0], {
      runtime: 'pi',
      profile: 'builder-pi',
      providerRoute: 'munito',
      model: 'qwen/legacy-pinned',
    })
    const result = resolveExecutionContracts(input)
    expect(result.ok).toBe(true)
    expect(build(result).model).toBe('qwen/legacy-pinned')
    expect(build(result).model).not.toBe('qwen/advisory-only')
  })

  it('uses explicit invocation fields over project policy and records field-level provenance', () => {
    const input = fixture()
    input.config = {
      adapters: {
        openrig: {
          executionPolicy: { seats: { 'dev.build': { model: 'qwen/project', effort: 'low' } } },
        },
      },
    }
    input.overrides = { seats: { 'dev.build': { model: 'qwen/invocation' } } }
    const result = resolveExecutionContracts(input)
    expect(result.ok).toBe(true)
    expect(build(result)).toMatchObject({ model: 'qwen/invocation', effort: 'low' })
    expect(build(result).provenance.model).toMatchObject({
      value: 'qwen/invocation',
      source: expect.stringMatching(/overrid|invocation/i),
    })
    expect(build(result).provenance.effort).toMatchObject({
      value: 'low',
      source: expect.stringMatching(/project|config/i),
    })
  })

  it('applies project tier model policy to the selected route', () => {
    const input = fixture()
    input.config = {
      models: {
        tiers: {
          balanced: {
            models: {
              'pi:munito': {
                runtime: 'pi',
                providerFamily: 'deepseek',
                model: 'deepseek/project-tier',
                effort: 'low',
              },
            },
          },
        },
      },
    }
    const result = resolveExecutionContracts(input)
    expect(result.ok).toBe(true)
    expect(build(result)).toMatchObject({
      model: 'deepseek/project-tier',
      providerFamily: 'deepseek',
      providerRoute: 'munito',
      effort: 'low',
    })
  })

  it.each([
    { runtime: 'pi', profile: 'builder' },
    { runtime: 'codex', providerRoute: 'munito', model: 'qwen/incompatible' },
    { runtime: 'pi', effort: 'nonsense' },
  ])('rejects contradictory explicit tuple %j', (tuple) => {
    const input = fixture()
    input.overrides = { seats: { 'dev.build': tuple } }
    const result = resolveExecutionContracts(input)
    expect(result.ok).toBe(false)
    expect(errors(result).length).toBeGreaterThan(0)
  })

  it('does not mistake missing inventory for supported execution', () => {
    const result = resolveExecutionContracts({ ...fixture(), inventory: null })
    expect(result.ok).toBe(true)
    expect(build(result).support).toBe('unknown')
  })

  it('reports a known unavailable route without treating preview configuration as invalid', () => {
    const result = resolveExecutionContracts({
      ...fixture(),
      inventory: [
        {
          runtime: 'pi',
          providerRoute: 'munito',
          model: 'qwen/test-balanced',
          efforts: ['medium'],
          available: false,
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(build(result).support).toBe('unavailable')
  })

  it('recognizes positive inventory evidence and keeps gateway distinct from model family', () => {
    const result = resolveExecutionContracts({
      ...fixture(),
      inventory: [
        {
          runtime: 'pi',
          providerRoute: 'munito',
          model: 'qwen/test-balanced',
          efforts: ['medium'],
          available: true,
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(build(result)).toMatchObject({
      support: 'supported',
      providerRoute: 'munito',
      providerFamily: 'qwen',
    })
  })

  it('preserves unassigned eval configuration and diagnoses preset seats absent from the rig', () => {
    const input = fixture()
    input.bundleConfig.presets.delivery['dev.missing'] = 'pi'
    const result = resolveExecutionContracts(input)
    expect(result.ok).toBe(true)
    expect(result.contracts.find((item) => item.seat === 'eval.tester')).toMatchObject({
      runtime: 'codex',
      profile: 'eval-tester',
      model: 'eval-pinned',
      effort: 'low',
    })
    expect(
      result.diagnostics.some(
        (item) => item.severity === 'warning' && JSON.stringify(item).includes('dev.missing'),
      ),
    ).toBe(true)
  })

  it('rejects duplicate stable seat identities', () => {
    const input = fixture()
    input.rig.pods[0].members.push({ ...input.rig.pods[0].members[0] })
    const result = resolveExecutionContracts(input)
    expect(result.ok).toBe(false)
    expect(errors(result).length).toBeGreaterThan(0)
  })

  it('is independent of seat order and does not mutate any caller input', () => {
    const input = fixture()
    const before = structuredClone(input)
    const first = resolveExecutionContracts(input)
    expect(input).toEqual(before)
    const reordered = structuredClone(input)
    reordered.rig.pods.reverse()
    const second = resolveExecutionContracts(reordered)
    const sort = (items) => [...items].sort((a, b) => a.seat.localeCompare(b.seat))
    expect(sort(first.contracts)).toEqual(sort(second.contracts))
  })
})
