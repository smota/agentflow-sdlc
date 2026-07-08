#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { loadProjectConfig, validateBranchStrategyConfig } from '../lib/branch-strategy.mjs'

export function main() {
  let result
  try {
    result = validateBranchStrategyConfig(loadProjectConfig())
  } catch (error) {
    result = { ok: false, errors: [error.message], warnings: [] }
  }

  if (result.ok) {
    process.stdout.write('[validate-branch-strategy] READY\n')
    for (const warning of result.warnings) process.stdout.write(`Warning: ${warning}\n`)
  } else {
    process.stdout.write('[validate-branch-strategy] BLOCKED\n')
    for (const error of result.errors) process.stdout.write(`Error: ${error}\n`)
    for (const warning of result.warnings) process.stdout.write(`Warning: ${warning}\n`)
  }
  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
