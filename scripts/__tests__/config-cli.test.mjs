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

describe('CLI config commands (bin/cli.mjs config)', () => {
  it('runs `config doctor` and `config doctor --json` reporting healthy status', () => {
    const target = tempGitRepo('cli-config-doc-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo-cli', scripts: { test: 'node --test' } }),
    )
    mkdirSync(join(target, 'src'), { recursive: true })
    writeFileSync(join(target, 'src/index.js'), 'export const val = 42;\n')

    // Initialize with init
    const initRun = spawnSync(process.execPath, [cli, 'init', '--target', target], {
      encoding: 'utf8',
    })
    expect(initRun.status).toBe(0)

    // Run config doctor (text)
    const doctorRun = spawnSync(process.execPath, [cli, 'config', 'doctor', '--target', target], {
      encoding: 'utf8',
    })
    expect(doctorRun.status).toBe(0)
    expect(doctorRun.stdout).toContain('AgentFlow project configuration doctor (READY)')
    expect(doctorRun.stdout).toContain('Passed checks')

    // Run config doctor (--json)
    const jsonRun = spawnSync(
      process.execPath,
      [cli, 'config', 'doctor', '--target', target, '--json'],
      { encoding: 'utf8' },
    )
    expect(jsonRun.status).toBe(0)
    const parsed = JSON.parse(jsonRun.stdout)
    expect(parsed.ok).toBe(true)
    expect(parsed.checks.authority.ok).toBe(true)
    expect(parsed.checks.workflow.ok).toBe(true)
  })

  it('runs `config sync --dry-run` and `config sync --apply`', () => {
    const target = tempGitRepo('cli-config-sync-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo-sync', scripts: { test: 'node --test' } }),
    )
    spawnSync(process.execPath, [cli, 'init', '--target', target], { encoding: 'utf8' })

    // Dry run
    const dryRun = spawnSync(
      process.execPath,
      [cli, 'config', 'sync', '--dry-run', '--target', target],
      { encoding: 'utf8' },
    )
    expect(dryRun.status).toBe(0)
    expect(dryRun.stdout).toContain('PREVIEW ONLY')

    // Apply
    const applyRun = spawnSync(
      process.execPath,
      [cli, 'config', 'sync', '--apply', '--target', target],
      { encoding: 'utf8' },
    )
    expect(applyRun.status).toBe(0)
    expect(applyRun.stdout).toContain('ALL ADAPTERS IN SYNC')
  })

  it('runs `config inspect` and outputs JSON configuration', () => {
    const target = tempGitRepo('cli-config-inspect-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo-inspect', scripts: { test: 'node --test' } }),
    )
    spawnSync(process.execPath, [cli, 'init', '--target', target, '--posture', 'delegated'], {
      encoding: 'utf8',
    })

    const inspectRun = spawnSync(process.execPath, [cli, 'config', 'inspect', '--target', target], {
      encoding: 'utf8',
    })
    expect(inspectRun.status).toBe(0)
    const config = JSON.parse(inspectRun.stdout)
    expect(config.posture.configured).toBe('delegated')
    expect(config.harnessIntelligence.configuredCount).toBe(4)
  })

  it('runs `config prompt` and outputs continuous configuration playbook instructions', () => {
    const promptRun = spawnSync(
      process.execPath,
      [cli, 'config', 'prompt', '--target', '/custom/path'],
      { encoding: 'utf8' },
    )
    expect(promptRun.status).toBe(0)
    expect(promptRun.stdout).toContain('assisted configuration collaborator')
    expect(promptRun.stdout.toLowerCase()).toContain('custom')
  })

  it('runs `init` with `--posture autonomous` and `--sync`', () => {
    const target = tempGitRepo('cli-init-options-')
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'demo-opt', scripts: { test: 'node --test' } }),
    )
    mkdirSync(join(target, 'src'), { recursive: true })
    writeFileSync(join(target, 'src/index.js'), 'export const val = 1;\n')

    const initRun = spawnSync(
      process.execPath,
      [cli, 'init', '--posture', 'autonomous', '--sync', '--target', target],
      { encoding: 'utf8' },
    )
    expect(initRun.status).toBe(0)
    expect(initRun.stdout).toContain('posture: autonomous')
    expect(initRun.stdout).not.toContain('synced adapters:')
    expect(existsSync(join(target, '.agents/skills'))).toBe(false)

    const adapter = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(adapter.posture).toBe('autonomous')
  })
})
