#!/usr/bin/env node
// `pnpm validate:claims` / `agentflow-sdlc sdlc validate-claims`: the claims ledger check
// (governed-factory design, item M0-3).
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateClaimsLedger } from '../lib/claims-ledger.mjs'

export function main(argv) {
  const targetIndex = argv.indexOf('--target')
  const root = resolve(targetIndex >= 0 ? argv[targetIndex + 1] : process.cwd())
  let result
  try {
    result = validateClaimsLedger({ root })
  } catch (error) {
    result = {
      ok: false,
      rows: 0,
      findings: [{ severity: 'error', code: 'ledger-unreadable', message: error.message }],
    }
  }
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else {
    process.stdout.write(
      `[validate-claims-ledger] ${result.ok ? 'READY' : 'FAILED'} (${result.rows} rows)\n`,
    )
    for (const item of result.findings) {
      process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
    }
  }
  return result.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
