#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCockpitConfig, validateCockpitConfig } from '../lib/cockpit-config.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = loadCockpitConfig()
const validation = validateCockpitConfig(config)
const files = [
  'scripts/cockpit-server.mjs',
  'lib/cockpit-ui.mjs',
  'lib/cockpit-read-model.mjs',
  'lib/cockpit-goal-model.mjs',
  'assets/cockpit/agentflow-logo.png',
]
const missingFiles = files.filter((file) => !existsSync(join(packageRoot, file)))
const findings = []
if (missingFiles.length)
  findings.push(
    ...missingFiles.map((file) => ({
      severity: 'blocker',
      code: 'cockpit.file',
      message: `missing ${file}`,
    })),
  )
findings.push(
  ...validation.errors.map((message) => ({ severity: 'blocker', code: 'cockpit.config', message })),
)
findings.push(
  ...validation.warnings.map((message) => ({ severity: 'info', code: 'cockpit.config', message })),
)
if (config.writeActions && (!config.remote || !config.sessionSecret))
  findings.push({
    severity: 'high',
    code: 'cockpit.write-actions',
    message:
      'COCKPIT_WRITE_ACTIONS requires hardened remote auth/session configuration for production use',
  })
const report = {
  ok: findings.every((item) => !['blocker', 'high'].includes(item.severity)),
  enabled: config.enabled,
  mode: config.remote ? 'remote' : 'local',
  readOnly: !config.writeActions,
  chatEnabled: config.chat,
  runnerTelemetry: config.runnerTelemetry,
  repositories: config.repositories,
  port: config.port,
  publicUrl: config.publicUrl,
  findings,
}
if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write('AgentFlow Cockpit doctor\n')
  process.stdout.write(`Mode: ${report.mode}\nRead-only: ${report.readOnly ? 'yes' : 'no'}\n`)
  for (const item of findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${report.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(report.ok ? 0 : 1)
