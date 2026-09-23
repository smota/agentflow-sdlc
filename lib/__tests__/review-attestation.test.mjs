import { describe, expect, it } from 'vitest'
import {
  computeReviewDigest,
  createReviewAttestation,
  validateReviewAttestation,
} from '../core/review-attestation.mjs'

describe('digest-bound review attestations', () => {
  it('produces an order-independent path-and-content digest', () => {
    const entries = [
      { path: 'b.txt', content: Buffer.from('b') },
      { path: 'a.txt', content: Buffer.from('a') },
    ]
    expect(computeReviewDigest(entries)).toBe(computeReviewDigest([...entries].reverse()))
  })

  it('rejects agreement bound to a stale digest', () => {
    const digest = 'a'.repeat(64)
    const attestation = createReviewAttestation({
      subject: 'issue:188',
      reviewedDigest: digest,
      reviewer: { platform: 'claude', executor: 'claude-cli', independence: 'independent' },
      decision: 'agree',
      timestamp: '2026-09-01T15:00:00Z',
    })
    expect(validateReviewAttestation(attestation, { expectedDigest: digest }).ok).toBe(true)
    expect(validateReviewAttestation(attestation, { expectedDigest: 'b'.repeat(64) })).toEqual({
      ok: false,
      errors: ['reviewedDigest is stale'],
    })
  })
})

describe('attestation timestamp', () => {
  const base = {
    version: 1,
    subject: 'role-pass',
    reviewedDigest: 'a'.repeat(64),
    decision: 'agree',
    reviewer: { platform: 'human', executor: 'human', independence: 'human-gate' },
    findings: [],
  }

  // An attestation without a real instant cannot be reasoned about for freshness. The field used to
  // be accepted in any shape at all, which made "timestamped" a claim the record did not support.
  it('refuses an attestation whose timestamp is absent or not an instant', () => {
    expect(validateReviewAttestation(base).ok).toBe(false)
    expect(validateReviewAttestation({ ...base, timestamp: undefined }).ok).toBe(false)
    expect(validateReviewAttestation({ ...base, timestamp: 'not-a-date' }).ok).toBe(false)
    expect(validateReviewAttestation({ ...base, timestamp: 12345 }).ok).toBe(false)
  })

  it('accepts an ISO-8601 instant', () => {
    expect(validateReviewAttestation({ ...base, timestamp: '2026-09-12T10:00:00Z' }).ok).toBe(true)
  })
})
