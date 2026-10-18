import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assumptionNotes, detectTestCommand, planProjectAdoption, runInit } from '../init.mjs'
import { rollbackAdoption } from '../adoption/transaction.mjs'
import { createOnboardingService } from '../application/onboarding-service.mjs'
import { buildReadinessReport } from '../onboarding/readiness-report.mjs'
import { checkPostureCapability } from '../posture-check.mjs'

// W6b — a newcomer's install currently detects nothing about the repository it lands in: the
// shipped execution adapter (agent-workflow.config.json) carries this framework's own NEUTRAL
// defaults (branch "main", no test command, candidate inputs ["src"]) regardless of what the
// adopter's repository actually looks like. `init` fixes that by detecting real facts and, when it
// cannot, saying plainly what it assumed instead of inventing a command that does not exist in the
// adopter's repo — the exact defect that once shipped this repository's own `pnpm test:workflow`
// into a stranger's project.

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const cli = join(packageRoot, 'bin/cli.mjs')

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

describe('init detects instead of interrogating (W6b / D1)', () => {
  it('1. writes the repository default branch, not the NEUTRAL "main" fallback', () => {
    const target = tempGitRepo('agentflow-init-trunk-', { initialBranch: 'trunk' })

    const result = runInit({ packageRoot, targetDir: target })

    expect(result.status).toBe('initialized')
    const adapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(adapter.branching.trunk).toBe('trunk')
    expect(adapter.branching.trunk).not.toBe('main')
    expect(adapter.branching.integration).toBe('trunk')
    expect(adapter.branching.defaultPrTarget).toBe('trunk')
  })

  it('2a. writes the detected scripts.test command from the target package.json', () => {
    const target = tempGitRepo('agentflow-init-testcmd-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { test: 'vitest run --coverage' } }),
    )

    const result = runInit({ packageRoot, targetDir: target })

    const adapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(adapter.ciCommands).toEqual(['vitest run --coverage'])
    expect(result.facts.testCommand.detected).toBe(true)
    expect(result.assumptions.some((note) => /test command/i.test(note))).toBe(false)
  })

  it('2b. writes no command and reports the assumption when no scripts.test exists', () => {
    const target = tempGitRepo('agentflow-init-notestcmd-')
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'demo' }))

    const result = runInit({ packageRoot, targetDir: target })

    const adapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(adapter.ciCommands).toEqual([])
    expect(result.facts.testCommand.detected).toBe(false)
    expect(result.assumptions.some((note) => /test command/i.test(note))).toBe(true)
  })

  it('3. preserves authored configuration even with the legacy force flag', () => {
    const target = tempGitRepo('agentflow-init-noclobber-', { initialBranch: 'trunk' })
    const first = runInit({ packageRoot, targetDir: target })
    expect(first.status).toBe('initialized')

    // Simulate the adopter having hand-edited the adapter after the first init.
    const adapterPath = join(target, 'agent-workflow.config.json')
    const handEdited = { ...JSON.parse(readFileSync(adapterPath, 'utf8')), posture: 'delegated' }
    writeFileSync(adapterPath, JSON.stringify(handEdited, null, 2))

    const second = runInit({ packageRoot, targetDir: target })
    expect(second.status).toBe('initialized')
    const untouched = JSON.parse(readFileSync(adapterPath, 'utf8'))
    expect(untouched.posture).toBe('delegated')

    const forced = runInit({ packageRoot, targetDir: target, force: true })
    expect(forced.status).toBe('initialized')
    const overwritten = JSON.parse(readFileSync(adapterPath, 'utf8'))
    expect(overwritten.posture).toBe('delegated')
  })

  it('4. never invents a command absent from the target repository', () => {
    const target = tempGitRepo('agentflow-init-noinvent-')
    // No package.json at all: this framework's own scripts (e.g. `pnpm test:workflow`) must never
    // leak into a stranger's adapter just because they happen to be this repo's own test commands.
    const result = runInit({ packageRoot, targetDir: target })

    const adapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(adapter.ciCommands).toEqual([])
    for (const command of adapter.ciCommands) {
      expect(command).not.toMatch(/pnpm|test:workflow/)
    }
    expect(result.assumptions.some((note) => /test command/i.test(note))).toBe(true)

    // Also guard the CLI entry point end to end.
    const cliResult = spawnSync(
      process.execPath,
      [cli, 'init', '--target', target, '--force', '--json'],
      { encoding: 'utf8' },
    )
    expect(cliResult.status).toBe(0)
    const parsed = JSON.parse(cliResult.stdout)
    expect(parsed.facts.testCommand.detected).toBe(false)
    const reAdapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(reAdapter.ciCommands).toEqual([])
  })

  it('wires into the CLI and reports assumptions when run without --json', () => {
    const target = tempGitRepo('agentflow-init-cli-')
    const result = spawnSync(process.execPath, [cli, 'init', '--target', target], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/assum/i)
    expect(existsSync(join(target, 'agent-workflow.config.json'))).toBe(true)
  })
})

