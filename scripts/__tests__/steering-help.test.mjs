import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20000 })
}

it('public liveness help succeeds without evaluating a missing result', () => {
  const result = runCli(['steer', 'liveness', '--help'])
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('Usage:')
  expect(result.stderr).not.toContain('ReferenceError')
})

it('steer setup --help succeeds without inspecting project state', () => {
  const result = runCli(['steer', 'setup', '--help'])
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('Usage: agentflow-sdlc steer setup')
  expect(result.stdout).toContain('--inspect')
  expect(result.stdout).toContain('--plan')
  expect(result.stdout).toContain('--apply')
  expect(result.stderr).not.toContain('ReferenceError')
})

it('steer setup --inspect --json reports the confirmed repository agreement', () => {
  const result = runCli(['steer', 'setup', '--inspect', '--json'])
  expect(result.status).toBe(0)
  expect(result.stderr).not.toContain('ReferenceError')
  const report = JSON.parse(result.stdout)
  expect(report.ok).toBe(true)
  expect(report.status).toBe('confirmed')
  expect(report.alreadyConfirmed).toBe(true)
  expect(report.reusedConfirmedAgreement).toBe(true)
  expect(report.agreement.goalScope).toBeTruthy()
  expect(report.agreement.steeringOwner).toBe('steer.lead')
  expect(report.agreement.executionDistribution.steerLeadRoute.default).toBeTruthy()
  expect(report.agreement.executionDistribution.steerLeadRoute.fallbacks).toHaveLength(2)
  expect(report.enforcementLimits.conversationalConfirmationGrantsAuthority).toBe(false)
  expect(report.enforcementLimits.bypassesSteeringBinding).toBe(false)
  expect(report.enforcementLimits.bypassesMergeReadiness).toBe(false)
  expect(report.enforcementLimits.fabricatesHostAuthentication).toBe(false)
  expect(report.enforcementLimits.grantsPublicationOrMergePower).toBe(false)
})
