import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHarnessIntelligence, harnessScaffoldFiles } from '../config/harness-intelligence.mjs'
import { computeProjections } from '../config/projection.mjs'
import { loadAuthoritativeConfigs, validateConfigAuthority } from '../config/authority.mjs'

const roots = []
const root = () => {
  const dir = mkdtempSync(join(tmpdir(), 'execution-policy-'))
  roots.push(dir)
  return dir
}
const json = (dir, path, value) => writeFileSync(join(dir, path), JSON.stringify(value))
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('execution policy uses canonical configuration authority and shared projections', () => {
  it('unified authority outranks stale generated intelligence and retains partial defaults', () => {
    const dir = root()
    mkdirSync(join(dir, '.agentflow'))
    json(dir, '.agentflow/execution-policy.json', { escalation: { maxAttemptsPerTier: 99 } })
    json(dir, 'agentflow.config.json', {
      version: 1,
      execution: { escalation: { maxAttemptsPerTier: 3 } },
      models: { tiers: { balanced: { preferredModel: 'project/preferred' } } },
    })
    const loaded = loadHarnessIntelligence(dir)
    expect(loaded.executionPolicy.escalation).toMatchObject({
      maxAttemptsPerTier: 3,
      suspendOnRepeatedRejections: 2,
    })
    expect(loaded.modelCatalog.tiers.balanced).toMatchObject({
      preferredModel: 'project/preferred',
      defaultEffort: 'medium',
    })
    expect(loaded.modelCatalog.tiers.balanced.fallbacks.length).toBeGreaterThan(0)
  })

  it('legacy workflow aliases remain authoritative over generated files', () => {
    const dir = root()
    mkdirSync(join(dir, '.agentflow'))
    json(dir, '.agentflow/execution-policy.json', { escalation: { maxAttemptsPerTier: 99 } })
    json(dir, 'agent-workflow.config.json', {
      orchestrationModel: { lifecycle: 'legacy' },
      executionPolicy: { escalation: { maxAttemptsPerTier: 4 } },
      modelCatalog: { tiers: { balanced: { preferredModel: 'legacy/model' } } },
      harnessParameters: { scratchPath: '.legacy-scratch' },
    })
    const authoritative = loadAuthoritativeConfigs(dir)
    expect(authoritative.execution.escalation.maxAttemptsPerTier).toBe(4)
    const loaded = loadHarnessIntelligence(dir)
    expect(loaded.orchestrationModel.lifecycle).toBe('legacy')
    expect(loaded.executionPolicy.escalation.maxAttemptsPerTier).toBe(4)
    expect(loaded.modelCatalog.tiers.balanced.preferredModel).toBe('legacy/model')
    expect(loaded.harnessParameters.scratchPath).toBe('.legacy-scratch')
  })

  it('scaffold, empty runtime load and projection share identical defaults', () => {
    const projected = computeProjections()
    const scaffold = harnessScaffoldFiles()
    const loaded = loadHarnessIntelligence(root())
    const fields = {
      'orchestration-model': 'orchestrationModel',
      'execution-policy': 'executionPolicy',
      'model-catalog': 'modelCatalog',
      'harness-parameters': 'harnessParameters',
    }
    for (const [file, field] of Object.entries(fields)) {
      expect(JSON.parse(scaffold[`.agentflow/${file}.json`])).toEqual(
        JSON.parse(projected[`.agentflow/${file}.json`]),
      )
      expect(loaded[field]).toEqual(JSON.parse(projected[`.agentflow/${file}.json`]))
    }
  })

  it('does not serialize execution policy as a rig', () => {
    const openrig = {
      executionPolicy: {
        seats: { 'dev.build': { runtime: 'pi', providerRoute: 'munito', model: 'qwen/test' } },
      },
    }
    expect(computeProjections({ adapters: { openrig } })).not.toHaveProperty(
      'adapters/openrig/rig.yaml',
    )
  })

  it('projects only an explicit wrapped rig and preserves legacy raw rig shape', () => {
    const rig = { version: '0.2', name: 'fixture', pods: [] }
    const wrapped = computeProjections({
      adapters: { openrig: { rig, executionPolicy: { seats: {} } } },
    })
    const legacy = computeProjections({ adapters: { openrig: rig } })
    expect(JSON.parse(wrapped['adapters/openrig/rig.yaml'])).toEqual(rig)
    expect(legacy['adapters/openrig/rig.yaml']).toBe(wrapped['adapters/openrig/rig.yaml'])
  })

  it.each([
    null,
    [],
    'pi',
    { runtime: 2 },
    { runtime: 'bogus' },
    { model: [] },
    { effort: 'impossible' },
  ])('rejects malformed seat tuple %j through authority validation', (tuple) => {
    const result = validateConfigAuthority({
      isUnified: true,
      unified: { adapters: { openrig: { executionPolicy: { seats: { 'dev.build': tuple } } } } },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('dev.build')
  })

  it('accepts partial route tuples and reports malformed seats collections', () => {
    const valid = validateConfigAuthority({
      isUnified: true,
      unified: {
        adapters: {
          openrig: {
            executionPolicy: {
              seats: { 'dev.build': { providerRoute: 'munito', model: 'qwen/test' } },
            },
          },
        },
      },
    })
    expect(valid.ok).toBe(true)
    expect(
      validateConfigAuthority({
        isUnified: true,
        unified: { adapters: { openrig: { executionPolicy: { seats: [] } } } },
      }).ok,
    ).toBe(false)
  })
})
