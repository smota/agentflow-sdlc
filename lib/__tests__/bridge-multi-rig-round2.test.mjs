// Several delivery rigs (#586), review round 2: the bridge's queue session survives an upgrade,
// every park is its own gate, only trusted writers record gates, claim release needs authority,
// a resume cannot take over a running start, and the review digest takes the source's head.
// Memory queue ports and a filesystem source only: no network, no rig.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gateCapacityAdmission } from '../bridge/backpressure.mjs'
import { bridgeSessionFor, createBridge, sourceCandidateHead } from '../bridge/bridge.mjs'
import { normalizeBridgeConfig } from '../bridge/config.mjs'
import { gateMarkerState } from '../bridge/gate-markers.mjs'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'
import { stableQueueId } from '../bridge/queue-id.mjs'
import { formatRolePassComment, rolePassIdempotencyKey } from '../core/role-pass-evidence.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { formatGateDecision } from '../roster/authority.mjs'
import {
  createFilesystemSourceAdapter,
  createFilesystemWorkItem,
} from '../sources/filesystem-source.mjs'

const P = 'agentflow-p'
const CONTROL = 'agentflow-p-control'
const D1 = 'agentflow-p-d1'
const D2 = 'agentflow-p-d2'
const BRIDGE = 'agentflow-bridge'
const TRUSTED = [BRIDGE, 'rig-p', 'rig-d1', 'rig-d2']
const OPERATOR = `human@${CONTROL}`

const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function world() {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-round2-'))
  dirs.push(root)
  const queue = createMemoryQueuePort()
  const source = (writer = BRIDGE) =>
    createFilesystemSourceAdapter({ root, writer, trustedWriters: TRUSTED })
  const config = (rigs, extra = {}) =>
    normalizeBridgeConfig({
      ...rigs,
      source: { adapter: 'filesystem', claimWriters: TRUSTED },
      ...extra,
    })
  const bridge = (rigs, options = {}, writer = BRIDGE) =>
    createBridge({ source: source(writer), queue, config: config(rigs), ...options })
  let counter = 0
  const makeItem = (fields = {}) =>
    createFilesystemWorkItem(root, {
      id: fields.id ?? `item-${++counter}`,
      title: 't',
      labels: ['agentflow:ready'],
      changeClass: 'standard',
      ...fields,
    })
  return { root, queue, source, config, bridge, makeItem }
}

const MULTI = { rigs: { control: CONTROL, delivery: [D1, D2] } }
const live = (queue) =>
  queue.rows().filter((row) => ['pending', 'in-progress', 'blocked'].includes(row.state))
const openGates = async (source, ref) =>
  (await source.readWorkItem({ id: parseSourceRef(ref).id })).openGates

async function comment(source, ref, body, key) {
  const plan = await source.previewMutation({
    operation: 'add-comment',
    parameters: { id: parseSourceRef(ref).id, body },
    actionBoundary: { effective: 'external-action' },
    ...(key ? { idempotencyKey: key } : {}),
  })
  await source.flushReceipt(await source.applyMutation(plan, { confirm: plan.token }))
}

async function reviewed(source, ref, attempt = 1) {
  const { id } = parseSourceRef(ref)
  for (const [phase, seat] of [
    [4, 'dev.build'],
    [6, 'rev.review'],
  ]) {
    await comment(
      source,
      ref,
      formatRolePassComment({
        idempotencyKey: rolePassIdempotencyKey({ stableId: id, phase, status: 'pass', attempt }),
        phase,
        role: 'role',
        status: 'pass',
        seat,
        seatVerified: false,
        seatRig: null,
        body: `phase ${phase}`,
      }),
    )
  }
}

