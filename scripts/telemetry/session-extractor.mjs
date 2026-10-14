#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_TELEMETRY_DIR,
  extractSessionTelemetry,
  saveTelemetryDigest,
} from '../../lib/core/session-telemetry.mjs'

export const SESSION_EXTRACTOR_USAGE = `Usage: node scripts/telemetry/session-extractor.mjs [options]

Ingests .agent-runs/*.jsonl transcripts and OpenRig session logs to aggregate
quantitative process telemetry (turn counts, token spend, error rates, rework, and freeze events).

Options:
  --traces <path...>       One or more trace files or directories containing .jsonl logs
  --run-id <id>            Custom identifier for this run (defaults to run-<timestamp>)
  --out-dir <dir>          Directory to save digest (default: .agentflow/telemetry)
  --no-save                Do not write output file to disk
  --target <dir>           Repository root directory (defaults to cwd)
  --json                   Emit full JSON digest to stdout
  --help, -h               Show this help message
`

function getFlag(args, names, fallback = null) {
  const flags = Array.isArray(names) ? names : [names]
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i])) {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        return args[i + 1]
      }
      return true
    }
  }
  return fallback
}

function hasFlag(args, names) {
  const flags = Array.isArray(names) ? names : [names]
  return args.some((arg) => flags.includes(arg))
}

function getMultiFlag(args, name) {
  const results = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      let j = i + 1
      while (j < args.length && !args[j].startsWith('--')) {
        results.push(args[j])
        j++
      }
    }
  }
  return results
}

export async function runSessionExtractor(rawArgs = []) {
  if (hasFlag(rawArgs, ['--help', '-h'])) {
    process.stdout.write(SESSION_EXTRACTOR_USAGE)
    return 0
  }

  const isJson = hasFlag(rawArgs, '--json')
  const save = !hasFlag(rawArgs, '--no-save')
  const targetDir = resolve(getFlag(rawArgs, '--target', process.cwd()))
  const outDir = getFlag(rawArgs, '--out-dir', DEFAULT_TELEMETRY_DIR)
  const runId = getFlag(rawArgs, '--run-id', `run-${Date.now().toString(36)}`)
  const traceArgs = getMultiFlag(rawArgs, '--traces')

  const traces = traceArgs.length > 0 ? traceArgs : ['.agent-runs']

  try {
    const digest = extractSessionTelemetry({
      inputs: traces,
      runId,
      outDir,
      targetDir,
      save,
    })

    if (isJson) {
      process.stdout.write(JSON.stringify(digest, null, 2) + '\n')
    } else {
      process.stdout.write(
        `✓ Session telemetry extracted for run: ${digest.runId}\n` +
          `  Total turns: ${digest.summary.totalTurns}\n` +
          `  Token spend: ${digest.summary.tokens.total.toLocaleString()} (${digest.summary.tokens.prompt.toLocaleString()} prompt / ${digest.summary.tokens.completion.toLocaleString()} completion)\n` +
          `  Commands executed: ${digest.summary.commands.total} (${digest.summary.commands.failures} failures, ${(digest.summary.commands.failureRate * 100).toFixed(1)}%)\n` +
          `  Process health: ${digest.summary.processHealth.reworkCount} rework loops, ${digest.summary.processHealth.freezeCount} freezes (${digest.summary.processHealth.circuitBreakerTrips} circuit-breaker trips)\n` +
          (save ? `  Digest saved: ${outDir}/${digest.runId}.json\n` : ''),
      )
    }

    return 0
  } catch (err) {
    if (isJson) {
      process.stdout.write(JSON.stringify({ ok: false, error: err.message }, null, 2) + '\n')
    } else {
      process.stderr.write(`Error: ${err.message}\n`)
    }
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSessionExtractor(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
