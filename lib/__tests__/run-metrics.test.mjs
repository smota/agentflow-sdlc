import { describe, it, expect } from 'vitest'
import { deriveRunMetrics } from '../outcome-metrics.mjs'
import { createRunService } from '../application/run-service.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { loadRunView, renderRunView } from '../cockpit-run-model.mjs'

describe('run metrics and operator projections', () => {
  it('keeps observed and accepted delivery distinct and exposes unknown measurements', () => {
    const e = (id, kind, seconds, payload = {}) => ({
      id,
      runId: 'demo',
      kind,
      timestamp: new Date(seconds * 1000).toISOString(),
      payload,
    })
    const observation = {
      criterionId: 'search',
      invocationId: 'test',
      candidateDigest: 'a'.repeat(64),
      origin: 'collector-observed',
      outcome: 'fail',
      errors: ['stale runtime'],
    }
    const first = e('one', 'observation', 2, { observation })
    const events = [
      e('start', 'started', 0),
      e('developer', 'advanced', 1, { to: 4 }),
      first,
      first,
      e('two', 'observation', 4, { observation: { ...observation, outcome: 'pass', errors: [] } }),
      e('accepted', 'advanced', 6, { to: 5 }),
      e('returned', 'returned', 7, { to: 4, findings: [{ id: 'regression' }] }),
    ]
    const metrics = deriveRunMetrics(events)
    expect(metrics.attempts).toBe(2)
    expect(metrics.firstObservedEvidenceSeconds).toBe(4)
    expect(metrics.firstAcceptedDeliverySeconds).toBe(1)
    expect(metrics.retries).toBe(1)
    expect(metrics.retryCauses['stale runtime']).toBe(1)
    expect(metrics.attemptDetails.map((a) => a.phase)).toEqual([4, 4])
    expect(metrics.returnedFindings).toBe(1)
    expect(metrics.interventions).toBeNull()
    expect(metrics.usage.known).toBe(false)
    expect(() => deriveRunMetrics([first, { ...first, payload: {} }])).toThrow('Conflicting')
  })
  it('replays verified budget observations identically in the service and optional Cockpit', async () => {
    const store = createMemoryRunStore(),
      authority = { owner: 'operator', generation: 0 }
    const service = createRunService({
      store,
      authorize: async () => true,
      budget: { level: 'admission-enforced', unit: 'tokens', limit: 100 },
      observeUsage: async () => ({ verified: true, unit: 'tokens', used: 20 }),
    })
    await service.start({ runId: 'budget', goalRef: 'issue:1', owner: 'operator', authority })
    expect((await service.admitAttempt({ authority, estimatedNext: 10 })).admitted).toBe(true)
    const status = await service.status(),
      view = await loadRunView(store)
    expect(view.status.budget).toEqual(status.budget)
    expect(status.budget.lastAdmission.used).toBe(20)
    expect(view.metrics.usage).toEqual({ used: 20, unit: 'tokens', known: true })
    expect(renderRunView(view)).toContain('100 tokens (admission-enforced)')
    expect((await service.admitAttempt({ authority })).admitted).toBe(false)
    const missingEstimate = await loadRunView(store)
    expect(missingEstimate.status.budget.usageKnown).toBe(true)
    expect(missingEstimate.status.budget.lastAdmission.estimateKnown).toBe(false)
    expect(missingEstimate.metrics.usage).toEqual({ used: 20, unit: 'tokens', known: true })
  })
})