// W6c — the orchestrator found that `init` wrote AgentFlow's own vendored `lib/` files into the
// adopter's candidate: on a repo containing only `src/`, all 42 files `init` put under `lib/` were
// framework internals listed as managed in agent-framework-lock.json, so every framework upgrade
// would silently invalidate the adopter's evidence. D1 fixes this using the lockfile — the source of
// truth for what AgentFlow owns — instead of a hardcoded directory-name list. D2 seeds a first
// governed run's contract and check from exactly what was detected, and never invents either.
describe('candidate inputs exclude framework-managed paths, and governance is never invented (W6c / D1, D2)', () => {
  it('2. on a repo with only src/, candidate inputs contain src and not lib', () => {
    const target = tempGitRepo('agentflow-init-candidate-src-')
    mkdirSync(join(target, 'src'))
    writeFileSync(join(target, 'src/index.js'), 'module.exports = 1\n')

    const result = runInit({ packageRoot, targetDir: target })

    expect(result.status).toBe('initialized')
    expect(result.facts.candidateInputs.detected).toBe(true)
    expect(result.facts.candidateInputs.value.some((path) => path.startsWith('src/'))).toBe(true)
    expect(result.facts.candidateInputs.value.some((path) => path.startsWith('lib/'))).toBe(false)
    const adapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(adapter.delivery.candidate.inputs).toEqual(result.facts.candidateInputs.value)
  })

  it('3. never puts a lockfile-managed path into candidate inputs, even in a directory the adopter also owns', () => {
    const target = tempGitRepo('agentflow-init-candidate-mixed-')
    // AgentFlow's own composition profile vendors many of its own files under lib/; this adopter
    // also keeps a file of their own in that same directory. Only the adopter's file may survive.
    mkdirSync(join(target, 'lib'))
    writeFileSync(join(target, 'lib/adopter-owned.js'), 'module.exports = 2\n')

    const result = runInit({ packageRoot, targetDir: target })

    expect(result.status).toBe('initialized')
    const lock = JSON.parse(readFileSync(join(target, 'agent-framework-lock.json'), 'utf8'))
    const managed = new Set(lock.entries.filter((entry) => entry.hash).map((entry) => entry.target))
    expect(managed.size).toBeGreaterThan(0)
    for (const path of result.facts.candidateInputs.value) expect(managed.has(path)).toBe(false)
    expect(result.facts.candidateInputs.value).toContain('lib/adopter-owned.js')
  })

  it('4. seeds no starter check or acceptance contract, and invents no command, without a detected test command', () => {
    const target = tempGitRepo('agentflow-init-no-governance-')
    mkdirSync(join(target, 'src'))
    writeFileSync(join(target, 'src/index.js'), 'module.exports = 1\n')
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'demo' }))

    const result = runInit({ packageRoot, targetDir: target })

    expect(result.facts.testCommand.detected).toBe(false)
    expect(result.governed).toBe(false)
    expect(result.acceptancePath).toBeNull()
    expect(existsSync(join(target, 'agentflow-acceptance.json'))).toBe(false)
    const adapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(adapter.delivery.checks).toBeUndefined()
    expect(adapter.delivery.contracts).toBeUndefined()
    expect(result.assumptions.some((note) => /governed run/i.test(note))).toBe(true)
  })

  it('seeds a starter check and acceptance contract wired to the detected test command when both are detected', () => {
    const target = tempGitRepo('agentflow-init-governance-')
    mkdirSync(join(target, 'src'))
    writeFileSync(join(target, 'src/index.js'), 'module.exports = 1\n')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }),
    )

    const result = runInit({ packageRoot, targetDir: target })

    expect(result.governed).toBe(true)
    const adapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(adapter.delivery.checks.starter.executable).toBe('npm')
    expect(adapter.delivery.checks.starter.args).toEqual(['test'])
    expect(adapter.delivery.contracts['product-manager']).toBe('agentflow-acceptance.json')
    const acceptance = JSON.parse(readFileSync(join(target, 'agentflow-acceptance.json'), 'utf8'))
    expect(acceptance.criteria).toHaveLength(1)
    expect(acceptance.criteria[0].definitionDigest).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('starter check inherits only the toolchain environment it needs', () => {
  it('records the names of version-manager and profile variables, never unrelated ones', async () => {
    const { toolchainEnvironmentNames } = await import('../init.mjs')
    const names = toolchainEnvironmentNames({
      PATH: '/bin',
      MISE_GLOBAL_CONFIG_FILE: '/x/mise.toml',
      USERPROFILE: 'C:/Users/u',
      SECRET_TOKEN: 'do-not-inherit',
      GITHUB_TOKEN: 'do-not-inherit',
    })
    expect(names).toEqual(['MISE_GLOBAL_CONFIG_FILE', 'USERPROFILE'])
  })

  it('records nothing when no toolchain variables are present', async () => {
    const { toolchainEnvironmentNames } = await import('../init.mjs')
    expect(toolchainEnvironmentNames({ PATH: '/bin', SECRET_TOKEN: 'x' })).toEqual([])
  })
})

