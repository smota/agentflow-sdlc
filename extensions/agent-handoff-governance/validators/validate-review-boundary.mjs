#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const files = ['README.md', 'principles.md', 'templates/human-review-request.md']
const failures = []
for (const file of files) {
  const text = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').toLowerCase()
  if (!text.includes('review') || !text.includes('implementation')) {
    failures.push(`${file}: must mention review and implementation boundary`)
  }
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Review/implementation boundary documented')
