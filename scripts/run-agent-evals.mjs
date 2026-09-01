#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { runEvalManifest } from '../lib/agent-evals.mjs'

const args = process.argv.slice(2)
const flag = (name) => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
const manifestPath = flag('--manifest')
const target = path.resolve(flag('--target') ?? process.cwd())
if (!manifestPath) {
  process.stderr.write('Usage: run-agent-evals --manifest <json> [--actual-dir <dir>] [--json]\n')
  process.exit(2)
}
try {
  const resolved = path.resolve(target, manifestPath)
  const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  const report = runEvalManifest(manifest, {
    manifestPath: resolved,
    actualDir: flag('--actual-dir') ? path.resolve(target, flag('--actual-dir')) : undefined,
    rootDir: target,
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ok ? 0 : 1)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
