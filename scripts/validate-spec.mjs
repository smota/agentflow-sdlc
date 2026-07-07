import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const jsonOutput = args.includes('--json')

const specFlagIndex = args.indexOf('--spec')
const explicitSpec = specFlagIndex !== -1
const specPath = explicitSpec ? args[specFlagIndex + 1] : 'SPEC.md'

if (explicitSpec && !specPath) {
  process.stderr.write('validate-spec: --spec requires a path argument\n')
  process.exit(2)
}

if (!existsSync(specPath)) {
  if (!explicitSpec) {
    if (jsonOutput) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, skipped: true, reason: 'SPEC.md not found' })}\n`,
      )
    } else {
      process.stdout.write('[validate-spec] SPEC.md not found — nothing to validate, skipping.\n')
    }
    process.exit(0)
  }
  process.stderr.write(`[validate-spec] spec file not found: ${specPath}\n`)
  process.exit(2)
}

const raw = readFileSync(specPath, 'utf8')
const trimmed = raw.trim()

let body
let issueNumber = null

if (trimmed.startsWith('{')) {
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    process.stderr.write(`[validate-spec] ${specPath} looks like JSON but failed to parse\n`)
    process.exit(2)
  }
  if (typeof parsed.body !== 'string') {
    process.stderr.write(`[validate-spec] ${specPath} is JSON but has no "body" string field\n`)
    process.exit(2)
  }
  body = parsed.body
  if (typeof parsed.number === 'number') {
    issueNumber = parsed.number
  }
} else {
  body = raw
}

if (issueNumber === null) {
  const headerMatch = raw.match(/^# Issue #([0-9]+):/m)
  if (headerMatch) issueNumber = Number(headerMatch[1])
}

if (issueNumber === null) {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const branchMatch = branch.match(/^issue\/([0-9]+)-/)
    if (branchMatch) issueNumber = Number(branchMatch[1])
  } catch {
    // git unavailable — issue number stays unresolved
  }
}

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '')
}

function extractSection(text, headingPattern, maxLevel) {
  if (text === null) return null
  const lines = text.split('\n')
  const headingRe = new RegExp(headingPattern)
  const stopRe = new RegExp(`^#{1,${maxLevel}}\\s`)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i + 1
      break
    }
  }
  if (start === -1) return null
  let end = lines.length
  for (let i = start; i < lines.length; i++) {
    if (stopRe.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

function isEffectivelyNone(text) {
  if (text === null) return true
  const stripped = stripComments(text).trim()
  return stripped === '' || stripped === '_None_'
}

const openQuestions = extractSection(body, '^##\\s+Open questions\\b', 2)
const classification = extractSection(body, '^##\\s+Workflow classification\\b', 2)
const businessLogic = extractSection(body, '^##\\s+Business logic\\b', 2)
const acceptanceCriteria = extractSection(body, '^##\\s+Acceptance criteria\\b', 2)
const featureSpecific = extractSection(acceptanceCriteria ?? '', '^###\\s+Feature-specific\\b', 3)
const standardCompliance = extractSection(
  acceptanceCriteria ?? '',
  '^###\\s+Standard compliance\\b',
  3,
)

const checks = {}

checks['issue-number'] =
  issueNumber !== null
    ? { status: 'pass', detail: `Resolved issue #${issueNumber}` }
    : {
        status: 'fail',
        detail:
          'No issue number found ("number" field, "# Issue #N:" header, or issue/<N>-... branch)',
      }

if (openQuestions === null) {
  checks['open-questions'] = {
    status: 'pass',
    detail: "No 'Open questions' section found",
  }
} else {
  const items = stripComments(openQuestions).match(/^- \[ \] .+$/gm) ?? []
  checks['open-questions'] =
    items.length === 0
      ? { status: 'pass', detail: 'No unresolved open questions' }
      : {
          status: 'fail',
          detail: `${items.length} unresolved open question(s)`,
        }
}

const CLASSIFICATION_PLACEHOLDERS = {
  Profile: 'bounded | standard | high-assurance',
  Risk: 'low | medium | high',
  Effort: 'low | medium | high',
  'Change surfaces': 'docs | UI | service | API | data | infra | security',
}

if (classification === null) {
  checks['workflow-classification'] = {
    status: 'pass',
    detail: "No 'Workflow classification' section found (not applicable)",
  }
} else {
  const cleanClassification = stripComments(classification)
  const missing = []
  const unfilled = []
  for (const [label, placeholder] of Object.entries(CLASSIFICATION_PLACEHOLDERS)) {
    const re = new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+)$`, 'm')
    const match = cleanClassification.match(re)
    if (!match) {
      missing.push(label)
    } else if (match[1].trim() === placeholder) {
      unfilled.push(label)
    }
  }
  if (missing.length > 0 || unfilled.length > 0) {
    const parts = []
    if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`)
    if (unfilled.length > 0) parts.push(`unfilled: ${unfilled.join(', ')}`)
    checks['workflow-classification'] = {
      status: 'fail',
      detail: parts.join('; '),
    }
  } else {
    checks['workflow-classification'] = {
      status: 'pass',
      detail: 'Profile, Risk, Effort, and Change surfaces are all filled in',
    }
  }
}

