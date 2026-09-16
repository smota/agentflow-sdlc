import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
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

  it('3. does not overwrite an existing adapter without an explicit flag', () => {
    const target = tempGitRepo('agentflow-init-noclobber-', { initialBranch: 'trunk' })
    const first = runInit({ packageRoot, targetDir: target })
    expect(first.status).toBe('initialized')

    // Simulate the adopter having hand-edited the adapter after the first init.
    const adapterPath = join(target, 'agent-workflow.config.json')
    const handEdited = { ...JSON.parse(readFileSync(adapterPath, 'utf8')), posture: 'delegated' }
    writeFileSync(adapterPath, JSON.stringify(handEdited, null, 2))

    const second = runInit({ packageRoot, targetDir: target })
    expect(second.status).toBe('skipped')
    const untouched = JSON.parse(readFileSync(adapterPath, 'utf8'))
    expect(untouched.posture).toBe('delegated')

    const forced = runInit({ packageRoot, targetDir: target, force: true })
    expect(forced.status).toBe('initialized')
    const overwritten = JSON.parse(readFileSync(adapterPath, 'utf8'))
    expect(overwritten.posture).not.toBe('delegated')
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
