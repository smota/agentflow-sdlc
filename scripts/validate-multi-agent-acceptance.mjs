#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { validateClaudeAgyAcceptance } from '../lib/multi-agent-acceptance.mjs'
import { loadProjectConfig } from '../lib/role-routing.mjs'
import { loadSdlcConfig } from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}
const target = path.resolve(flag('--target', process.cwd()))
const actualDir = path.resolve(target, flag('--actual-dir', 'agents/evals/fixtures'))
try {
  const claude = JSON.parse(fs.readFileSync(path.join(actualDir, 'claude-analyst.txt'), 'utf8'))
  const agy = JSON.parse(fs.readFileSync(path.join(actualDir, 'agy-architect.txt'), 'utf8'))
  const report = validateClaudeAgyAcceptance(
    { claude, agy },
    loadSdlcConfig(target),
    loadProjectConfig(target),
  )
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ok ? 0 : 1)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
