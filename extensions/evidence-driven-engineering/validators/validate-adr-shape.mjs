#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const template = path.resolve(process.cwd(), 'templates/adr-template.md')
const required = [
  '# ADR NNN',
  '## Status',
  '## Context',
  '## Decision',
  '## Alternatives considered',
  '## Consequences',
  '## Validation and follow-up',
]
const source = fs.readFileSync(template, 'utf8')
const missing = required.filter((section) => !source.includes(section))
if (missing.length) {
  console.error(`ADR template missing required sections: ${missing.join(', ')}`)
  process.exit(1)
}
console.log('ADR template shape OK')
