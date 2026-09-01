#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { deriveOutcomeMetrics } from '../lib/outcome-metrics.mjs'

const args = process.argv.slice(2)
const index = args.indexOf('--path')
const targetIndex = args.indexOf('--target')
const target = path.resolve(targetIndex < 0 ? process.cwd() : args[targetIndex + 1])
if (index < 0 || !args[index + 1]) {
  process.stderr.write('Usage: derive-outcome-metrics --path <events.json>\n')
  process.exit(2)
}
try {
  const events = JSON.parse(fs.readFileSync(path.resolve(target, args[index + 1]), 'utf8'))
  process.stdout.write(`${JSON.stringify(deriveOutcomeMetrics(events), null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
