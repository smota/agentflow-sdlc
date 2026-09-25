import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInit } from '../init.mjs'
import { planAdoption, applyAdoption } from '../adoption/transaction.mjs'
import { scaffoldHarnessIntelligence } from '../config/harness-intelligence.mjs'
import { runConfigDoctor } from '../config/doctor.mjs'
import { runConfigSync } from '../config/sync.mjs'
import { inspectEffectiveConfig } from '../config/inspect.mjs'
import { formatContinuousConfigPrompt } from '../config/prompt.mjs'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

const roots = []
function tempGitRepo(prefix, { initialBranch = 'main' } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix))
  roots.push(root)
  execFileSync('git', ['init', `--initial-branch=${initialBranch}`], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'agentflow-test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'AgentFlow Test'], { cwd: root })
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Configuration Suite: runInit enhancements', () => {
  it('scaffolds harness intelligence by default and accepts custom posture', () => {
    const target = tempGitRepo('config-init-harness-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo-harness', scripts: { test: 'node --test' } }),
    )
    mkdirSync(join(target, 'src'), { recursive: true })
    writeFileSync(join(target, 'src/index.js'), 'export const hello = 1;\n')

    const result = runInit({
      packageRoot,
      targetDir: target,
      posture: 'delegated',
      scaffoldHarness: true,
      syncAdapters: false,
    })

    expect(result.status).toBe('initialized')
    expect(result.posture).toBe('delegated')
    expect(result.harnessIntelligence).toBeDefined()
    expect(result.harnessIntelligence.created.length).toBe(4)

    const adapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(adapter.posture).toBe('delegated')

    // Check .agentflow files exist
    expect(existsSync(join(target, '.agentflow/orchestration-model.json'))).toBe(true)
    expect(existsSync(join(target, '.agentflow/execution-policy.json'))).toBe(true)
    expect(existsSync(join(target, '.agentflow/model-catalog.json'))).toBe(true)
    expect(existsSync(join(target, '.agentflow/harness-parameters.json'))).toBe(true)
  })

  it('allows disabling harness scaffolding with scaffoldHarness: false', () => {
    const target = tempGitRepo('config-init-no-harness-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo-no-harness', scripts: { test: 'node --test' } }),
    )

    const result = runInit({
      packageRoot,
      targetDir: target,
      scaffoldHarness: false,
    })

    expect(result.status).toBe('initialized')
    expect(result.harnessIntelligence).toBeNull()
    expect(existsSync(join(target, '.agentflow/orchestration-model.json'))).toBe(false)
  })
})

describe('Configuration Suite: runConfigDoctor', () => {
  it('distinguishes reviewed adoption from detected init and reports non-blocking drift', () => {
    const target = tempGitRepo('assisted-adoption-', { initialBranch: 'trunk' })
    const plan = planAdoption(packageRoot, target, { profile: 'standard', storage: 'project' })
    expect(plan.blocked).toBe(false)
    applyAdoption(packageRoot, target, plan, { confirm: plan.token })
    const configPath = join(target, 'agent-workflow.config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(config.branching.trunk).toBe('main')
    expect(config.ciCommands).toEqual([])
    expect(existsSync(join(target, 'agentflow-acceptance.json'))).toBe(false)
    expect(existsSync(join(target, '.agentflow/orchestration-model.json'))).toBe(false)
    const before = runConfigDoctor({ packageRoot, targetDir: target })
    expect(before.blockers).toEqual([])
    expect(before.ok).toBe(true)
    expect(before.warnings.some((w) => w.includes('pillars'))).toBe(true)
    expect(before.warnings.some((w) => w.includes('out of sync'))).toBe(true)
    config.branching.trunk = 'trunk'
    writeFileSync(configPath, JSON.stringify(config))
    scaffoldHarnessIntelligence(target)
    runConfigSync({ packageRoot, targetDir: target, write: true })
    expect(JSON.parse(readFileSync(configPath, 'utf8')).branching.trunk).toBe('trunk')
    expect(
      runConfigDoctor({ packageRoot, targetDir: target }).checks.harnessIntelligence
        .configuredCount,
    ).toBe(4)
    expect(runInit({ packageRoot, targetDir: target }).status).toBe('skipped')
    expect(existsSync(join(target, 'agentflow-acceptance.json'))).toBe(false)
  })
  it('reports blockers when workflow config is missing', () => {
    const target = tempGitRepo('config-doctor-missing-')
    const report = runConfigDoctor({ packageRoot, targetDir: target })

    expect(report.ok).toBe(false)
    expect(report.summary.blockerCount).toBeGreaterThan(0)
    expect(report.checks.workflow.exists).toBe(false)
  })

  it('reports healthy configuration on initialized repository', () => {
    const target = tempGitRepo('config-doctor-healthy-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo-healthy', scripts: { test: 'node --test' } }),
    )
    mkdirSync(join(target, 'src'), { recursive: true })
    writeFileSync(join(target, 'src/index.js'), 'export const a = 1;\n')

    runInit({ packageRoot, targetDir: target, posture: 'assisted' })

    const report = runConfigDoctor({ packageRoot, targetDir: target })
    expect(report.ok).toBe(true)
    expect(report.blockers.length).toBe(0)
    expect(report.summary.passedCount).toBeGreaterThanOrEqual(4)
    expect(report.checks.harnessIntelligence.configuredCount).toBe(4)
  })
})

describe('Configuration Suite: runConfigSync', () => {
  it('previews and applies harness sync across skills, roles, plugins, and settings', () => {
    const target = tempGitRepo('config-sync-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo-sync', scripts: { test: 'node --test' } }),
    )
    mkdirSync(join(target, 'src'), { recursive: true })
    writeFileSync(join(target, 'src/index.js'), 'export const a = 1;\n')

    runInit({ packageRoot, targetDir: target })

    // Dry-run preview
    const preview = runConfigSync({
      packageRoot,
      targetDir: target,
      write: false,
    })
    expect(preview.mode).toBe('preview')
    expect(preview.summary.skillsCount).toBeGreaterThan(0)
    expect(preview.summary.rolesCount).toBeGreaterThan(0)

    // Applied sync
    const applied = runConfigSync({
      packageRoot,
      targetDir: target,
      write: true,
    })
    expect(applied.mode).toBe('applied')
    expect(applied.ok).toBe(true)
  })
})

describe('Configuration Suite: inspectEffectiveConfig and prompt', () => {
  it('inspects composite configuration across domain, workflow, posture, and harness', () => {
    const target = tempGitRepo('config-inspect-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo-inspect', scripts: { test: 'node --test' } }),
    )
    runInit({ packageRoot, targetDir: target, posture: 'assisted' })

    const effective = inspectEffectiveConfig({ targetDir: target })
    expect(effective.targetDir).toBe(target)
    expect(effective.posture.configured).toBe('assisted')
    expect(effective.authority.valid).toBe(true)
    expect(effective.harnessIntelligence.configuredCount).toBe(4)
  })

  it('formats continuous configuration prompt with target directory and 5-phase loop', () => {
    const prompt = formatContinuousConfigPrompt('/test/my-project')
    expect(prompt).toContain(
      'https://github.com/smota/agentflow-sdlc/blob/main/docs/assisted-configuration.md',
    )
    expect(prompt).toContain('/test/my-project')
    expect(prompt).toContain('agentflow-sdlc config doctor --json')
    expect(prompt).toContain('agentflow-sdlc config sync --apply')
  })
})
