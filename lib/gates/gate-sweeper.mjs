/**
 * Bounded Evidence Gate Sweeper
 * Prevents workflow deadlocks via 3-tier resolution:
 * 1. Active Webhook Listener for real-time CI status
 * 2. Background Reconciling Sweeper with exponential backoff
 * 3. Deterministic Hard Bounded Timeout
 */

export const GateResolutionStatus = Object.freeze({
  PENDING: 'pending',
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED_WITH_REASON: 'skipped_with_reason',
  TIMED_OUT: 'timed_out',
})

export const GateReason = Object.freeze({
  NO_CI: 'no_ci',
  NO_CI_CONFIGURED: 'no_ci_configured',
  CI_UNAVAILABLE: 'ci_unavailable',
  TIMEOUT_EXPIRED: 'timeout_expired',
  CI_QUOTA_EXHAUSTED: 'ci_quota_exhausted',
  NETWORK_TIMEOUT: 'network_timeout',
  EXTERNAL_FAILURE: 'external_failure',
})

export const DEFAULT_SWEEPER_CONFIG = Object.freeze({
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  initialPollIntervalMs: 2 * 60 * 1000, // 2 minutes
  backoffFactor: 1.5,
  maxPollIntervalMs: 10 * 60 * 1000, // 10 minutes
  maxRetries: 15,
})

export function createGateTracker(options = {}) {
  if (!options.gateId) {
    throw new Error('gateId is required')
  }

  const now = options.now ? new Date(options.now).getTime() : Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_SWEEPER_CONFIG.timeoutMs
  const initialPollIntervalMs =
    options.initialPollIntervalMs ?? DEFAULT_SWEEPER_CONFIG.initialPollIntervalMs

  return {
    gateId: options.gateId,
    taskId: options.taskId || 'unspecified-task',
    gateType: options.gateType || 'ci_verification',
    status: GateResolutionStatus.PENDING,
    gateReason: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    timeoutAt: now + timeoutMs,
    timeoutMs,
    pollAttempts: 0,
    nextPollAt: now + initialPollIntervalMs,
    pollIntervalMs: initialPollIntervalMs,
    backoffFactor: options.backoffFactor ?? DEFAULT_SWEEPER_CONFIG.backoffFactor,
    maxPollIntervalMs: options.maxPollIntervalMs ?? DEFAULT_SWEEPER_CONFIG.maxPollIntervalMs,
    failureLog: null,
    revisionContext: null,
    alerts: [],
    metadata: { ...options.metadata },
  }
}

export function formatRevisionContext(gate) {
  if (!gate) return ''
  const lines = [
    `### Automated CI Failure Injection`,
    `- **Gate ID:** ${gate.gateId}`,
    `- **Task ID:** ${gate.taskId}`,
    `- **Gate Reason:** ${gate.gateReason || 'unknown'}`,
    `- **Resolved At:** ${gate.updatedAt}`,
  ]
  if (gate.failureLog) {
    lines.push(`- **Failure Log Extraction:**`)
    lines.push('```')
    lines.push(gate.failureLog.trim())
    lines.push('```')
    lines.push(
      `- **Guidance:** Address the failure above in the revision loop before requesting re-verification.`,
    )
  }
  return lines.join('\n')
}

export function handleWebhookEvent(gate, event = {}) {
  if (!gate) throw new Error('gate is required')
  if (gate.status !== GateResolutionStatus.PENDING) {
    return gate // Already resolved
  }

  const now = event.timestamp ? new Date(event.timestamp).getTime() : Date.now()
  const rawStatus = (event.status || event.conclusion || '').toLowerCase()

  if (rawStatus === 'success' || rawStatus === 'passed') {
    gate.status = GateResolutionStatus.PASSED
    gate.gateReason = null
  } else if (rawStatus === 'failure' || rawStatus === 'failed') {
    gate.status = GateResolutionStatus.FAILED
    gate.gateReason = event.reason || GateReason.EXTERNAL_FAILURE
    gate.failureLog = event.logs || event.failureLog || ''
    gate.revisionContext = formatRevisionContext(gate)
  } else if (rawStatus === 'skipped' || rawStatus === 'no_ci' || rawStatus === 'neutral') {
    gate.status = GateResolutionStatus.SKIPPED_WITH_REASON
    gate.gateReason = event.reason || GateReason.NO_CI_CONFIGURED
  }

  gate.updatedAt = new Date(now).toISOString()
  return gate
}

