import { describe, it, expect } from 'vitest'
import { reduceRun, createRunEvent } from '../core/run-state.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import { fakeGitHub, patchBarrier } from './github-run-store.fixture.mjs'
import {
  createSegmentedRunStore,
  previewMigration,
  migrateRunStore,
} from '../sources/segmented-run-store.mjs'
import { createGitHubRunStore, planGitHubCoordination } from '../sources/github-run-store.mjs'

function startEvent(runId) {
  return createRunEvent({
    runId,
    id: `event-start`,
    previousDigest: null,
    generation: 0,
    kind: 'started',
    payload: {
      goalRef: 'issue:266',
      owner: 'writer',
      profile: 'standard',
      boundary: 'external-action',
    },
    timestamp: '2026-09-26T08:00:00.000Z',
  })
}

function event(runId, index, previousDigest = null) {
  return createRunEvent({
    runId,
    id: `event-${index}`,
    previousDigest,
    generation: 0,
    kind: 'checkpoint',
    payload: { seq: index, timestamp: '2026-09-26T08:00:00.000Z' },
    timestamp: '2026-09-26T08:00:00.000Z',
  })
}

function generateEvents(runId, count) {
  const start = startEvent(runId)
  const events = [start]
  let prev = start.digest
  for (let i = 1; i < count; i++) {
    const e = event(runId, i, prev)
    events.push(e)
    prev = e.digest
  }
  return events
}

async function storeFor(fake, runId, options = {}) {
  const setup = await planGitHubCoordination({ repo: 'test/repo', client: fake.client })
  return createSegmentedRunStore({
    repo: 'test/repo',
    runId,
    client: fake.client,
    boundary: 'external-action',
    setupConfirm: setup.digest,
    ...options,
  })
}

async function setupV1Store(fake, runId, events) {
  fake.objects.clear()
  fake.refs.clear()
  const content = JSON.stringify(events)
  const blobSha = recordDigest(content)
  fake.objects.set(blobSha, { content })
  const tree = [{ path: `runs/${runId}.json`, mode: '100644', type: 'blob', sha: blobSha }]
  const treeSha = recordDigest({ tree })
  fake.objects.set(treeSha, { tree })
  const commit = { tree: { sha: treeSha }, parents: [] }
  const commitSha = recordDigest(commit)
  fake.objects.set(commitSha, commit)
  fake.refs.set('agentflow-state', commitSha)
  return { commitSha, treeSha }
}

