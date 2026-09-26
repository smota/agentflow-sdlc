import { describe, expect, it, vi } from 'vitest'
import {
  BoundedGateSweeper,
  createGateTracker,
  DEFAULT_SWEEPER_CONFIG,
  formatRevisionContext,
  GateReason,
  GateResolutionStatus,
  handleWebhookEvent,
  sweepGate,
} from '../gates/gate-sweeper.mjs'

describe('Bounded Evidence Gate Sweeper (#278)', () => {
  const baseTime = 1700000000000 // Fixed epoch for deterministic testing

  it('1. Webhook intake immediately resolves pending gate to passed on success', () => {
    const gate = createGateTracker({
      gateId: 'gate-101',
      taskId: 'task-101',
      now: baseTime,
    })
    expect(gate.status).toBe(GateResolutionStatus.PENDING)

    const updated = handleWebhookEvent(gate, {
      status: 'success',
      timestamp: baseTime + 5000,
    })

    expect(updated.status).toBe(GateResolutionStatus.PASSED)
    expect(updated.gateReason).toBeNull()
    expect(updated.updatedAt).toBe(new Date(baseTime + 5000).toISOString())
  })

  it('2. Webhook failure extracts logs and injects revision context', () => {
    const gate = createGateTracker({
      gateId: 'gate-102',
      taskId: 'task-102',
      now: baseTime,
    })

    const errorLogs = 'Error: test assertion failed on line 42\nExpected 200 OK but got 500'
    const updated = handleWebhookEvent(gate, {
      status: 'failure',
      reason: GateReason.EXTERNAL_FAILURE,
      logs: errorLogs,
      timestamp: baseTime + 8000,
    })

    expect(updated.status).toBe(GateResolutionStatus.FAILED)
    expect(updated.gateReason).toBe(GateReason.EXTERNAL_FAILURE)
    expect(updated.failureLog).toBe(errorLogs)
    expect(updated.revisionContext).toContain('Automated CI Failure Injection')
    expect(updated.revisionContext).toContain(errorLogs)
    expect(updated.revisionContext).toContain('task-102')
  })

  it('3. Dropped webhooks are reconciled on next sweep poll (external CI passed)', () => {
    const gate = createGateTracker({
      gateId: 'gate-103',
      taskId: 'task-103',
      initialPollIntervalMs: 60000, // 1 min
      now: baseTime,
    })

    // Poll before nextPollAt does nothing
    const early = sweepGate(gate, { now: baseTime + 30000 })
    expect(early.action).toBe('idle')
    expect(gate.status).toBe(GateResolutionStatus.PENDING)

    // Poll at or after nextPollAt executes external status check
    const checkMock = vi.fn().mockReturnValue({ status: 'passed' })
    const sweepResult = sweepGate(gate, {
      now: baseTime + 60000,
      checkExternalStatus: checkMock,
    })

    expect(checkMock).toHaveBeenCalledOnce()
    expect(sweepResult.resolved).toBe(true)
    expect(sweepResult.action).toBe('reconciled_passed')
    expect(gate.status).toBe(GateResolutionStatus.PASSED)
  })

  it('4. Reconciling sweeper recovers dropped webhook failure and injects logs into prompt context', () => {
    const gate = createGateTracker({
      gateId: 'gate-104',
      taskId: 'task-104',
      initialPollIntervalMs: 60000,
      now: baseTime,
    })

    const sweepResult = sweepGate(gate, {
      now: baseTime + 65000,
      checkExternalStatus: () => ({
        status: 'failed',
        reason: GateReason.EXTERNAL_FAILURE,
        logs: 'SyntaxError: Unexpected token < in JSON at position 0',
      }),
    })

    expect(sweepResult.resolved).toBe(true)
    expect(sweepResult.action).toBe('reconciled_failed')
    expect(gate.status).toBe(GateResolutionStatus.FAILED)
    expect(gate.failureLog).toContain('SyntaxError')
    expect(gate.revisionContext).toContain('SyntaxError')
  })

  it('5. Hard Bounded Timeout (NFR-01 zero deadlock) resolves silent gates to timed_out', () => {
    const timeoutMs = 30 * 60 * 1000 // 30 minutes
    const gate = createGateTracker({
      gateId: 'gate-105',
      taskId: 'task-105',
      timeoutMs,
      now: baseTime,
    })

    const loggerWarn = vi.fn()
    const sweepResult = sweepGate(gate, {
      now: baseTime + timeoutMs + 1000,
      logger: { warn: loggerWarn },
    })

    expect(sweepResult.resolved).toBe(true)
    expect(sweepResult.action).toBe('timed_out')
    expect(gate.status).toBe(GateResolutionStatus.TIMED_OUT)
    expect(gate.gateReason).toBe(GateReason.TIMEOUT_EXPIRED)
    expect(gate.alerts.length).toBeGreaterThan(0)
    expect(gate.alerts[0].message).toContain('Cockpit Alert')
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('timed out after 1800000ms'))
  })

  it('6. Exponential backoff increases polling interval on consecutive attempts (NFR-03)', () => {
    const initialInterval = 10000 // 10s
    const backoffFactor = 2.0
    const maxInterval = 60000 // 60s
    const gate = createGateTracker({
      gateId: 'gate-106',
      taskId: 'task-106',
      initialPollIntervalMs: initialInterval,
      backoffFactor,
      maxPollIntervalMs: maxInterval,
      now: baseTime,
    })

    let currentTime = baseTime + initialInterval
    const checkUnavailable = () => ({ status: 'unavailable', reason: GateReason.CI_UNAVAILABLE })

    // Attempt 1
    sweepGate(gate, { now: currentTime, checkExternalStatus: checkUnavailable })
    expect(gate.pollAttempts).toBe(1)
    // Next poll interval should be 10000 * (2^0) = 10000 -> nextPollAt = currentTime + 10000
    expect(gate.nextPollAt).toBe(currentTime + 10000)

    // Attempt 2
    currentTime = gate.nextPollAt
    sweepGate(gate, { now: currentTime, checkExternalStatus: checkUnavailable })
    expect(gate.pollAttempts).toBe(2)
    // Next poll interval should be 10000 * (2^1) = 20000 -> nextPollAt = currentTime + 20000
    expect(gate.nextPollAt).toBe(currentTime + 20000)

    // Attempt 3
    currentTime = gate.nextPollAt
    sweepGate(gate, { now: currentTime, checkExternalStatus: checkUnavailable })
    expect(gate.pollAttempts).toBe(3)
    // Next poll interval should be 10000 * (2^2) = 40000 -> nextPollAt = currentTime + 40000
    expect(gate.nextPollAt).toBe(currentTime + 40000)

    // Attempt 4 (capped by maxPollIntervalMs = 60000)
    currentTime = gate.nextPollAt
    sweepGate(gate, { now: currentTime, checkExternalStatus: checkUnavailable })
    expect(gate.pollAttempts).toBe(4)
    // 10000 * (2^3) = 80000, capped at 60000
    expect(gate.nextPollAt).toBe(currentTime + maxInterval)
  })

  it('7. BoundedGateSweeper class coordinates multiple gates and aggregates alerts', () => {
    const sweeper = new BoundedGateSweeper({
      timeoutMs: 10000,
      initialPollIntervalMs: 2000,
    })

    sweeper.registerGate({ gateId: 'g1', taskId: 't1', now: baseTime })
    sweeper.registerGate({ gateId: 'g2', taskId: 't2', now: baseTime })

    // g1 gets webhook success
    sweeper.handleWebhook('g1', { status: 'passed' })
    expect(sweeper.getGate('g1').status).toBe(GateResolutionStatus.PASSED)

    // g2 remains silent until timeout
    const sweepResults = sweeper.sweep({ now: baseTime + 11000 })
    expect(sweepResults.length).toBe(1)
    expect(sweepResults[0].action).toBe('timed_out')
    expect(sweeper.getGate('g2').status).toBe(GateResolutionStatus.TIMED_OUT)

    expect(sweeper.getPendingGates()).toHaveLength(0)
    expect(sweeper.getResolvedGates()).toHaveLength(2)
    expect(sweeper.getAllAlerts()).toHaveLength(1)
  })
})
