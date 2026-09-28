import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { sealDeliveryRecord } from '../core/delivery-record.mjs'
const rawDigest = (content) => createHash('sha256').update(content).digest('hex')
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { createRunService } from '../application/run-service.mjs'
import {
  createContinuationBundle,
  reconstructContinuation,
  MAX_PACKET_BYTES,
} from '../application/continuation-service.mjs'
import { createRunEvent, reduceRun } from '../core/run-state.mjs'

const fixedTime = '2026-09-26T08:00:00.000Z'
const futureTime = '2099-01-01T12:00:00.000Z'
const pastTime = '2026-09-26T07:00:00.000Z'

async function setupRunFixture({ grantExpired = false, grantRevoked = false } = {}) {
  const store = createMemoryRunStore({ durable: true })
  const authority = { owner: 'writer-1', generation: 0 }
  const runId = 'continuation-run'

  const service = createRunService({
    store,
    clock: () => fixedTime,
    authorize: async () => true,
    observeWriter: async () => ({ stopped: true }),
    observeWorkspace: async () => ({ verified: true, candidateDigest: 'c'.repeat(64) }),
  })

  await service.start({
    runId,
    goalRef: 'issue:267',
    owner: 'writer-1',
    profile: 'standard',
    boundary: 'external-action',
    authority,
  })

  let rev = (await service.read()).revision
  await service.record(
    'candidate',
    { digest: 'c'.repeat(64) },
    { expectedRevision: rev, authority },
  )

  const grantEnvelope = {
    id: 'grant-1',
    issuedAt: fixedTime,
    issuerActor: 'test-issuer',
    binding: {
      issuerMode: 'local-cooperative',
      issuerBinding: {
        issuerId: 'local',
        mode: 'local-cooperative',
        origin: 'cli',
        authorityRef: 'local',
        decisionRef: 'dec-1',
      },
      planDigest: 'a'.repeat(64),
      policyDigest: 'b'.repeat(64),
      repository: 'test/repo',
      base: 'main',
      delegate: 'agy',
      allowedPaths: ['src/*'],
      allowedActions: ['edit'],
      capabilities: ['edit'],
      requiredChecks: ['test'],
      reviewPolicy: 'automated',
      materiality: 'fixed-scope-v1',
      allowSubdelegation: false,
      maxAttempts: 2,
      maxExternalEffects: 2,
      expiry: grantExpired ? pastTime : futureTime,
    },
    parentId: null,
  }

  const grantObj = {
    envelope: grantEnvelope,
    revision: 'grant-rev-1',
    status: grantRevoked ? 'revoked' : 'active',
    revocationEpoch: grantRevoked ? 1 : 0,
    budgetUsed: { attempts: 0, externalEffects: 0 },
    budgetReserved: { attempts: 0, externalEffects: 0 },
  }

  const originalStoreRead = store.read.bind(store)
  store.read = async () => {
    const s = await originalStoreRead()
    const state = reduceRun(s.events)
    state.grants = { 'grant-1': grantObj }
    return { ...s, state }
  }

  const originalServiceRead = service.read.bind(service)
  service.read = async () => {
    const s = await originalServiceRead()
    s.state.grants = { 'grant-1': grantObj }
    return s
  }

  return { store, service, authority, runId, grantEnvelope }
}

