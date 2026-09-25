import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { formatOnboardingPrompt } from '../onboarding/prompt.mjs'
import { runInit } from '../init.mjs'

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

describe('Onboarding S7 CLI and Prompt Integration', () => {
  let tempDir

  beforeEach(() => {
    tempDir = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-onboarding-e2e-'))
  })

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('handles fresh onboarding plan and apply lifecycle, then remains unchanged', () => {
    const reqRes = runCli(['onboarding', 'runtime-request'])
    expect(reqRes.status).toBe(0)
    const runtimeRequest = JSON.parse(reqRes.stdout)
    expect(runtimeRequest.schemaVersion).toBe(1)
    expect(runtimeRequest.runtimeId).toBe('current')
    expect(runtimeRequest.requiredCapabilities.length).toBe(2)

    const planRes = runCli(['onboarding', 'plan', '--target', tempDir, '--profile', 'standard'])
    expect(planRes.status).toBe(0)
    const plan = JSON.parse(planRes.stdout)
    expect(plan.operation).toBe('onboarding')
    expect(plan.readyToApply).toBe(true)
    expect(plan.digest).toBeDefined()
    expect(plan.changes.length).toBeGreaterThan(0)

    const planFilePath = join(tempDir, 'saved-plan.json')
    writeFileSync(planFilePath, JSON.stringify(plan, null, 2))

    const applyRes = runCli([
      'onboarding',
      'apply',
      '--target',
      tempDir,
      '--plan',
      planFilePath,
      '--confirm',
      plan.digest,
    ])
    expect(applyRes.status).toBe(0)
    const receipt = JSON.parse(applyRes.stdout)
    expect(receipt.changed.length).toBeGreaterThan(0)
    expect(existsSync(join(tempDir, 'agent-framework-lock.json'))).toBe(true)
    expect(existsSync(join(tempDir, 'AGENTS.md'))).toBe(true)

    const verifyRes = runCli(['onboarding', 'verify', '--target', tempDir, '--profile', 'standard'])
    expect(verifyRes.status).toBe(0)
    const verifyReport = JSON.parse(verifyRes.stdout)
    expect(verifyReport.projectReady).toBe(true)
    expect(verifyReport.governedChangeReady).toBe(false)

    const repeatPlanRes = runCli([
      'onboarding',
      'plan',
      '--target',
      tempDir,
      '--profile',
      'standard',
    ])
    expect(repeatPlanRes.status).toBe(0)
    const repeatPlan = JSON.parse(repeatPlanRes.stdout)
    const mutatingActions = repeatPlan.changes.filter((a) =>
      ['create', 'update', 'seed'].includes(a.action),
    )
    expect(mutatingActions.length).toBe(0)
  })

  it('carries matching runtime observations through the public plan/apply/verify commands', () => {
    const request = JSON.parse(
      runCli(['onboarding', 'runtime-request', '--runtime', 'synthetic']).stdout,
    )
    const requestPath = join(tempDir, 'runtime-request.json')
    const evidencePath = join(tempDir, 'runtime-evidence.json')
    writeFileSync(requestPath, JSON.stringify(request))
    writeFileSync(
      evidencePath,
      JSON.stringify({
        schemaVersion: 1,
        requestId: request.requestId,
        runtimeId: request.runtimeId,
        components: ['agentflow-cli', 'agentflow-skills'].map((id) => ({
          id,
          presence: 'available',
          compatibility: 'compatible',
          operationOutcome: 'not-requested',
          updateDisposition: 'unknown',
          evidence: 'observed',
          provenance: 'synthetic test fixture',
          ...(id === 'agentflow-skills' ? { hostDiscovered: true } : {}),
        })),
      }),
    )
    const flags = [
      '--target',
      tempDir,
      '--profile',
      'minimal',
      '--runtime-request',
      requestPath,
      '--runtime-evidence',
      evidencePath,
    ]
    const preview = runCli(['onboarding', 'plan', ...flags])
    expect(preview.status, preview.stderr).toBe(0)
    const plan = JSON.parse(preview.stdout)
    const planPath = join(tempDir, 'plan.json')
    writeFileSync(planPath, JSON.stringify(plan))
    const applied = runCli([
      'onboarding',
      'apply',
      ...flags,
      '--plan',
      planPath,
      '--confirm',
      plan.digest,
    ])
    expect(applied.status, applied.stderr).toBe(0)
    const verified = runCli(['onboarding', 'verify', ...flags])
    expect(verified.status, verified.stderr).toBe(0)
    expect(JSON.parse(verified.stdout)).toMatchObject({
      projectReady: true,
      runtimeReady: true,
      governedChangeReady: false,
    })
  })

  it('preserves existing project configuration and completes missing assets', () => {
    const customConfig = {
      version: 1,
      posture: 'delegated',
      branching: {
        trunk: 'development',
        integration: 'development',
      },
      customUserSetting: true,
    }
    const configPath = join(tempDir, 'agent-workflow.config.json')
    writeFileSync(configPath, JSON.stringify(customConfig, null, 2))

    const initResult = runInit({
      packageRoot,
      targetDir: tempDir,
      force: true,
      scaffoldHarness: false,
    })
    expect(initResult.status).toBe('initialized')
    expect(initResult.syncedAdapters).toBeNull()
    expect(initResult.skillInstruction).toBeDefined()

    const afterConfig = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(afterConfig.posture).toBe('delegated')
    expect(afterConfig.customUserSetting).toBe(true)
    expect(existsSync(join(tempDir, 'agent-framework-lock.json'))).toBe(true)
    expect(existsSync(join(tempDir, 'AGENTS.md'))).toBe(true)
  })

  it('rejects tampered token and post-plan inventory drift', () => {
    const planRes = runCli(['onboarding', 'plan', '--target', tempDir, '--profile', 'standard'])
    expect(planRes.status).toBe(0)
    const plan = JSON.parse(planRes.stdout)
    const planFilePath = join(tempDir, 'tamper-plan.json')
    writeFileSync(planFilePath, JSON.stringify(plan, null, 2))

    const badConfirmRes = runCli([
      'onboarding',
      'apply',
      '--target',
      tempDir,
      '--plan',
      planFilePath,
      '--confirm',
      'tampered-token-digest',
    ])
    expect(badConfirmRes.status).not.toBe(0)
    expect(badConfirmRes.stderr).toContain('Confirmation token mismatch')

    writeFileSync(join(tempDir, 'AGENTS.md'), 'authored policy added after preview')
    const driftRes = runCli([
      'onboarding',
      'apply',
      '--target',
      tempDir,
      '--plan',
      planFilePath,
      '--confirm',
      plan.digest,
    ])
    expect(driftRes.status).not.toBe(0)
  })

  it('formats generic onboarding prompt without npm global, npx, or automatic config sync', () => {
    const prompt = formatOnboardingPrompt(tempDir)
    expect(prompt).not.toContain('npm install -g')
    expect(prompt).not.toContain('npm -g')
    expect(prompt).not.toContain('npx')
    expect(prompt).not.toContain('config sync')
    expect(prompt).not.toContain('.claude/skills')
    expect(prompt).not.toContain('.codex')

    expect(prompt).toContain('runtime discovers and provisions tool paths using its own mechanisms')
    expect(prompt).toContain('current runtime')
    expect(prompt).toContain('extra runtimes')
    expect(prompt).toContain('Always assess updates')
    expect(prompt).toContain('updating shared tools is a separate decision')
    expect(prompt).toContain('Unknown outcomes must be reconciled')
  })
})
