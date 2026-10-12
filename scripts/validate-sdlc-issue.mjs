#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { loadSdlcConfig, validateIssueAgainstSdlc } from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : process.cwd()
const path = args.includes('--path') ? args[args.indexOf('--path') + 1] : ''
// A JSON array of the other records in the medium, so a replacement is checked against its note.
const recordsPath = args.includes('--records') ? args[args.indexOf('--records') + 1] : ''
let issue
if (path) issue = JSON.parse(readFileSync(path, 'utf8'))
else
  issue = {
    title: args.includes('--title') ? args[args.indexOf('--title') + 1] : '',
    body: readFileSync(0, 'utf8'),
    labels: [],
  }
const records = recordsPath ? JSON.parse(readFileSync(recordsPath, 'utf8')) : undefined
const report = validateIssueAgainstSdlc(issue, loadSdlcConfig(target), { records })
if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write('[validate-sdlc-issue]\n')
  for (const item of report.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  for (const part of report.parts?.current ?? [])
    process.stdout.write(`  PART #${part.number}${part.admitted ? '' : ' (not yet admitted)'}\n`)
  for (const part of report.parts?.replaced ?? [])
    process.stdout.write(`  REPLACED #${part.number} by #${part.by}\n`)
  if (report.replacedBy) process.stdout.write(`  Replaced by #${report.replacedBy}\n`)
  process.stdout.write(`Result: ${report.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(report.ok ? 0 : 1)