describe('S5: Portable continuation and bounded context', () => {
  it('reconstructs exact authority, state, and verified artifacts on fresh root', async () => {
    const { store, service, runId } = await setupRunFixture()
    const { state, revision } = await service.read()

    const artifactContent = 'console.log("verified code artifact")'
    const artifactDigest = rawDigest(artifactContent)
    const artifacts = [
      {
        id: 'patch-1',
        digest: artifactDigest,
        path: 'patches/patch-1.diff',
        byteLength: Buffer.byteLength(artifactContent),
      },
    ]

    const bundle = createContinuationBundle({
      state,
      runRevision: revision,
      branch: 'codex/process-autonomy',
      commitSha: 'a'.repeat(40),
      nextSlice: 'S6',
      artifacts,
    })

    expect(bundle.kind).toBe('continuation-packet')
    expect(Buffer.byteLength(JSON.stringify(bundle))).toBeLessThanOrEqual(MAX_PACKET_BYTES)

    // Reconstruct on fresh instance
    const reconstruction = await reconstructContinuation({
      bundle,
      store,
      observeWriter: async () => ({ stopped: true, observedAt: fixedTime }),
      resolveArtifact: async (ref) => ({ content: artifactContent }),
      clock: () => fixedTime,
    })

    expect(reconstruction.verified).toBe(true)
    expect(reconstruction.runId).toBe(runId)
    expect(reconstruction.nextGeneration).toBe(1)
    expect(reconstruction.nextSlice).toBe('S6')
    expect(reconstruction.verifiedArtifactCount).toBe(1)
  })

  it('rejects oversized continuation bundle exceeding 32 KiB', () => {
    const hugeArtifacts = Array.from({ length: 600 }, (_, i) => ({
      id: `artifact-${i}`,
      digest: 'd'.repeat(64),
      path: `path/to/very/long/and/bloated/directory/structure/file-${i}.txt`,
      byteLength: 1024,
    }))

    expect(() =>
      createContinuationBundle({
        state: { runId: 'bloated', owner: 'w', generation: 0 },
        runRevision: 'rev-1',
        branch: 'main',
        commitSha: 'a'.repeat(40),
        nextSlice: 'S6',
        artifacts: hugeArtifacts,
      }),
    ).toThrow(/exceeds \d+ bytes limit/)
  })

  it('refuses continuation when previous writer liveness is active or unknown', async () => {
    const { store, service } = await setupRunFixture()
    const { state, revision } = await service.read()

    const bundle = createContinuationBundle({
      state,
      runRevision: revision,
      branch: 'codex/process-autonomy',
      commitSha: 'a'.repeat(40),
      nextSlice: 'S6',
    })

    // Active
    await expect(
      reconstructContinuation({
        bundle,
        store,
        observeWriter: async () => ({ stopped: false }),
        resolveArtifact: async () => null,
      }),
    ).rejects.toThrow(/Previous writer liveness unknown or active/)

    // Unknown
    await expect(
      reconstructContinuation({
        bundle,
        store,
        observeWriter: async () => ({ stopped: null }),
        resolveArtifact: async () => null,
      }),
    ).rejects.toThrow(/Previous writer liveness unknown or active/)
  })

  it('refuses continuation when authoritative run revision has drifted', async () => {
    const { store, service } = await setupRunFixture()
    const { state, revision } = await service.read()

    const bundle = createContinuationBundle({
      state,
      runRevision: revision,
      branch: 'codex/process-autonomy',
      commitSha: 'a'.repeat(40),
      nextSlice: 'S6',
    })

    // Advance store with another event to cause drift
    await service.record(
      'checkpoint',
      { step: 'drift' },
      { expectedRevision: revision, authority: { owner: 'writer-1', generation: 0 } },
    )

    await expect(
      reconstructContinuation({
        bundle,
        store,
        observeWriter: async () => ({ stopped: true }),
        resolveArtifact: async () => null,
      }),
    ).rejects.toThrow(/Authoritative run revision mismatch/)
  })

  it('refuses continuation when an artifact is missing or corrupted', async () => {
    const { store, service } = await setupRunFixture()
    const { state, revision } = await service.read()

    const validContent = 'legitimate artifact data'
    const bundle = createContinuationBundle({
      state,
      runRevision: revision,
      branch: 'codex/process-autonomy',
      commitSha: 'a'.repeat(40),
      nextSlice: 'S6',
      artifacts: [
        {
          id: 'test-art',
          digest: rawDigest(validContent),
          path: 'artifacts/test.txt',
          byteLength: Buffer.byteLength(validContent),
        },
      ],
    })

    // Missing artifact
    await expect(
      reconstructContinuation({
        bundle,
        store,
        observeWriter: async () => ({ stopped: true }),
        resolveArtifact: async () => null,
      }),
    ).rejects.toThrow(/Corrupted or missing continuation artifact/)

    // Corrupted digest
    await expect(
      reconstructContinuation({
        bundle,
        store,
        observeWriter: async () => ({ stopped: true }),
        resolveArtifact: async () => ({ content: 'x'.repeat(Buffer.byteLength(validContent)) }),
      }),
    ).rejects.toThrow(/Artifact digest mismatch/)
  })

  it('refuses continuation when active grant is expired or revoked', async () => {
    // Expired grant
    const expiredFixture = await setupRunFixture({ grantExpired: true })
    const expiredState = (await expiredFixture.service.read()).state
    const expiredBundle = createContinuationBundle({
      state: expiredState,
      runRevision: (await expiredFixture.service.read()).revision,
      branch: 'codex/process-autonomy',
      commitSha: 'a'.repeat(40),
      nextSlice: 'S6',
    })

    await expect(
      reconstructContinuation({
        bundle: expiredBundle,
        store: expiredFixture.store,
        observeWriter: async () => ({ stopped: true }),
        resolveArtifact: async () => null,
        clock: () => fixedTime,
      }),
    ).rejects.toThrow(/has expired/)

    // Revoked grant
    const revokedFixture = await setupRunFixture({ grantRevoked: true })
    const revokedState = (await revokedFixture.service.read()).state
    const revokedBundle = createContinuationBundle({
      state: revokedState,
      runRevision: (await revokedFixture.service.read()).revision,
      branch: 'codex/process-autonomy',
      commitSha: 'a'.repeat(40),
      nextSlice: 'S6',
    })

    await expect(
      reconstructContinuation({
        bundle: revokedBundle,
        store: revokedFixture.store,
        observeWriter: async () => ({ stopped: true }),
        resolveArtifact: async () => null,
        clock: () => fixedTime,
      }),
    ).rejects.toThrow(/is revoked/)
  })

  it('blocks stale writer after continuation takeover via generation fencing', async () => {
    const { store, service, authority, runId } = await setupRunFixture()
    const { state, revision } = await service.read()

    const bundle = createContinuationBundle({
      state,
      runRevision: revision,
      branch: 'codex/process-autonomy',
      commitSha: 'a'.repeat(40),
      nextSlice: 'S6',
    })

    const takeover = await reconstructContinuation({
      bundle,
      store,
      observeWriter: async () => ({ stopped: true }),
      resolveArtifact: async () => null,
      clock: () => fixedTime,
    })

    // Advance generation on store via resume
    const newAuthority = { owner: 'writer-2', generation: state.generation }
    const recoveryPlan = await service.recoveryPlan({
      owner: 'writer-2',
      boundary: 'external-action',
      writer: { instance: 'inst-2', host: 'host-2', pid: 12345 },
    })

    // Takeover resumes the run
    await service.resume({ plan: recoveryPlan, authority: newAuthority })

    const activeState = (await service.read()).state
    expect(activeState.generation).toBe(1)
    expect(activeState.owner).toBe('writer-2')

    // Stale writer (generation 0, writer-1) attempts append -> MUST FAIL
    await expect(
      service.record(
        'checkpoint',
        { msg: 'stale append' },
        { expectedRevision: activeState.revision, authority },
      ),
    ).rejects.toThrow(/Obsolete writer identity or generation/)
  })
})

