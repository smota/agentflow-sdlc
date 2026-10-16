import { describe, it, expect } from 'vitest'
import { summarizeIncidentEvidence } from '../incident-evidence.mjs'
import { createRunEvent } from '../../../lib/core/run-state.mjs'
import { recordDigest } from '../../../lib/core/record-digest.mjs'
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

describe('advisory review regressions (#528)', () => {
  it('does not count the same resolved execution receipt twice across different checkpoints', async () => {
    const f = fixture()
    const next = createRunEvent({
      runId: 'fixture',
      id: 'repeated-reference',
      previousDigest: f.event.digest,
      kind: 'checkpoint',
      timestamp: now,
      payload: f.event.payload,
    })
    const r = await summarizeIncidentEvidence({
      ...f,
      resolveSource: async () => ({
        source: f.source,
        revision: next.digest,
        events: [...f.events, next],
      }),
    })
    expect(r.failures).toBe(1)
  })
  it('degrades malformed null refs to unknown rather than throwing', async () => {
    const f = fixture(receipt(), {
      executionRef: undefined,
      oracle: [
        { stage: 'produced', artifactDigest: hash, candidateDigest: hash, evidenceRef: null },
      ],
    })
    await expect(summarizeIncidentEvidence(f)).resolves.toMatchObject({ failures: 0 })
  })
  it('does not echo unsafe source event identifiers', async () => {
    const f = fixture()
    const event = createRunEvent({
      runId: 'fixture',
      id: 'PRIVATE\u001b[31m',
      previousDigest: f.events[0].digest,
      kind: 'checkpoint',
      timestamp: now,
      payload: f.event.payload,
    })
    const r = await summarizeIncidentEvidence({
      ...f,
      resolveSource: async () => ({
        source: f.source,
        revision: event.digest,
        events: [f.events[0], event],
      }),
    })
    expect(JSON.stringify(r)).not.toContain('PRIVATE')
  })
  it('rejects oversized source observation before resolving evidence', async () => {
    const f = fixture()
    let reads = 0
    const r = await summarizeIncidentEvidence({
      ...f,
      resolveSource: async () => ({
        source: f.source,
        revision: f.event.digest,
        events: [...f.events, ...Array(10001).fill(f.event)],
      }),
      resolveEvidence: async () => {
        reads++
        return null
      },
    })
    expect(r.status).toBe('unknown')
    expect(reads).toBe(0)
  })
  it('does not label a passed execution as unavailable failure evidence', async () => {
    const r = await summarizeIncidentEvidence(fixture(receipt({ status: 'pass' })))
    expect(r.incidents[0].unknowns).not.toContain('structured-failure-unavailable')
    expect(r.incidents[0].executionStatus).toBe('pass')
  })
})
