import { describe, expect, it } from 'vitest'
import { runProcessPilot } from '../process-pilot.mjs'

describe('Process Pilot and Retrospective Dataset (S9)', () => {
  it('runs autonomous pilot with injected fault and confirms zero duplicate effects', async () => {
    const report = await runProcessPilot({ fixture: true, runId: 'pilot-test-run' })

    expect(report.passed).toBe(true)
    expect(report.runId).toBe('pilot-test-run')
    expect(report.metrics.unacknowledgedLosses).toBe(0)
    expect(report.metrics.duplicateEffects).toBe(0)
    expect(report.metrics.continuationPacketBytes).toBeLessThanOrEqual(
      report.metrics.maxPacketBudgetBytes,
    )
    expect(report.metrics.grantFencing.priorGeneration).toBe(0)
    expect(report.metrics.grantFencing.nextGeneration).toBe(1)
    expect(report.provenance.executor).toBe('antigravity-orchestrator')
    expect(report.provenance.dispatchTargets).toEqual(['agy-cli', 'grok-cli', 'claude-cli'])
  })
})
