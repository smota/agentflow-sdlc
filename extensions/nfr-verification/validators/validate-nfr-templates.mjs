#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const NFR_AREAS = [
  'security',
  'privacy and compliance',
  'performance and capacity',
  'reliability',
  'observability',
  'operability',
  'compatibility and versioning',
  'cost',
  'usability and accessibility',
  'maintainability and testability',
  'portability and environment',
]

export const TARGET_REQUIRED_COLUMNS = [
  'ID',
  'Area',
  'Applies',
  'Target or Decision',
  'Verification',
  'Check or Tool',
  'Required',
  'Reason (if not applicable)',
]

export const EVIDENCE_REQUIRED_COLUMNS = [
  'Target ID',
  'Check or Tool',
  'Environment',
  'Candidate Identity',
  'Measured Value',
  'Unit',
  'Threshold',
  'Sample Size',
  'Outcome',
  'Observed At',
  'Origin',
]

function extractTableHeaders(content) {
  const lines = content.split('\n').map((l) => l.trim())
  for (const line of lines) {
    if (line.startsWith('|') && line.endsWith('|')) {
      const columns = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
      if (columns.length > 0 && !columns.every((c) => /^:?-+:?$/.test(c))) {
        return columns
      }
    }
  }
  return []
}

export function validateNfrTemplates(options = {}) {
  const errors = []
  const baseDir = options.cwd ?? process.cwd()

  const defaultTargetsPath = fs.existsSync(path.resolve(baseDir, 'templates/nfr-targets.md'))
    ? path.resolve(baseDir, 'templates/nfr-targets.md')
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../templates/nfr-targets.md')

  const defaultEvidencePath = fs.existsSync(path.resolve(baseDir, 'templates/nfr-evidence.md'))
    ? path.resolve(baseDir, 'templates/nfr-evidence.md')
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../templates/nfr-evidence.md')

  const targetsPath = options.targetsPath ?? defaultTargetsPath
  const evidencePath = options.evidencePath ?? defaultEvidencePath

  if (!fs.existsSync(targetsPath)) {
    errors.push(`Targets template not found at: ${targetsPath}`)
  } else {
    const targetsContent = fs.readFileSync(targetsPath, 'utf8')
    const headers = extractTableHeaders(targetsContent)
    const missingCols = TARGET_REQUIRED_COLUMNS.filter((col) => !headers.includes(col))
    if (missingCols.length > 0) {
      errors.push(`Targets template missing required columns: ${missingCols.join(', ')}`)
    }
    const missingAreas = NFR_AREAS.filter((area) => !targetsContent.toLowerCase().includes(area))
    if (missingAreas.length > 0) {
      errors.push(`Targets template missing required NFR areas: ${missingAreas.join(', ')}`)
    }
  }

  if (!fs.existsSync(evidencePath)) {
    errors.push(`Evidence template not found at: ${evidencePath}`)
  } else {
    const evidenceContent = fs.readFileSync(evidencePath, 'utf8')
    const headers = extractTableHeaders(evidenceContent)
    const missingCols = EVIDENCE_REQUIRED_COLUMNS.filter((col) => !headers.includes(col))
    if (missingCols.length > 0) {
      errors.push(`Evidence template missing required columns: ${missingCols.join(', ')}`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  }
}

export function main() {
  const result = validateNfrTemplates()
  if (!result.ok) {
    for (const err of result.errors) {
      process.stderr.write(`${err}\n`)
    }
    process.exit(1)
  }
  process.stdout.write('NFR templates OK\n')
  process.exit(0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
