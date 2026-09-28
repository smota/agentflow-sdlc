import { describe, expect, it } from 'vitest'
import { analyzeObservations } from '../observability/analysis.mjs'
import { metricLabels, normalizeObservation } from '../observability/events.mjs'

describe('process analysis dimensions', () => {
  it('accepts only finite process stages and emits their enum as a metric dimension', () => {
    const event = normalizeObservation({
      kind: 'process_stage',
      stage: 'human-wait',
      duration: 125,
    })
    expect(event).toMatchObject({ kind: 'process_stage', stage: 'human-wait', duration: 125 })
    expect(metricLabels(event)).toEqual({ kind: 'process_stage', stage: 'human-wait' })
    expect(
      normalizeObservation({ kind: 'process_stage', stage: 'PRIVATE_STAGE', duration: 125 }),
    ).toBeNull()
    expect(normalizeObservation({ kind: 'process_stage', stage: 'ci', duration: -1 })).toBeNull()
  })

  it('summarizes observed coordination, wait, CI, and first-evidence durations', () => {
    const report = analyzeObservations([
      { kind: 'process_stage', stage: 'coordination', duration: 10 },
      { kind: 'process_stage', stage: 'coordination', duration: 20 },
      { kind: 'process_stage', stage: 'coordination', duration: 30 },
      { kind: 'process_stage', stage: 'human-wait', duration: 300 },
      { kind: 'process_stage', stage: 'ci', duration: 800 },
      { kind: 'process_stage', stage: 'first-evidence', duration: 1200 },
      { kind: 'process_stage', stage: 'first-evidence', duration: 1600 },
    ])

    expect(report.durationMs).toMatchObject({ coordination: 60, humanWait: 300, ci: 800 })
    expect(report.durationDistributionsMs.coordination).toEqual({
      count: 3,
      totalMs: 60,
      p50Ms: 20,
      p95Ms: 30,
    })
    expect(report.durationDistributionsMs.timeToFirstEvidence).toEqual({
      count: 2,
      totalMs: 2800,
      p50Ms: 1200,
      p95Ms: 1600,
    })
    expect(report.unknowns).not.toContain('time-to-first-evidence')
    expect(report.durationMs.recovery).toBeNull()
  })

  it('keeps absent timing and recovery classification unknown', () => {
    const report = analyzeObservations([
      { kind: 'recovery', outcome: 'resumed', duration: 50 },
      { kind: 'recovery', outcome: 'resumed', duration: 60, temperature: 'unknown' },
    ])

    expect(report.durationMs.coordination).toBeNull()
    expect(report.durationDistributionsMs.humanWait).toEqual({
      count: 0,
      totalMs: null,
      p50Ms: null,
      p95Ms: null,
    })
    expect(report.durationDistributionsMs.timeToFirstEvidence.p95Ms).toBeNull()
    expect(report.recoveryTemperature).toEqual({ cold: 0, warm: 0, unknown: 2 })
    expect(report.unknowns).toContain('time-to-first-evidence')
    expect(report.unknowns).toContain('cold-warm-resume-classification')
  })

  it('reports recovery temperature only from explicit classifications', () => {
    const report = analyzeObservations([
      { kind: 'recovery', outcome: 'resumed', duration: 50, temperature: 'cold' },
      { kind: 'recovery', outcome: 'resumed', duration: 60, temperature: 'warm' },
    ])
    expect(report.recoveryTemperature).toEqual({ cold: 1, warm: 1, unknown: 0 })
    expect(report.unknowns).not.toContain('cold-warm-resume-classification')
    expect(
      normalizeObservation({
        kind: 'recovery',
        outcome: 'resumed',
        duration: 10,
        temperature: 'hot',
      }),
    ).toBeNull()
  })
})
