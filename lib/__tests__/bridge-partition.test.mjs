// Partition and multi-rig configuration (#586).
import { describe, expect, it } from 'vitest'
import {
  bridgeConfigProblems,
  deliveryRigProblems,
  normalizeBridgeConfig,
} from '../bridge/config.mjs'
import { gateResolutionRefusal } from '../bridge/gate-guard.mjs'
import { partitionProblems, partitionTargets } from '../bridge/partition.mjs'

const RIGS = ['p-d1', 'p-d2', 'p-d3']
const item = (fields) => ({ partOf: null, labels: [], ...fields })

describe('partitionTargets', () => {
  it('offers every delivery rig without a partition', () => {
    expect(partitionTargets({ workItem: item(), partition: null, deliveryRigs: RIGS })).toEqual(
      RIGS,
    )
  })

  it('maps a mission to its rigs, in delivery order, and falls back to every rig', () => {
    const partition = { key: 'mission', map: { 578: ['p-d3', 'p-d1'] } }
    expect(
      partitionTargets({ workItem: item({ partOf: '578' }), partition, deliveryRigs: RIGS }),
    ).toEqual(['p-d1', 'p-d3'])
    expect(
      partitionTargets({ workItem: item({ partOf: '9' }), partition, deliveryRigs: RIGS }),
    ).toEqual(RIGS)
  })

  it('maps area labels after the prefix, union of every area', () => {
    const partition = { key: 'area', prefix: 'path:', map: { lib: ['p-d1'], docs: ['p-d2'] } }
    expect(
      partitionTargets({
        workItem: item({ labels: ['path:lib', 'path:docs', 'area:lib'] }),
        partition,
        deliveryRigs: RIGS,
      }),
    ).toEqual(['p-d1', 'p-d2'])
  })
})

describe('partition and rig configuration problems', () => {
  it('reports a bad key, a non-delivery rig and an empty list', () => {
    expect(partitionProblems({ key: 'other', map: { a: [] } }, RIGS)).toEqual([
      'key must be one of mission, area',
      'map.a must be a non-empty list of rig names',
    ])
    expect(partitionProblems({ key: 'mission', map: { a: ['nope'] } }, RIGS)).toEqual([
      'map.a names nope, not a delivery rig',
    ])
    expect(partitionProblems(undefined, RIGS)).toEqual([])
  })

  it('accepts several delivery rigs and rejects duplicates and a bad maxOpenGates', () => {
    const ok = normalizeBridgeConfig({
      rigs: { control: 'p', delivery: RIGS },
      source: { adapter: 'filesystem', claimWriters: ['agentflow-bridge'] },
      partition: { key: 'mission', map: { 1: ['p-d2'] } },
      maxOpenGates: 4,
    })
    expect(bridgeConfigProblems(ok)).toEqual([])
    const bad = normalizeBridgeConfig({
      rigs: { control: 'p', delivery: ['p-d1', 'p-d1'] },
      source: { adapter: 'filesystem', claimWriters: ['agentflow-bridge'] },
      maxOpenGates: 0,
    })
    expect(bridgeConfigProblems(bad)).toEqual([
      'adapters.openrig.bridge.rigs.delivery lists a rig more than once',
      'adapters.openrig.bridge.maxOpenGates must be an integer of at least 1',
    ])
  })

  it('needs a claiming source for more than one delivery rig', () => {
    const config = normalizeBridgeConfig({
      rigs: { control: 'p', delivery: RIGS },
      source: { adapter: 'x' },
    })
    expect(deliveryRigProblems(config, { id: 'x', capabilities: ['claim'] })).toEqual([])
    expect(deliveryRigProblems(config, { id: 'x', capabilities: [] })).toEqual([
      '3 delivery rigs are configured but the source allows 1: source adapter x does not declare claim',
    ])
  })
})

describe('gateResolutionRefusal (decision 9)', () => {
  const rigs = { control: 'p', delivery: ['p-d1'] }
  it('refuses delivery and eval seats anywhere and any session on a delivery rig', () => {
    for (const session of ['dev-build@p', 'rev-review@p', 'eval-tester@p']) {
      expect(gateResolutionRefusal({ session, rigs })).toMatch(
        /seat .*resolved only outside the rig/,
      )
    }
    for (const session of ['pm-analyst@p-d1', 'human@p-d1', 'agentflow-bridge@p-d1', 'x@p-d1']) {
      expect(gateResolutionRefusal({ session, rigs })).toMatch(/is on delivery rig p-d1/)
    }
  })

  it('allows a control-rig product or steering seat and a person outside the delivery rigs', () => {
    for (const session of ['pm-manager@p', 'steer-lead@p', 'human@p', 'ci@external', 'garbage']) {
      expect(gateResolutionRefusal({ session, rigs })).toBeNull()
    }
  })

  it('in a single-rig project the rig rule does not apply to the control rig', () => {
    const single = { control: 'p', delivery: ['p'] }
    expect(gateResolutionRefusal({ session: 'human@p', rigs: single })).toBeNull()
    expect(gateResolutionRefusal({ session: 'dev-build@p', rigs: single })).toMatch(/delivery seat/)
  })

  it('resolves legacy aliases through the seat table', () => {
    expect(gateResolutionRefusal({ session: 'rev-gate@p', rigs })).toMatch(/rev\.review/)
  })
})
