#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const OBSERVATION_ORIGINS = [
  'collector-observed',
  'external-resolved',
  'agent-reported',
  'human-attested',
]

export const OBSERVATION_OUTCOMES = ['pass', 'fail', 'blocked', 'not-run', 'unknown']

function parseMarkdownTable(text, sectionHeader = null) {
  const lines = text.split('\n')
  let startIndex = 0

  if (sectionHeader) {
    let found = false
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`^##\\s+${sectionHeader}\\b`, 'i').test(lines[i])) {
        startIndex = i + 1
        found = true
        break
      }
    }
    if (!found) startIndex = 0
  }

  let tableLines = []
  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      tableLines.push(trimmed)
    } else if (trimmed === '') {
      continue
    } else if (tableLines.length >= 2) {
      break
    }
  }

  if (tableLines.length < 2) return null

  const headers = tableLines[0]
    .split('|')
    .slice(1, -1)
    .map((h) => h.trim().toLowerCase())

  const rows = []
  for (let i = 2; i < tableLines.length; i++) {
    const line = tableLines[i]
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

export function checkNfrEvidence(evidenceText, targetsText = null, options = {}) {
  const findings = []

  if (!evidenceText || typeof evidenceText !== 'string' || !evidenceText.trim()) {
    const f = { code: 'empty-input', message: 'Evidence text is empty' }
    findings.push(f)
    findings.ok = false
    return findings
  }

  const evidenceTable = parseMarkdownTable(evidenceText, 'Non-functional verification evidence')
  if (!evidenceTable || evidenceTable.rows.length === 0) {
    const f = {
      code: 'missing-evidence-table',
      message: 'No evidence table found in evidence text',
    }
    findings.push(f)
    findings.ok = false
    return findings
  }

  const targetsMap = new Map()
  if (targetsText && typeof targetsText === 'string' && targetsText.trim()) {
    const targetsTable = parseMarkdownTable(targetsText, 'Non-functional targets')
    if (targetsTable) {
      for (const row of targetsTable.rows) {
        const id = getField(row, ['id', 'target id'])
        const applies = getField(row, ['applies']).toLowerCase()
        const required = getField(row, ['required']).toLowerCase()
        const area = getField(row, ['area']).toLowerCase()
        if (id) {
          targetsMap.set(id, {
            id,
            applies: applies === 'yes',
            required: required === 'yes',
            area,
          })
        }
      }
    }
  }

  const seenTargetIds = new Set()

  for (let i = 0; i < evidenceTable.rows.length; i++) {
    const row = evidenceTable.rows[i]
    const targetId = getField(row, ['target id', 'target', 'id'])
    const candidateId = getField(row, ['candidate'])
    const measuredVal = getField(row, ['measured'])
    const unit = getField(row, ['unit'])
    const outcomeRaw = getField(row, ['outcome']).toLowerCase()
    const originRaw = getField(row, ['origin']).toLowerCase()
    const threshold = getField(row, ['threshold'])
    const reasonField = getField(row, ['reason', 'notes'])

    if (targetId) seenTargetIds.add(targetId)

    // Outcome vocabulary check
    if (!OBSERVATION_OUTCOMES.includes(outcomeRaw)) {
      findings.push({
        code: 'invalid-outcome',
        row: i + 1,
        targetId,
        outcome: outcomeRaw,
        message: `Outcome "${outcomeRaw}" is outside observation vocabulary (${OBSERVATION_OUTCOMES.join(', ')})`,
      })
    }

    // Origin vocabulary check
    if (!OBSERVATION_ORIGINS.includes(originRaw)) {
      findings.push({
        code: 'invalid-origin',
        row: i + 1,
        targetId,
        origin: originRaw,
        message: `Origin "${originRaw}" is outside observation vocabulary (${OBSERVATION_ORIGINS.join(', ')})`,
      })
    }

    // Pass outcome requirements
    if (outcomeRaw === 'pass') {
      if (!candidateId || candidateId === '-' || candidateId.toLowerCase() === 'none') {
        findings.push({
          code: 'missing-candidate',
          row: i + 1,
          targetId,
          message: `Pass outcome for target "${targetId}" is missing candidate identity`,
        })
      }
      if (!measuredVal || measuredVal === '-' || measuredVal.toLowerCase() === 'none') {
        findings.push({
          code: 'missing-measured-value',
          row: i + 1,
          targetId,
          message: `Pass outcome for target "${targetId}" is missing measured value`,
        })
      }
      if (!unit || unit === '-' || unit.toLowerCase() === 'none') {
        findings.push({
          code: 'missing-unit',
          row: i + 1,
          targetId,
          message: `Pass outcome for target "${targetId}" is missing unit of measurement`,
        })
      }
    }

    // not-run, blocked, unknown must carry a reason
    if (['not-run', 'blocked', 'unknown'].includes(outcomeRaw)) {
      const reasonText = (reasonField || measuredVal || threshold || '').trim()
      if (!reasonText || reasonText === '-' || reasonText.toLowerCase() === 'none') {
        findings.push({
          code: 'missing-not-run-reason',
          row: i + 1,
          targetId,
          outcome: outcomeRaw,
          message: `Outcome "${outcomeRaw}" for target "${targetId}" requires a stated reason`,
        })
      }
    }

    // Check agent-reported policy on required target
    const targetMeta = targetId ? targetsMap.get(targetId) : null
    const isRequired = targetMeta ? targetMeta.required : false
    if (isRequired && outcomeRaw === 'pass' && originRaw === 'agent-reported') {
      if (!options.allowAgentReported) {
        findings.push({
          code: 'disallowed-agent-reported',
          row: i + 1,
          targetId,
          message: `Required target "${targetId}" cannot rest on agent-reported evidence without --allow-agent-reported`,
        })
      }
    }
  }

  // Check that all applicable targets in targetsText have a result row in evidence
  for (const [id, target] of targetsMap.entries()) {
    if (target.applies && !seenTargetIds.has(id)) {
      findings.push({
        code: 'missing-result',
        targetId: id,
        message: `Applicable target "${id}" (${target.area}) has no verification result row`,
      })
    }
  }

  findings.ok = findings.length === 0
  return findings
}

export function main(argv = process.argv.slice(2)) {
  const jsonOutput = argv.includes('--json')
  const allowAgentReported = argv.includes('--allow-agent-reported')

  const targetsIdx = argv.indexOf('--targets')
  let targetsPath = null
  if (targetsIdx !== -1 && argv[targetsIdx + 1]) {
    targetsPath = path.resolve(process.cwd(), argv[targetsIdx + 1])
  }

  const positional = argv.filter(
    (arg, i) => !arg.startsWith('--') && (targetsIdx === -1 || i !== targetsIdx + 1),
  )

  if (positional.length === 0) {
    process.stderr.write(
      'Usage: node check-nfr-evidence.mjs <evidence> [--targets <targets>] [--json] [--allow-agent-reported]\n',
    )
    process.exit(1)
  }

  const evidencePath = path.resolve(process.cwd(), positional[0])
  if (!fs.existsSync(evidencePath)) {
    process.stderr.write(`Evidence file not found: ${evidencePath}\n`)
    process.exit(1)
  }

  const evidenceText = fs.readFileSync(evidencePath, 'utf8')
  let targetsText = null
  if (targetsPath) {
    if (!fs.existsSync(targetsPath)) {
      process.stderr.write(`Targets file not found: ${targetsPath}\n`)
      process.exit(1)
    }
    targetsText = fs.readFileSync(targetsPath, 'utf8')
  }

  const findings = checkNfrEvidence(evidenceText, targetsText, { allowAgentReported })

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`)
  } else if (findings.length === 0) {
    process.stdout.write('NFR evidence table OK\n')
  } else {
    process.stderr.write(`NFR evidence checks failed with ${findings.length} finding(s):\n`)
    for (const f of findings) {
      process.stderr.write(`- [${f.code}] ${f.message}\n`)
    }
  }

  process.exit(findings.length === 0 ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
