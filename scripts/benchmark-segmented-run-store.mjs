// Local fake-source measurement. This does not qualify network or live-source throughput.
import { performance } from 'node:perf_hooks'
import { createRunEvent } from '../lib/core/run-state.mjs'
import { createSegmentedRunStore } from '../lib/sources/segmented-run-store.mjs'
import { planGitHubCoordination } from '../lib/sources/github-run-store.mjs'
import { fakeGitHub } from '../lib/__tests__/github-run-store.fixture.mjs'

async function measure(count, readCacheBytes) {
  const fake = fakeGitHub()
  const setup = await planGitHubCoordination({ repo: 'test/repo', client: fake.client })
  const metrics = {}
  const store = createSegmentedRunStore({
    repo: 'test/repo',
    runId: `bench-${count}`,
    client: fake.client,
    boundary: 'external-action',
    setupConfirm: setup.digest,
    segmentSize: 50,
    readCacheBytes,
    metrics,
  })
  let revision = null
  let parent = null
  const latencies = []
  for (let index = 0; index < count; index++) {
    const event = createRunEvent({
      runId: `bench-${count}`,
      id: `event-${index}`,
      previousDigest: parent,
      generation: 0,
      kind: index ? 'checkpoint' : 'started',
      payload: index
        ? { seq: index }
        : {
            goalRef: 'issue:297',
            owner: 'benchmark',
            profile: 'standard',
            boundary: 'external-action',
          },
      timestamp: '2026-09-28T00:00:00.000Z',
    })
    const start = performance.now()
    revision = (await store.append(event, revision)).revision
    latencies.push(performance.now() - start)
    parent = event.digest
  }
  const sorted = [...latencies].sort((a, b) => a - b)
  const readCalls = fake.requests.filter((request) => !request.method)
  const blobReads = readCalls.filter((request) => request.path.includes('/git/blobs/'))
  const readBytes = blobReads.reduce((sum, request) => {
    const sha = request.path.split('/').at(-1)
    return sum + Buffer.byteLength(fake.objects.get(sha)?.content ?? '')
  }, 0)
  return {
    count,
    readCacheBytes,
    segmentSize: 50,
    finalRevision: revision,
    sourceCalls: fake.requests.length,
    readCalls: readCalls.length,
    blobReads: blobReads.length,
    readBytes,
    ...metrics,
    totalMs: Math.round(latencies.reduce((sum, value) => sum + value, 0)),
    p50Ms: Number(sorted[Math.floor(sorted.length * 0.5)].toFixed(2)),
    p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
  }
}

const results = []
for (const count of [50, 100, 200]) {
  results.push(await measure(count, 0))
  results.push(await measure(count, 2 * 1024 * 1024))
}
console.log(
  JSON.stringify(
    {
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      workload:
        'single-process fake GitHub source, sequential started/checkpoint events; includes setup',
      priorBaseline: {
        source: 'issue #297 comment at candidate 5976b1e',
        50: { ms: 30, calls: 807 },
        100: { ms: 109, calls: 1710 },
        200: { ms: 365, calls: 3816 },
      },
      results,
    },
    null,
    2,
  ),
)
