import { describe, expect, it } from 'vitest'
import { validateEvidenceContract } from '../evidence-contracts.mjs'
import { createRunService } from '../application/run-service.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { createRunEvent, reduceRun } from '../core/run-state.mjs'
import { createOracleCustodyReceipt } from '../core/oracle-custody.mjs'
const digest = 'a'.repeat(64)
const authority = { owner: 'writer', generation: 0 }
const ref = (uri) => ({
  kind: 'validation',
  system: 'github',
  uri,
  authority: 'authoritative',
  relationship: 'verifies',
  revision: 'source-revision',
  digest: 'b'.repeat(64),
})
const proposal = (mode = 'historical-author') => ({
  mode,
  oracleDigest: digest,
  identity: 'independent-test-engineer',
  assignmentRef: ref('https://example.invalid/assignment'),
  manifestRef: ref('https://example.invalid/manifest'),
  evidenceRefs: [ref('https://example.invalid/proof')],
  provenance: { platform: 'pi', executor: 'pi-session' },
})
async function fixture(overrides = {}) {
  const store = createMemoryRunStore()
  let snapshot = await store.append(
    createRunEvent({
      runId: 'existing',
      id: 'start',
      kind: 'started',
      payload: {
        goalRef: 'issue:521',
        owner: 'writer',
        profile: 'standard',
        boundary: 'mutate-worktree',
      },
    }),
    null,
  )
  for (let phase = 0; phase < 3; phase++)
    snapshot = await store.append(
      createRunEvent({
        runId: 'existing',
        id: `advance-${phase}`,
        previousDigest: snapshot.revision,
        kind: 'advanced',
        payload: {
          from: phase,
          to: phase + 1,
          candidateDigest: null,
          acceptanceDigest: 'c'.repeat(64),
        },
      }),
      snapshot.revision,
    )
  const service = createRunService({
    store,
    authorize: async () => true,
    resolveOracleCustody: async (request) => ({
      verified: true,
      receipt: createOracleCustodyReceipt({
        request,
        verifier: 'trusted-assignment-source',
        verifiedAt: '2026-10-15T12:00:00.000Z',
      }),
    }),
    ...overrides,
  })
  await service.pinOracle({ digest, authority })
  return { store, service }
}

describe('native source ledger oracle custody', () => {
  it('records historical authorship with exact native identity without inventing an epoch', async () => {
    const { service, store } = await fixture()
    await service.recordOracleCustody({ proposal: proposal(), authority })
    const { state } = await service.read()
    expect(state.oracleCustody.author.mode).toBe('historical-author')
    expect(state.oracleCustody.author.authorIdentity).toBe('independent-test-engineer')
    expect(state.oracleCustody.author.assigneeIdentity).toBe(null)
    expect(state.generation).toBe(0)
    expect(state.revocationEpoch).toBe(0)
    expect(state).not.toHaveProperty('epoch')
    expect(state).not.toHaveProperty('fencingToken')
    expect((await store.read()).events.at(-1).kind).toBe('oracle-custody-recorded')
  })
  it('keeps prospective assignment distinct from historical authorship', async () => {
    const { service } = await fixture()
    await service.recordOracleCustody({ proposal: proposal('prospective-assignment'), authority })
    const custody = (await service.read()).state.oracleCustody.assignment
    expect(custody.authorIdentity).toBe(null)
    expect(custody.assigneeIdentity).toBe('independent-test-engineer')
  })
  it('does not accept caller declarations without trusted source verification', async () => {
    const { service } = await fixture({ resolveOracleCustody: undefined })
    await expect(service.recordOracleCustody({ proposal: proposal(), authority })).rejects.toThrow(
      /verif|source/i,
    )
    await expect(
      service.record(
        'oracle-custody-recorded',
        {},
        { expectedRevision: (await service.read()).revision, authority },
      ),
    ).rejects.toThrow(/governed/i)
  })
  it('rejects changed pins, wrong identities and unverified source receipts', async () => {
    const { service } = await fixture({
      resolveOracleCustody: async (request) => ({
        verified: false,
        receipt: createOracleCustodyReceipt({
          request,
          verifier: 'source',
          verifiedAt: '2026-10-15T12:00:00Z',
        }),
      }),
    })
    await expect(
      service.recordOracleCustody({
        proposal: { ...proposal(), oracleDigest: 'd'.repeat(64) },
        authority,
      }),
    ).rejects.toThrow(/pin|digest/i)
    await expect(service.recordOracleCustody({ proposal: proposal(), authority })).rejects.toThrow(
      /verif|source/i,
    )
    expect((await service.read()).state.oracleCustody).toBeUndefined()
  })
  it('rejects a source changing the ledger while verification is pending', async () => {
    let active
    const { service } = await fixture({
      resolveOracleCustody: async (request) => {
        await active.record(
          'candidate',
          { digest: 'd'.repeat(64) },
          { expectedRevision: (await active.read()).revision, authority },
        )
        return {
          verified: true,
          receipt: createOracleCustodyReceipt({
            request,
            verifier: 'source',
            verifiedAt: '2026-10-15T12:00:00Z',
          }),
        }
      },
    })
    active = service
    await expect(service.recordOracleCustody({ proposal: proposal(), authority })).rejects.toThrow(
      /changed|revision|stale/i,
    )
    expect((await service.read()).state.oracleCustody).toBeUndefined()
  })
  it('invalidates active custody on a changed candidate but preserves its source event', async () => {
    const { service, store } = await fixture()
    await service.recordOracleCustody({ proposal: proposal(), authority })
    await service.record(
      'candidate',
      { digest: 'd'.repeat(64) },
      { expectedRevision: (await service.read()).revision, authority },
    )
    expect((await service.read()).state.oracleCustody).toBeUndefined()
    expect(
      (await store.read()).events.some((event) => event.kind === 'oracle-custody-recorded'),
    ).toBe(true)
  })
  it('does not change the reduced shape of legacy history with no custody event', async () => {
    const { store } = await fixture()
    expect(reduceRun((await store.read()).events)).not.toHaveProperty('oracleCustody')
  })
  it('rejects tampered custody replay at the reducer boundary', async () => {
    const { service, store } = await fixture()
    await service.recordOracleCustody({ proposal: proposal(), authority })
    const { events } = await store.read()
    const prior = events.slice(0, -1)
    const payload = structuredClone(events.at(-1).payload)
    payload.receipt.identity = 'builder'
    const altered = createRunEvent({
      runId: 'existing',
      id: 'altered',
      previousDigest: prior.at(-1).digest,
      kind: 'oracle-custody-recorded',
      payload,
    })
    expect(() => reduceRun([...prior, altered])).toThrow(/custody|receipt|stale/i)
  })
})

