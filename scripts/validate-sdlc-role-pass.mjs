#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { fieldValue } from '../lib/markdown-sections.mjs'
import { loadSdlcConfig, finding, report } from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const path = args.includes('--path') ? args[args.indexOf('--path') + 1] : ''
if (!path || !existsSync(path)) {
  process.stderr.write('Usage: validate-sdlc-role-pass --path <role-pass.md> [--json]\n')
  process.exit(2)
}
const text = readFileSync(path, 'utf8')
const config = loadSdlcConfig()
const required = [
  'Issue',
  'Branch',
  'Phase',
  'Role',
  'Status',
  'Workflow profile',
  'Planned owner',
  'Actual executor',
  'Launcher',
  'Executor',
  'Transport',
  'Delegation boundary',
  'Context boundary',
  'Model / runtime',
]
const findings = []
for (const label of required)
  if (fieldValue(text, label) === null)
    findings.push(finding('high', 'role-pass.field', `missing ${label}`))
const profile = fieldValue(text, 'Workflow profile')
const role = fieldValue(text, 'Role')
if (profile && !config.paths?.[profile])
  findings.push(finding('high', 'role-pass.profile', `unknown profile ${profile}`))
if (
  profile === 'high-assurance' &&
  /self-review/i.test(fieldValue(text, 'Independence boundary') || '')
)
  findings.push(
    finding(
      'blocker',
      'role-pass.high-assurance.self-review',
      'high-assurance cannot rely on self-review',
    ),
  )
if (role && !config.roles?.some((item) => item.slug === role || item.label === role))
  findings.push(finding('medium', 'role-pass.role', `role not in SDLC config: ${role}`))
const result = report(findings, 'role-pass')
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else {
  process.stdout.write(`[validate-sdlc-role-pass] ${path}\n`)
  for (const item of result.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${result.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(result.ok ? 0 : 1)