describe('continuation byte integrity and event-only reconstruction', () => {
  async function fixture(content = '') {
    const store = createMemoryRunStore({ durable: true })
    const service = createRunService({ store, clock: () => fixedTime, authorize: async () => true })
    await service.start({
      runId: 'event-only',
      goalRef: 'issue:295',
      owner: 'writer',
      profile: 'standard',
      boundary: 'observe',
      authority: { owner: 'writer', generation: 0 },
    })
    const { state, revision } = await service.read()
    const input = {
      state,
      runRevision: revision,
      branch: 'codex/continuation',
      commitSha: 'a'.repeat(40),
      nextSlice: 'verify',
      artifacts: [
        {
          id: 'bytes',
          path: 'artifacts/bytes',
          digest: rawDigest(content),
          byteLength: Buffer.byteLength(content),
        },
      ],
    }
    const reconstruct = (bundle, resolvedContent = content) =>
      reconstructContinuation({
        bundle,
        store,
        observeWriter: async () => ({ stopped: true }),
        resolveArtifact: async () => ({ content: resolvedContent }),
      })
    return { input, reconstruct, store }
  }

  it.each([
    '',
    'é雪',
    Buffer.alloc(0),
    Buffer.from([0, 255, 128, 10]),
    new Uint8Array([0, 255, 128]),
    new Uint8Array([7, 0, 255, 8]).subarray(1, 3),
  ])('verifies original UTF-8 or binary bytes %# using event replay', async (content) => {
    const { input, reconstruct, store } = await fixture(content)
    expect((await store.read()).state).toBeUndefined()
    const result = await reconstruct(createContinuationBundle(input))
    expect(result.verifiedArtifactCount).toBe(1)
    expect(result.runRevision).toBe(input.runRevision)
  })

  it('rejects declared lengths that disagree even when the digest matches', async () => {
    const { input, reconstruct } = await fixture('é')
    input.artifacts[0].byteLength = 1
    await expect(reconstruct(createContinuationBundle(input))).rejects.toThrow(
      /byte length mismatch/,
    )
  })

  it.each([null, {}, 0, false, [1, 2]])(
    'rejects unsupported resolved content %#',
    async (content) => {
      const { input, reconstruct } = await fixture('')
      await expect(reconstruct(createContinuationBundle(input), content)).rejects.toThrow(
        /missing continuation artifact/,
      )
    },
  )

  it.each([
    null,
    {},
    { id: 4 },
    { path: ' ' },
    { digest: 'not-sha256' },
    { byteLength: -1 },
    { byteLength: 0.5 },
  ])('rejects malformed artifact references at creation and reconstruction %#', async (invalid) => {
    const { input, reconstruct } = await fixture()
    const bundle = createContinuationBundle(input)
    const art = invalid === null ? null : { ...input.artifacts[0], ...invalid }
    if (invalid && Object.keys(invalid).length === 0) delete art.id
    expect(() => createContinuationBundle({ ...input, artifacts: [art] })).toThrow(
      /Invalid artifact reference/,
    )
    const resealed = sealDeliveryRecord('continuation-packet', { ...bundle, artifacts: [art] })
    await expect(reconstruct(resealed)).rejects.toThrow(/Invalid artifact reference/)
  })

  it('bounds the sealed packet including its digest and envelope', async () => {
    const { input } = await fixture()
    const initial = createContinuationBundle(input)
    const room = MAX_PACKET_BYTES - Buffer.byteLength(JSON.stringify(initial))
    input.nextSlice += 'x'.repeat(room)
    expect(Buffer.byteLength(JSON.stringify(createContinuationBundle(input)))).toBe(
      MAX_PACKET_BYTES,
    )
    input.nextSlice += 'x'
    expect(() => createContinuationBundle(input)).toThrow(/exceeds/)
  })
})
