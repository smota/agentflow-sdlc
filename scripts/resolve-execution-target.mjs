#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { loadProjectConfig } from '../lib/role-routing.mjs'
import { AGENT_SLUGS, resolveExecutionTarget } from '../lib/execution-targets.mjs'

function valueAfter(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

function usage() {
  return `Usage: node scripts/resolve-execution-target.mjs --agent <agy|codex|claude|pi> --requested <text> [--current-agent <agy|codex|claude|pi>] [--json]\n\nResolve an ambiguous mention such as "with claude" or "anthropic/claude-sonnet-4" into a\ndeterministic executionTarget/transport/delegationBoundary before launching work. Exits non-zero\nwhen the request requires clarification instead of guessing.\n`
}

export function main(argv = process.argv.slice(2)) {
  const agentSlug = valueAfter(argv, '--agent')
  const requested = valueAfter(argv, '--requested') ?? ''
  const currentAgent = valueAfter(argv, '--current-agent')
  const jsonOutput = argv.includes('--json')

  if (!agentSlug || !AGENT_SLUGS.includes(agentSlug)) {
    process.stderr.write(usage())
    process.exit(2)
  }

  let result
  try {
    const config = loadProjectConfig()
    result = resolveExecutionTarget({ agentSlug, requested, currentAgent, config })
  } catch (error) {
    result = { ok: false, reason: error.message, requiresClarification: true }
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (result.ok) {
    process.stdout.write(
      `Execution target: ${agentSlug} -> ${result.executionTarget} (transport: ${result.transport}; delegation boundary: ${result.delegationBoundary})\n`,
    )
    process.stdout.write(`Reason: ${result.reason}\n`)
    if (result.model) process.stdout.write(`Model: ${result.model}\n`)
  } else {
    process.stderr.write(`Execution target unresolved: ${result.reason}\n`)
    if (result.requiresClarification) {
      process.stderr.write('Ask a clarifying question before launching work.\n')
    }
  }

  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
