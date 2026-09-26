import { describe, expect, it } from 'vitest'
import {
  createRoleFlowSpan,
  verifySpanChain,
  calculateCycleMetrics,
  exportSpansToCsv,
} from '../audit/role-flow-span.mjs'

describe('Tamper-Evident Role Flow Span Ledger (Issue #277)', () => {
  describe('createRoleFlowSpan', () => {
    it('creates a valid sealed span with SHA-256 digest', () => {
      const span = createRoleFlowSpan({
        taskId: '277',
        role: 'developer',
        phase: 4,
        entryTime: '2026-09-26T10:00:00.000Z',
        exitTime: '2026-09-26T10:15:00.000Z',
        actor: 'agent',
        runtime: 'agy-cli',
        verdict: 'clean',
        prevDigest: 'genesis',
      })

      expect(span.version).toBe(1)
      expect(span.type).toBe('role-flow-span')
      expect(span.taskId).toBe('277')
      expect(span.durationMs).toBe(900000) // 15 mins
      expect(span.digest).toMatch(/^[a-f0-9]{64}$/)
    })

    it('rejects invalid actor or verdict', () => {
      expect(() =>
        createRoleFlowSpan({
          taskId: '277',
          role: 'developer',
          actor: 'unauthorized-bot',
        }),
      ).toThrow(/Invalid actor/)

      expect(() =>
        createRoleFlowSpan({
          taskId: '277',
          role: 'developer',
          verdict: 'approved-maybe',
        }),
      ).toThrow(/Invalid verdict/)
    })
  })

  describe('verifySpanChain', () => {
    it('verifies a valid cryptographically linked chain of spans', () => {
      const span1 = createRoleFlowSpan({
        taskId: '100',
        role: 'analyst',
        phase: 1,
        prevDigest: 'genesis',
      })

      const span2 = createRoleFlowSpan({
        taskId: '100',
        role: 'architect',
        phase: 2,
        prevDigest: span1.digest,
      })

      const span3 = createRoleFlowSpan({
        taskId: '100',
        role: 'developer',
        phase: 4,
        prevDigest: span2.digest,
      })

      const chain = [span1, span2, span3]
      const result = verifySpanChain(chain)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('detects tampering within a span in the chain', () => {
      const span1 = createRoleFlowSpan({
        taskId: '100',
        role: 'developer',
        phase: 4,
        prevDigest: 'genesis',
      })

      // Attacker tampers with the verdict without recalculating digest
      const tamperedSpan = { ...span1, verdict: 'clean' }
      tamperedSpan.verdict = 'revised'

      const result = verifySpanChain([tamperedSpan])
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('invalid or tampered digest')
    })

    it('detects broken chain link if prevDigest is altered', () => {
      const span1 = createRoleFlowSpan({
        taskId: '100',
        role: 'developer',
        phase: 4,
        prevDigest: 'genesis',
      })

      const span2 = createRoleFlowSpan({
        taskId: '100',
        role: 'tester',
        phase: 5,
        prevDigest: '0000000000000000000000000000000000000000000000000000000000000000',
      })

      const result = verifySpanChain([span1, span2])
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('broken chain')
    })
  })

  describe('calculateCycleMetrics', () => {
    it('aggregates durations, actor breakdown, and first pass rate', () => {
      const span1 = createRoleFlowSpan({
        taskId: '1',
        role: 'developer',
        entryTime: '2026-09-26T10:00:00Z',
        exitTime: '2026-09-26T10:30:00Z', // 30m
        actor: 'agent',
        verdict: 'clean',
      })

      const span2 = createRoleFlowSpan({
        taskId: '1',
        role: 'tester',
        entryTime: '2026-09-26T10:30:00Z',
        exitTime: '2026-09-26T10:45:00Z', // 15m
        actor: 'system',
        verdict: 'clean',
      })

      const span3 = createRoleFlowSpan({
        taskId: '1',
        role: 'reviewer',
        entryTime: '2026-09-26T10:45:00Z',
        exitTime: '2026-09-26T10:55:00Z', // 10m
        actor: 'human',
        verdict: 'revised',
      })

      const metrics = calculateCycleMetrics([span1, span2, span3])
      expect(metrics.totalDurationMs).toBe(55 * 60 * 1000)
      expect(metrics.byActor.agent).toBe(30 * 60 * 1000)
      expect(metrics.byActor.human).toBe(10 * 60 * 1000)
      expect(metrics.byActor.system).toBe(15 * 60 * 1000)
      expect(metrics.cleanCount).toBe(2)
      expect(metrics.revisedCount).toBe(1)
      expect(metrics.firstPassRate).toBe(67) // 2 / 3 = 66.6% -> 67%
    })
  })

  describe('exportSpansToCsv', () => {
    it('exports RFC-compliant CSV with headers', () => {
      const span = createRoleFlowSpan({
        taskId: '277',
        role: 'developer',
        phase: 4,
        entryTime: '2026-09-26T12:00:00Z',
        exitTime: '2026-09-26T12:10:00Z',
        actor: 'agent',
        runtime: 'agy-cli',
        verdict: 'clean',
      })

      const csv = exportSpansToCsv([span])
      const lines = csv.split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain('taskId,phase,role,entryTime,exitTime')
      expect(lines[1]).toContain('277,4,"developer"')
    })
  })
})
