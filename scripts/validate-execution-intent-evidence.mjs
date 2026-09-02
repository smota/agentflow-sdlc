#!/usr/bin/env node
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateExecutionIntentEvidence } from '../lib/core/execution-intent.mjs'

function valueAfter(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

export function main(argv = process.argv.slice(2)) {
  const path = valueAfter(argv, '--path')
  const jsonOutput = argv.includes('--json')
  if (!path) {
    process.stderr.write(
      'Usage: node scripts/validate-execution-intent-evidence.mjs --path <json-file> [--json]\n',
    )
    process.exit(2)
  }
  let result
  try {
    result = validateExecutionIntentEvidence(JSON.parse(fs.readFileSync(path, 'utf8')))
  } catch (error) {
    result = { ok: false, errors: [error.message] }
  }
  if (jsonOutput) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else {
    for (const error of result.errors ?? []) process.stderr.write(`FAIL  ${error}\n`)
    if (result.ok) process.stdout.write('PASS  execution intent evidence\n')
  }
  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
