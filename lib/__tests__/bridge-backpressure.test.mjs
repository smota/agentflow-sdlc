// Backpressure (#586 AC3): while open gates on the source reach capacity, intake and reconcile
// queue nothing; once a gate closes the next push queues. Filesystem source + memory queue only.
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_OPEN_GATES,
  countOpenGates,
  gateCapacity,
  gateCapacityAdmission,
} from '../bridge/backpressure.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { bridgeFixture, cleanupBridgeFixtures } from './bridge-fixture.mjs'

afterEach(cleanupBridgeFixtures)

const person = (id, capacity) => ({
  id,
  handles: {},
  scopes: [],
  ...(capacity ? { capacity } : {}),
})

async function gateMarker(source, refText, state, gate) {
  const { id } = parseSourceRef(refText)
  const plan = await source.previewMutation({
    operation: 'add-comment',
    parameters: { id, body: `<!-- agentflow-gate:${state}:${gate} -->` },
    actionBoundary: { effective: 'external-action' },
  })
  await source.flushReceipt(await source.applyMutation(plan, { confirm: plan.token }))
}

// A fixture whose admission is the real gate-capacity port over its own source.
function gated({ roster = null, maxOpenGates } = {}) {
  let admission = null
  const fixture = bridgeFixture({
    bridgeOptions: { admission: (input) => admission(input) },
  })
  admission = gateCapacityAdmission({ source: fixture.source, roster, maxOpenGates })
  return fixture
}

describe('gate capacity', () => {
  it('is the sum of roster capacities (default 3 each), else maxOpenGates, else 3', () => {
    expect(gateCapacity({ roster: { people: [person('a'), person('b', 5)] } })).toBe(8)
    expect(gateCapacity({ roster: null, maxOpenGates: 2 })).toBe(2)
    expect(gateCapacity({ roster: { people: [] } })).toBe(DEFAULT_MAX_OPEN_GATES)
    expect(gateCapacity()).toBe(3)
  })

  it('counts open gates on open items only', () => {
    expect(
      countOpenGates([
        { lifecycle: 'open', openGates: 2 },
        { lifecycle: 'closed', openGates: 4 },
        { lifecycle: 'open', openGates: 1 },
        { lifecycle: 'open' },
      ]),
    ).toBe(3)
  })

  it('holds intake when the source cannot list its items', async () => {
    const admission = gateCapacityAdmission({ source: { id: 'x', capabilities: [] } })
    expect(await admission({})).toMatchObject({
      admit: false,
      reason: 'gate-count-unavailable',
      capacity: 3,
    })
  })
})

describe('bridge backpressure (#586 AC3)', () => {
  it('defers intake at capacity and queues the next push once a gate closes', async () => {
    const { bridge, queue, source, makeItem } = gated({ maxOpenGates: 2 })
    const waiting = makeItem({ labels: [] })
    await gateMarker(source, waiting, 'waiting', 'g-1')
    await gateMarker(source, waiting, 'waiting', 'g-2')
    const ref = makeItem()
    expect(await bridge.intake(ref)).toMatchObject({
      status: 'deferred',
      reason: 'gate-capacity',
      openGates: 2,
      capacity: 2,
    })
    expect(queue.rows()).toHaveLength(0)
    const reconciled = await bridge.reconcile()
    expect(reconciled.restored).toEqual([])
    expect(reconciled.deferred).toEqual([
      expect.objectContaining({
        ref,
        status: 'deferred',
        reason: 'gate-capacity',
        openGates: 2,
        capacity: 2,
      }),
    ])
    expect(queue.rows()).toHaveLength(0)

    await gateMarker(source, waiting, 'closed', 'g-1')
    expect(await bridge.intake(ref)).toMatchObject({ status: 'queued' })
    expect(queue.rows()).toHaveLength(1)
  })

  it('uses the roster capacity when a roster exists', async () => {
    const { bridge, source, makeItem } = gated({
      roster: { people: [person('a', 1), person('b', 1)] },
      maxOpenGates: 10,
    })
    const waiting = makeItem({ labels: [] })
    await gateMarker(source, waiting, 'waiting', 'g-1')
    expect(await bridge.intake(makeItem())).toMatchObject({ status: 'queued' })
    await gateMarker(source, waiting, 'waiting', 'g-2')
    expect(await bridge.intake(makeItem())).toMatchObject({
      status: 'deferred',
      openGates: 2,
      capacity: 2,
    })
  })

  it('below capacity reconcile queues every ready item', async () => {
    const { bridge, queue, makeItem } = gated()
    makeItem()
    makeItem()
    const report = await bridge.reconcile()
    expect(report.restored).toHaveLength(2)
    expect(report.deferred).toEqual([])
    expect(queue.rows()).toHaveLength(2)
  })
})
