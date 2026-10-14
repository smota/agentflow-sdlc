import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const VALID_CATEGORIES = [
  'crash',
  'ergonomics-friction',
  'edge-case',
  'performance-regression',
]

export const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low']

export const DEFAULT_INTAKE_DIR = '.agentflow/intake'

/**
 * Normalizes repro steps to an array of trimmed string steps.
 */
export function normalizeReproSteps(repro) {
  if (Array.isArray(repro)) {
    return repro.map((step) => String(step).trim()).filter(Boolean)
  }
  if (typeof repro === 'string') {
    return repro
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * Validates an intake finding against schema requirements.
 */
export function validateFinding(finding) {
  const errors = []
  if (!finding || typeof finding !== 'object') {
    return { valid: false, errors: ['Finding must be a non-null object'] }
  }

  if (!finding.findingId || typeof finding.findingId !== 'string') {
    errors.push('findingId is required and must be a non-empty string')
  }

  if (!finding.timestamp || typeof finding.timestamp !== 'string') {
    errors.push('timestamp is required and must be a string')
  } else if (Number.isNaN(Date.parse(finding.timestamp))) {
    errors.push('timestamp must be a valid ISO-8601 date string')
  }

  if (!finding.commitSha || typeof finding.commitSha !== 'string' || finding.commitSha.length < 7) {
    errors.push('commitSha is required and must be at least 7 characters')
  }

  if (!VALID_CATEGORIES.includes(finding.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(', ')}`)
  }

  const steps = normalizeReproSteps(finding.reproSteps)
  if (steps.length === 0) {
    errors.push('reproSteps must contain at least one step or command')
  }

  if (!finding.observedOutput || typeof finding.observedOutput !== 'string') {
    errors.push('observedOutput is required and must be a non-empty string')
  }

  if (!finding.expectedProgress || typeof finding.expectedProgress !== 'string') {
    errors.push('expectedProgress is required and must be a non-empty string')
  }

  if (!VALID_SEVERITIES.includes(finding.severity)) {
    errors.push(`severity must be one of: ${VALID_SEVERITIES.join(', ')}`)
  }

  if (!finding.jtbdPushForce) {
    errors.push('jtbdPushForce is required')
  } else if (
    typeof finding.jtbdPushForce !== 'string' &&
    typeof finding.jtbdPushForce !== 'object'
  ) {
    errors.push('jtbdPushForce must be a string or structured object')
  } else if (
    typeof finding.jtbdPushForce === 'object' &&
    (!finding.jtbdPushForce.struggle || !finding.jtbdPushForce.desiredProgress)
  ) {
    errors.push('jtbdPushForce object must include both struggle and desiredProgress')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Computes a deterministic SHA-256 fingerprint for deduplication.
 */
export function computeFindingFingerprint(finding) {
  const category = (finding.category || '').toLowerCase().trim()
  const component = (finding.targetComponent || '').toLowerCase().trim()
  const steps = normalizeReproSteps(finding.reproSteps).join('\n')
  const observed = (finding.observedOutput || '').trim().replace(/\s+/g, ' ')

  const payload = [category, component, steps, observed].join('::')
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Creates and formats a validated finding object.
 */
export function createFinding(params = {}) {
  const normalizedSteps = normalizeReproSteps(params.reproSteps)
  const category = params.category || 'ergonomics-friction'
  const component = params.targetComponent || ''

  const candidate = {
    category,
    targetComponent: component,
    reproSteps: normalizedSteps,
    observedOutput: params.observedOutput || '',
  }

  const fingerprint = params.fingerprint || computeFindingFingerprint(candidate)
  const shortHash = fingerprint.slice(0, 12)
  const findingId = params.findingId || `finding-${shortHash}`

  const finding = {
    findingId,
    timestamp: params.timestamp || new Date().toISOString(),
    commitSha: params.commitSha || 'unknown',
    category,
    targetComponent: component || undefined,
    reproSteps: normalizedSteps,
    observedOutput: params.observedOutput || '',
    expectedProgress: params.expectedProgress || '',
    severity: params.severity || 'medium',
    jtbdPushForce: params.jtbdPushForce || '',
    fingerprint,
    queueStatus: params.queueStatus || 'intake',
    metadata: params.metadata || {},
  }

  // Remove undefined keys
  for (const key of Object.keys(finding)) {
    if (finding[key] === undefined) delete finding[key]
  }

  const { valid, errors } = validateFinding(finding)
  if (!valid) {
    const error = new Error(`Invalid finding: ${errors.join('; ')}`)
    error.errors = errors
    throw error
  }

  return finding
}

/**
 * Saves a finding to local storage (.agentflow/intake/finding-<id>.json).
 * Optionally deduplicates against existing findings by fingerprint.
 */
export function saveFindingLocally(finding, options = {}) {
  const intakeDir = resolve(
    options.targetDir || process.cwd(),
    options.intakeDir || DEFAULT_INTAKE_DIR,
  )
  const dedup = options.dedup !== false

  mkdirSync(intakeDir, { recursive: true })

  if (dedup && finding.fingerprint) {
    const existing = loadLocalFindings(intakeDir)
    const match = existing.find((f) => f.fingerprint === finding.fingerprint)
    if (match) {
      return {
        saved: false,
        duplicate: true,
        finding: match,
        path: join(intakeDir, `${match.findingId}.json`),
      }
    }
  }

  const outPath = join(intakeDir, `${finding.findingId}.json`)
  writeFileSync(outPath, JSON.stringify(finding, null, 2), 'utf8')

  return {
    saved: true,
    duplicate: false,
    path: outPath,
    finding,
  }
}

/**
 * Loads all local findings from the intake directory.
 */
export function loadLocalFindings(intakeDir = DEFAULT_INTAKE_DIR) {
  const dirPath = resolve(intakeDir)
  if (!existsSync(dirPath)) return []

  const files = readdirSync(dirPath)
  const findings = []

  for (const file of files) {
    if (file.endsWith('.json') && file.startsWith('finding-')) {
      try {
        const content = readFileSync(join(dirPath, file), 'utf8')
        const parsed = JSON.parse(content)
        findings.push(parsed)
      } catch {
        // Skip unparseable files
      }
    }
  }

  return findings
}

/**
 * Formats and connects a finding to a backlog capability intake queue item.
 */
export function connectToBacklogQueue(finding, options = {}) {
  const pushForceText =
    typeof finding.jtbdPushForce === 'object'
      ? `Struggle: ${finding.jtbdPushForce.struggle}\nDesired Progress: ${finding.jtbdPushForce.desiredProgress}`
      : String(finding.jtbdPushForce)

  const summary =
    typeof finding.jtbdPushForce === 'object'
      ? finding.jtbdPushForce.desiredProgress
      : String(finding.jtbdPushForce).slice(0, 70)

  const componentPrefix = finding.targetComponent ? `[${finding.targetComponent}] ` : ''
  const title = `capability: ${componentPrefix}${summary}`

  const reproText = normalizeReproSteps(finding.reproSteps)
    .map((step, idx) => `${idx + 1}. \`${step}\``)
    .join('\n')

  const body = [
    `<!-- agentflow-work:{"kind":"capability","changeClass":"standard","admission":"intake"} -->`,
    `**Kind:** capability`,
    `**Triage:** intake`,
    `**Category:** ${finding.category}`,
    `**Severity:** ${finding.severity}`,
    `**Observed Commit:** ${finding.commitSha}`,
    `**Finding ID:** \`${finding.findingId}\``,
    `**Fingerprint:** \`${finding.fingerprint || ''}\``,
    '',
    `## Job / Push Force`,
    pushForceText,
    '',
    `## Observed Friction`,
    finding.observedOutput,
    '',
    `## Expected Progress`,
    finding.expectedProgress,
    '',
    `## Deterministic Reproduction`,
    reproText,
  ].join('\n')

  const queueItem = {
    kind: 'capability',
    triage: 'intake',
    title,
    body,
    findingId: finding.findingId,
    fingerprint: finding.fingerprint,
    severity: finding.severity,
    category: finding.category,
    createdAt: finding.timestamp,
  }

  const dryRun = options.dryRun === true
  let queuePath = null

  if (!dryRun && options.queuePath) {
    queuePath = resolve(options.queuePath)
    mkdirSync(resolve(queuePath, '..'), { recursive: true })

    let queue = []
    if (existsSync(queuePath)) {
      try {
        queue = JSON.parse(readFileSync(queuePath, 'utf8'))
        if (!Array.isArray(queue)) queue = []
      } catch {
        queue = []
      }
    }

    const exists = queue.some((item) => item.fingerprint === finding.fingerprint)
    if (!exists) {
      queue.push(queueItem)
      writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf8')
    }
  }

  return {
    queueItem,
    enqueued: !dryRun && Boolean(queuePath),
    queuePath,
  }
}
