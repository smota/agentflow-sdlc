#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const ignored = new Set(['node_modules', '.git'])
const findings = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(md|mjs|yaml)$/.test(entry.name)) {
      const rel = path.relative(root, full).split(path.sep).join('/')
      const text = fs.readFileSync(full, 'utf8')
      const lines = text.split(/\r?\n/)
      lines.forEach((line, index) => {
        if (/\b(TODO|TBD|FIXME)\s*[:(]/.test(line))
          findings.push(`${rel}:${index + 1}: ${line.trim()}`)
      })
    }
  }
}
walk(root)
if (findings.length) {
  console.error(`Hidden TODO-style placeholders found:\n${findings.join('\n')}`)
  process.exit(1)
}
console.log('No hidden TODO-style placeholders found')
