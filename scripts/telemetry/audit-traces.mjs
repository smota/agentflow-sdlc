#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditTraceRecords } from '../../lib/trace-auditor.mjs'
import { parseJsonLines } from '../../lib/session-telemetry.mjs'

export const AUDIT_TRACES_USAGE = `Usage: node scripts/telemetry/audit-traces.mjs [options]

Inspects reasoning traces and tool invocations for path-ownership violations,
in-rig steering hallucinations, decider port bypass attempts, and role boundary drift.

Options:
  --traces <path...>       One or more trace files (.jsonl) to audit
  --fail-on-critical       Exit with non-zero code if critical violations are found (default: true)
  --fail-on-high           Exit with non-zero code if high severity violations are found
  --target <dir>           Repository root directory (defaults to cwd)
  --json                   Emit full JSON report to stdout
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

export async function runAuditTraces(rawArgs = []) {
  if (hasFlag(rawArgs, ['--help', '-h'])) {
    process.stdout.write(AUDIT_TRACES_USAGE)
    return 0
  }

  const isJson = hasFlag(rawArgs, '--json')
  const targetDir = resolve(getFlag(rawArgs, '--target', process.cwd()))
  const tracePaths = getMultiFlag(rawArgs, '--traces')

  if (tracePaths.length === 0) {
    const errorMsg = 'Error: Missing required --traces argument\n'
    if (isJson) {
      process.stdout.write(JSON.stringify({ ok: false, error: 'Missing --traces' }, null, 2) + '\n')
    } else {
      process.stderr.write(errorMsg)
    }
    return 1
  }

  const allRecords = []
  for (const path of tracePaths) {
    const fullPath = resolve(targetDir, path)
    if (!existsSync(fullPath)) continue
    try {
      const content = readFileSync(fullPath, 'utf8')
      allRecords.push(...parseJsonLines(content))
    } catch {
      // Ignore unreadable files
    }
  }

  const report = auditTraceRecords(allRecords, { packageRoot: targetDir })

  if (isJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(
      `Audit Verdict: ${report.verdict} (${report.counts.total} violations in ${report.totalRecords} records)\n` +
        `  Critical: ${report.counts.critical}\n` +
        `  High:     ${report.counts.high}\n` +
        `  Medium:   ${report.counts.medium}\n` +
        `  Low:      ${report.counts.low}\n\n`,
    )

    for (const v of report.violations) {
      process.stdout.write(
        `[${v.severity.toUpperCase()}] ${v.category} (Seat: ${v.seat}, Step: ${v.stepIndex})\n` +
          `  Finding:  ${v.finding}\n` +
          `  Evidence: ${v.evidence}\n\n`,
      )
    }
  }

  return report.verdict === 'FAIL' ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAuditTraces(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
