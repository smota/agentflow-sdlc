import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runProcessPilot } from '../process-pilot.mjs'

describe('production-service process pilot fixture', () => {
  it('replays actual governance events and measures dispatch refusal across recovery', async () => {
    const report = await runProcessPilot({ runId: 'pilot-test-run' })
    expect(report.passed).toBe(true)
    expect(Object.values(report.checks).every(Boolean)).toBe(true)
    expect(report.evidence.eventKinds.filter((kind) => kind === 'grant-issued')).toHaveLength(1)
    expect(report.evidence.eventKinds.filter((kind) => kind === 'operation-admitted')).toHaveLength(
      2,
    )
    expect(report.evidence.eventKinds).toEqual(
      expect.arrayContaining(['paused', 'resumed', 'grant-revoked', 'delegation-safety']),
    )
    expect(report.evidence.dispatches).toEqual(['first', 'second'])
    expect(report.metrics.dispatchCount).toBe(2)
    expect(report.metrics.beforeReplay).toBe(report.metrics.afterReplay)
    expect(report.metrics.beforeRevocationAttempt).toBe(report.metrics.afterRevocationAttempt)
    expect(report.metrics.duplicateEffects).toBe(0)
    expect(report.evidence.staleWriterDenial).toMatch(/Obsolete writer/)
    expect(report.evidence.revocationDenial).toMatch(/REVOKED/)
    expect(report.metrics.grantFencing).toMatchObject({ priorGeneration: 0, nextGeneration: 1 })
    expect(report.metrics.continuationPacketBytes).toBeLessThanOrEqual(
      report.metrics.maxPacketBudgetBytes,
    )
    expect(report.evidence.acknowledgments).toHaveLength(1)
    expect(report.evidence.acknowledgments[0]).toMatchObject({
      eventDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(report.metrics.pendingJournalEntries).toBe(0)
  })

  it('limits assurance to the actual fixture runtime and refuses a live-mode request', async () => {
    const report = await runProcessPilot()
    expect(report.assurance).toMatchObject({
      source: 'non-durable-memory',
      qualification: 'fixture-only',
      writerObservation: 'fixture-controlled',
    })
    expect(report.provenance.executor).toBe('node-single-process-fixture')
    expect(report.provenance.dispatchTargets).toEqual(['in-memory-artifact-adapter'])
    expect(report.unqualified).toEqual(
      expect.arrayContaining([
        'live GitHub durability',
        'process crash recovery',
        'OS writer liveness',
        'CLI/provider harness execution',
        'full S0-S9 delivery qualification',
      ]),
    )
    await expect(runProcessPilot({ fixture: false })).rejects.toThrow(
      /Only the single-process fixture/,
    )
  })

  it('runs through its public CLI and exits nonzero for unsupported live execution', () => {
    const script = fileURLToPath(new URL('../process-pilot.mjs', import.meta.url))
    const fixture = spawnSync(process.execPath, [script, '--fixture'], { encoding: 'utf8' })
    expect(fixture.status, fixture.stderr).toBe(0)
    expect(JSON.parse(fixture.stdout).passed).toBe(true)
    const live = spawnSync(process.execPath, [script, '--live'], { encoding: 'utf8' })
    expect(live.status).toBe(1)
    expect(live.stderr).toMatch(/live qualification is unavailable/)
  })
})
