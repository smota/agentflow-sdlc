#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(process.cwd())
const cli = join(repoRoot, 'bin', 'cli.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'agentflow-sdlc-smoke-'))
function run(args) {
  return execFileSync(process.execPath, [cli, ...args, '--target', tmp], {
    encoding: 'utf8',
    env: { ...process.env, AGENTFLOW_REPOSITORIES: 'smota/agentflow-sdlc' },
  })
}
execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' })
run(['init'])
run(['sdlc', 'validate', '--json'])
run(['sdlc', 'audit', '--json'])
run(['sdlc', 'migrate', '--json'])
run(['cockpit', 'doctor', '--json'])
run(['skills', 'sync', '--harness', 'all', '--apply'])
run(['skills', 'status', '--harness', 'all', '--json'])
run(['plugins', 'validate', '--harness', 'all', '--json'])
run(['plugins', 'build', '--harness', 'all', '--apply'])
run(['plugins', 'status', '--harness', 'all', '--json'])
run(['settings', 'merge', '--harness', 'all', '--apply'])
run(['settings', 'status', '--harness', 'all', '--json'])
const expected = [
  'docs/sdlc-definition.md',
  'sdlc.config.json',
  'schemas/sdlc-config.schema.json',
  '.claude/skills/sdlc-definition/SKILL.md',
  '.pi/skills/sdlc-audit/SKILL.md',
  '.agents/skills/sdlc-migration/SKILL.md',
  '.claude/agentflow-sdlc.plugin.json',
  '.agy/agentflow-sdlc.plugin.json',
  '.codex/agentflow-sdlc.plugin.json',
  '.pi/agentflow-sdlc.plugin.json',
  '.claude/settings.json',
  '.agy/settings.json',
  '.codex/hooks.json',
  '.pi/settings.json',
]
const missing = expected.filter((item) => !existsSync(join(tmp, item)))
const result = { ok: missing.length === 0, tmp, missing }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exit(result.ok ? 0 : 1)
