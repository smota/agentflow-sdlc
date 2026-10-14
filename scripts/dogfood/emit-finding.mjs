#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_INTAKE_DIR,
  VALID_CATEGORIES,
  VALID_SEVERITIES,
  connectToBacklogQueue,
  createFinding,
  saveFindingLocally,
} from '../../lib/intake-emitter.mjs'

export const EMIT_FINDING_USAGE = `Usage: node scripts/dogfood/emit-finding.mjs [options]

Standardized emitter that writes immutable findings to disk and connects to product intake queues.

Options:
  --category <type>        Category: ${VALID_CATEGORIES.join(', ')} (default: ergonomics-friction)
  --repro <steps>          Reproduction steps / command
  --observed <text>        Observed behavior or error output
  --expected <text>        Expected progress or behavior
  --severity <level>       Severity: ${VALID_SEVERITIES.join(', ')} (default: medium)
  --jtbd <text>            JTBD push force statement
  --component <name>       Target subsystem or command
  --commit <sha>           Commit SHA (defaults to git rev-parse HEAD)
  --file <path>            Load finding definition from JSON file
  --intake-dir <dir>       Directory to store findings (default: .agentflow/intake)
  --queue <file>           Optional backlog intake queue JSON file to append to
  --no-dedup               Allow duplicate findings with the same fingerprint
  --dry-run                Preview finding generation without writing to disk
  --target <dir>           Repository root directory (defaults to cwd)
  --json                   Emit JSON output to stdout
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

function resolveCommitSha(targetDir, fallback = 'unknown') {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return fallback
  }
}

export async function runEmitFinding(rawArgs = []) {
  if (hasFlag(rawArgs, ['--help', '-h'])) {
    process.stdout.write(EMIT_FINDING_USAGE)
    return 0
  }

  const isJson = hasFlag(rawArgs, '--json')
  const dryRun = hasFlag(rawArgs, '--dry-run')
  const dedup = !hasFlag(rawArgs, '--no-dedup')
  const targetDir = resolve(getFlag(rawArgs, '--target', process.cwd()))
  const intakeDir = getFlag(rawArgs, '--intake-dir', DEFAULT_INTAKE_DIR)
  const queueFile = getFlag(rawArgs, '--queue')
  const fileArg = getFlag(rawArgs, '--file')

  try {
    let findingParams = {}

    if (fileArg) {
      const filePath = resolve(targetDir, fileArg)
      if (!existsSync(filePath)) {
        throw new Error(`Finding definition file not found: ${fileArg}`)
      }
      findingParams = JSON.parse(readFileSync(filePath, 'utf8'))
    } else {
      const repro = getFlag(rawArgs, '--repro')
      const observed = getFlag(rawArgs, '--observed')
      const expected = getFlag(rawArgs, '--expected')
      const jtbd = getFlag(rawArgs, '--jtbd')

      if (!repro || !observed || !expected || !jtbd) {
        throw new Error(
          'Missing required arguments: --repro, --observed, --expected, and --jtbd (or provide --file)',
        )
      }

      findingParams = {
        category: getFlag(rawArgs, '--category', 'ergonomics-friction'),
        severity: getFlag(rawArgs, '--severity', 'medium'),
        targetComponent: getFlag(rawArgs, '--component'),
        reproSteps: repro,
        observedOutput: observed,
        expectedProgress: expected,
        jtbdPushForce: jtbd,
        commitSha: getFlag(rawArgs, '--commit') || resolveCommitSha(targetDir),
      }
    }

    if (!findingParams.commitSha || findingParams.commitSha === 'unknown') {
      findingParams.commitSha = resolveCommitSha(targetDir)
    }

    const finding = createFinding(findingParams)

    let saveResult = { saved: false, duplicate: false, path: null }
    if (!dryRun) {
      saveResult = saveFindingLocally(finding, { targetDir, intakeDir, dedup })
    }

    let queueResult = null
    if (queueFile) {
      queueResult = connectToBacklogQueue(finding, {
        dryRun,
        queuePath: resolve(targetDir, queueFile),
      })
    } else {
      queueResult = connectToBacklogQueue(finding, { dryRun: true })
    }

    const output = {
      ok: true,
      finding,
      saved: saveResult.saved,
      duplicate: saveResult.duplicate,
      filePath: saveResult.path,
      queueItem: queueResult.queueItem,
      enqueued: queueResult.enqueued,
    }

    if (isJson) {
      process.stdout.write(JSON.stringify(output, null, 2) + '\n')
    } else {
      if (saveResult.duplicate) {
        process.stdout.write(
          `ℹ Duplicate finding detected: ${finding.findingId} (fingerprint: ${finding.fingerprint.slice(0, 10)}...)\n` +
            `  Existing record preserved at: ${saveResult.path}\n`,
        )
      } else if (dryRun) {
        process.stdout.write(
          `✓ [Dry Run] Finding created: ${finding.findingId}\n` +
            `  Category: ${finding.category} | Severity: ${finding.severity}\n` +
            `  Fingerprint: ${finding.fingerprint}\n` +
            `  Title: ${queueResult.queueItem.title}\n`,
        )
      } else {
        process.stdout.write(
          `✓ Intake finding recorded: ${finding.findingId}\n` +
            `  Category: ${finding.category} | Severity: ${finding.severity}\n` +
            `  Saved to: ${saveResult.path}\n` +
            (queueResult.enqueued ? `  Enqueued to: ${queueFile}\n` : ''),
        )
      }
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
  runEmitFinding(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
