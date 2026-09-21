#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { validateEvidenceContract } from '../lib/evidence-contracts.mjs'
import { validateExecutionReceipt } from '../lib/core/execution-receipt.mjs'
import { loadSdlcConfig } from '../lib/sdlc-state.mjs'
import { loadProjectConfig } from '../lib/role-routing.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}
const type = flag('--type')
const target = path.resolve(flag('--target', process.cwd()))
const source = flag('--path')
if (!type || !source) {
  process.stderr.write(
    'Usage: validate-evidence-contract --type artifact-ref|artifact-refs|transition-envelope|execution-receipt|review-attestation|role-handoff|acceptance-contract|delivery-receipt|acceptance-decision|council-request|council-advice|council-synthesis|rework-request --path <json> [--expected-digest <sha256>] [--target <dir>] [--json]\n',
  )
  process.exit(2)
}
try {
  const value = JSON.parse(fs.readFileSync(path.resolve(target, source), 'utf8'))
  const config = loadSdlcConfig(target)
  const report =
    type === 'execution-receipt'
      ? validateExecutionReceipt(value, config)
      : validateEvidenceContract(type, value, config, loadProjectConfig(target), {
          expectedDigest: flag('--expected-digest'),
          packageRoot: target,
        })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ok ? 0 : 1)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
