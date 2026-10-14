#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_MARKER_PATH,
  generateDogfoodSurface,
  saveDogfoodMarker,
} from '../../lib/dogfood-surface.mjs'

export const DEFAULT_SURFACE_OUTPUT = '.agentflow/dogfood/dogfood-surface.json'

export const SURFACE_READER_USAGE = `Usage: node scripts/dogfood/surface-reader.mjs [options]

Resolves merged commit deltas on trunk, correlates closed issues and anti-goals,
extracts PR review limitations, and generates the dogfood testing surface manifest.

Options:
  --since <ref>            Beginning git commit SHA, tag, or branch (defaults to marker or HEAD~1)
  --head <ref>             Ending git ref (defaults to HEAD)
  --out <file>             Output path for surface manifest (defaults to .agentflow/dogfood/dogfood-surface.json)
  --marker <file>          Path to dogfood marker file (defaults to .agentflow/dogfood/last-run-marker.json)
  --no-update-marker       Do not advance the dogfood run marker
  --dry-run                Preview surface generation without writing output files
  --target <dir>           Repository root directory (defaults to current working directory)
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

export async function runSurfaceReader(rawArgs = []) {
  if (hasFlag(rawArgs, ['--help', '-h'])) {
    process.stdout.write(SURFACE_READER_USAGE)
    return 0
  }

  const isJson = hasFlag(rawArgs, '--json')
  const dryRun = hasFlag(rawArgs, '--dry-run')
  const updateMarker = !hasFlag(rawArgs, '--no-update-marker') && !dryRun
  const targetDir = resolve(getFlag(rawArgs, '--target', process.cwd()))
  const since = getFlag(rawArgs, '--since')
  const head = getFlag(rawArgs, '--head', 'HEAD')
  const outFile = getFlag(rawArgs, '--out', DEFAULT_SURFACE_OUTPUT)
  const markerFile = getFlag(rawArgs, '--marker', DEFAULT_MARKER_PATH)

  try {
    const surface = await generateDogfoodSurface({
      since,
      head,
      repoRoot: targetDir,
      markerPath: markerFile,
    })

    if (!dryRun) {
      const outPath = resolve(targetDir, outFile)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, JSON.stringify(surface, null, 2), 'utf8')

      if (updateMarker && surface.range.head) {
        const markerPath = resolve(targetDir, markerFile)
        saveDogfoodMarker(markerPath, {
          lastHead: surface.range.head,
          timestamp: new Date().toISOString(),
          commitsCount: surface.range.commitCount,
        })
      }
    }

    if (isJson) {
      process.stdout.write(JSON.stringify(surface, null, 2) + '\n')
    } else {
      process.stdout.write(
        `✓ Dogfood surface generated (${surface.range.commitCount} commits, blast radius: ${surface.blastRadius.level.toUpperCase()}):\n` +
          `  Range: ${surface.range.since.slice(0, 7)}..${surface.range.head.slice(0, 7)}\n` +
          `  Affected modules: ${surface.blastRadius.modules.join(', ')}\n` +
          `  Files changed: ${surface.blastRadius.filesChanged} (+${surface.blastRadius.insertions}/-${surface.blastRadius.deletions})\n` +
          `  Correlated issues (${surface.correlatedIssues.length}): ${surface.correlatedIssues.map((i) => `#${i.number}`).join(', ') || 'none'}\n` +
          `  Exclusion filters: ${surface.exclusionFilters.length} active\n` +
          (dryRun
            ? `  [Dry Run] Output file not written\n`
            : `  Surface manifest saved: ${outFile}\n`),
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
  runSurfaceReader(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
