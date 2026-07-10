#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { loadProjectConfig } from '../lib/role-routing.mjs'
import { CAPABILITIES, resolveCapability } from '../lib/capabilities.mjs'
import { ALL_EXECUTION_TARGETS } from '../lib/execution-targets.mjs'

function valueAfter(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

function usage() {
  return `Usage: node scripts/resolve-capability.mjs --capability <${CAPABILITIES.join('|')}> --execution-target <target> [--required] [--json]\n\nResolve a portable advanced agent capability for a selected executionTarget. Exits non-zero when a required capability is unavailable.\n`
}

export function main(argv = process.argv.slice(2)) {
  const capability = valueAfter(argv, '--capability')
  const executionTarget = valueAfter(argv, '--execution-target')
  const required = argv.includes('--required')
  const jsonOutput = argv.includes('--json')

  if (!CAPABILITIES.includes(capability) || !ALL_EXECUTION_TARGETS.includes(executionTarget)) {
    process.stderr.write(usage())
    process.exit(2)
  }

  let result
  try {
    result = resolveCapability({
      capability,
      executionTarget,
      required,
      config: loadProjectConfig(),
    })
  } catch (error) {
    result = {
      ok: false,
      capability,
      executionTarget,
      required,
      mode: 'required-unavailable',
      status: 'blocked',
      reason: error.message,
    }
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (result.ok) {
    process.stdout.write(
      `${capability} -> ${result.mode} for ${executionTarget} (${result.status})\n`,
    )
    process.stdout.write(`Reason: ${result.reason}\n`)
  } else {
    process.stderr.write(`Capability unresolved: ${result.reason}\n`)
  }

  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