describe('the bridge queue session survives an upgrade (round 2, blocking 1)', () => {
  it('is agentflow-bridge@<project>, the same before and after a single-to-multi upgrade', () => {
    const single = normalizeBridgeConfig({ rig: P, source: { adapter: 'filesystem' } })
    const upgraded = normalizeBridgeConfig({
      rigs: { control: CONTROL, delivery: [P, D1] },
      source: { adapter: 'filesystem' },
    })
    expect(bridgeSessionFor(single)).toBe(`agentflow-bridge@${P}`)
    expect(bridgeSessionFor(upgraded)).toBe(`agentflow-bridge@${P}`)
    expect(
      bridgeSessionFor(
        normalizeBridgeConfig({ ...upgraded, project: 'proj', source: { adapter: 'filesystem' } }),
      ),
    ).toBe('agentflow-bridge@proj')
  })

  it('the documented upgrade queues nothing twice; reconcile, cancellation and markers see old rows', async () => {
    const { queue, bridge, makeItem, source } = world()
    const ref = makeItem()
    const stableId = stableQueueId(parseSourceRef(ref))
    const old = await bridge({ rig: P }).intake(ref)
    expect(old.status).toBe('queued')
    const upgraded = { rigs: { control: CONTROL, delivery: [P, D1] } }
    expect(await bridge(upgraded).intake(ref)).toMatchObject({ status: 'already-queued' })
    expect((await bridge(upgraded).reconcile({ session: OPERATOR })).restored).toEqual([])
    expect(live(queue)).toHaveLength(1)
    // The old row parks on the replay gate: marker sync records it.
    await queue.block(old.qitemId, { on: `external:reconcile-replay:${stableId}` })
    await bridge(upgraded).reconcile({ session: OPERATOR })
    expect(await openGates(source(), ref)).toBe(1)
    // Closing the item cancels the old row and closes its gate.
    const plan = await source().previewMutation({
      operation: 'set-lifecycle',
      parameters: { id: parseSourceRef(ref).id, lifecycle: 'closed' },
      actionBoundary: { effective: 'external-action' },
    })
    await source().flushReceipt(await source().applyMutation(plan, { confirm: plan.token }))
    const closed = await bridge(upgraded).intake(ref, { event: 'closed', session: OPERATOR })
    expect(closed.canceled).toEqual([old.qitemId])
    expect(await openGates(source(), ref)).toBe(0)
  })

  it('rows created under a rig session before a rename stay visible (legacy sources)', async () => {
    const { queue, bridge, makeItem, source } = world()
    const ref = makeItem()
    const old = await bridge({ rig: 'agentflow-old' }).intake(ref)
    // The control rig is renamed to a name the project id cannot be derived back from.
    const renamed = { rigs: { control: 'ctl', delivery: ['agentflow-old', D1] } }
    expect(await bridge(renamed).intake(ref)).toMatchObject({ status: 'already-queued' })
    expect(live(queue)).toHaveLength(1)
    // Stray settling sees the old row once the item merges.
    const plan = await source().previewMutation({
      operation: 'set-lifecycle',
      parameters: { id: parseSourceRef(ref).id, lifecycle: 'merged' },
      actionBoundary: { effective: 'external-action' },
    })
    await source().flushReceipt(await source().applyMutation(plan, { confirm: plan.token }))
    const report = await bridge(renamed).reconcile({ session: 'human@ctl' })
    expect(report.settled).toEqual([
      expect.objectContaining({ ref, lifecycle: 'merged', stableId: old.stableId }),
    ])
  })
})

describe('each park is its own gate (round 2, blocking 2)', () => {
  it('park, resolve, park again counts again', async () => {
    const { queue, bridge, makeItem, source } = world()
    const a = makeItem()
    const stableA = stableQueueId(parseSourceRef(a))
    const { offers } = await bridge(MULTI).intake(a)
    const started = await bridge(MULTI, {}, 'rig-d1').start(offers[0].qitemId, {
      session: `pm-analyst@${D1}`,
    })
    const gate = `external:review:${stableA}`
    await queue.block(started.packetId, { on: gate })
    await bridge(MULTI).reconcile({ session: OPERATOR })
    expect(await openGates(source(), a)).toBe(1)
    await reviewed(source(), a)
    expect(
      await bridge(MULTI).intake(a, { event: 'review-done', session: OPERATOR }),
    ).toMatchObject({ status: 'resolved' })
    expect(await openGates(source(), a)).toBe(0)
    // The same packet parks again in a later round: a new name, counted again.
    await queue.block(started.packetId, { on: gate })
    await bridge(MULTI).reconcile({ session: OPERATOR })
    expect(await openGates(source(), a)).toBe(1)
    const state = gateMarkerState(
      await source().readLogEntries({ id: parseSourceRef(a).id }),
      TRUSTED,
    )
    expect([...state.open.values()]).toEqual([`${gate}@${started.packetId}~2`])
  })

  it('backpressure holds a second item while the re-parked gate is open', async () => {
    const { queue, bridge, makeItem, source } = world()
    const admission = gateCapacityAdmission({ source: source(), maxOpenGates: 1 })
    const a = makeItem()
    const stableA = stableQueueId(parseSourceRef(a))
    const { offers } = await bridge(MULTI, { admission }).intake(a)
    const started = await bridge(MULTI, {}, 'rig-d1').start(offers[0].qitemId, {
      session: `pm-analyst@${D1}`,
    })
    const gate = `external:merge:${stableA}`
    await queue.block(started.packetId, { on: gate })
    await queue.resolve(started.packetId, { decision: 'resolved in the queue' })
    await queue.block(started.packetId, { on: gate })
    const b = makeItem()
    expect(await bridge(MULTI, { admission }).intake(b)).toMatchObject({
      status: 'deferred',
      openGates: 1,
    })
  })
})

