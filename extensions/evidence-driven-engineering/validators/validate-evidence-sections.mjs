#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const files = [
  'templates/analysis-guardrails.md',
  'templates/review-checklist.md',
  'templates/pr-evidence-addendum.md',
]
const requiredTerms = ['Validation', 'follow-up', 'Decision']
const failures = []
for (const file of files) {
  const text = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
  for (const term of requiredTerms) {
    if (!text.toLowerCase().includes(term.toLowerCase())) failures.push(`${file}: missing ${term}`)
  }
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Evidence templates include decision, validation, and follow-up sections')
