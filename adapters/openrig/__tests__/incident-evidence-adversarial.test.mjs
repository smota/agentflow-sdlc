import { describe, it, expect } from 'vitest'
import { summarizeIncidentEvidence } from '../incident-evidence.mjs'
import { createRunEvent } from '../../../lib/core/run-state.mjs'
import { sealDeliveryRecord } from '../../../lib/core/delivery-record.mjs'
const hash = 'a'.repeat(64),
  now = '2026-10-15T12:00:00.000Z'
function proof(patch = {}) {
  return sealDeliveryRecord('verification-observation', {
    id: 'acceptance',
    invocationId: 'fixture',
    criterionId: 'oracle.independentlyAccepted',
    producer: 'fixture-source',
    candidateDigest: hash,
    definitionDigest: hash,
    origin: 'external-resolved',
    isolation: 'cooperative',
    startedAt: now,
    completedAt: now,
    outcome: 'pass',
    assertions: [
      { id: 'oracle.independentlyAccepted', outcome: 'pass' },
      { id: 'oracle.independent-review', outcome: 'pass' },
    ],
    subject: {
      stage: 'independentlyAccepted',
      artifactDigest: hash,
      authorIdentity: 'writer',
      reviewerIdentity: 'reviewer',
    },
    ...patch,
  })
}
function fixture(record) {
  const ref = {
    kind: 'validation',
    system: 'github',
    uri: 'https://example.invalid/review',
    authority: 'authoritative',
    relationship: 'verifies',
    revision: 'fixture-1',
    digest: record.digest,
  }
  const start = createRunEvent({
    runId: 'fixture',
    id: 'start',
    kind: 'started',
    timestamp: now,
    payload: { goalRef: 'issue:528', owner: 'writer', profile: 'standard', boundary: 'observe' },
  })
  const event = createRunEvent({
    runId: 'fixture',
    id: 'proof',
    kind: 'checkpoint',
    previousDigest: start.digest,
    timestamp: now,
    payload: {
      incidentEvidence: {
        version: 1,
        oracle: [
          {
            stage: 'independentlyAccepted',
            artifactDigest: hash,
            candidateDigest: hash,
            evidenceRef: ref,
          },
        ],
      },
    },
  })
  return {
    resolveSource: async () => ({
      source: { kind: 'local-preview', runId: 'fixture' },
      revision: event.digest,
      events: [start, event],
    }),
    resolveEvidence: async ({ eventIdentity }) => ({
      eventId: eventIdentity.eventId,
      eventDigest: eventIdentity.eventDigest,
      revision: ref.revision,
      digest: ref.digest,
      record,
    }),
  }
}
describe('incident proof adverse boundaries (#528)', () => {
  it('records independent acceptance alone without inventing production, calibration or integration', async () => {
    const r = await summarizeIncidentEvidence(fixture(proof()))
    expect(r.oracles[0].states).toEqual({
      produced: 'unknown',
      calibrated: 'unknown',
      independentlyAccepted: 'verified',
      integrated: 'unknown',
    })
    expect(r.assurance).toBe('cooperative')
  })
  it('cannot elevate testimony, same author/reviewer or wrong artifact to independent acceptance', async () => {
    for (const record of [
      proof({ origin: 'human-attested' }),
      proof({ origin: 'agent-reported' }),
      proof({
        subject: {
          stage: 'independentlyAccepted',
          artifactDigest: hash,
          authorIdentity: 'writer',
          reviewerIdentity: 'writer',
        },
      }),
      proof({
        subject: {
          stage: 'independentlyAccepted',
          artifactDigest: 'b'.repeat(64),
          authorIdentity: 'writer',
          reviewerIdentity: 'reviewer',
        },
      }),
      proof({ assertions: [{ id: 'oracle.independentlyAccepted', outcome: 'pass' }] }),
    ])
      expect(
        (await summarizeIncidentEvidence(fixture(record))).oracles[0].states.independentlyAccepted,
      ).toBe('unknown')
  })
  it('bounds unavailable source and evidence readers with explicit unknowns', async () => {
    const a = await summarizeIncidentEvidence({
      resolveSource: () => new Promise(() => {}),
      timeoutMs: 1,
    })
    expect(a.status).toBe('unknown')
    const b = await summarizeIncidentEvidence({
      ...fixture(proof()),
      resolveEvidence: () => new Promise(() => {}),
      timeoutMs: 1,
    })
    expect(b.oracles[0].states.independentlyAccepted).toBe('unknown')
  })
  it('rejects a modified or stale source event before reading external proof', async () => {
    const f = fixture(proof()),
      read = f.resolveSource
    let reads = 0
    const r = await summarizeIncidentEvidence({
      ...f,
      resolveSource: async () => {
        const s = await read()
        s.events[1].payload.incidentEvidence.oracle[0].artifactDigest = 'b'.repeat(64)
        return s
      },
      resolveEvidence: async () => {
        reads++
        return null
      },
    })
    expect(r.status).toBe('unknown')
    expect(reads).toBe(0)
  })
})