describe('only trusted writers record gates (round 2, blocking 3)', () => {
  it('an untrusted waiting marker opens nothing and an untrusted closed marker closes nothing', async () => {
    const { queue, bridge, makeItem, source } = world()
    const a = makeItem()
    const stableA = stableQueueId(parseSourceRef(a))
    const evil = source('mallory')
    await comment(evil, a, `<!-- agentflow-gate:waiting:external:review:${stableA}@forged~1 -->`)
    expect(await openGates(source(), a)).toBe(0)
    const { offers } = await bridge(MULTI).intake(a)
    const started = await bridge(MULTI, {}, 'rig-d1').start(offers[0].qitemId, {
      session: `pm-analyst@${D1}`,
    })
    await queue.block(started.packetId, { on: `external:review:${stableA}` })
    await bridge(MULTI).reconcile({ session: OPERATOR })
    expect(await openGates(source(), a)).toBe(1)
    const name = `external:review:${stableA}@${started.packetId}~1`
    await comment(evil, a, `<!-- agentflow-gate:closed:${name} -->`)
    expect(await openGates(source(), a)).toBe(1)
    // The bridge does not read it either: reconcile keeps the gate open and writes nothing new.
    await bridge(MULTI).reconcile({ session: OPERATOR })
    expect(await openGates(source(), a)).toBe(1)
    const state = gateMarkerState(
      await source().readLogEntries({ id: parseSourceRef(a).id }),
      TRUSTED,
    )
    expect([...state.open.values()]).toEqual([name])
  })
})

describe('claim release needs authority (round 2 advisory)', () => {
  const roster = {
    version: 1,
    people: [
      {
        id: 'sam',
        handles: { filesystem: 'sam-writer' },
        scopes: [{ gates: ['acceptance-review'], tiers: ['standard'] }],
      },
    ],
  }

  it("a configured rig's claim is released only for a roster person", async () => {
    const { bridge, makeItem, source } = world()
    const ref = makeItem()
    const { id } = parseSourceRef(ref)
    await source('rig-d1').claim({ id }, { kind: 'rig', rig: D1, host: 'local' })
    await expect(bridge(MULTI).release(ref, { session: OPERATOR })).rejects.toMatchObject({
      status: 'refused',
    })
    await expect(
      bridge(MULTI, { roster }).release(ref, { session: OPERATOR, person: 'nobody' }),
    ).rejects.toMatchObject({ status: 'refused' })
    expect(
      await bridge(MULTI, { roster }).release(ref, { session: OPERATOR, person: 'sam' }),
    ).toMatchObject({ status: 'released', holder: { rig: D1 }, releasedFor: 'sam' })
  })

  it("a removed rig's claim is released by any named caller outside the delivery rigs", async () => {
    const { bridge, makeItem, source } = world()
    const ref = makeItem()
    const { id } = parseSourceRef(ref)
    await source('rig-d1').claim({ id }, { kind: 'rig', rig: D1, host: 'local' })
    const onlyD2 = { rigs: { control: CONTROL, delivery: [D2] } }
    expect(await bridge(onlyD2).release(ref, { session: OPERATOR })).toMatchObject({
      status: 'released',
      holder: { rig: D1 },
    })
  })
})

describe('resume takes a lease (round 2 advisory)', () => {
  it('a resume during a running start is refused; after the lease expires it may take over', async () => {
    const { queue, bridge, makeItem } = world()
    const ref = makeItem()
    const { offers } = await bridge(MULTI).intake(ref)
    const mine = offers[0].qitemId
    let release
    const gate = new Promise((done) => {
      release = done
    })
    const slow = { prepare: async () => (await gate, { path: '/w' }) }
    const running = bridge(MULTI, { worktrees: slow }, 'rig-d1').start(mine, {
      session: `pm-analyst@${D1}`,
    })
    await new Promise((done) => setTimeout(done, 20))
    await expect(
      bridge(MULTI, {}, 'rig-d1').start(mine, { session: `pm-analyst@${D1}`, resume: true }),
    ).rejects.toMatchObject({ status: 'refused' })
    release()
    expect((await running).status).toBe('started')
    expect(queue.instances()).toHaveLength(1)
  })

  it('an expired lease lets one resume through; a second concurrent resume loses the atomic claim', async () => {
    const { queue, bridge, makeItem, source } = world()
    const ref = makeItem()
    const { offers } = await bridge(MULTI).intake(ref)
    const mine = offers[0].qitemId
    // The start died after the queue claim, its lease and the source claim.
    await queue.claim(mine, { session: `pm-analyst@${D1}` })
    await queue.update(mine, {
      note: `agentflow-start-lease session=pm-analyst@${D1} at=2026-01-01T00:00:00.000Z`,
    })
    await source('rig-d1').claim(
      { id: parseSourceRef(ref).id },
      { kind: 'rig', rig: D1, host: 'local' },
    )
    const later = { clock: () => new Date('2026-01-01T01:00:00.000Z') }
    const results = await Promise.allSettled([
      bridge(MULTI, later, 'rig-d1').start(mine, { session: `pm-analyst@${D1}`, resume: true }),
      bridge(MULTI, later, 'rig-d1').start(mine, { session: `pm-analyst@${D1}`, resume: true }),
    ])
    const started = results.filter(
      (result) => result.status === 'fulfilled' && result.value.status === 'started',
    )
    expect(started).toHaveLength(1)
    expect(started[0].value.resumed).toBe(true)
    expect(queue.instances()).toHaveLength(1)
  })
})

