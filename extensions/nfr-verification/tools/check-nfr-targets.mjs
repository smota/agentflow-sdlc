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

function extractTargetsSection(text) {
  const lines = text.split('\n')
  let startIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Non-functional targets\b/i.test(lines[i])) {
      startIndex = i + 1
      break
    }
  }

  // If heading not found, fallback to full text
  if (startIndex === -1) {
    return text
  }

  let endIndex = lines.length
  for (let i = startIndex; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIndex = i
      break
    }
  }

  return lines.slice(startIndex, endIndex).join('\n')
}

function parseMarkdownTable(sectionText) {
  const lines = sectionText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|'))

  if (lines.length < 2) return null

  const headerLine = lines[0]
  const headers = headerLine
    .split('|')
    .slice(1, -1)
    .map((h) => h.trim().toLowerCase())

  const rows = []
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]
    if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(line)) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    const row = {}
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? ''
    })
    rows.push(row)
  }

  return { headers, rows }
}

function getField(row, patterns) {
  for (const [key, value] of Object.entries(row)) {
    for (const pattern of patterns) {
      if (key.includes(pattern)) return value
    }
  }
  return ''
}

export function checkNfrTargets(text) {
  const findings = []

  if (!text || typeof text !== 'string' || !text.trim()) {
    const f = {
      code: 'empty-input',
      message: 'Targets text is empty',
    }
    findings.push(f)
    findings.ok = false
    return findings
  }

  const section = extractTargetsSection(text)
  const table = parseMarkdownTable(section)

  if (!table || table.rows.length === 0) {
    const f = {
      code: 'missing-table',
      message: 'No non-functional targets table found under ## Non-functional targets',
    }
    findings.push(f)
    findings.ok = false
    return findings
  }

  const seenAreas = new Set()

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i]
    const areaRaw = getField(row, ['area'])
    const appliesRaw = getField(row, ['applies']).toLowerCase()
    const targetRaw = getField(row, ['target', 'decision'])
    const reasonRaw = getField(row, ['reason'])

    if (!areaRaw || areaRaw === '-' || areaRaw.toLowerCase() === 'none') {
      findings.push({
        code: 'blank-area',
        row: i + 1,
        message: `Row ${i + 1} has a blank area`,
      })
      continue
    }

    const areaNorm = areaRaw.toLowerCase()
    if (!NFR_AREAS.includes(areaNorm)) {
      findings.push({
        code: 'unknown-area',
        area: areaRaw,
        row: i + 1,
        message: `Unknown NFR area: "${areaRaw}"`,
      })
      continue
    }

    seenAreas.add(areaNorm)

    if (appliesRaw === 'yes') {
      if (!targetRaw || targetRaw === '-' || targetRaw.toLowerCase() === 'none') {
        findings.push({
          code: 'missing-target',
          area: areaNorm,
          row: i + 1,
          message: `Applies row for "${areaNorm}" is missing a target or decision`,
        })
      }
    } else if (appliesRaw === 'no') {
      if (!reasonRaw || reasonRaw === '-' || reasonRaw.toLowerCase() === 'none') {
        findings.push({
          code: 'missing-reason',
          area: areaNorm,
          row: i + 1,
          message: `Not applicable row for "${areaNorm}" is missing a reason`,
        })
      }
    } else {
      findings.push({
        code: 'invalid-applies',
        area: areaNorm,
        row: i + 1,
        message: `Area "${areaNorm}" has invalid applies value "${appliesRaw}"; must be "yes" or "no"`,
      })
    }
  }

  for (const area of NFR_AREAS) {
    if (!seenAreas.has(area)) {
      findings.push({
        code: 'missing-area',
        area,
        message: `Missing required NFR area: "${area}"`,
      })
    }
  }

  findings.ok = findings.length === 0
  return findings
}

export function main(argv = process.argv.slice(2)) {
  const jsonOutput = argv.includes('--json')
  const fileArgs = argv.filter((arg) => !arg.startsWith('--'))

  if (fileArgs.length === 0) {
    process.stderr.write('Usage: node check-nfr-targets.mjs <file> [--json]\n')
    process.exit(1)
  }

  const filePath = path.resolve(process.cwd(), fileArgs[0])
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`File not found: ${filePath}\n`)
    process.exit(1)
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const findings = checkNfrTargets(content)

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`)
  } else if (findings.length === 0) {
    process.stdout.write('NFR targets table OK\n')
  } else {
    process.stderr.write(`NFR target checks failed with ${findings.length} finding(s):\n`)
    for (const f of findings) {
      process.stderr.write(`- [${f.code}] ${f.message}\n`)
    }
  }

  process.exit(findings.length === 0 ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
