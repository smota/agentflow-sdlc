#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { loadSdlcConfig, validateSdlcConfigShape } from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const targetIndex = args.indexOf('--target')
const target = targetIndex === -1 ? process.cwd() : args[targetIndex + 1]
const pathIndex = args.indexOf('--path')
const path = pathIndex === -1 ? 'sdlc.config.json' : args[pathIndex + 1]
const source = existsSync(`${target}/${path}`) ? path : 'defaults/sdlc.config.json'
const config = loadSdlcConfig(target, source)
const report = validateSdlcConfigShape(config)
if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write(`[validate-sdlc-config] ${source}\n`)
  for (const item of report.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${report.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(report.ok ? 0 : 1)
