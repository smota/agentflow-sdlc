#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeReviewDigest } from '../lib/core/review-attestation.mjs'

const args = process.argv.slice(2)
const root = resolve(args.includes('--target') ? args[args.indexOf('--target') + 1] : process.cwd())
const files = execFileSync(
  'git',
  ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
  .filter((path) => !path.startsWith('.agent-runs/') && !path.startsWith('.pnpm-store/'))
  .filter((path) => {
    const absolute = resolve(root, path)
    return existsSync(absolute) && statSync(absolute).isFile()
  })
const entries = files.map((path) => ({ path, content: readFileSync(resolve(root, path)) }))
const result = {
  algorithm: 'sha256-path-nul-content-nul',
  files: files.length,
  digest: computeReviewDigest(entries),
}
if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else process.stdout.write(`${result.digest}  ${result.files} files\n`)