describe('linked-project adoption (issue 533 slice B)', () => {
  it('previews generated harness files, refreshes a stale adapter, and undo restores prior bytes', () => {
    const target = tempGitRepo('agentflow-init-harness-')
    const first = runInit({ packageRoot, targetDir: target })
    expect(first.status).toBe('initialized')
    const preview = planProjectAdoption(packageRoot, target)
    const harnessWrites = preview.actions.filter(
      (item) =>
        (item.target.startsWith('.claude/commands/') ||
          item.target.startsWith('.pi/commands/') ||
          item.target.startsWith('.agentflow/roles/') ||
          item.target.endsWith('agentflow-sdlc.plugin.json') ||
          item.target.endsWith('settings.json') ||
          item.target === '.codex/hooks.json') &&
        ['create', 'update', 'unchanged'].includes(item.action),
    )
    expect(harnessWrites.length).toBeGreaterThan(0)
    expect(harnessWrites.every((item) => item.action === 'unchanged')).toBe(true)

    const stalePath = join(target, '.claude/commands/role-developer.md')
    expect(existsSync(stalePath)).toBe(true)
    const prior = readFileSync(stalePath)
    writeFileSync(stalePath, `${prior.toString('utf8')}\n<!-- stale -->\n`)
    const staleBytes = readFileSync(stalePath)
    const stalePlan = planProjectAdoption(packageRoot, target)
    const stale = stalePlan.actions.find(
      (item) => item.target === '.claude/commands/role-developer.md',
    )
    expect(stale.action).toBe('update')
    expect(stale.ownership).toBe('project')
    expect(stale.beforeHash).toBeTruthy()
    expect(stale.contentBase64).toBeTruthy()

    const service = createOnboardingService({
      inspect: () => ({
        lock: { format: 'v2' },
        classification: 'adopted',
        diagnostics: [],
        pendingJournal: null,
      }),
      planProject: planProjectAdoption,
      applyProject: () => ({}),
      recoverProject: () => ({}),
      assessRuntime: () => ({ runtimeReady: true }),
    })
    const readiness = buildReadinessReport({
      stage: 'verify',
      targetDir: target,
      projectPlan: stalePlan,
      inventory: { lock: { format: 'v2' }, classification: 'current', pendingJournal: null },
    })
    expect(readiness.project.installed).toBe(false)
    expect(readiness.blockers.some((item) => item.id === 'not-installed')).toBe(true)
    const verify = service.verify({
      packageRoot,
      targetDir: target,
      journey: 'adoption',
      stage: 'verify',
    })
    expect(verify.projectReady).toBe(false)

    const refreshed = runInit({ packageRoot, targetDir: target })
    const receipt = JSON.parse(readFileSync(join(target, refreshed.receiptPath), 'utf8'))
    expect(readFileSync(stalePath).equals(Buffer.from(stale.contentBase64, 'base64'))).toBe(true)
    rollbackAdoption(target, receipt, { confirm: receipt.receiptToken })
    expect(readFileSync(stalePath).equals(staleBytes)).toBe(true)
  })

  it('seeds Rust tooling dependencies and imports managed entry points without OpenTelemetry', async () => {
    const target = tempGitRepo('agentflow-init-rust-')
    writeFileSync(join(target, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n')
    mkdirSync(join(target, 'src'))
    writeFileSync(join(target, 'src/lib.rs'), 'pub fn demo() {}\n')
    const result = runInit({ packageRoot, targetDir: target })
    expect(result.status).toBe('initialized')
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({ ajv: '8.20.0', yaml: '2.9.1' })
    const lock = readFileSync(join(target, 'pnpm-lock.yaml'), 'utf8')
    expect(lock).toContain('ajv@8.20.0:')
    expect(lock).toContain('yaml@2.9.1:')
    expect(lock).toContain('fast-deep-equal@3.1.3:')
    mkdirSync(join(target, 'node_modules'))
    const ajvDir = realpathSync(join(packageRoot, 'node_modules/ajv'))
    const yamlDir = realpathSync(join(packageRoot, 'node_modules/yaml'))
    const ajvPnpmNodeModules = resolve(ajvDir, '..')
    for (const pkg of [
      'ajv',
      'fast-deep-equal',
      'fast-uri',
      'json-schema-traverse',
      'require-from-string',
    ]) {
      cpSync(join(ajvPnpmNodeModules, pkg), join(target, 'node_modules', pkg), {
        recursive: true,
        dereference: true,
      })
    }
    cpSync(yamlDir, join(target, 'node_modules/yaml'), {
      recursive: true,
      dereference: true,
    })
    const adopted = JSON.parse(readFileSync(join(target, 'agent-framework-lock.json'), 'utf8'))
    const modules = (adopted.entries ?? [])
      .map((entry) => entry.target)
      .filter((file) => typeof file === 'string' && file.endsWith('.mjs'))
    const libModules = modules.filter((file) => file.startsWith('lib/'))
    expect(libModules).toContain('lib/observability/otel.mjs')
    expect(libModules).toContain('lib/config/distribution-cli.mjs')
    expect(libModules).toContain('lib/verification/oracle-package-resolver.mjs')
    for (const file of libModules) {
      await import(join(target, file))
    }
    const bare = []
    for (const file of modules) {
      const source = readFileSync(join(target, file), 'utf8')
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = match[1]
        if (spec.startsWith('.') || spec.startsWith('node:')) continue
        bare.push(`${file} -> ${spec}`)
      }
    }
    expect(
      bare.filter((item) => {
        const spec = item.split(' -> ')[1]
        return (
          spec !== 'ajv' && spec !== 'yaml' && !spec.startsWith('ajv/') && !spec.startsWith('yaml/')
        )
      }),
    ).toEqual([])
  })

  it('reports unsupported Rust test and CI discovery instead of proven absence', () => {
    const target = tempGitRepo('agentflow-init-rust-tests-')
    writeFileSync(join(target, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n')
    const missing = detectTestCommand(target)
    expect(missing.status).toBe('unsupported')
    expect(missing.detected).toBe(false)
    const notes = assumptionNotes({
      branch: { detected: true },
      testCommand: missing,
      candidateInputs: { detected: false, reason: 'none' },
    })
    expect(notes.some((note) => note.includes('not proven absent'))).toBe(true)
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'demo', private: true }))
    expect(detectTestCommand(target).status).toBe('unsupported')
    writeFileSync(join(target, 'package.json'), '{ invalid json')
    expect(detectTestCommand(target).status).toBe('unsupported')
    const warnings = checkPostureCapability({ root: target }).warnings
    const testWarning = warnings.find((item) => item.code === 'posture-check.no-tests')
    const ciWarning = warnings.find((item) => item.code === 'posture-check.no-ci')
    expect(testWarning.status).toBe('unsupported')
    expect(testWarning.message).toContain('not proven absent')
    expect(ciWarning.status).toBe('unsupported')
    expect(ciWarning.message).toContain('not proven absent')
    const absent = checkPostureCapability({ root: tempGitRepo('agentflow-init-notests-') })
    const absentWarning = absent.warnings.find((item) => item.code === 'posture-check.no-tests')
    const absentCiWarning = absent.warnings.find((item) => item.code === 'posture-check.no-ci')
    expect(absentWarning.status).toBeUndefined()
    expect(absentWarning.message).toContain('no test suite was found')
    expect(absentCiWarning.status).toBeUndefined()
    expect(absentCiWarning.message).toContain('no CI workflow was found')
  })
})
