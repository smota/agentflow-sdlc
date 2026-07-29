#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { loadSdlcConfig, validateIssueAgainstSdlc } from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : process.cwd()
const path = args.includes('--path') ? args[args.indexOf('--path') + 1] : ''
let issue
if (path) issue = JSON.parse(readFileSync(path, 'utf8'))
else
  issue = {
    title: args.includes('--title') ? args[args.indexOf('--title') + 1] : '',
    body: readFileSync(0, 'utf8'),
    labels: [],
  }
const report = validateIssueAgainstSdlc(issue, loadSdlcConfig(target))
if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write('[validate-sdlc-issue]\n')
  for (const item of report.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${report.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(report.ok ? 0 : 1)
