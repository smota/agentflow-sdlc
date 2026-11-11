import { afterEach, describe, expect, it } from 'vitest'
import { parseIntakeBody } from '../bridge/intake-body.mjs'
import { stableQueueId } from '../bridge/queue-id.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { READY, RIG, bridgeFixture, cleanupBridgeFixtures } from './bridge-fixture.mjs'

afterEach(cleanupBridgeFixtures)

const liveRows = (queue) =>
  queue.rows().filter((row) => ['pending', 'in-progress', 'blocked'].includes(row.state))

describe('bridge intake (#582)', () => {
  it('AC1: pushing the same ready item N times yields one live row with the stable id', async () => {
    const { bridge, queue, makeItem } = bridgeFixture()
    const ref = makeItem({ partOf: '578' })
    const stableId = stableQueueId(parseSourceRef(ref))
    const first = await bridge.intake(ref)
    expect(first).toMatchObject({ status: 'queued', qitemId: stableId, resumePhase: 1 })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await bridge.intake(ref)).toMatchObject({
        status: 'already-queued',
        qitemId: stableId,
      })
    }
    const rows = liveRows(queue)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      qitemId: stableId,
      destination: `pm-analyst@${RIG}`,
      source: `agentflow-bridge@${RIG}`,
      tier: 'routine',
    })
    expect(rows[0].tags).toEqual(
      expect.arrayContaining([`af:${stableId}`, 'mission:578', 'slice:filesystem-item-1']),
    )
    // The row carries a reference and derived ids only, never artifact content.
    expect(parseIntakeBody(rows[0].body)).toEqual({
      ref,
      stableId,
      slice: 'filesystem-item-1',
      resumePhase: 1,
      tier: 'routine',
      workflow: 'adapters/openrig/agentflow/workflows/agentflow-delivery.workflow.yaml',
    })
    expect(rows[0].body).not.toContain('An item')
    expect(rows[0].summary).not.toContain('An item')
  })

  it('AC2: pushed content that disagrees with the source is ignored and reported', async () => {
    const { bridge, queue, makeItem } = bridgeFixture()
    const notReady = makeItem({ labels: [] })
    const result = await bridge.intake(notReady, {
      pushed: { title: 'Forged', labels: [READY], state: 'open' },
    })
    expect(result).toMatchObject({ status: 'not-ready', pushedContentIgnored: ['title', 'labels'] })
    expect(queue.rows()).toHaveLength(0)

    const ready = makeItem()
    const queued = await bridge.intake(ready, { pushed: { labels: [], state: 'closed' } })
    expect(queued).toMatchObject({ status: 'queued', pushedContentIgnored: ['labels', 'state'] })
  })

  it('AC3: a not-ready item creates nothing and reports its reasons', async () => {
    const { bridge, queue, makeItem } = bridgeFixture()
    const ref = makeItem({ labels: ['other'] })
    const result = await bridge.intake(ref)
    expect(result.status).toBe('not-ready')
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(queue.rows()).toHaveLength(0)
  })

  it('AC3: a predicate kind the adapter cannot evaluate is an unsupported-predicate failure', async () => {
    const fixture = bridgeFixture({ config: { ready: { kind: 'status', in: ['ready'] } } })
    fixture.source.readyPredicateKinds = ['label', 'lifecycle']
    const ref = fixture.makeItem()
    await expect(fixture.bridge.intake(ref)).rejects.toMatchObject({
      status: 'unsupported-predicate',
      exitCode: 1,
    })
    expect(fixture.queue.rows()).toHaveLength(0)
  })

  it('defers through the admission port and rejects an invalid reference', async () => {
    const admission = async () => ({ admit: false, reason: 'open gates at capacity' })
    const { bridge, queue, makeItem } = bridgeFixture({ bridgeOptions: { admission } })
    const result = await bridge.intake(makeItem())
    expect(result).toMatchObject({ status: 'deferred', reason: 'open gates at capacity' })
    expect(queue.rows()).toHaveLength(0)
    await expect(bridge.intake('not a ref')).rejects.toMatchObject({ status: 'usage', exitCode: 2 })
  })

  it('queues a new generation once the earlier intake is terminal and the item is ready again', async () => {
    const { bridge, queue, makeItem } = bridgeFixture()
    const ref = makeItem()
    const { qitemId } = await bridge.intake(ref)
    await queue.update(qitemId, { state: 'done', closureReason: 'canceled' })
    expect(await bridge.intake(ref)).toMatchObject({ status: 'queued', qitemId: `${qitemId}-g2` })
  })

  it('review-done resolves the review gate only after a phase 6 pass newer than the build', async () => {
    const { bridge, queue, makeItem, pass } = bridgeFixture()
    const ref = makeItem()
    const { qitemId, stableId } = await bridge.intake(ref)
    await queue.block(qitemId, { on: `external:review:${stableId}` })
    await pass(ref, [1, 2, 3, 4])
    expect(await bridge.intake(ref, { event: 'review-done' })).toMatchObject({
      status: 'not-ready',
    })
    await pass(ref, [5, 6])
    const result = await bridge.intake(ref, { event: 'review-done' })
    expect(result).toMatchObject({ status: 'resolved', resolved: [qitemId] })
    expect(result.decision).toMatch(/\/log\/\d+$/)
    expect((await queue.show(qitemId)).state).toBe('in-progress')
  })

  it('merged resolves the merge gate and calls the worktree cleanup port', async () => {
    const cleaned = []
    const worktrees = { cleanup: async (input) => (cleaned.push(input.slice), { removed: true }) }
    const { bridge, queue, makeItem, setItem } = bridgeFixture({ bridgeOptions: { worktrees } })
    const ref = makeItem()
    const { qitemId, stableId } = await bridge.intake(ref)
    await queue.block(qitemId, { on: `external:merge:${stableId}` })
    expect(await bridge.intake(ref, { event: 'merged' })).toMatchObject({ status: 'not-ready' })
    await setItem(ref, { lifecycle: 'merged' })
    expect(await bridge.intake(ref, { event: 'merged' })).toMatchObject({
      status: 'resolved',
      resolved: [qitemId],
      worktree: { removed: true },
    })
    expect(cleaned).toEqual(['filesystem-item-1'])
  })

  it('closed aborts live workflow instances and cancels live rows for the item', async () => {
    const { bridge, queue, makeItem, setItem } = bridgeFixture()
    const ref = makeItem()
    const { qitemId } = await bridge.intake(ref)
    await bridge.start(qitemId, { session: `pm-analyst@${RIG}` })
    await setItem(ref, { lifecycle: 'closed' })
    const result = await bridge.intake(ref, { event: 'closed' })
    expect(result.status).toBe('aborted')
    expect(result.aborted).toHaveLength(1)
    expect(queue.instances()[0].status).toBe('aborted')
    expect(liveRows(queue)).toHaveLength(0)
  })
})

