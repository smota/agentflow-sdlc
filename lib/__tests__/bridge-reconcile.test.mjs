import { afterEach, describe, expect, it } from 'vitest'
import { parseIntakeBody } from '../bridge/intake-body.mjs'
import { stableQueueId } from '../bridge/queue-id.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { RIG, bridgeFixture, cleanupBridgeFixtures } from './bridge-fixture.mjs'

afterEach(cleanupBridgeFixtures)

const idOf = (ref) => stableQueueId(parseSourceRef(ref))

describe('bridge reconcile (#582)', () => {
  it('AC4: restores one intake row per open ready item after the queue is emptied, with resume_phase from evidence', async () => {
    const { bridge, queue, makeItem, pass } = bridgeFixture()
    const fresh = makeItem()
    const midway = makeItem()
    const notReady = makeItem({ labels: [] })
    makeItem({ lifecycle: 'closed' })
    await pass(midway, [1, 2, 3, 4])
    await bridge.intake(fresh)
    await bridge.intake(midway)
    queue.wipe()

    const report = await bridge.reconcile()
    expect(report.status).toBe('reconciled')
    expect(report.restored.map((item) => item.ref).sort()).toEqual([fresh, midway].sort())
    expect(report.skipped).toEqual([
      expect.objectContaining({ ref: notReady, reasons: expect.any(Array) }),
    ])
    const bodies = Object.fromEntries(
      queue.rows().map((row) => [row.qitemId, parseIntakeBody(row.body)]),
    )
    expect(Object.keys(bodies).sort()).toEqual([idOf(fresh), idOf(midway)].sort())
    expect(bodies[idOf(fresh)].resumePhase).toBe(1)
    expect(bodies[idOf(midway)].resumePhase).toBe(5)

    // A second pass keeps the live rows and creates nothing.
    const again = await bridge.reconcile()
    expect(again.restored).toEqual([])
    expect(again.kept.map((item) => item.ref).sort()).toEqual([fresh, midway].sort())
    expect(queue.rows()).toHaveLength(2)
  })

  it('keeps items whose workflow instance is live and restores a started item after a wipe', async () => {
    const { bridge, queue, makeItem } = bridgeFixture()
    const ref = makeItem()
    const { qitemId } = await bridge.intake(ref)
    await bridge.start(qitemId, { session: `pm-analyst@${RIG}` })
    expect((await bridge.reconcile()).kept).toEqual([expect.objectContaining({ ref })])
    queue.wipe()
    expect((await bridge.reconcile()).restored).toEqual([expect.objectContaining({ ref })])
  })

  it('uses the next generation id when the base row is terminal', async () => {
    const { bridge, queue, makeItem } = bridgeFixture()
    const ref = makeItem()
    const { qitemId } = await bridge.intake(ref)
    await queue.update(qitemId, { state: 'done', closureReason: 'canceled' })
    const report = await bridge.reconcile()
    expect(report.restored).toEqual([expect.objectContaining({ qitemId: `${qitemId}-g2` })])
  })

  it('dry run reports without creating rows', async () => {
    const { bridge, queue, makeItem } = bridgeFixture()
    const ref = makeItem()
    const report = await bridge.reconcile({ dryRun: true })
    expect(report).toMatchObject({
      status: 'dry-run',
      restored: [expect.objectContaining({ ref })],
    })
    expect(queue.rows()).toHaveLength(0)
  })

  it('settles live rows of merged and closed items and reports orphans', async () => {
    const swept = []
    const worktrees = {
      cleanup: async () => ({ removed: true }),
      sweep: async (input) => (swept.push(input.openSlices), { removed: [] }),
    }
    const { bridge, queue, makeItem, setItem } = bridgeFixture({ bridgeOptions: { worktrees } })
    const mergedRef = makeItem()
    const closedRef = makeItem()
    const merged = await bridge.intake(mergedRef)
    await queue.block(merged.qitemId, { on: `external:merge:${merged.stableId}` })
    await bridge.intake(closedRef)
    await setItem(mergedRef, { lifecycle: 'merged' })
    await setItem(closedRef, { lifecycle: 'closed' })
    // An intake row whose item the source no longer has, and an unrelated row that is not ours.
    await queue.create({
      id: 'af-filesystem-00000000-gone',
      destination: `pm-analyst@${RIG}`,
      source: `agentflow-bridge@${RIG}`,
      body: 'agentflow-intake/v1\nref=filesystem:local#gone\nstable_id=af-filesystem-00000000-gone\n',
      tags: ['af:af-filesystem-00000000-gone'],
    })
    await queue.create({ id: 'other', destination: 'x@y', source: 'y@z', body: 'unrelated' })
    const report = await bridge.reconcile()
    expect(report.settled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: mergedRef,
          lifecycle: 'merged',
          resolved: [merged.qitemId],
        }),
        expect.objectContaining({
          ref: closedRef,
          lifecycle: 'closed',
          canceled: [idOf(closedRef)],
        }),
      ]),
    )
    expect(report.orphans).toEqual([
      { stableId: 'af-filesystem-00000000-gone', ref: 'filesystem:local#gone' },
    ])
    expect(swept).toEqual([[]])
  })

  it('requires the ready-predicates capability', async () => {
    const { bridge, source } = bridgeFixture()
    source.capabilities = source.capabilities.filter((name) => name !== 'ready-predicates')
    await expect(bridge.reconcile()).rejects.toMatchObject({
      status: 'capability-absent',
      message: 'reconcile requires ready-predicates',
    })
  })

  it('liveness survives a bounded, newest-first queue listing (100-row cap)', async () => {
    const { bridge, queue, makeItem } = bridgeFixture({ queueOptions: { listCap: 100 } })
    const ref = makeItem()
    const { qitemId } = await bridge.intake(ref)
    for (let index = 0; index < 150; index += 1) {
      await queue.create({ id: `noise-${index}`, destination: 'x@y', source: 'y@z', body: '' })
    }
    expect((await queue.list({})).map((row) => row.qitemId)).not.toContain(qitemId)
    const report = await bridge.reconcile()
    expect(report.restored).toEqual([])
    expect(report.kept).toEqual([expect.objectContaining({ ref, qitemIds: [qitemId] })])
    expect(await bridge.intake(ref)).toMatchObject({ status: 'already-queued', qitemId })
  })

  it('refuses to settle strays from a full page of rows', async () => {
    const { bridge, queue } = bridgeFixture()
    const list = queue.list
    queue.list = async (options) =>
      Array.from({ length: options.limit }, (_, index) => ({
        qitemId: `r${index}`,
        state: 'pending',
        tags: [],
      }))
    await expect(bridge.reconcile()).rejects.toThrow(/full page/)
    queue.list = list
  })

  it('ignores untrusted evidence when restoring the resume phase', async () => {
    const { bridge, queue, makeItem, pass } = bridgeFixture()
    const ref = makeItem()
    await pass(ref, [1, 2, 3, 4, 5, 6, 7], { writer: 'stranger' })
    await bridge.reconcile()
    expect(parseIntakeBody(queue.rows()[0].body).resumePhase).toBe(1)
  })
})

describe('bridge reconcile isolation (#582)', () => {
  it('reports a failing item, restores the rest and lists workflows once', async () => {
    const { bridge, queue, makeItem } = bridgeFixture()
    const good = makeItem()
    const bad = makeItem()
    const other = makeItem()
    const badId = stableQueueId(parseSourceRef(bad))
    const show = queue.show
    queue.show = async (id) => {
      if (id === badId) throw new Error('daemon timeout')
      return show(id)
    }
    let listings = 0
    const listWorkflows = queue.listWorkflows
    queue.listWorkflows = async (options) => {
      listings += 1
      return listWorkflows(options)
    }
    const report = await bridge.reconcile()
    expect(report.status).toBe('reconciled-with-errors')
    expect(report.failed).toEqual([{ ref: bad, stableId: badId, error: 'daemon timeout' }])
    expect(report.restored.map((item) => item.ref).sort()).toEqual([good, other].sort())
    expect(listings).toBe(1)
  })
})
