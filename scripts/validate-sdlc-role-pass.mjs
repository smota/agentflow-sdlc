#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { fieldValue } from '../lib/markdown-sections.mjs'
import { loadSdlcConfig, finding, report } from '../lib/sdlc-state.mjs'
import {
  ALL_EXECUTION_TARGETS,
  DELEGATION_BOUNDARIES,
  TRANSPORTS,
} from '../lib/execution-targets.mjs'
import { CONTEXT_BOUNDARIES } from '../lib/role-attribution.mjs'
import { loadProjectConfig } from '../lib/role-routing.mjs'
import { runtimePlatformSlugs } from '../lib/runtime-platforms.mjs'
import { normalizeRole } from '../lib/sdlc-vocabulary.mjs'

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
const executedBy = fieldValue(text, 'Executed by') ?? fieldValue(text, 'Actual executor')
if (executedBy === null) findings.push(finding('high', 'role-pass.field', 'missing Executed by'))

const projectConfig = loadProjectConfig()
let registeredPlatforms = []
try {
  registeredPlatforms = runtimePlatformSlugs(projectConfig)
} catch (error) {
  findings.push(finding('high', 'role-pass.platform-registry', error.message))
}
for (const [label, value] of [
  ['Planned owner', fieldValue(text, 'Planned owner')],
  ['Executed by', executedBy],
  ['Launcher', fieldValue(text, 'Launcher')],
]) {
  if (
    value !== null &&
    value !== 'not-applicable:single-agent' &&
    !registeredPlatforms.includes(value)
  ) {
    findings.push(
      finding('high', 'role-pass.platform', `${label} uses unregistered platform slug: ${value}`),
    )
  }
}
for (const [label, values] of [
  ['Executor', ALL_EXECUTION_TARGETS],
  ['Transport', TRANSPORTS],
  ['Delegation boundary', DELEGATION_BOUNDARIES],
  ['Context boundary', CONTEXT_BOUNDARIES],
]) {
  const value = fieldValue(text, label)
  if (value !== null && !values.includes(value)) {
    findings.push(finding('high', 'role-pass.provenance', `${label} has invalid value: ${value}`))
  }
}
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
const roleIdentity = normalizeRole(role, config)
if (role && !roleIdentity.canonical)
  findings.push(finding('medium', 'role-pass.role', `role not in SDLC config: ${role}`))
if (roleIdentity.deprecated)
  findings.push(
    finding('low', 'role-pass.role-alias', `deprecated role alias; emit ${roleIdentity.canonical}`),
  )
const result = report(findings, 'role-pass')
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else {
  process.stdout.write(`[validate-sdlc-role-pass] ${path}\n`)
  for (const item of result.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${result.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(result.ok ? 0 : 1)
