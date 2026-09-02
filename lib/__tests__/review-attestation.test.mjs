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
