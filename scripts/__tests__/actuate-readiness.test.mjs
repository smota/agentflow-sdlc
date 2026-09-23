import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createGitHubRunStore,
  planGitHubCoordination,
} from '../../lib/sources/github-run-store.mjs'
import { createRunEvent } from '../../lib/core/run-state.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
import { GATE_CLASSES } from '../../lib/core/gate.mjs'
import { createGatePendingHook } from '../../lib/adapters/gate-pending-hook.mjs'
import { actuateTopAction, createLocalCursorStore } from '../actuate-readiness.mjs'

// Same fake GitHub coordination backend used by lib/sources/__tests__/github-run-store.test.mjs:
// one shared object/ref store behind a client whose git-refs write is atomic and non-force, exactly
// like the real API. Two independent createGitHubRunStore instances pointed at the same fake
// backend genuinely interleave through their multiple `await request(...)` calls, which is what
// lets a Promise.all below reproduce a real concurrent race instead of a synthetic one.
function fakeGitHub() {
  const objects = new Map(),
    refs = new Map(),
    requests = []
  const put = (value) => {
    const sha = recordDigest(value)
    objects.set(sha, value)
    return { sha }
  }
  const client = {
    async request(path, options = {}) {
      requests.push({ path, ...options })
      const tail = path.replace('/repos/test/repo', '')
      if (!options.method) {
        if (!tail) return { default_branch: 'main' }
        if (tail.startsWith('/rulesets?')) return []
        if (tail.startsWith('/actions/workflows?')) return { total_count: 0, workflows: [] }
        if (tail === '/git/ref/heads/main') return { object: { sha: 'baseline' } }
        if (tail.startsWith('/git/ref/heads/')) {
          const sha = refs.get(tail.slice(15))
          if (!sha) throw Object.assign(new Error('not found'), { status: 404 })
          return { object: { sha } }
        }
        if (tail.startsWith('/git/commits/')) return objects.get(tail.slice(13))
        if (tail.startsWith('/git/trees/'))
          return { tree: objects.get(tail.slice(11).split('?')[0]).tree, truncated: false }
        if (tail.startsWith('/git/blobs/')) {
          const blob = objects.get(tail.slice(11))
          return {
            encoding: 'base64',
            content: Buffer.from(blob.content).toString('base64'),
            size: Buffer.byteLength(blob.content),
          }
        }
      }
      const body = options.body
      if (tail === '/git/blobs') return put(body)
      if (tail === '/git/trees') return put({ tree: body.tree })
      if (tail === '/git/commits') return put({ ...body, tree: { sha: body.tree } })
      if (tail.startsWith('/git/refs')) {
        const branch = body.ref?.replace('refs/heads/', '') ?? tail.slice('/git/refs/heads/'.length)
        const existing = refs.get(branch)
        const commit = objects.get(body.sha)
        if (existing && (body.force !== false || commit.parents[0] !== existing))
          throw Object.assign(new Error('conflict'), { status: 422 })
        refs.set(branch, body.sha)
        return { object: { sha: body.sha } }
      }
      throw new Error(`Unexpected request: ${tail}`)
    },
  }
  return { client, requests, refs, objects }
}

const runId = 'demo'
const started = () =>
  createRunEvent({
    runId,
    id: 'start',
    kind: 'started',
    payload: {
      goalRef: 'issue:1',
      owner: 'writer',
      profile: 'standard',
      boundary: 'external-action',
    },
  })

async function seedStartedRun(fake) {
  const setupConfirm = (await planGitHubCoordination({ repo: 'test/repo', client: fake.client }))
    .digest
  const store = createGitHubRunStore({
    repo: 'test/repo',
    runId,
    client: fake.client,
    boundary: 'external-action',
    setupConfirm,
  })
  await store.append(started(), null)
  return setupConfirm
}

function storeFor(fake, setupConfirm) {
  return createGitHubRunStore({
    repo: 'test/repo',
    runId,
    client: fake.client,
    boundary: 'external-action',
    setupConfirm,
  })
}

const contract = () => ({
  queue: [
    {
      unitRef: { kind: 'goal', id: 'goal:1', number: 1, revision: 'a'.repeat(64) },
      status: 'blocked',
      action: {
        id: 'request-human-gate',
        label: 'Request human approval gate',
        reason: 'High-assurance path requires an explicit human decision.',
        priority: 95,
      },
      gate: {
        gateClass: GATE_CLASSES.adequacyOfIntent,
        subjectDigest: 'a'.repeat(64),
        subjectKind: 'goalRevision',
        requiredRole: 'reviewer',
      },
    },
  ],
})

function gatePendingEvents(events) {
  return events.filter((event) => event.id.startsWith('gate-pending:'))
}

