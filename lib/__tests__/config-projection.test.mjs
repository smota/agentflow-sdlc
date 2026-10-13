import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import Ajv2020 from 'ajv/dist/2020.js'
import {
  CANONICAL_CONFIG_NAME,
  loadAuthoritativeConfigs,
  resolveConfigAuthority,
  validateConfigAuthority,
  planAuthorityConsolidation,
  applyAuthorityConsolidation,
} from '../config/authority.mjs'
import { computeProjections, inspectConfigState, applyProjections } from '../config/projection.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cliPath = resolve(packageRoot, 'bin/cli.mjs')
const schemaPath = resolve(packageRoot, 'schemas/agentflow-config.schema.json')

function runCli(args, cwd = packageRoot) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('Unified Configuration Authority and Deterministic Projections (P5-C1 to P5-C8)', () => {
  let tempDir
  const ajv = new Ajv2020({ strict: false })
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  const validateSchema = ajv.compile(schema)

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentflow-projection-test-'))
  })

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('P5-C1: unified agentflow.config.json loads cleanly and validates against schema', () => {
    const unifiedConfig = {
      $schema: './schemas/agentflow-config.schema.json',
      version: 1,
      authority: { human: 'docs/sdlc.md', machine: 'agentflow.config.json' },
      roles: [
        { phase: 0, slug: 'product-manager', label: 'PM', owns: ['goal'] },
        { phase: 4, slug: 'developer', label: 'Dev', owns: ['code'] },
      ],
      orchestration: {
        lifecycle: 'dual-gate',
        concurrency: { maxWriters: 1, maxAdvisors: 2 },
      },
      models: {
        tiers: {
          balanced: { capabilities: ['fast'], preferredModel: 'claude-sonnet-4-5' },
        },
        roleAssignments: { developer: 'balanced' },
      },
      harness: {
        scratchPath: '.agent-runs/scratch',
      },
    }

    writeFileSync(join(tempDir, CANONICAL_CONFIG_NAME), JSON.stringify(unifiedConfig, null, 2))

    // 1. JSON Schema validation
    const valid = validateSchema(unifiedConfig)
    expect(valid).toBe(true)

    // 2. Loader resolution
    const loaded = loadAuthoritativeConfigs(tempDir)
    expect(loaded.isUnified).toBe(true)
    expect(loaded.configPath).toBe(join(tempDir, CANONICAL_CONFIG_NAME))
    expect(loaded.orchestration.lifecycle).toBe('dual-gate')
    expect(loaded.models.roleAssignments.developer).toBe('balanced')

    // 3. Authority validation
    const resolved = resolveConfigAuthority(tempDir)
    expect(resolved.validation.ok).toBe(true)
    expect(resolved.validation.errors).toHaveLength(0)
  })

  it('P5-C2: legacy dual sdlc.config.json + agent-workflow.config.json resolves without regression', () => {
    writeFileSync(
      join(tempDir, 'sdlc.config.json'),
      JSON.stringify({
        version: 1,
        roles: [{ phase: 4, slug: 'developer', label: 'Dev', owns: ['code'] }],
      }),
    )
    writeFileSync(
      join(tempDir, 'agent-workflow.config.json'),
      JSON.stringify({ branching: { trunk: 'main' }, ciCommands: ['pnpm test'] }),
    )

    const loaded = loadAuthoritativeConfigs(tempDir)
    expect(loaded.isUnified).toBe(false)
    expect(loaded.domainPath).toBe(join(tempDir, 'sdlc.config.json'))
    expect(loaded.workflowPath).toBe(join(tempDir, 'agent-workflow.config.json'))
    expect(loaded.domain.roles).toHaveLength(1)
    expect(loaded.workflow.branching.trunk).toBe('main')

    const resolved = resolveConfigAuthority(tempDir)
    expect(resolved.validation.ok).toBe(true)
  })

  it('P5-C3: deterministic projection engine generates byte-stable projections with sorted keys', () => {
    const config = {
      orchestration: {
        preCodeReview: { gate: 'sparring', enabled: true },
        lifecycle: 'dual-gate',
      },
      models: {
        roleAssignments: { tester: 'deep-reasoning', developer: 'balanced' },
        tiers: {
          balanced: { preferredModel: 'claude-sonnet-4-5' },
          'deep-reasoning': { preferredModel: 'grok-4.7' },
        },
      },
    }

    const run1 = computeProjections(config)
    const run2 = computeProjections(config)

    // Multiple runs must produce identical string bytes
    expect(run1).toEqual(run2)
    for (const [path, content] of Object.entries(run1)) {
      expect(content).toBe(run2[path])
      // JSON must parse cleanly
      expect(() => JSON.parse(content)).not.toThrow()
    }

    // Verify key sorting
    const parsedModelCatalog = JSON.parse(run1['.agentflow/model-catalog.json'])
    const tierKeys = Object.keys(parsedModelCatalog.tiers)
    expect(tierKeys).toEqual([...tierKeys].sort())
  })

  it('P5-C4: reference integrity catches undefined model tiers and invalid execution targets', () => {
    const invalidConfig = {
      models: {
        tiers: { balanced: { preferredModel: 'claude-sonnet' } },
        roleAssignments: {
          developer: 'nonexistent-tier',
        },
      },
      workflow: {
        routing: {
          agents: {
            claude: {
              enabled: true,
              defaultExecutionTarget: 'invalid-claude-target',
            },
          },
        },
      },
    }

    const validation = validateConfigAuthority(invalidConfig)
    expect(validation.ok).toBe(false)
    expect(validation.errors.some((e) => e.includes('nonexistent-tier'))).toBe(true)
    expect(validation.errors.some((e) => e.includes('invalid-claude-target'))).toBe(true)
  })

  it('P5-C5: conflicting aliases validation detects self-mapping and circular alias chains', () => {
    const circularConfig = {
      workflow: {
        routing: {
          aliases: {
            alpha: 'beta',
            beta: 'alpha',
            self: 'self',
          },
        },
      },
    }

    const validation = validateConfigAuthority(circularConfig)
    expect(validation.ok).toBe(false)
    expect(validation.errors.some((e) => e.includes('maps to itself'))).toBe(true)
    expect(validation.errors.some((e) => e.includes('circular alias detected'))).toBe(true)
  })

  it('P5-C6: inspectConfigState distinguishes desired configuration from observed running state', () => {
    // 1. In empty directory, projected files must report missing
    writeFileSync(join(tempDir, CANONICAL_CONFIG_NAME), JSON.stringify({ version: 1 }))
    const state = inspectConfigState(tempDir)

    expect(state.clean).toBe(false)
    expect(state.observed.driftCount).toBe(4)
    expect(state.files.every((f) => f.status === 'missing')).toBe(true)

    // 2. Write one file with modified content
    mkdirSync(join(tempDir, '.agentflow'), { recursive: true })
    writeFileSync(join(tempDir, '.agentflow', 'harness-parameters.json'), '{"modified": true}\n')

    const updatedState = inspectConfigState(tempDir)
    const harnessStatus = updatedState.files.find(
      (f) => f.path === '.agentflow/harness-parameters.json',
    )
    expect(harnessStatus.status).toBe('modified')
    expect(harnessStatus.observedDigest).not.toBe(harnessStatus.desiredDigest)
  })

  it('P5-C7: applyProjections writes all projected files with confirmation digest and reaches clean state', () => {
    writeFileSync(
      join(tempDir, CANONICAL_CONFIG_NAME),
      JSON.stringify({
        version: 1,
        orchestration: { lifecycle: 'dual-gate' },
        harness: { limits: { envelopeByteCapKb: 64 } },
      }),
    )

    const stateBefore = inspectConfigState(tempDir)
    expect(stateBefore.clean).toBe(false)

    // Apply with confirmation
    const applied = applyProjections(tempDir, {
      confirm: stateBefore.desired.planDigest,
      plan: stateBefore,
    })
    expect(applied.ok).toBe(true)
    expect(applied.status).toBe('applied')
    expect(applied.writtenFiles.length).toBeGreaterThan(0)

    // State after must be clean
    const stateAfter = inspectConfigState(tempDir)
    expect(stateAfter.clean).toBe(true)
    expect(stateAfter.observed.driftCount).toBe(0)
    expect(stateAfter.files.every((f) => f.status === 'matched')).toBe(true)
  })

  it('P5-C8: consolidateAuthority migrates legacy dual configs into agentflow.config.json', () => {
    writeFileSync(
      join(tempDir, 'sdlc.config.json'),
      JSON.stringify({ version: 1, authority: { human: 'sdlc.md', machine: 'sdlc.config.json' } }),
    )
    writeFileSync(
      join(tempDir, 'agent-workflow.config.json'),
      JSON.stringify({ ciCommands: ['pnpm test'], branching: { trunk: 'main' } }),
    )

    // Plan consolidation
    const plan = planAuthorityConsolidation(tempDir)
    expect(plan.changed).toBe(true)
    expect(plan.targetPath).toBe(join(tempDir, CANONICAL_CONFIG_NAME))
    expect(plan.after.authority.human).toBe('sdlc.md')
    expect(plan.after.ciCommands).toEqual(['pnpm test'])

    // Apply consolidation
    const receipt = applyAuthorityConsolidation(tempDir, plan, { confirm: plan.token })
    expect(receipt.status).toBe('applied')
    expect(existsSync(join(tempDir, CANONICAL_CONFIG_NAME))).toBe(true)

    // Next inspection loads as unified
    const loaded = loadAuthoritativeConfigs(tempDir)
    expect(loaded.isUnified).toBe(true)
    expect(loaded.unified.ciCommands).toEqual(['pnpm test'])

    // Repeated plan shows unchanged
    const planAfter = planAuthorityConsolidation(tempDir)
    expect(planAfter.changed).toBe(false)
  })

  it('CLI command integration: agentflow-sdlc project and config subcommands', () => {
    // 1. project status in packageRoot
    const resProject = runCli(['project', '--json'])
    expect(resProject.status).toBe(0)
    const projectData = JSON.parse(resProject.stdout)
    expect(projectData.clean).toBe(true)

    // 2. config validate
    const resValidate = runCli(['config', 'validate', '--projections', '--json'])
    expect(resValidate.status).toBe(0)
    const validateData = JSON.parse(resValidate.stdout)
    expect(validateData.ok).toBe(true)

    // 3. config consolidate preview
    const resConsolidate = runCli(['config', 'consolidate', '--target', tempDir, '--json'])
    expect(resConsolidate.status).toBe(0)
    const consolidateData = JSON.parse(resConsolidate.stdout)
    expect(consolidateData.token).toBeDefined()
  })
})