it('clears active custody when the source records a changed oracle pin, preserving old events', async () => {
  const { service, store } = await fixture()
  await service.recordOracleCustody({ proposal: proposal(), authority })
  const before = await store.read()
  await store.append(
    createRunEvent({
      runId: 'existing',
      id: 'new-pin',
      previousDigest: before.revision,
      kind: 'oracle-pinned',
      payload: { digest: 'd'.repeat(64), seat: 'dev.build' },
    }),
    before.revision,
  )
  expect((await service.read()).state.oracleCustody).toBeUndefined()
  expect(
    (await store.read()).events.some((event) => event.kind === 'oracle-custody-recorded'),
  ).toBe(true)
})

it('does not call the source verifier for a stale writer generation', async () => {
  let calls = 0
  const { service } = await fixture({
    resolveOracleCustody: async () => {
      calls++
      return { verified: false }
    },
  })
  await expect(
    service.recordOracleCustody({
      proposal: proposal(),
      authority: { owner: 'writer', generation: 1 },
    }),
  ).rejects.toThrow(/generation|writer|identity/i)
  expect(calls).toBe(0)
})

it('retains historical authorship when a prospective repair executor is assigned', async () => {
  const { service } = await fixture()
  await service.recordOracleCustody({ proposal: proposal(), authority })
  await service.recordOracleCustody({
    proposal: { ...proposal('prospective-assignment'), identity: 'future-repairer' },
    authority,
  })
  const custody = (await service.read()).state.oracleCustody
  expect(custody.author.authorIdentity).toBe('independent-test-engineer')
  expect(custody.assignment.assigneeIdentity).toBe('future-repairer')
  expect(custody.author.manifestRef).toEqual(proposal().manifestRef)
})
it('clears active custody when recovery changes native writer generation without invalidating candidate', async () => {
  const { service, store } = await fixture()
  await service.recordOracleCustody({ proposal: proposal(), authority })
  const snapshot = await store.read()
  await store.append(
    createRunEvent({
      runId: 'existing',
      id: 'takeover',
      previousDigest: snapshot.revision,
      kind: 'resumed',
      payload: {
        owner: 'replacement',
        boundary: 'mutate-worktree',
        previousOwnerStopped: true,
        invalidateCandidate: false,
      },
    }),
    snapshot.revision,
  )
  expect((await service.read()).state.oracleCustody).toBeUndefined()
  expect((await service.read()).state.generation).toBe(1)
})

it('requires the exact source request when portable evidence validation checks a custody receipt', async () => {
  const { service, store } = await fixture()
  await service.recordOracleCustody({ proposal: proposal(), authority })
  const { request, receipt } = (await store.read()).events.at(-1).payload
  expect(validateEvidenceContract('oracle-custody-request', request).ok).toBe(true)
  expect(validateEvidenceContract('oracle-custody-receipt', receipt, {}, {}, { request }).ok).toBe(
    true,
  )
  expect(validateEvidenceContract('oracle-custody-receipt', receipt).ok).toBe(false)
  expect(
    validateEvidenceContract(
      'oracle-custody-receipt',
      { ...receipt, authorIdentity: 'other' },
      {},
      {},
      { request },
    ).ok,
  ).toBe(false)
})
