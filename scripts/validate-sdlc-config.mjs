#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { finding, loadSdlcConfig, report, validateSdlcConfigShape } from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const targetIndex = args.indexOf('--target')
const target = targetIndex === -1 ? process.cwd() : args[targetIndex + 1]
const pathIndex = args.indexOf('--path')
const path = pathIndex === -1 ? 'sdlc.config.json' : args[pathIndex + 1]
const source = existsSync(`${target}/${path}`) ? path : 'defaults/sdlc.config.json'
const config = loadSdlcConfig(target, source)
const shape = validateSdlcConfigShape(config)
const adapterFindings = []
const adapterPath = config.authority?.executionAdapter
if (adapterPath) {
  const resolvedAdapterPath = `${target}/${adapterPath}`
  if (!existsSync(resolvedAdapterPath)) {
    adapterFindings.push(
      finding('high', 'authority.executionAdapter', `execution adapter not found: ${adapterPath}`),
    )
  } else {
    try {
      JSON.parse(readFileSync(resolvedAdapterPath, 'utf8'))
    } catch {
      adapterFindings.push(
        finding(
          'high',
          'authority.executionAdapter',
          `execution adapter does not parse as JSON: ${adapterPath}`,
        ),
      )
    }
  }
}
const result = report([...shape.findings, ...adapterFindings], shape.profile)
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else {
  process.stdout.write(`[validate-sdlc-config] ${source}\n`)
  for (const item of result.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${result.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(result.ok ? 0 : 1)