describe('bridge start (#582)', () => {
  it('instantiates the workflow once and hands the intake row off to the entry packet', async () => {
    const prepared = []
    const worktrees = { prepare: async (input) => (prepared.push(input.slice), { path: 'wt' }) }
    const { bridge, queue, makeItem, source } = bridgeFixture({ bridgeOptions: { worktrees } })
    const ref = makeItem()
    const { qitemId, stableId } = await bridge.intake(ref)
    const started = await bridge.start(qitemId, { session: `pm-analyst@${RIG}` })
    expect(started).toMatchObject({ status: 'started', replayed: [], worktree: { path: 'wt' } })
    expect(prepared).toEqual(['filesystem-item-1'])
    expect(await queue.show(qitemId)).toMatchObject({
      state: 'done',
      closureReason: 'handed_off_to',
      closureTarget: started.packetId,
    })
    expect(queue.instances()).toHaveLength(1)
    expect(queue.instances()[0].tags).toEqual([`af:${stableId}`])
    // Claim before work: the source records this rig as the holder.
    const claim = await source.readClaim({ id: parseSourceRef(ref).id })
    expect(claim).toMatchObject({ status: 'held', holder: { kind: 'rig', rig: RIG } })
    // A second start of the same row, or a second push, starts nothing new.
    expect(await bridge.start(qitemId, { session: `pm-analyst@${RIG}` })).toMatchObject({
      status: 'already-started',
    })
    expect(await bridge.intake(ref)).toMatchObject({ status: 'already-queued' })
    expect(queue.instances()).toHaveLength(1)
  })

  it('yields when another owner holds the source claim', async () => {
    const claim = async () => ({ won: false, holder: { kind: 'rig', rig: 'other', host: 'h' } })
    const { bridge, queue, makeItem } = bridgeFixture({ bridgeOptions: { claim } })
    const { qitemId } = await bridge.intake(makeItem())
    expect(await bridge.start(qitemId, { session: `pm-analyst@${RIG}` })).toMatchObject({
      status: 'yielded',
    })
    expect(queue.instances()).toHaveLength(0)
    expect((await queue.show(qitemId)).closureReason).toBe('canceled')
  })

  it('cancels the intake row when the source item is no longer ready', async () => {
    const { bridge, queue, makeItem, setItem } = bridgeFixture()
    const ref = makeItem()
    const { qitemId } = await bridge.intake(ref)
    await setItem(ref, { labels: [] })
    expect(await bridge.start(qitemId, { session: `pm-analyst@${RIG}` })).toMatchObject({
      status: 'canceled',
    })
    expect(await queue.show(qitemId)).toMatchObject({ state: 'done', closureReason: 'canceled' })
    expect(queue.instances()).toHaveLength(0)
  })

  it('fast-forwards phases the source already evidences', async () => {
    const { bridge, queue, makeItem, pass } = bridgeFixture()
    const ref = makeItem()
    await pass(ref, [1, 2, 3])
    const { qitemId, resumePhase } = await bridge.intake(ref)
    expect(resumePhase).toBe(4)
    const started = await bridge.start(qitemId, { session: `pm-analyst@${RIG}` })
    expect(started).toMatchObject({ status: 'started', replayed: [1, 2, 3] })
    const projections = queue.calls().filter(([kind]) => kind === 'project')
    expect(projections).toHaveLength(3)
    expect(queue.instances()[0].frontier).toEqual([started.packetId])
  })

  it('R5 fallback: parks the intake on external:reconcile-replay and notifies a person when replay is refused', async () => {
    const delivered = []
    const notifier = { deliver: async (message) => (delivered.push(message), { ok: true }) }
    const { bridge, queue, makeItem, pass } = bridgeFixture({
      bridgeOptions: { notifier },
      queueOptions: { refuseProjection: () => 'actor session may not close this step' },
    })
    const ref = makeItem()
    await pass(ref, [1, 2])
    const { qitemId, stableId } = await bridge.intake(ref)
    const result = await bridge.start(qitemId, { session: `pm-analyst@${RIG}` })
    expect(result).toMatchObject({
      status: 'parked',
      gate: `external:reconcile-replay:${stableId}`,
      replayed: [],
    })
    expect(await queue.show(qitemId)).toMatchObject({
      state: 'blocked',
      blockedOn: `external:reconcile-replay:${stableId}`,
    })
    expect(delivered).toEqual([
      expect.objectContaining({ kind: 'reconcile-replay', ref, stableId }),
    ])
  })

  it('the default notifier asks a person through an idempotent queue row', async () => {
    const { bridge, queue, makeItem } = bridgeFixture()
    const ref = makeItem()
    const first = await bridge.escalate(ref, { reason: 'stuck' })
    const again = await bridge.escalate(ref, { reason: 'stuck' })
    expect(first.status).toBe('escalated')
    expect(again.delivery.created).toBe(false)
    const rows = queue.rows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ destination: `human@${RIG}`, humanIntent: 'decision' })
  })
})
