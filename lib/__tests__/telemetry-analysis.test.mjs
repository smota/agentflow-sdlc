import { describe, it, expect } from 'vitest'
import { analyzeObservations } from '../observability/analysis.mjs'

describe('process observation analysis', () => {
  it('uses actual denominators and keeps CLI calls distinct from HTTP', () => {
    const report = analyzeObservations([
      { kind: 'github_cli_request', requestBytes: 2, responseBytes: 7 },
      { kind: 'github_client_request', requestBytes: 3, responseBytes: 11 },
      { kind: 'run_event_appended', eventKind: 'checkpoint' },
      { kind: 'run_event_appended', eventKind: 'completed' },
      { kind: 'context_admitted', bytes: 100, repeatedBytes: 25 },
    ])
    expect(report.sourceHttp.callsPerAcceptedDelivery).toBe(1)
    expect(report.sourceCli.responseBytesPerCheckpoint).toBe(7)
    expect(report.context.repeatedRatio).toBe(0.25)
    expect(report.usage.totalTokens).toBeNull()
    expect(report.losses).toBeNull()
  })
  it('does not turn missing evidence into zero measurements or invent denominators', () => {
    const report = analyzeObservations([{ kind: 'usage', totalTokens: 9, secret: 'private' }])
    expect(report.rejectedRecords).toBe(1)
    expect(report.sourceHttp.callsPerAcceptedDelivery).toBeNull()
    expect(report.context.repeatedRatio).toBeNull()
    expect(report.durationMs.execution).toBeNull()
    expect(JSON.stringify(report)).not.toContain('private')
  })
})
