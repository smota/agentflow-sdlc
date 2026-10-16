import { describe, expect, it } from 'vitest'
import { resolveExecutionContracts } from '../config/execution-contract.mjs'

function fixture(member = {}) {
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
              model: 'gpt-6.1-sol',
              effort: 'medium',
              ...member,
            },
          ],
        },
      ],
    },
    bundleConfig: {
      presets: { selected: { 'dev.build': 'codex' } },
      seats: { 'dev.build': { runtimes: { codex: 'builder', pi: 'builder-pi' } } },
    },
    preset: 'selected',
  }
}
const resolve = (input) => resolveExecutionContracts(input)
const contract = (result) => result.contracts.find((entry) => entry.seat === 'dev.build')
const rejected = (result) => {
  expect(result.ok).toBe(false)
  expect(result.diagnostics.some((entry) => entry.severity === 'error')).toBe(true)
}

describe('execution contract independent adversarial design-review regressions', () => {
  it.each([42, null, []])('rejects present malformed preset tuple %j', (value) => {
    const input = fixture()
    input.bundleConfig.presets.selected['dev.build'] = value
    rejected(resolve(input))
  })

  it('rejects misspelled invocation fields rather than silently accepting defaults', () => {
    rejected(
      resolve({ ...fixture(), overrides: { seats: { 'dev.build': { modle: 'gpt-6.1-sol' } } } }),
    )
  })

  it('rejects misspelled project execution fields', () => {
    rejected(
      resolve({
        ...fixture(),
        config: {
          adapters: { openrig: { executionPolicy: { seats: { 'dev.build': { efort: 'low' } } } } },
        },
      }),
    )
  })

  it('rejects explicit native provider-family spoofing', () => {
    rejected(
      resolve({
        ...fixture(),
        overrides: {
          seats: {
            'dev.build': { runtime: 'codex', model: 'gpt-6.1-sol', providerFamily: 'anthropic' },
          },
        },
      }),
    )
  })

  it('does not invent a Pi gateway for an explicitly supplied unqualified model', () => {
    const input = fixture({ runtime: 'pi', profile: 'builder-pi', model: 'qwen/ambiguous' })
    input.bundleConfig.presets.selected['dev.build'] = 'pi'
    input.overrides = { seats: { 'dev.build': { model: 'qwen/ambiguous' } } }
    rejected(resolve(input))
  })

  it('holds a legacy Pi model whose gateway is unknown', () => {
    const input = fixture({ runtime: 'pi', profile: 'builder-pi', model: 'qwen/ambiguous' })
    input.bundleConfig.presets.selected['dev.build'] = 'pi'
    rejected(resolve(input))
  })

  it.each([
    ['munito', 'munito/qwen/test', 'qwen/test', 'qwen'],
    ['antigravity', 'antigravity/gemini-test', 'gemini-test', 'google'],
    ['grok', 'grok-cli/grok-test', 'grok-test', 'xai'],
  ])(
    'separates canonical model and exact runner locator for %s',
    (providerRoute, locator, model, providerFamily) => {
      const input = fixture({ runtime: 'pi', profile: 'builder-pi', providerRoute, model: locator })
      input.bundleConfig.presets.selected['dev.build'] = 'pi'
      input.inventory = [
        {
          runtime: 'pi',
          providerRoute,
          model,
          providerFamily,
          efforts: ['medium'],
          available: true,
        },
      ]
      const result = resolve(input)
      expect(result.ok).toBe(true)
      expect(contract(result)).toMatchObject({
        runtime: 'pi',
        providerRoute,
        model,
        runnerModel: locator,
        support: 'supported',
      })
    },
  )

  it('rejects a provider-prefixed locator for the native Codex harness', () => {
    rejected(
      resolve({
        ...fixture(),
        overrides: { seats: { 'dev.build': { model: 'openai-codex/gpt-test' } } },
      }),
    )
  })

  it('does not let generated catalog effort defaults silently replace a compatible legacy pin', () => {
    const input = fixture()
    input.config = { models: { tiers: { balanced: { defaultEffort: 'low' } } } }
    const result = resolve(input)
    expect(result.ok).toBe(true)
    expect(contract(result).effort).toBe('medium')
  })

  it('honors an explicit per-platform tier effort policy over the compatible legacy pin', () => {
    const input = fixture()
    input.config = {
      models: {
        tiers: {
          balanced: {
            models: {
              'codex:openai-codex': {
                runtime: 'codex',
                providerFamily: 'openai',
                model: 'gpt-6.1-sol',
                effort: 'low',
              },
            },
          },
        },
      },
    }
    const result = resolve(input)
    expect(result.ok).toBe(true)
    expect(contract(result).effort).toBe('low')
  })
})
