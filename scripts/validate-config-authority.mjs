#!/usr/bin/env node
import { resolve } from 'node:path'
import { resolveConfigAuthority } from '../lib/config/authority.mjs'

const args = process.argv.slice(2)
const target = resolve(
  args.includes('--target') ? args[args.indexOf('--target') + 1] : process.cwd(),
)
const json = args.includes('--json')
const result = resolveConfigAuthority(target)
const report = {
  ok: result.validation.ok,
  domainPath: result.domainPath,
  workflowPath: result.workflowPath,
  errors: result.validation.errors,
  warnings: result.validation.warnings,
}

if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write(`[validate-config-authority] ${target}\n`)
  for (const warning of report.warnings) process.stdout.write(`  WARNING ${warning}\n`)
  for (const error of report.errors) process.stdout.write(`  ERROR ${error}\n`)
  process.stdout.write(`Result: ${report.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(report.ok ? 0 : 1)
