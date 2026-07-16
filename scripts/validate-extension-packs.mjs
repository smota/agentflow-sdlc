#!/usr/bin/env node
import { validateConfiguredExtensionPacks } from '../lib/extension-packs.mjs'

const args = new Set(process.argv.slice(2))
const runValidators = args.has('--run-validators')
const allowEmpty = args.has('--allow-empty')

const { configured, results } = validateConfiguredExtensionPacks(process.cwd(), { runValidators })

if (!configured.length) {
  const message =
    'No repository extension packs configured in agent-workflow.config.json (extensions.enabledPacks).'
  if (allowEmpty) {
    console.log(`extension-pack validation skipped: ${message}`)
    process.exit(0)
  }
  console.error(`extension-pack validation failed: ${message}`)
  process.exit(1)
}

let failures = 0
for (const result of results) {
  const id = result.pack.manifest.id ?? result.pack.relativeDir
  if (result.errors.length) {
    failures += result.errors.length
    console.error(`\n[FAIL] ${id}`)
    for (const error of result.errors) console.error(`- ${error}`)
  } else {
    console.log(`[OK] ${id} (${result.pack.relativeDir})`)
  }
  for (const warning of result.warnings) console.warn(`[WARN] ${id}: ${warning}`)
}

if (failures) {
  console.error(`\nextension-pack validation failed with ${failures} error(s).`)
  process.exit(1)
}

console.log(`\nextension-pack validation passed for ${results.length} pack(s).`)
