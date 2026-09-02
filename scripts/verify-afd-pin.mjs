#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { AI_FOUNDRY_DESK_CONTRACT } from '../lib/providers/ai-foundry-desk.mjs'

const args = process.argv.slice(2)
const index = args.indexOf('--repo')
if (index === -1 || !args[index + 1]) {
  throw new Error('Usage: verify-afd-pin --repo <ai-foundry-desk-checkout>')
}
const repo = resolve(args[index + 1])
const results = AI_FOUNDRY_DESK_CONTRACT.artifacts.map((artifact) => {
  const content = execFileSync(
    'git',
    [
      '-c',
      `safe.directory=${repo.replaceAll('\\', '/')}`,
      '-C',
      repo,
      'show',
      `${AI_FOUNDRY_DESK_CONTRACT.commit}:${artifact.path}`,
    ],
    { encoding: 'buffer' },
  )
  const actual = createHash('sha256').update(content).digest('hex').toUpperCase()
  return { path: artifact.path, expected: artifact.sha256, actual, ok: actual === artifact.sha256 }
})
const report = {
  ok: results.every((item) => item.ok),
  commit: AI_FOUNDRY_DESK_CONTRACT.commit,
  results,
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exit(report.ok ? 0 : 1)
