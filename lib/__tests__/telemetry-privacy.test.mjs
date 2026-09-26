import { describe, expect, it } from 'vitest'
import { normalizeObservation, metricLabels } from '../observability/events.mjs'

describe('typed telemetry privacy boundary', () => {
  it.each(['method', 'status', 'requestBytes', 'duration', 'errorType'])(
    'rejects secret text under allowed key %s',
    (key) => {
      expect(
        normalizeObservation({ kind: 'github_cli_request', [key]: 'PRIVATE_SECRET' }),
      ).toBeNull()
    },
  )
  it('rejects unknown kinds, prototype keys and arbitrary attributes', () => {
    for (const value of [
      { kind: 'test' },
      { kind: 'toString' },
      { kind: '__proto__' },
      { kind: 'session', detail: 'PRIVATE_SECRET' },
    ]) {
      expect(normalizeObservation(value)).toBeNull()
    }
  })
  it('hashes correlation identifiers and excludes every measurement and digest from metric labels', () => {
    const event = normalizeObservation({
      kind: 'usage',
      runId: 'PRIVATE_RUN',
      inputTokens: 123,
      planDigest: 'a'.repeat(64),
    })
    expect(event.runId).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(event)).not.toContain('PRIVATE_RUN')
    expect(metricLabels(event)).toEqual({ kind: 'usage' })
  })
  it.each([NaN, Infinity, -1, 0.5, '123'])('rejects invalid usage %s', (inputTokens) => {
    expect(normalizeObservation({ kind: 'usage', inputTokens })).toBeNull()
  })
  it('keeps unknown observed response counts distinct from zero', () => {
    expect(
      normalizeObservation({ kind: 'github_cli_request', responseBytes: null, status: null }),
    ).toMatchObject({ responseBytes: null, status: null })
  })
})
