import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
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

async function setupRunFixture({ grantExpired = false } = {}) {
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
    status: 'active',
    revocationEpoch: 0,
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

  return { store, service, authority, runId, grantEnvelope, grantObj }
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

  it('refuses continuation when an active grant is expired', async () => {
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
  })

  it('builds a new packet without a revoked grant and rejects the older grant-bearing packet', async () => {
    const { store, service, grantObj } = await setupRunFixture()
    const active = await service.read()
    const input = {
      state: active.state,
      runRevision: active.revision,
      branch: 'codex/process-autonomy',
      commitSha: 'a'.repeat(40),
      nextSlice: 'S6',
    }
    const oldBundle = createContinuationBundle(input)
    expect(oldBundle.grant?.id).toBe('grant-1')
    grantObj.status = 'revoked'
    grantObj.revocationEpoch = 1
    const revoked = await service.read()
    expect(revoked.state.grants['grant-1'].status).toBe('revoked')
    const newBundle = createContinuationBundle({ ...input, state: revoked.state })
    expect(newBundle.grant).toBeNull()
    const reconstruct = (bundle) =>
      reconstructContinuation({
        bundle,
        store,
        observeWriter: async () => ({ stopped: true }),
        resolveArtifact: async () => null,
        clock: () => fixedTime,
      })
    expect((await reconstruct(newBundle)).activeGrantId).toBeNull()
    await expect(reconstruct(oldBundle)).rejects.toThrow(/summary differs/)
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

  it('rejects packet summaries that omit pending work or forge phase, candidate, policy, and grant revision', async () => {
    const { store, service } = await setupRunFixture()
    const sourceRead = store.read.bind(store)
    store.read = async () => {
      const snapshot = await sourceRead()
      snapshot.state.operations = {
        pending: {
          id: 'pending',
          kind: 'publish',
          state: 'submitted',
          payloadDigest: 'a'.repeat(64),
        },
      }
      snapshot.state.openRework = { finding: { id: 'finding', criteria: ['c1'] } }
      return snapshot
    }
    const { state, revision } = await service.read()
    state.operations = {
      pending: {
        id: 'pending',
        kind: 'publish',
        state: 'submitted',
        payloadDigest: 'a'.repeat(64),
      },
    }
    state.openRework = { finding: { id: 'finding', criteria: ['c1'] } }
    const packet = createContinuationBundle({
      state,
      runRevision: revision,
      branch: 'main',
      commitSha: 'a'.repeat(40),
      nextSlice: 'verify',
    })
    const reconstruct = (bundle) =>
      reconstructContinuation({
        bundle,
        store,
        observeWriter: async () => ({ stopped: true }),
        resolveArtifact: async () => null,
      })
    const variants = [
      { pendingOperations: [] },
      { openRework: [] },
      { phase: 4 },
      { candidateDigest: 'f'.repeat(64) },
      { policyDigest: 'f'.repeat(64) },
      { grant: { ...packet.grant, revision: 'forged' } },
      { grant: null },
    ]
    for (const changes of variants) {
      await expect(
        reconstruct(sealDeliveryRecord('continuation-packet', { ...packet, ...changes })),
      ).rejects.toThrow(/summary differs/)
    }
  })

  it('requires source and workspace identity in strict recovery and withholds packet navigation', async () => {
    const { input, store } = await fixture()
    input.storeDigest = 'f'.repeat(40)
    const rawRead = store.read.bind(store)
    store.read = async () => ({ ...(await rawRead()), sourceRevision: 'f'.repeat(40) })
    const bundle = createContinuationBundle(input)
    const workspace = {
      verified: true,
      runId: input.state.runId,
      branch: input.branch,
      commitSha: input.commitSha,
      candidateDigest: null,
      storeDigest: input.storeDigest,
    }
    const resume = (packet, resolved = workspace) =>
      reconstructContinuation({
        bundle: packet,
        store,
        strictWorkspace: true,
        observeWriter: async () => ({ stopped: true }),
        resolveWorkspace: async () => resolved,
        resolveArtifact: async () => ({ content: '' }),
      })
    expect((await resume(bundle)).nextSlice).toBeNull()
    await expect(resume(bundle, { ...workspace, commitSha: 'b'.repeat(40) })).rejects.toThrow(
      /Workspace identity/,
    )
    await expect(
      resume(sealDeliveryRecord('continuation-packet', { ...bundle, storeDigest: 'a'.repeat(40) })),
    ).rejects.toThrow(/source identity/)
    await expect(
      reconstructContinuation({
        bundle,
        store,
        strictWorkspace: true,
        observeWriter: async () => ({ stopped: true }),
        resolveArtifact: async () => ({ content: '' }),
      }),
    ).rejects.toThrow(/workspace resolver/)
  })
})

describe('strict continuation across a process and Git root using a file-backed fake source', () => {
  it('reconstructs exact packet, source events, artifact bytes, and workspace in a fresh clone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'af-continuation-process-'))
    try {
      const origin = join(root, 'origin')
      const resumed = join(root, 'resumed')
      mkdirSync(join(origin, 'src'), { recursive: true })
      const content = 'export const recovered = true\n'
      writeFileSync(join(origin, 'src', 'candidate.js'), content)
      const git = (cwd, ...args) =>
        execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
      git(origin, 'init', '-b', 'main')
      git(origin, 'config', 'user.name', 'Fixture')
      git(origin, 'config', 'user.email', 'fixture@example.invalid')
      git(origin, 'config', 'core.autocrlf', 'false')
      git(origin, 'add', '.')
      git(origin, 'commit', '-m', 'candidate')
      git(root, '-c', 'core.autocrlf=false', 'clone', origin, resumed)
      const commitSha = git(origin, 'rev-parse', 'HEAD')
      const { fingerprintCandidate } = await import('../verification/workspace.mjs')
      const candidateDigest = fingerprintCandidate(origin, { inputs: ['src/candidate.js'] }).digest
      const store = createMemoryRunStore({ durable: true })
      const start = createRunEvent({
        runId: 'cross-process',
        id: 'start',
        generation: 0,
        kind: 'started',
        payload: {
          goalRef: 'issue:300',
          owner: 'old-writer',
          profile: 'standard',
          boundary: 'observe',
        },
        timestamp: fixedTime,
      })
      await store.append(start, null)
      const candidate = createRunEvent({
        runId: 'cross-process',
        id: 'candidate',
        previousDigest: start.digest,
        generation: 0,
        kind: 'candidate',
        payload: { digest: candidateDigest },
        timestamp: fixedTime,
      })
      await store.append(candidate, start.digest)
      const snapshot = await store.read()
      const sourceRevision = 'f'.repeat(40)
      const bundle = createContinuationBundle({
        state: reduceRun(snapshot.events),
        runRevision: snapshot.revision,
        branch: 'main',
        commitSha,
        nextSlice: 'untrusted-navigation',
        storeDigest: sourceRevision,
        artifacts: [
          {
            id: 'candidate',
            path: 'src/candidate.js',
            digest: rawDigest(content),
            byteLength: Buffer.byteLength(content),
          },
        ],
      })
      writeFileSync(join(root, 'source.json'), JSON.stringify({ ...snapshot, sourceRevision }))
      writeFileSync(join(root, 'bundle.json'), JSON.stringify(bundle))
      const continuationModule = pathToFileURL(
        join(process.cwd(), 'lib/application/continuation-service.mjs'),
      ).href
      const reducerModule = pathToFileURL(join(process.cwd(), 'lib/core/run-state.mjs')).href
      const script = `
        import { readFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { execFileSync } from 'node:child_process';
        import { reconstructContinuation } from ${JSON.stringify(continuationModule)};
        import { reduceRun } from ${JSON.stringify(reducerModule)};
        const [root, sourcePath, bundlePath] = process.argv.slice(1);
        const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
        const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
        const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
        const result = await reconstructContinuation({
          bundle, store: { read: async () => source }, strictWorkspace: true,
          observeWriter: async () => ({ stopped: true }),
          resolveArtifact: async (ref) => ({ content: readFileSync(join(root, ref.path)) }),
          resolveWorkspace: async () => ({ verified: git('status', '--porcelain') === '',
            runId: bundle.runId, branch: git('symbolic-ref', '--short', 'HEAD'),
            commitSha: git('rev-parse', 'HEAD'), candidateDigest: reduceRun(source.events).candidateDigest,
            storeDigest: source.sourceRevision }),
        });
        process.stdout.write(JSON.stringify(result));
      `
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          script,
          resumed,
          join(root, 'source.json'),
          join(root, 'bundle.json'),
        ],
        { encoding: 'utf8' },
      )
      expect(child.status, child.stderr).toBe(0)
      const reconstruction = JSON.parse(child.stdout)
      expect(reconstruction.verified).toBe(true)
      expect(reconstruction.verifiedArtifactCount).toBe(1)
      expect(reconstruction.nextSlice).toBeNull()
      expect(reconstruction.candidateDigest).toBe(candidateDigest)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
