import { createHash } from 'node:crypto'
import { recordDigest, hasCurrentDigest } from '../core/record-digest.mjs'

export const VALID_ACTORS = Object.freeze(['agent', 'human', 'system'])
export const VALID_VERDICTS = Object.freeze(['clean', 'revised', 'failed'])

/**
 * Creates an immutable, tamper-evident Role Flow Span.
 */
export function createRoleFlowSpan({
  taskId,
  role,
  phase,
  entryTime = new Date().toISOString(),
  exitTime = new Date().toISOString(),
  actor = 'agent',
  runtime = 'agy-cli',
  verdict = 'clean',
  prevDigest = 'genesis',
  metadata = {},
} = {}) {
  if (!taskId) throw new Error('taskId is required')
  if (!role) throw new Error('role is required')
  if (!VALID_ACTORS.includes(actor)) {
    throw new Error(`Invalid actor: ${actor}. Must be one of: ${VALID_ACTORS.join(', ')}`)
  }
  if (!VALID_VERDICTS.includes(verdict)) {
    throw new Error(`Invalid verdict: ${verdict}. Must be one of: ${VALID_VERDICTS.join(', ')}`)
  }

  const startMs = new Date(entryTime).getTime()
  const endMs = new Date(exitTime).getTime()
  const durationMs = Math.max(0, endMs - startMs)

  const payload = {
    version: 1,
    type: 'role-flow-span',
    taskId: String(taskId),
    role,
    phase: Number(phase ?? 0),
    entryTime,
    exitTime,
    durationMs,
    actor,
    runtime,
    verdict,
    prevDigest,
    metadata,
  }

  return {
    ...payload,
    digest: recordDigest(payload),
  }
}

/**
 * Verifies a sequential chain of spans for cryptographic integrity.
 */
export function verifySpanChain(spans = []) {
  if (!Array.isArray(spans)) return { valid: false, errors: ['spans must be an array'] }
  if (spans.length === 0) return { valid: true, errors: [] }

  const errors = []

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]
    if (!hasCurrentDigest(span)) {
      errors.push(`Span index ${i} has invalid or tampered digest`)
      continue
    }

    if (i === 0) {
      if (span.prevDigest !== 'genesis' && !/^[a-f0-9]{64}$/.test(span.prevDigest)) {
        errors.push(`Initial span has invalid prevDigest: ${span.prevDigest}`)
      }
    } else {
      const prevSpan = spans[i - 1]
      if (span.prevDigest !== prevSpan.digest) {
        errors.push(
          `Span index ${i} broken chain: prevDigest ${span.prevDigest} does not match previous digest ${prevSpan.digest}`,
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Calculates cycle and defect metrics from an array of spans.
 */
export function calculateCycleMetrics(spans = []) {
  const result = {
    totalDurationMs: 0,
    spansCount: spans.length,
    byRole: {},
    byActor: { agent: 0, human: 0, system: 0 },
    cleanCount: 0,
    revisedCount: 0,
    failedCount: 0,
    firstPassRate: 0,
  }

  for (const span of spans) {
    const duration = span.durationMs || 0
    result.totalDurationMs += duration

    result.byRole[span.role] ??= { count: 0, totalDurationMs: 0 }
    result.byRole[span.role].count += 1
    result.byRole[span.role].totalDurationMs += duration

    if (span.actor in result.byActor) {
      result.byActor[span.actor] += duration
    }

    if (span.verdict === 'clean') result.cleanCount += 1
    else if (span.verdict === 'revised') result.revisedCount += 1
    else if (span.verdict === 'failed') result.failedCount += 1
  }

  const completed = result.cleanCount + result.revisedCount + result.failedCount
  result.firstPassRate = completed > 0 ? Math.round((result.cleanCount / completed) * 100) : 100

  return result
}

/**
 * Exports spans to CSV format for audit reporting.
 */
export function exportSpansToCsv(spans = []) {
  const headers = [
    'taskId',
    'phase',
    'role',
    'entryTime',
    'exitTime',
    'durationMs',
    'actor',
    'runtime',
    'verdict',
    'prevDigest',
    'digest',
  ]

  const rows = spans.map((s) => [
    s.taskId,
    s.phase,
    `"${s.role}"`,
    s.entryTime,
    s.exitTime,
    s.durationMs,
    s.actor,
    `"${s.runtime}"`,
    s.verdict,
    s.prevDigest,
    s.digest,
  ])

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
}
