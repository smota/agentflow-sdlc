#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { doctor, init, sync } from '../lib/install.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function getFlag(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  return args[index + 1] ?? fallback
}

function printReport(title, report) {
  process.stdout.write(`${title}\n`)
  for (const [key, list] of Object.entries(report)) {
    if (list.length === 0) continue
    process.stdout.write(`  ${key} (${list.length}):\n`)
    for (const item of list) {
      process.stdout.write(`    - ${item}\n`)
    }
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  const targetDir = resolve(getFlag(rest, '--target', process.cwd()))

  if (command === 'init') {
    const report = init(packageRoot, targetDir)
    printReport(`Installed framework into ${targetDir}`, report)
    process.exit(0)
  }

  if (command === 'sync') {
    const report = sync(packageRoot, targetDir)
    printReport(`Synced framework in ${targetDir}`, report)
    process.exit(report.conflicts.length > 0 ? 1 : 0)
  }

  if (command === 'doctor') {
    const report = doctor(packageRoot, targetDir)
    printReport(`Framework status for ${targetDir}`, report)
    const drifted = report.modified.length + report.missing.length + report.notInstalled.length
    process.exit(drifted > 0 ? 1 : 0)
  }

  process.stderr.write('Usage: multi-agent-sdlc <init|sync|doctor> [--target <dir>]\n')
  process.exit(2)
}

main()
