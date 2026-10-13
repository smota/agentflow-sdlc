#!/usr/bin/env node
import { resolve } from 'node:path'
import { resolveConfigAuthority } from '../lib/config/authority.mjs'
import { inspectConfigState } from '../lib/config/projection.mjs'

const args = process.argv.slice(2)
const target = resolve(
  args.includes('--target') ? args[args.indexOf('--target') + 1] : process.cwd(),
)
const json = args.includes('--json')
const checkProjections = args.includes('--projections')

const result = resolveConfigAuthority(target)
const projectionState = checkProjections ? inspectConfigState(target) : null

const errors = [...result.validation.errors]
if (projectionState && !projectionState.clean) {
  for (const file of projectionState.files) {
    if (file.status !== 'matched') {
      errors.push(`Projected file "${file.path}" has drifted (${file.status})`)
    }
  }
}

const report = {
  ok: errors.length === 0,
  isUnified: result.isUnified,
  configPath: result.configPath,
  domainPath: result.domainPath,
  workflowPath: result.workflowPath,
  errors,
  warnings: result.validation.warnings,
  projections: projectionState
    ? {
        clean: projectionState.clean,
        driftCount: projectionState.observed.driftCount,
        files: projectionState.files,
      }
    : null,
}

if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write(`[validate-config-authority] ${target}\n`)
  for (const warning of report.warnings) process.stdout.write(`  WARNING ${warning}\n`)
  for (const error of report.errors) process.stdout.write(`  ERROR ${error}\n`)
  if (projectionState) {
    process.stdout.write(
      `  PROJECTIONS: ${projectionState.clean ? 'CLEAN' : `${projectionState.observed.driftCount} DRIFTED`}\n`,
    )
  }
  process.stdout.write(`Result: ${report.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(report.ok ? 0 : 1)
