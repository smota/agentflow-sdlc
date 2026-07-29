#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import {
  releaseAssignmentState,
  releaseCandidateFromIssue,
  releaseImpactFromIssue,
  finding,
  report,
} from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const path = args.includes('--path') ? args[args.indexOf('--path') + 1] : ''
const issue = path
  ? JSON.parse(readFileSync(path, 'utf8'))
  : { body: readFileSync(0, 'utf8'), labels: [], state: 'open' }
const findings = []
const candidate = releaseCandidateFromIssue(issue)
const impact = releaseImpactFromIssue(issue)
const assignment = releaseAssignmentState(issue)
if (assignment === 'needs-assignment' && impact !== 'unknown')
  findings.push(
    finding(
      'medium',
      'release.assignment',
      'release-impact issue needs target release or no-impact decision',
    ),
  )
if (
  !candidate &&
  /v\d+\.\d+\.\d+/i.test(issue.body || '') &&
  !/(?:target release|release|version)\s*:?\s*v\d+\.\d+\.\d+/i.test(issue.body || '')
)
  findings.push(
    finding('info', 'release.incidental-semver', 'incidental semver ignored as release candidate'),
  )
const result = { ...report(findings, 'release'), release: { candidate, impact, assignment } }
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else {
  process.stdout.write(
    `[validate-sdlc-release] candidate=${candidate || 'none'} impact=${impact} assignment=${assignment}\n`,
  )
  for (const item of result.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${result.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(result.ok ? 0 : 1)