describe('the review digest takes the source head (round 2 advisory)', () => {
  const roster = {
    version: 1,
    people: [
      {
        id: 'sam',
        handles: { filesystem: 'sam-writer' },
        scopes: [{ gates: ['acceptance-review'], tiers: ['standard'] }],
      },
    ],
  }

  it('prefers a head the source reports over a branch head', async () => {
    expect(sourceCandidateHead({ head: 'abc' })).toBe('abc')
    expect(sourceCandidateHead({ mergedHead: 'def' })).toBe('def')
    expect(sourceCandidateHead({})).toBeNull()
    const { bridge, makeItem, source } = world()
    const ref = makeItem()
    await reviewed(source(), ref)
    const withHead = source()
    const readWorkItem = withHead.readWorkItem.bind(withHead)
    let head = 'a'.repeat(40)
    withHead.readWorkItem = async (reference) => ({ ...(await readWorkItem(reference)), head })
    const branch = async () => 'b'.repeat(40)
    const b = createBridge({
      source: withHead,
      queue: createMemoryQueuePort(),
      config: normalizeBridgeConfig({
        ...MULTI,
        source: { adapter: 'filesystem', claimWriters: TRUSTED },
      }),
      roster,
      candidateHead: branch,
    })
    const first = await b.intake(ref, { event: 'review-done', session: OPERATOR })
    expect(first.gate).toMatchObject({ candidateHead: head, candidateFrom: 'source' })
    await comment(
      source('sam-writer'),
      ref,
      formatGateDecision({ gate: first.gate.gateId, decision: 'agree' }),
    )
    expect((await b.intake(ref, { event: 'review-done', session: OPERATOR })).gate.satisfied).toBe(
      true,
    )
    // The source reports a new head (a push after the agreement): the agreement is stale.
    head = 'c'.repeat(40)
    const after = await b.intake(ref, { event: 'review-done', session: OPERATOR })
    expect(after.status).toBe('not-ready')
    expect(after.gate.ignored.map((item) => item.reason)).toEqual(['stale-gate'])
    // Without a source head, the branch head is used and said so.
    const plain = createBridge({
      source: source(),
      queue: createMemoryQueuePort(),
      config: normalizeBridgeConfig({
        ...MULTI,
        source: { adapter: 'filesystem', claimWriters: TRUSTED },
      }),
      roster,
      candidateHead: branch,
    })
    expect(
      (await plain.intake(ref, { event: 'review-done', session: OPERATOR })).gate,
    ).toMatchObject({ candidateHead: 'b'.repeat(40), candidateFrom: 'branch' })
  })
})

describe('a stood-down start tells a person (round 2 advisory)', () => {
  it('notifies when a start supersedes itself for a concurrent one', async () => {
    const { queue, bridge, makeItem } = world()
    const ref = makeItem()
    const { offers } = await bridge(MULTI).intake(ref)
    const mine = offers[0].qitemId
    const row = await queue.show(mine)
    await queue.create({
      id: `${mine}-g2`,
      destination: row.destination,
      source: row.source,
      body: row.body,
      tags: row.tags,
    })
    const delivered = []
    const notifier = { deliver: async (input) => (delivered.push(input), { ok: true }) }
    const d1 = bridge(MULTI, { notifier }, 'rig-d1')
    const results = await Promise.all([
      d1.start(mine, { session: `pm-analyst@${D1}` }),
      d1.start(`${mine}-g2`, { session: `pm-analyst@${D1}` }),
    ])
    const stoodDown = results.filter((result) => result.concurrentWith)
    expect(stoodDown.length).toBeGreaterThan(0)
    expect(delivered.filter((item) => item.kind === 'start-superseded')).toHaveLength(
      stoodDown.length,
    )
  })
})
