import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprintCandidate } from '../verification/workspace.mjs'
import { createLocalCliProvider } from '../providers/local-cli.mjs'

describe('physical observation boundaries', () => {
  it('measures actual candidate UTF-8 reads without changing identity or exposing paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'af-physical-read-'))
    const content = 'é\r\n'
    writeFileSync(join(root, 'private-name.txt'), content)
    const definition = { inputs: ['private-name.txt'] }
    const expected = fingerprintCandidate(root, definition)
    const events = []
    expect(
      fingerprintCandidate(root, definition, { observer: (event) => events.push(event) }),
    ).toEqual(expected)
    expect(events).toEqual([
      { kind: 'file_read', bytes: Buffer.byteLength(content), files: 1, purpose: 'candidate' },
    ])
    expect(
      fingerprintCandidate(root, definition, {
        observer: () => {
          throw new Error('offline')
        },
      }),
    ).toEqual(expected)
  })

  it('reports one dispatch pair and contains async observer failure', async () => {
    const events = []
    const provider = createLocalCliProvider({
      id: 'agy-cli',
      platform: 'agy',
      executable: 'agy',
      executionTarget: 'agy-cli',
      spawn: () => ({ status: 0, stdout: 'private output', stderr: '' }),
      observer: async (event) => {
        events.push(event)
        throw new Error('observer offline')
      },
    })
    const plan = provider.plan({ args: [] })
    expect(provider.execute(plan, { confirm: plan.token }).status).toBe('pass')
    await new Promise((resolve) => setImmediate(resolve))
    expect(events.map((event) => event.state)).toEqual(['started', 'completed'])
    expect(events[0].operationId).toBe(events[1].operationId)
    expect(events[1].duration).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(events)).not.toContain('private output')
  })

  it('normalizes meshloop engineering metrics and enforces privacy boundaries', async () => {
    const { normalizeObservation, metricLabels } = await import('../observability/events.mjs')

    const raw = {
      kind: 'meshloop_engineering_metrics',
      operationId: 'private-op-id-12345',
      astReductionRatio: 0.85,
      lyapunovIterations: 4,
      orphanProcessCount: 0,
      worktreeLockWaitMs: 42.1,
      duration: 1200.5,
    }

    const normalized = normalizeObservation(raw)
    expect(normalized).not.toBeNull()
    expect(normalized.schemaVersion).toBe(1)
    expect(normalized.astReductionRatio).toBe(0.85)
    expect(normalized.lyapunovIterations).toBe(4)
    expect(normalized.orphanProcessCount).toBe(0)
    expect(normalized.worktreeLockWaitMs).toBe(42.1)
    // OperationId is hashed for privacy
    expect(normalized.operationId).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(normalized)).not.toContain('private-op-id-12345')

    // Metric dimensions should not expose unbounded metrics
    const labels = metricLabels(normalized)
    expect(labels).toEqual({ kind: 'meshloop_engineering_metrics' })

    // Invalid ratio > 1 or < 0 must be rejected
    expect(
      normalizeObservation({
        kind: 'meshloop_engineering_metrics',
        astReductionRatio: 1.5,
      }),
    ).toBeNull()

    expect(
      normalizeObservation({
        kind: 'meshloop_engineering_metrics',
        astReductionRatio: -0.1,
      }),
    ).toBeNull()

    // Negative counter must be rejected
    expect(
      normalizeObservation({
        kind: 'meshloop_engineering_metrics',
        lyapunovIterations: -1,
      }),
    ).toBeNull()
  })
})
