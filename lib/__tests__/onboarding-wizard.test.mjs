import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { runOnboardingWizard } from '../onboarding/wizard.mjs'
import { createLocalOnboardingService } from '../onboarding/project-writer.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cliPath = resolve(packageRoot, 'bin/cli.mjs')

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

function createAskQueue(answers) {
  const queue = [...answers]
  return async () => queue.shift() ?? ''
}

describe('Onboarding Wizard Stepper (P4-C1 to P4-C4)', () => {
  let tempDir

  beforeEach(() => {
    tempDir = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-wizard-test-'))
  })

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('P4-C1: interactive TTY stepper steps through prompts and applies on confirmation', async () => {
    const output = new PassThrough()
    let stdoutText = ''
    output.on('data', (chunk) => {
      stdoutText += chunk.toString()
    })

    // Sequential prompt answers:
    // 1. targetDir -> tempDir
    // 2. profile -> 1 (standard)
    // 3. harness -> y
    // 4. confirmation -> y
    const ask = createAskQueue([tempDir, '1', 'y', 'y'])

    const result = await runOnboardingWizard({
      targetDir: tempDir,
      io: { output, ask, interactive: true },
      options: {},
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('applied')
    expect(result.receipt).toBeDefined()
    expect(existsSync(join(tempDir, 'AGENTS.md'))).toBe(true)
    expect(stdoutText).toContain('AgentFlow SDLC Onboarding Wizard')
    expect(stdoutText).toContain('Environment Readiness Probe')
    expect(stdoutText).toContain('Scaffolding Plan Preview')
    expect(stdoutText).toContain('AgentFlow successfully initialized')
  })

  it('P4-C2: stepper aborts cleanly on "n" at confirmation without mutating files', async () => {
    const output = new PassThrough()
    let stdoutText = ''
    output.on('data', (chunk) => {
      stdoutText += chunk.toString()
    })

    // Sequential prompt answers:
    // 1. targetDir -> tempDir
    // 2. profile -> 1 (standard)
    // 3. harness -> y
    // 4. confirmation -> n (decline)
    const ask = createAskQueue([tempDir, '1', 'y', 'n'])

    const result = await runOnboardingWizard({
      targetDir: tempDir,
      io: { output, ask, interactive: true },
      options: {},
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('cancelled')
    expect(existsSync(join(tempDir, 'AGENTS.md'))).toBe(false)
    expect(stdoutText).toContain('Onboarding cancelled. No files were written.')
  })

  it('P4-C3: non-interactive mode with --yes runs end-to-end without waiting on stdin', async () => {
    const output = new PassThrough()
    let stdoutText = ''
    output.on('data', (chunk) => {
      stdoutText += chunk.toString()
    })

    const result = await runOnboardingWizard({
      targetDir: tempDir,
      io: { output },
      options: { yes: true, profile: 'minimal' },
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('applied')
    expect(existsSync(join(tempDir, 'AGENTS.md'))).toBe(true)
    expect(stdoutText).toContain('Selected profile: minimal')
    expect(stdoutText).toContain('AgentFlow successfully initialized')
  })

  it('P4-C4: missing required tool prompts user and aborts cleanly when declined', async () => {
    const output = new PassThrough()
    let stdoutText = ''
    output.on('data', (chunk) => {
      stdoutText += chunk.toString()
    })

    const result = await runOnboardingWizard({
      targetDir: tempDir,
      io: { output, interactive: false },
      options: { yes: false },
    })

    expect(result).toBeDefined()
    expect(result.ok).toBe(false)
    expect(result.status).toBe('unconfirmed')
  })

  it('CLI command integration: agentflow-sdlc onboarding wizard --yes applies adoption', () => {
    const res = runCli([
      'onboarding',
      'wizard',
      '--target',
      tempDir,
      '--profile',
      'standard',
      '--yes',
    ])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('AgentFlow successfully initialized')
    expect(existsSync(join(tempDir, 'AGENTS.md'))).toBe(true)
  })

  it('CLI command alias: agentflow-sdlc wizard --yes applies adoption', () => {
    const res = runCli(['wizard', '--target', tempDir, '--profile', 'minimal', '--yes'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('AgentFlow successfully initialized')
    expect(existsSync(join(tempDir, 'AGENTS.md'))).toBe(true)
  })
})