const BR_LINE_RE = /^- \*\*BR-(\d+) \((rule|edge|error)\):\*\*/
const brNumbers = []

if (isEffectivelyNone(businessLogic)) {
  checks['business-rules-numbered'] = {
    status: 'pass',
    detail: 'No business logic (chore)',
  }
} else {
  const lines = stripComments(businessLogic)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '_None_')
  const bulletLines = lines.filter((line) => line.startsWith('- '))
  const malformed = []
  for (const line of bulletLines) {
    const match = line.match(BR_LINE_RE)
    if (match) {
      brNumbers.push(Number(match[1]))
    } else {
      malformed.push(line)
    }
  }
  if (malformed.length > 0) {
    checks['business-rules-numbered'] = {
      status: 'fail',
      detail: `Rule(s) not in "BR-N (rule|edge|error):" format: ${malformed.join('; ')}`,
    }
  } else if (brNumbers.length === 0) {
    checks['business-rules-numbered'] = {
      status: 'fail',
      detail: "'Business logic' is non-empty but defines no BR-N rules",
    }
  } else {
    checks['business-rules-numbered'] = {
      status: 'pass',
      detail: `${brNumbers.length} business rule(s): ${brNumbers.map((n) => `BR-${n}`).join(', ')}`,
    }
  }
}

const featureSpecificItems =
  featureSpecific !== null ? (stripComments(featureSpecific).match(/^- \[[ xX]\]/gm) ?? []) : []
const standardComplianceItems =
  standardCompliance !== null
    ? (stripComments(standardCompliance).match(/^- \[[ xX]\]/gm) ?? [])
    : []

if (acceptanceCriteria === null) {
  checks['acceptance-criteria'] = {
    status: 'pass',
    detail: "No 'Acceptance criteria' section found (not applicable)",
  }
} else {
  const allItems = stripComments(acceptanceCriteria).match(/^- \[[ xX]\]/gm) ?? []
  checks['acceptance-criteria'] =
    allItems.length > 0
      ? {
          status: 'pass',
          detail: `${featureSpecificItems.length} feature-specific, ${standardComplianceItems.length} standard compliance, ${allItems.length} total item(s)`,
        }
      : {
          status: 'fail',
          detail: "'Acceptance criteria' section is present but has no checklist items",
        }
}

const noBusinessLogic = isEffectivelyNone(businessLogic)
const noFeatureSpecificAcs = isEffectivelyNone(featureSpecific)

if (noBusinessLogic && noFeatureSpecificAcs) {
  checks['ac-traceability'] = {
    status: 'pass',
    detail: 'No business logic and no feature-specific ACs (chore)',
  }
} else if (noBusinessLogic && !noFeatureSpecificAcs) {
  checks['ac-traceability'] = {
    status: 'fail',
    detail: "'Feature-specific' ACs exist but 'Business logic' is _None_",
  }
} else if (!noBusinessLogic && noFeatureSpecificAcs) {
  checks['ac-traceability'] = {
    status: 'fail',
    detail:
      "'Business logic' defines BR-N rules but 'Feature-specific' acceptance criteria is _None_",
  }
} else {
  const acEntries = [
    ...stripComments(featureSpecific).matchAll(/^- \[[ xX]\] AC-(\d+) \(BR-(\d+)\):/gm),
  ].map((m) => ({ ac: Number(m[1]), br: Number(m[2]) }))
  const brSet = new Set(brNumbers)
  const acBrSet = new Set(acEntries.map((e) => e.br))
  const issues = []
  if (acEntries.length === 0) {
    issues.push("No 'AC-N (BR-M):' entries found in 'Feature-specific' acceptance criteria")
  }
  for (const entry of acEntries) {
    if (!brSet.has(entry.br)) {
      issues.push(
        `AC-${entry.ac} references BR-${entry.br}, which does not exist in 'Business logic'`,
      )
    }
  }
  for (const br of brNumbers) {
    if (!acBrSet.has(br)) {
      issues.push(`BR-${br} has no corresponding AC-N in 'Feature-specific' acceptance criteria`)
    }
  }
  checks['ac-traceability'] =
    issues.length === 0
      ? {
          status: 'pass',
          detail: `${acEntries.length} AC↔BR mapping(s) verified`,
        }
      : { status: 'fail', detail: issues.join('; ') }
}

const failedChecks = Object.entries(checks).filter(([, check]) => check.status === 'fail')
const ok = failedChecks.length === 0

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify({ ok, issueNumber, checks }, null, 2)}\n`)
} else {
  const issueLabel = issueNumber !== null ? `#${issueNumber}` : 'unknown'
  const lines = [`[validate-spec] ${specPath} — issue ${issueLabel}`, '']
  for (const [name, check] of Object.entries(checks)) {
    lines.push(`  ${check.status.toUpperCase().padEnd(4)}  ${name.padEnd(24)}  ${check.detail}`)
  }
  lines.push('')
  lines.push(
    ok
      ? 'Result: READY — all checks passed'
      : `Result: BLOCKED — ${failedChecks.length} check(s) failed`,
  )
  process.stdout.write(`${lines.join('\n')}\n`)
}

process.exit(ok ? 0 : 1)
