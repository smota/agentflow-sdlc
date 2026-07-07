#!/usr/bin/env node
import { execFileSync } from 'node:child_process'

function runGit(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const base = process.argv.includes('--base')
  ? (process.argv[process.argv.indexOf('--base') + 1] ?? 'origin/development')
  : 'origin/development'

runGit(['fetch', 'origin', '--prune', '--quiet'])
const refs = runGit(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^origin\/(issue\/|work\/|hotfix\/|feat\/|fix\/|chore\/)/.test(line))

const rows = []
for (const ref of refs) {
  const tip = runGit(['rev-parse', ref])
  const mergeBase = runGit(['merge-base', ref, base])
  if (tip.length > 0 && mergeBase === tip) {
    rows.push(ref)
  }
}

process.stdout.write(`# Branch cleanup candidates merged into ${base}\n\n`)
if (rows.length === 0) {
  process.stdout.write('- none\n')
  process.exit(0)
}
for (const row of rows) {
  process.stdout.write(`- ${row}\n`)
}
