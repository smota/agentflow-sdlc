#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(process.cwd())
const cli = join(repoRoot, 'bin', 'cli.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'agentflow-sdlc-smoke-'))
function run(args) {
  return execFileSync(process.execPath, [cli, ...args, '--target', tmp], { encoding: 'utf8' })
}
execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' })
run(['init'])
run(['sdlc', 'validate', '--json'])
run(['sdlc', 'audit', '--json'])
run(['sdlc', 'migrate', '--json'])
run(['skills', 'sync', '--harness', 'all', '--apply'])
run(['skills', 'status', '--harness', 'all', '--json'])
const expected = [
  'docs/sdlc-definition.md',
  'sdlc.config.json',
  'schemas/sdlc-config.schema.json',
  '.claude/skills/sdlc-definition/SKILL.md',
  '.pi/skills/sdlc-audit/SKILL.md',
  '.agents/skills/sdlc-migration/SKILL.md',
]
const missing = expected.filter((item) => !existsSync(join(tmp, item)))
const result = { ok: missing.length === 0, tmp, missing }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exit(result.ok ? 0 : 1)
