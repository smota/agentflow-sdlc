#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const files = ['templates/handoff-comment.md', 'templates/role-pass-handoff-addendum.md']
const fields = ['Launcher', 'Executor', 'Transport', 'Delegation boundary', 'Model / runtime']
const failures = []
for (const file of files) {
  const text = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
  for (const field of fields) if (!text.includes(field)) failures.push(`${file}: missing ${field}`)
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Provenance fields OK')
