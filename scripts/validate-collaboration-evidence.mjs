#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { validateCollaborationEvidence } from '../lib/collaboration-evidence.mjs'

const pathIndex = process.argv.indexOf('--path')
if (pathIndex === -1 || !process.argv[pathIndex + 1]) {
  console.error('usage: node scripts/validate-collaboration-evidence.mjs --path evidence.json')
  process.exit(1)
}

const path = process.argv[pathIndex + 1]
const evidence = JSON.parse(readFileSync(path, 'utf8'))
const result = validateCollaborationEvidence(evidence)
console.log(`[validate-collaboration-evidence] ${path}`)
for (const warning of result.warnings) console.log(`  WARN  ${warning}`)
for (const error of result.errors) console.log(`  FAIL  ${error}`)
if (result.ok) console.log('  PASS  collaboration evidence')
console.log(`\nResult: ${result.ok ? 'READY' : 'FAILED'}`)
process.exit(result.ok ? 0 : 1)
