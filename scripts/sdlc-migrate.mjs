#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadSdlcConfig, validateSdlcConfigShape } from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : process.cwd()
const apply = args.includes('--apply') || args.includes('--write')
const changes = []
for (const path of [
  'docs/sdlc-definition.md',
  'sdlc.config.json',
  'schemas/sdlc-config.schema.json',
  'docs/evidence-contracts.md',
  'docs/lifecycle-boundaries.md',
  'docs/agent-evals.md',
  'docs/outcome-metrics.md',
  'schemas/artifact-ref.schema.json',
  'schemas/transition-envelope.schema.json',
  'schemas/action-boundary.schema.json',
]) {
  if (!existsSync(join(target, path)))
    changes.push({ action: 'install', path, reason: 'required SDLC product file missing' })
}
const configReport = existsSync(join(target, 'sdlc.config.json'))
  ? validateSdlcConfigShape(loadSdlcConfig(target))
  : { ok: false, findings: [] }
const result = {
  ok: !apply && changes.length >= 0,
  mode: apply ? 'blocked-preview-first' : 'dry-run',
  message: apply
    ? 'Migration apply is gated; run init/sync for file installation and review this dry-run first.'
    : 'Preview migration plan; no writes performed.',
  changes,
  validation: configReport,
}
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else {
  process.stdout.write(`[sdlc-migrate] ${result.mode}\n${result.message}\n`)
  for (const change of changes)
    process.stdout.write(`  - ${change.action} ${change.path}: ${change.reason}\n`)
}
process.exit(apply ? 1 : 0)
