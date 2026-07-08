#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  classifyBranch,
  loadProjectConfig,
  validateBranchStrategyConfig,
} from '../lib/branch-strategy.mjs'

function valueAfter(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

function currentBranch() {
  try {
    return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

export function main(argv = process.argv.slice(2)) {
  const jsonOutput = argv.includes('--json')
  const branch = valueAfter(argv, '--branch') ?? currentBranch()

  let result
  try {
    const config = loadProjectConfig()
    const validation = validateBranchStrategyConfig(config)
    const classification = classifyBranch(branch, config)
    result = {
      ok: validation.ok && classification.allowedForImplementation,
      validation,
      ...classification,
    }
  } catch (error) {
    result = { ok: false, error: error.message }
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (result.ok) {
    process.stdout.write(
      `Branch strategy: ${result.branch || '<none>'} -> ${result.classification}; PR target ${result.expectedPrTarget}\n`,
    )
  } else {
    process.stderr.write(`Branch strategy blocked: ${result.reason ?? result.error}\n`)
  }

  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
