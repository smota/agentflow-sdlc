#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_REFINEMENTS_DIR,
  saveRefinementArtifacts,
  synthesizeRefinementProposals,
} from '../../lib/core/refinement-engine.mjs'
import { loadLocalFindings } from '../../lib/core/intake-emitter.mjs'

export const SYNTHESIZE_REFINEMENTS_USAGE = `Usage: node scripts/telemetry/synthesize-refinements.mjs [options]

Synthesizes telemetry metrics, audit findings, and dogfood friction into targeted,
reviewable prompt constraints, permission policy adjustments, and rig configuration improvements.

Options:
  --audit <file>           Path to trace audit report JSON
  --telemetry <file>       Path to session telemetry digest JSON
  --intake-dir <dir>       Path to local intake findings directory (default: .agentflow/intake)
  --out-dir <dir>          Directory to save proposal artifacts (default: .agentflow/refinements)
  --dry-run                Preview proposals without writing files
  --target <dir>           Repository root directory (defaults to cwd)
  --json                   Emit full JSON output to stdout
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

export async function runSynthesizeRefinements(rawArgs = []) {
  if (hasFlag(rawArgs, ['--help', '-h'])) {
    process.stdout.write(SYNTHESIZE_REFINEMENTS_USAGE)
    return 0
  }

  const isJson = hasFlag(rawArgs, '--json')
  const dryRun = hasFlag(rawArgs, '--dry-run')
  const targetDir = resolve(getFlag(rawArgs, '--target', process.cwd()))
  const outDir = getFlag(rawArgs, '--out-dir', DEFAULT_REFINEMENTS_DIR)
  const auditFile = getFlag(rawArgs, '--audit')
  const telemetryFile = getFlag(rawArgs, '--telemetry')
  const intakeDir = getFlag(rawArgs, '--intake-dir', '.agentflow/intake')

  let auditReport = { violations: [] }
  let telemetry = {}
  let intakeFindings = []

  if (auditFile) {
    const fullPath = resolve(targetDir, auditFile)
    if (existsSync(fullPath)) {
      try {
        auditReport = JSON.parse(readFileSync(fullPath, 'utf8'))
      } catch {
        // ignore
      }
    }
  }

  if (telemetryFile) {
    const fullPath = resolve(targetDir, telemetryFile)
    if (existsSync(fullPath)) {
      try {
        telemetry = JSON.parse(readFileSync(fullPath, 'utf8'))
      } catch {
        // ignore
      }
    }
  }

  const fullIntakePath = resolve(targetDir, intakeDir)
  if (existsSync(fullIntakePath)) {
    intakeFindings = loadLocalFindings(fullIntakePath)
  }

  const proposals = synthesizeRefinementProposals({
    auditReport,
    telemetry,
    intakeFindings,
  })

  let savedFiles = []
  if (!dryRun && proposals.length > 0) {
    savedFiles = saveRefinementArtifacts(proposals, {
      targetDir,
      outDir,
    })
  }

  if (isJson) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          proposalsCount: proposals.length,
          proposals,
          savedFiles,
        },
        null,
        2,
      ) + '\n',
    )
  } else {
    process.stdout.write(`✓ Synthesized ${proposals.length} refinement proposal(s):\n`)
    for (const p of proposals) {
      process.stdout.write(
        `  - [${p.refinementId}] ${p.summary} (${p.remediationType} -> ${p.targetSubject})\n`,
      )
    }
    if (dryRun) {
      process.stdout.write(`  [Dry Run] Proposal files not written.\n`)
    } else if (savedFiles.length > 0) {
      process.stdout.write(`  Artifacts saved to: ${outDir}/\n`)
    }
  }

  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSynthesizeRefinements(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
