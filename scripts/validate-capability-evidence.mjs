#!/usr/bin/env node
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateCapabilityEvidence } from '../lib/capabilities.mjs'

function valueAfter(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

function usage() {
  return 'Usage: node scripts/validate-capability-evidence.mjs --path <json-file> [--json]\n\nValidates a JSON document with a capabilitiesUsed array.\n'
}

export function main(argv = process.argv.slice(2)) {
  const path = valueAfter(argv, '--path')
  const jsonOutput = argv.includes('--json')
  if (!path) {
    process.stderr.write(usage())
    process.exit(2)
  }

  let result
  try {
    const evidence = JSON.parse(fs.readFileSync(path, 'utf8'))
    result = validateCapabilityEvidence(evidence)
  } catch (error) {
    result = { ok: false, errors: [error.message], warnings: [] }
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    for (const warning of result.warnings ?? []) process.stdout.write(`WARN  ${warning}\n`)
    for (const error of result.errors ?? []) process.stderr.write(`FAIL  ${error}\n`)
    if (result.ok) process.stdout.write('PASS  capability evidence\n')
  }

  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
