#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const required = [
  '## Handoff',
  '### Context',
  '### Evidence',
  '### Provenance',
  '### Open questions',
  '### Stop conditions',
  '### Next action',
]
const text = fs.readFileSync(path.resolve(process.cwd(), 'templates/handoff-comment.md'), 'utf8')
const missing = required.filter((section) => !text.includes(section))
if (missing.length) {
  console.error(`handoff-comment.md missing required sections: ${missing.join(', ')}`)
  process.exit(1)
}
console.log('Handoff template shape OK')
