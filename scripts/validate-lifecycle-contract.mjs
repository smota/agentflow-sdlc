#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { validateLifecycleContract } from '../lib/lifecycle-contracts.mjs'
import { loadSdlcConfig } from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}
const type = flag('--type')
const target = path.resolve(flag('--target', process.cwd()))
const source = flag('--path')
if (!type || !source) {
  process.stderr.write(
    'Usage: validate-lifecycle-contract --type external-signal|delivery-handoff|action-boundary --path <json> [--target <dir>]\n',
  )
  process.exit(2)
}
try {
  const value = JSON.parse(fs.readFileSync(path.resolve(target, source), 'utf8'))
  const report = validateLifecycleContract(type, value, loadSdlcConfig(target))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ok ? 0 : 1)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