describe('actuate-readiness (D2/D3)', () => {
  it('3. two actuators firing concurrently on the identical open gate produce exactly one actuation', async () => {
    const fake = fakeGitHub()
    const setupConfirm = await seedStartedRun(fake)
    // Two independent actuator processes/runners — two separate store instances, same backend.
    const storeA = storeFor(fake, setupConfirm)
    const storeB = storeFor(fake, setupConfirm)
    const [resultA, resultB] = await Promise.all([
      actuateTopAction({ contract: contract(), runStore: storeA, runId }),
      actuateTopAction({ contract: contract(), runStore: storeB, runId }),
    ])
    // No daemon holds a lock in memory anywhere here: both callers independently re-read the
    // durable store and rely on its own compare-and-swap (non-force fast-forward ref update).
    // Neither call is allowed to report an unexplained failure. Depending on exactly how the two
    // interleave, the loser converges one of two ways — it may lose the race inside `append()`
    // itself (reason: 'converged'), or its own pre-write read may already observe the winner's
    // commit (reason: 'already-recorded') — but either way both callers must report success.
    expect(resultA.actuated).toBe(true)
    expect(resultB.actuated).toBe(true)
    expect([undefined, 'converged', 'already-recorded']).toContain(resultA.reason)
    expect([undefined, 'converged', 'already-recorded']).toContain(resultB.reason)
    // The property under test is not which internal path each caller took — it is what ended up
    // durably recorded: exactly one gate-pending checkpoint for this gate, never two.
    const verifyStore = storeFor(fake, setupConfirm)
    const finalState = await verifyStore.read()
    expect(gatePendingEvents(finalState.events)).toHaveLength(1)
  })

  it('4. deleting all local operational state mid-run loses no governance state; the run resumes', async () => {
    const fake = fakeGitHub()
    const setupConfirm = await seedStartedRun(fake)
    const store = storeFor(fake, setupConfirm)
    const first = await actuateTopAction({ contract: contract(), runStore: store, runId })
    expect(first.actuated).toBe(true)

    // Write, then destroy, the LOCAL operational cursor — the only thing this actuator keeps
    // outside the durable store.
    const dir = mkdtempSync(join(tmpdir(), 'agentflow-actuator-'))
    const cursorPath = join(dir, 'actuator-cursor.json')
    const cursor = createLocalCursorStore(cursorPath)
    cursor.write({ lastRevision: first.event.digest, lastEventId: first.event.id })
    expect(existsSync(cursorPath)).toBe(true)
    unlinkSync(cursorPath)
    expect(existsSync(cursorPath)).toBe(false)
    rmSync(dir, { recursive: true, force: true })

    // A brand-new runner, zero local state, pointed only at the durable store: it must recognize
    // the gate is already recorded (no duplicate actuation) purely by reading refs/heads/agentflow-
    // state fresh — never by consulting the cursor that no longer exists.
    const freshRunner = storeFor(fake, setupConfirm)
    const resumed = await actuateTopAction({ contract: contract(), runStore: freshRunner, runId })
    expect(resumed.actuated).toBe(true)
    expect(resumed.reason).toBe('already-recorded')

    const finalState = await freshRunner.read()
    expect(gatePendingEvents(finalState.events)).toHaveLength(1)
    expect(finalState.events.some((event) => event.id === first.event.id)).toBe(true)
  })

  it('an empty queue is not actuated', async () => {
    const fake = fakeGitHub()
    const setupConfirm = await seedStartedRun(fake)
    const store = storeFor(fake, setupConfirm)
    const result = await actuateTopAction({ contract: { queue: [] }, runStore: store, runId })
    expect(result).toEqual({ actuated: false, reason: 'queue-empty' })
  })

  // W8c D5 — DEFECT FIXED. createGatePendingHook (lib/adapters/gate-pending-hook.mjs) was built
  // and never called from the actuator. It now fires exactly once, only when THIS call is the one
  // that actually opens the gate (never on an 'already-recorded'/'converged' read, which means some
  // other actuator already had its own chance to notify).
  it('7. when the actuator opens a gate, a configured hook receives exactly one event', async () => {
    const fake = fakeGitHub()
    const setupConfirm = await seedStartedRun(fake)
    const store = storeFor(fake, setupConfirm)
    const deliver = vi.fn().mockResolvedValue()
    const hook = createGatePendingHook(
      { gateNotifications: { hookUrl: 'https://example.test/hooks/gate-pending' } },
      { deliver },
    )
    const first = await actuateTopAction({ contract: contract(), runStore: store, runId, hook })
    expect(first.actuated).toBe(true)
    expect(deliver).toHaveBeenCalledTimes(1)
    const [, deliveredEvent] = deliver.mock.calls[0]
    expect(deliveredEvent.type).toBe('gate-pending')
    expect(deliveredEvent.gateClass).toBe(GATE_CLASSES.adequacyOfIntent)

    // A second actuation of the SAME already-open gate must not notify again — this run already
    // recorded it, so this call reports 'already-recorded' and the hook is never re-invoked.
    const second = await actuateTopAction({ contract: contract(), runStore: store, runId, hook })
    expect(second.reason).toBe('already-recorded')
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('an unconfigured hook stays silent while the gate still opens', async () => {
    const fake = fakeGitHub()
    const setupConfirm = await seedStartedRun(fake)
    const store = storeFor(fake, setupConfirm)
    const deliver = vi.fn()
    const hook = createGatePendingHook({}, { deliver })
    const result = await actuateTopAction({ contract: contract(), runStore: store, runId, hook })
    expect(result.actuated).toBe(true)
    expect(deliver).not.toHaveBeenCalled()
  })
})
