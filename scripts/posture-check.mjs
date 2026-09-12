#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAuthoritativeConfigs } from '../lib/config/authority.mjs'
import { checkPostureCapability } from '../lib/posture-check.mjs'

// D3 CLI entry point. posture-check is advisory only: it reports capability gaps for the
// currently configured posture and ALWAYS exits 0. There is no findings-severity threshold here
// that flips the exit code, unlike scripts/validate-*.mjs — that asymmetry is intentional. It must
// never block a run and must never be wired into `validate:release` or any CI gate.
export function runPostureCheck(root = process.cwd()) {
  const { workflow } = loadAuthoritativeConfigs(root)
  const posture =
    typeof workflow.posture === 'string' && workflow.posture ? workflow.posture : undefined
  return checkPostureCapability({ posture, root })
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const result = runPostureCheck(resolve(process.argv[2] ?? process.cwd()))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`posture-check (advisory only): posture='${result.posture}'\n`)
  for (const warning of result.warnings) {
    process.stdout.write(`  WARN ${warning.code}: ${warning.message}\n`)
  }
  if (!result.warnings.length) process.stdout.write('  no capability gaps found\n')
  process.exit(0)
}