export function sweepGate(
  gate,
  { now = Date.now(), checkExternalStatus = null, logger = null } = {},
) {
  if (!gate) throw new Error('gate is required')
  if (gate.status !== GateResolutionStatus.PENDING) {
    return { gate, resolved: true, action: 'none' }
  }

  const currentTime = typeof now === 'number' ? now : new Date(now).getTime()

  // 1. Hard Bounded Timeout check (Zero deadlock invariant)
  if (currentTime >= gate.timeoutAt) {
    gate.status = GateResolutionStatus.TIMED_OUT
    gate.gateReason = GateReason.TIMEOUT_EXPIRED
    gate.updatedAt = new Date(currentTime).toISOString()

    const alert = {
      level: 'warning',
      timestamp: gate.updatedAt,
      gateId: gate.gateId,
      message: `[Cockpit Alert] Gate ${gate.gateId} timed out after ${gate.timeoutMs}ms without evidence. Sweeper transitioning to Blocked (Timeout).`,
    }
    gate.alerts.push(alert)
    if (logger?.warn) {
      logger.warn(alert.message)
    }

    return { gate, resolved: true, action: 'timed_out', alert }
  }

  // 2. Reconciling Poller check
  if (currentTime >= gate.nextPollAt) {
    gate.pollAttempts += 1

    // Exponential backoff calculation for next interval
    const nextInterval = Math.min(
      Math.round(gate.pollIntervalMs * Math.pow(gate.backoffFactor, gate.pollAttempts - 1)),
      gate.maxPollIntervalMs,
    )
    gate.nextPollAt = currentTime + nextInterval
    gate.updatedAt = new Date(currentTime).toISOString()

    if (checkExternalStatus) {
      const externalResult = checkExternalStatus(gate)
      if (externalResult) {
        const rawStatus = (externalResult.status || externalResult.conclusion || '').toLowerCase()
        if (rawStatus === 'success' || rawStatus === 'passed') {
          gate.status = GateResolutionStatus.PASSED
          gate.gateReason = null
          return { gate, resolved: true, action: 'reconciled_passed' }
        } else if (rawStatus === 'failure' || rawStatus === 'failed') {
          gate.status = GateResolutionStatus.FAILED
          gate.gateReason = externalResult.reason || GateReason.EXTERNAL_FAILURE
          gate.failureLog = externalResult.logs || externalResult.failureLog || ''
          gate.revisionContext = formatRevisionContext(gate)
          return { gate, resolved: true, action: 'reconciled_failed' }
        } else if (
          rawStatus === 'skipped' ||
          rawStatus === 'no_ci' ||
          externalResult.reason === GateReason.NO_CI
        ) {
          gate.status = GateResolutionStatus.SKIPPED_WITH_REASON
          gate.gateReason = externalResult.reason || GateReason.NO_CI_CONFIGURED
          return { gate, resolved: true, action: 'reconciled_skipped' }
        } else if (
          rawStatus === 'unavailable' ||
          externalResult.reason === GateReason.CI_UNAVAILABLE ||
          externalResult.reason === GateReason.CI_QUOTA_EXHAUSTED
        ) {
          const alert = {
            level: 'info',
            timestamp: gate.updatedAt,
            gateId: gate.gateId,
            message: `[Sweeper Poller] External CI check returned ${externalResult.reason || 'unavailable'} on attempt ${gate.pollAttempts}. Retrying with exponential backoff.`,
          }
          gate.alerts.push(alert)
          if (logger?.info) logger.info(alert.message)
        }
      }
    }

    return { gate, resolved: false, action: 'polled' }
  }

  return { gate, resolved: false, action: 'idle' }
}

export class BoundedGateSweeper {
  constructor(options = {}) {
    this.gates = new Map()
    this.options = { ...DEFAULT_SWEEPER_CONFIG, ...options }
    this.alerts = []
    this.logger = options.logger || console
  }

  registerGate(options = {}) {
    const gate = createGateTracker({
      ...this.options,
      ...options,
    })
    this.gates.set(gate.gateId, gate)
    return gate
  }

  getGate(gateId) {
    return this.gates.get(gateId)
  }

  handleWebhook(gateId, event = {}) {
    const gate = this.gates.get(gateId)
    if (!gate) {
      throw new Error(`Gate not found: ${gateId}`)
    }
    return handleWebhookEvent(gate, event)
  }

  sweep({ now = Date.now(), checkExternalStatus = null } = {}) {
    const results = []
    for (const gate of this.gates.values()) {
      if (gate.status === GateResolutionStatus.PENDING) {
        const res = sweepGate(gate, { now, checkExternalStatus, logger: this.logger })
        if (res.alert) {
          this.alerts.push(res.alert)
        }
        results.push(res)
      }
    }
    return results
  }

  getPendingGates() {
    return Array.from(this.gates.values()).filter((g) => g.status === GateResolutionStatus.PENDING)
  }

  getResolvedGates() {
    return Array.from(this.gates.values()).filter((g) => g.status !== GateResolutionStatus.PENDING)
  }

  getAllAlerts() {
    return [...this.alerts]
  }
}
