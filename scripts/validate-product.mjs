#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REQUIRED_SECTIONS = [
  'Vision & Core Job-to-be-Done',
  'System Invariants',
  'Intentions & Tradeoffs',
  'Capability Map & Boundaries',
  'Active Horizon & Anti-Goals',
]

export function validateProductDocument(content) {
  const errors = []
  const capabilities = []

  // Check required sections
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      errors.push(`Missing required section: "${section}"`)
    }
  }

  // Check Job statement
  if (!/When\s+.*,\s*I\s+want\s+to\s+.*,\s*so\s+I\s+can/is.test(content)) {
    errors.push('Missing canonical Job Statement format ("When ..., I want to ..., so I can ...")')
  }

  // Parse capability table
  const lines = content.split('\n')
  let inTable = false
  for (const line of lines) {
    if (line.includes('| Capability ID |') || line.includes('| Module ID |')) {
      inTable = true
      continue
    }
    if (inTable) {
      if (!line.trim().startsWith('|')) {
        inTable = false
        continue
      }
      if (line.includes(':---') || line.includes('---')) continue
      const parts = line
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts.length >= 2) {
        const id = parts[0].replace(/`/g, '')
        if (id && id !== 'module-id') {
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
            errors.push(`Capability ID "${id}" is not valid kebab-case`)
          } else {
            capabilities.push(id)
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    capabilities,
  }
}

function run() {
  const root = process.cwd()
  const candidatePaths = [resolve(root, '.agentflow/PRODUCT.md'), resolve(root, 'PRODUCT.md')]

  const foundPath = candidatePaths.find((p) => existsSync(p))
  if (!foundPath) {
    console.log(
      JSON.stringify(
        { ok: true, skipped: true, reason: 'No PRODUCT.md file found to validate.' },
        null,
        2,
      ),
    )
    process.exit(0)
  }

  const content = readFileSync(foundPath, 'utf8')
  const result = validateProductDocument(content)

  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, file: foundPath, errors: result.errors }, null, 2))
    process.exit(1)
  }

  console.log(
    JSON.stringify({ ok: true, file: foundPath, capabilities: result.capabilities }, null, 2),
  )
  process.exit(0)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? '')) {
  run()
}
