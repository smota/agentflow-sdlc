import { describe, it, expect } from 'vitest'
import { summarizeIncidentEvidence } from '../incident-evidence.mjs'
import { createRunEvent } from '../../../lib/core/run-state.mjs'
import { recordDigest } from '../../../lib/core/record-digest.mjs'
import { sealDeliveryRecord } from '../../../lib/core/delivery-record.mjs'
const hash = 'a'.repeat(64),
  now = '2026-10-15T12:00:00.000Z'
function receipt(overrides = {}) {
  return {
    version: 1,
    subject: 'fixture',
    status: 'failed',
    requestDigest: hash,
    planDigest: hash,
    actual: {
      platform: 'pi',
      target: 'pi-parent',
      transport: 'local-process',
      model: 'qwen/qwen3.8-27b',
    },
    boundaries: {
      requested: 'observe',
      effective: null,
      enforced: null,
      observed: null,
      declared: 'observe',
    },
    revision: { source: 'provider-revision', workspaceFingerprint: null },
    writerLease: { id: 'fixture-lease', owner: 'fixture-writer', status: 'held' },
    timing: { startedAt: now, completedAt: now, timeoutMs: 0, cancelled: false },
    digests: { artifacts: hash, changes: hash, output: hash },
    executionIntentSource: { provider: 'pi', declared: [], resolutions: [] },
    cleanup: { status: 'not-required', actions: [] },
    disclosure: { authorized: false, scope: 'fixture' },
    redaction: { applied: true, policy: 'fixture' },
    inputRefs: [],
    outputRefs: [],
    validationRefs: [],
    metadata: { structuredError: { code: 'insufficient_quota', status: 429 } },
    ...overrides,
  }
}
function fixture(record = receipt(), envelope = {}) {
  const ref = {
    kind: 'validation',
    system: 'github',
    uri: 'https://example.invalid/receipt',
    authority: 'authoritative',
    relationship: 'verifies',
    revision: 'receipt-revision',
    digest: recordDigest(record),
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
    id: 'incident-1',
    previousDigest: start.digest,
    kind: 'checkpoint',
    timestamp: now,
    payload: {
      incidentEvidence: {
        version: 1,
        executionRef: ref,
        configuredIntent: { runtime: 'codex', model: 'desired-only' },
        ...envelope,
      },
    },
  })
  const source = {
    kind: 'github',
    runId: 'fixture',
    repo: 'fixture/repo',
    branch: 'agentflow-state',
    path: 'runs/fixture.json',
  }
  return {
    event,
    ref,
    record,
    source,
    events: [start, event],
    resolveSource: async () => ({
      source,
      revision: event.digest,
      sourceRevision: 'source-head-1',
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
describe('source-backed incident reporting (#528)', () => {
  it('counts one structured failure with actual receipt attribution and separate intent', async () => {
    const f = fixture()
    const r = await summarizeIncidentEvidence(f)
    expect(r.failures).toBe(1)
    expect(r.incidents[0]).toMatchObject({
      classification: 'quota-exhausted',
      actual: { runtime: 'pi', model: 'qwen/qwen3.8-27b', providerRoute: null, effort: null },
      configuredIntent: { runtime: 'codex' },
    })
    expect(r.assurance).toBe('cooperative')
    expect(r.incidents[0].identity.eventDigest).toBe(f.event.digest)
  })
  it('never counts usage metadata or prose as failures', async () => {
    for (const metadata of [
      { rate_limits: { used_percent: 100 } },
      { message: 'quota exceeded 429 502 historical' },
    ]) {
      const r = await summarizeIncidentEvidence(fixture(receipt({ metadata })))
      expect(r.failures).toBe(0)
      expect(r.incidents[0].classification).toBe('unknown')
    }
  })
  it('holds unknown when reader is missing or exact event/source/digest binding differs', async () => {
    const f = fixture()
    expect((await summarizeIncidentEvidence({ ...f, resolveEvidence: null })).failures).toBe(0)
    for (const patch of [
      { eventId: 'other' },
      { eventDigest: 'b'.repeat(64) },
      { revision: 'wrong' },
      { digest: 'b'.repeat(64) },
    ]) {
      const r = await summarizeIncidentEvidence({
        ...f,
        resolveEvidence: async (x) => ({ ...(await f.resolveEvidence(x)), ...patch }),
      })
      expect(r.failures).toBe(0)
      expect(r.incidents[0].actual).toBe(null)
    }
  })
  it('does not treat a passing receipt error-looking metadata as failed execution', async () => {
    expect((await summarizeIncidentEvidence(fixture(receipt({ status: 'pass' })))).failures).toBe(0)
  })
  it('deduplicates event identity independently of changing source chain head', async () => {
    const f = fixture()
    const r = await summarizeIncidentEvidence({
      ...f,
      resolveSource: async () => ({
        source: f.source,
        revision: f.event.digest,
        sourceRevision: 'different-head',
        events: [...f.events, f.event],
      }),
    })
    expect(r.incidents).toHaveLength(1)
    expect(r.failures).toBe(1)
  })
  it('ignores arbitrary checkpoint error metadata and unknown envelope versions', async () => {
    const f = fixture()
    const r = await summarizeIncidentEvidence({
      ...f,
      resolveSource: async () => ({
        source: f.source,
        revision: f.event.digest,
        events: [
          f.events[0],
          createRunEvent({
            runId: 'fixture',
            id: 'incident-1',
            previousDigest: f.events[0].digest,
            kind: 'checkpoint',
            timestamp: now,
            payload: {
              structuredError: { code: 'quota_exceeded' },
              incidentEvidence: { version: 99 },
            },
          }),
        ],
      }),
    })
    expect(r.failures).toBe(0)
  })
  it('keeps produced but rejected oracle proof stages distinct', async () => {
    const observation = (stage, outcome) =>
      sealDeliveryRecord('verification-observation', {
        id: stage,
        invocationId: 'fixture',
        criterionId: `oracle.${stage}`,
        producer: 'fixture-collector',
        candidateDigest: hash,
        definitionDigest: hash,
        origin: 'collector-observed',
        isolation: 'cooperative',
        startedAt: now,
        completedAt: now,
        outcome,
        assertions: [{ id: `oracle.${stage}`, outcome }],
        subject: { stage, artifactDigest: hash },
      })
    const produced = observation('produced', 'pass'),
      accepted = observation('independentlyAccepted', 'fail')
    const f = fixture()
    const refs = [produced, accepted].map((record, i) => ({
      ...f.ref,
      uri: `https://example.invalid/${i}`,
      digest: record.digest,
    }))
    const envelope = {
      executionRef: undefined,
      oracle: [produced, accepted].map((record, i) => ({
        stage: record.subject.stage,
        artifactDigest: hash,
        candidateDigest: hash,
        evidenceRef: refs[i],
      })),
    }
    const g = fixture(receipt(), envelope)
    const r = await summarizeIncidentEvidence({
      ...g,
      resolveEvidence: async ({ ref, eventIdentity }) => ({
        eventId: eventIdentity.eventId,
        eventDigest: eventIdentity.eventDigest,
        revision: ref.revision,
        digest: ref.digest,
        record: [produced, accepted].find((x) => x.digest === ref.digest),
      }),
    })
    expect(r.oracles[0].states).toEqual({
      produced: 'verified',
      calibrated: 'unknown',
      independentlyAccepted: 'rejected',
      integrated: 'unknown',
    })
  })
  it('does not leak arbitrary receipt messages, local paths or resolver errors', async () => {
    const f = fixture(
      receipt({
        metadata: {
          message: '/home/private/SECRET',
          structuredError: { code: 'quota_exceeded', message: 'SECRET' },
        },
      }),
    )
    const r = await summarizeIncidentEvidence(f)
    expect(JSON.stringify(r)).not.toContain('SECRET')
    const x = await summarizeIncidentEvidence({
      ...f,
      resolveEvidence: async () => {
        throw new Error('SECRET')
      },
    })
    expect(JSON.stringify(x)).not.toContain('SECRET')
  })
})