describe('S4b: Versioned snapshots, immutable event segments, and migration', () => {
  it('replays 10000 events matching reference reducer exactly', async () => {
    const fake = fakeGitHub()
    const runId = 'perf-10000'
    const store = await storeFor(fake, runId, { segmentSize: 500 })

    const totalEvents = 10000
    const events = generateEvents(runId, totalEvents)
    const referenceState = reduceRun(events)

    let rev = null
    for (let i = 0; i < totalEvents; i += 500) {
      const chunk = events.slice(i, i + 500)
      for (const e of chunk) {
        const res = await store.append(e, rev)
        rev = res.revision
      }
    }

    const replayed = await store.read()
    expect(replayed.events.length).toBe(totalEvents)
    expect(replayed.revision).toBe(referenceState.revision)
    expect(replayed.manifest.segments.length).toBe(20) // 10000 / 500 = 20 segments
    expect(replayed.manifest.snapshot.eventCount).toBe(10000)
  })

  it('fails before CAS without advancing state when killed before PATCH', async () => {
    const fake = fakeGitHub()
    const runId = 'kill-before-cas'
    const store = await storeFor(fake, runId)

    const e0 = startEvent(runId)
    await store.append(e0, null)
    const baseline = await store.read()

    fake.hooks.beforePatch = () => {
      throw new Error('Process killed before PATCH')
    }

    const e1 = event(runId, 1, e0.digest)
    await expect(store.append(e1, baseline.revision)).rejects.toThrow('Process killed before PATCH')

    fake.hooks.beforePatch = null
    const current = await store.read()
    expect(current.revision).toBe(baseline.revision)
    expect(current.events.length).toBe(1)
  })

  it('reconciles acknowledged event when killed after CAS during network response', async () => {
    const fake = fakeGitHub()
    const runId = 'kill-after-cas'
    const store = await storeFor(fake, runId)

    const e0 = startEvent(runId)
    await store.append(e0, null)

    const e1 = event(runId, 1, e0.digest)
    fake.uncertain = true // Simulates network failure after PATCH succeeds on server

    const result = await store.append(e1, (await store.read()).revision)
    expect(result.events.some((item) => item.id === e1.id)).toBe(true)
    expect(result.revision).toBe(reduceRun([e0, e1]).revision)
  })

  it('fails closed when an event segment is missing from the tree', async () => {
    const fake = fakeGitHub()
    const runId = 'missing-seg'
    const store = await storeFor(fake, runId, { segmentSize: 2 })

    // Write 3 events -> seals seg-0 (2 events) and tail has 1 event
    const e0 = startEvent(runId)
    const e1 = event(runId, 1, e0.digest)
    const e2 = event(runId, 2, e1.digest)
    await store.append(e0, null)
    await store.append(e1, (await store.read()).revision)
    await store.append(e2, (await store.read()).revision)

    // Remove seg-0 from tree
    const currentRef = fake.refs.get('agentflow-state')
    const commit = fake.objects.get(currentRef)
    const tree = fake.objects.get(commit.tree.sha)
    tree.tree = tree.tree.filter((entry) => !entry.path.includes('seg-0'))

    await expect(store.read({ cache: false })).rejects.toThrow(/Corrupted or missing event segment/)
  })

  it('fails closed when a segment blob has a corrupted digest', async () => {
    const fake = fakeGitHub()
    const runId = 'corrupt-seg'
    const store = await storeFor(fake, runId, { segmentSize: 2 })

    const e0 = startEvent(runId)
    const e1 = event(runId, 1, e0.digest)
    const e2 = event(runId, 2, e1.digest)
    await store.append(e0, null)
    await store.append(e1, (await store.read()).revision)
    await store.append(e2, (await store.read()).revision)

    // Tamper with seg-0 blob
    const currentRef = fake.refs.get('agentflow-state')
    const commit = fake.objects.get(currentRef)
    const tree = fake.objects.get(commit.tree.sha)
    const segEntry = tree.tree.find((entry) => entry.path.includes('seg-0'))
    const blob = fake.objects.get(segEntry.sha)
    blob.content = JSON.stringify([
      { ...e0, kind: 'started', payload: { ...e0.payload, owner: 'tampered' } },
      e1,
    ])

    await expect(store.read({ cache: false })).rejects.toThrow(/Segment digest mismatch/)
  })

  it('fails closed when the segment parentDigest chain is broken', async () => {
    const fake = fakeGitHub()
    const runId = 'broken-chain'
    const store = await storeFor(fake, runId, { segmentSize: 2 })

    const e0 = startEvent(runId)
    await store.append(e0, null)
    let rev = (await store.read()).revision
    let prev = e0.digest
    for (let i = 1; i <= 5; i++) {
      const e = event(runId, i, prev)
      const res = await store.append(e, rev)
      rev = res.revision
      prev = e.digest
    }

    // Tamper with manifest segment parentDigest
    const currentRef = fake.refs.get('agentflow-state')
    const commit = fake.objects.get(currentRef)
    const tree = fake.objects.get(commit.tree.sha)
    const manifestEntry = tree.tree.find((entry) => entry.path.includes('manifest'))
    const manifestBlob = fake.objects.get(manifestEntry.sha)
    const manifest = JSON.parse(manifestBlob.content)
    manifest.segments[1].parentDigest = 'f'.repeat(64)
    manifestBlob.content = JSON.stringify(manifest)

    await expect(store.read({ cache: false })).rejects.toThrow(/Segment parent digest mismatch/)
  })

  it('rejects concurrent conflicting writer on CAS without losing data', async () => {
    const fake = fakeGitHub()
    const runId = 'two-writers'
    const store1 = await storeFor(fake, runId)
    const store2 = await storeFor(fake, runId)

    const initial = startEvent(runId)
    await store1.append(initial, null)
    const commonRevision = (await store1.read()).revision

    const barrier = patchBarrier(fake, 2)
    const w1 = store1.append(event(runId, 1, initial.digest), commonRevision)
    const w2 = store2.append(event(runId, 2, initial.digest), commonRevision)

    await barrier.arrived
    barrier.writes[0].release.resolve()
    const w1Result = await w1
    expect(w1Result.events.some((e) => e.id === 'event-1')).toBe(true)

    barrier.writes[1].release.resolve()
    const w2Error = await w2.catch((e) => e)
    expect(w2Error.status).toBe(422)
    expect(w2Error.admissionOutcome).toBe('not-committed')

    const finalState = await store1.read()
    expect(finalState.events.length).toBe(2)
  })

  it('previews v1 migration without writes and executes migration with replay equality', async () => {
    const fake = fakeGitHub()
    const runId = 'migrate-test'
    const v1Events = generateEvents(runId, 25)
    await setupV1Store(fake, runId, v1Events)

    const initialCommitSha = fake.refs.get('agentflow-state')

    // Preview
    const preview = await previewMigration({
      repo: 'test/repo',
      runId,
      client: fake.client,
      segmentSize: 10,
    })
    expect(preview.verified).toBe(true)
    expect(preview.eventCount).toBe(25)
    expect(preview.segmentCount).toBe(3) // 10, 10, 5
    expect(preview.replayedRevision).toBe(reduceRun(v1Events).revision)
    expect(fake.refs.get('agentflow-state')).toBe(initialCommitSha) // No writes in preview

    // Migrate
    const receipt = await migrateRunStore({
      repo: 'test/repo',
      runId,
      client: fake.client,
      boundary: 'external-action',
      segmentSize: 10,
    })
    expect(receipt.verified).toBe(true)
    expect(receipt.priorRevision).toBe(initialCommitSha)
    expect(receipt.newRevision).not.toBe(initialCommitSha)
    expect(receipt.finalRevision).toBe(reduceRun(v1Events).revision)

    // Read migrated store with segmented store
    const store = await storeFor(fake, runId)
    const migrated = await store.read()
    expect(migrated.events.length).toBe(25)
    expect(migrated.revision).toBe(reduceRun(v1Events).revision)
    expect(migrated.manifest.segments.length).toBe(3)
  })

  it('fails closed on old v1 reader when reading a migrated v2 run', async () => {
    const fake = fakeGitHub()
    const runId = 'v1-fail-closed'
    const v1Events = generateEvents(runId, 5)
    await setupV1Store(fake, runId, v1Events)

    // Migrate to v2
    await migrateRunStore({
      repo: 'test/repo',
      runId,
      client: fake.client,
      boundary: 'external-action',
      segmentSize: 2,
    })

    // Now try reading with old v1 store
    const legacyStore = createGitHubRunStore({
      repo: 'test/repo',
      runId,
      client: fake.client,
      boundary: 'external-action',
    })

    // Legacy store JSON.parses runs/runId.json which contains the fail-closed marker object
    // reduceRun(object) throws because events must be an array
    await expect(legacyStore.read({ cache: false })).rejects.toThrow()
  })

  it('allows history to grow across segments without hitting the v1 1 MiB single-file limit', async () => {
    const fake = fakeGitHub()
    const runId = 'unbounded-segments'
    const store = await storeFor(fake, runId, {
      segmentSize: 10,
      segmentBytes: 4096,
    })

    // Append 50 events spanning multiple segments
    const events = generateEvents(runId, 50)
    let rev = null
    for (const e of events) {
      const res = await store.append(e, rev)
      rev = res.revision
    }

    const state = await store.read()
    expect(state.manifest.segments.length).toBe(5)
    expect(state.events.length).toBe(50)
    expect(state.revision).toBe(reduceRun(events).revision)
  })
})
