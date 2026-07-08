#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { loadProjectConfig, resolveRoleRoute, SUPPORTED_AGENT_SLUGS } from '../lib/role-routing.mjs'

function valueAfter(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

function usage() {
  return `Usage: node scripts/resolve-role-route.mjs --role <role> --current <agy|codex|claude|pi> [--json] [--no-availability-check]\n`
}

export function main(argv = process.argv.slice(2)) {
  const role = valueAfter(argv, '--role')
  const currentAgent = valueAfter(argv, '--current')
  const jsonOutput = argv.includes('--json')
  const checkAvailability = !argv.includes('--no-availability-check')

  if (!role || !currentAgent) {
    process.stderr.write(usage())
    process.exit(2)
  }
  if (!SUPPORTED_AGENT_SLUGS.includes(currentAgent)) {
    process.stderr.write(`--current must be one of: ${SUPPORTED_AGENT_SLUGS.join(', ')}\n`)
    process.exit(2)
  }

  let result
  try {
    const config = loadProjectConfig()
    result = resolveRoleRoute({ role, currentAgent, config, checkAvailability })
  } catch (error) {
    result = { ok: false, error: error.message }
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (result.ok) {
    process.stdout.write(
      `Role route: ${role} -> ${result.selectedAgent} (${result.mode}; ${result.reason})\n`,
    )
    process.stdout.write(`Launcher: ${result.launcher}\n`)
    process.stdout.write(
      `Executor: ${result.executor} (transport: ${result.transport}; delegation boundary: ${result.delegationBoundary})\n`,
    )
    if (result.handoverDoc) process.stdout.write(`Handover doc: ${result.handoverDoc}\n`)
    if (result.requiresHandoverComment) process.stdout.write('Handover comment: required\n')
  } else {
    process.stderr.write(`Role route blocked: ${result.reason ?? result.error}\n`)
  }

  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
