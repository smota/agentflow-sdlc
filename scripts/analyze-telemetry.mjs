#!/usr/bin/env node
import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { analyzeObservations } from '../lib/observability/analysis.mjs'

export function analyzeSpool(directory) {
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Spool directory must not be a link')
  const events = []
  let bytes = 0
  let invalidFiles = 0
  let traceFiles = 0
  const files = readdirSync(directory)
  if (files.length > 4096) throw new Error('Spool entry limit exceeded')
  for (const name of files) {
    if (!/^af-otel-v1-\d+-[a-f0-9-]{36}\.json$/.test(name)) continue
    const file = resolve(directory, name)
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      invalidFiles++
      continue
    }
    bytes += stat.size
    if (stat.size > 8 * 1024 * 1024 || bytes > 32 * 1024 * 1024)
      throw new Error('Spool byte limit exceeded')
    try {
      const record = JSON.parse(readFileSync(file, 'utf8'))
      if (
        record.version !== 1 ||
        createHash('sha256').update(JSON.stringify(record.payload)).digest('hex') !== record.sha256
      )
        throw new Error('Invalid record')
      if (record.payload.kind !== 'traces') continue
      if (!Array.isArray(record.payload.records)) throw new Error('Invalid trace records')
      traceFiles++
      for (const span of record.payload.records) {
        if (span.name === 'agentflow.session') continue
        const { schemaVersion, ...event } = span.attributes ?? {}
        if (schemaVersion !== 1) {
          invalidFiles++
          continue
        }
        events.push(event)
      }
    } catch {
      invalidFiles++
    }
  }
  return {
    ...analyzeObservations(events),
    input: { traceFiles, invalidFiles, bytes },
    runtime: { node: process.version, platform: process.platform },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node scripts/analyze-telemetry.mjs <spool-directory>')
    process.stdout.write(`${JSON.stringify(analyzeSpool(resolve(process.argv[2])), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
