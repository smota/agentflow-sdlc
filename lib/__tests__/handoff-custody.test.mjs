import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  executeHandoffStep,
  validateEpochFence,
} from '../../adapters/openrig/agentflow-product/handoff-step.mjs'
const roots = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'custody-'))
  roots.push(home)
  const binding = {
    verified: true,
    goal: '521',
    runId: 'existing-run',
    storeRef: 'existing-store',
    epoch: 7,
    minimumEpoch: 7,
    fencingToken: 9,
    oracleOwner: 'test-engineer',
    oracleDigest: 'a'.repeat(64),
  }
  const options = {
    goal: '521',
    phase: 4,
    key: '521-p4-candidate',
    status: 'pass',
    to: 'dev-qa@delivery',
    epoch: 7,
    oracleDigest: binding.oracleDigest,
  }
  const deps = {
    home,
    // This fixture's task is a source-resolved feature handoff, not protected oracle repair.
    resolveOracleTask: () => ({
      verified: true,
      sourceRef: 'fixture:feature-task',
      sourceRevision: 'feature-task-rev-1',
      task: {
        goal: '521',
        protocol: 'legacy',
        runId: binding.runId,
        epoch: binding.epoch,
        fence: binding.fencingToken,
        owner: 'planner',
        touchSurface: ['src/feature.mjs'],
        requiredCapabilities: [],
      },
    }),
    resolveWorkflowBinding: () => binding,
    appendPhase: () => ({ status: 0 }),
    run: (_cmd, args) => ({
      status: 0,
      stdout: JSON.stringify({ qitemId: args[args.indexOf('--id') + 1] }),
    }),
  }
  const records = () =>
    readdirSync(join(home, '.openrig/state/handoff-outbox'))
      .filter((file) => file.endsWith('.json'))
      .map((file) =>
        JSON.parse(readFileSync(join(home, '.openrig/state/handoff-outbox', file), 'utf8')),
      )
  return { home, binding, options, deps, records }
}
describe('handoff custody and recovery evidence', () => {
  it.each([undefined, null, NaN, Infinity, 0, -1, 1.5, '7', true])(
    'rejects invalid epoch %s',
    (epoch) => {
      expect(validateEpochFence({ goal: '521', epoch, minimumEpochByGoal: { 521: 7 } }).ok).toBe(
        false,
      )
    },
  )
  it('refuses to invent the authoritative minimum epoch', () => {
    expect(validateEpochFence({ goal: '521', epoch: 7 }).ok).toBe(false)
  })
  it('holds missing authoritative bindings before phase or queue effects', () => {
    const s = setup()
    let effects = 0
    delete s.deps.resolveWorkflowBinding
    s.deps.appendPhase = s.deps.run = (_cmd, args) => {
      effects++
      return { status: 0 }
    }
    expect(() => executeHandoffStep(s.deps, s.options)).toThrow(/binding/i)
    expect(effects).toBe(0)
  })
  it('persists intent before phase append and replays its original idempotency key after a crash', () => {
    const s = setup()
    let firstKey
    s.deps.appendPhase = (options) => {
      expect(s.records()).toHaveLength(1)
      firstKey = options.key
      throw new Error('crash after phase effect')
    }
    expect(() => executeHandoffStep(s.deps, s.options)).toThrow(/crash/)
    s.deps.appendPhase = (options) => {
      expect(options.key).toBe(firstKey)
      return { status: 0 }
    }
    const result = executeHandoffStep(s.deps, { goal: '521', phase: 4, handoffOnly: true })
    expect(result.status).toBe('submitted')
    expect(s.records()[0].binding).toMatchObject({
      runId: 'existing-run',
      epoch: 7,
      fencingToken: 9,
      oracleOwner: 'test-engineer',
    })
  })
  it('reuses supported queue retry identity after an uncertain successful create', () => {
    const s = setup()
    const ids = []
    let appends = 0
    s.deps.appendPhase = () => {
      appends++
      return { status: 0 }
    }
    s.deps.run = (_cmd, args) => {
      ids.push(args[args.indexOf('--id') + 1])
      return { status: null, error: new Error('timeout after persist') }
    }
    expect(() => executeHandoffStep(s.deps, s.options)).toThrow(/recover/i)
    expect(s.records()[0].state).toBe('dispatch-unknown')
    s.deps.run = (_cmd, args) => {
      ids.push(args[args.indexOf('--id') + 1])
      return { status: 0, stdout: JSON.stringify({ qitemId: args[args.indexOf('--id') + 1] }) }
    }
    expect(executeHandoffStep(s.deps, { goal: '521', phase: 4, handoffOnly: true }).status).toBe(
      'submitted',
    )
    expect(ids[0]).toMatch(/^qitem-/)
    expect(ids[1]).toBe(ids[0])
    expect(appends).toBe(1)
    expect(s.records()).toHaveLength(1)
  })
  it('does not turn queue exit zero into accepted successor custody', () => {
    const s = setup()
    const result = executeHandoffStep(s.deps, s.options)
    expect(result.status).toBe('submitted')
    expect(result.custodyVerified).toBe(false)
    expect(s.records()[0].state).toBe('submitted')
  })
  it('rejects replacement destination and stale authoritative fence during replay', () => {
    const s = setup()
    executeHandoffStep(s.deps, s.options)
    expect(() =>
      executeHandoffStep(s.deps, {
        goal: '521',
        phase: 4,
        handoffOnly: true,
        to: 'other@delivery',
      }),
    ).toThrow(/destination|target/i)
    s.binding.fencingToken = 10
    expect(() => executeHandoffStep(s.deps, { goal: '521', phase: 4, handoffOnly: true })).toThrow(
      /binding|fenc/i,
    )
  })
  it('retains ambiguous custody rather than duplicating dispatch after acknowledged submission', () => {
    const s = setup()
    let calls = 0
    s.deps.run = (_cmd, args) => {
      calls++
      return { status: 0, stdout: JSON.stringify({ qitemId: args[args.indexOf('--id') + 1] }) }
    }
    executeHandoffStep(s.deps, s.options)
    executeHandoffStep(s.deps, { goal: '521', phase: 4, handoffOnly: true })
    expect(calls).toBe(1)
    expect(s.records()).toHaveLength(1)
  })
})

describe('handoff custody adversarial binding checks', () => {
  it('does not silently reuse a pending slot for a different phase candidate', () => {
    const s = setup()
    executeHandoffStep(s.deps, s.options)
    expect(() => executeHandoffStep(s.deps, { ...s.options, candidateSha: 'replacement' })).toThrow(
      /conflict|original|candidate/i,
    )
  })
  it('rejects concurrent calls while the same handoff operation is active', () => {
    const s = setup()
    s.deps.appendPhase = () => {
      expect(() => executeHandoffStep(s.deps, s.options)).toThrow(/locked|active/i)
      return { status: 0 }
    }
    expect(executeHandoffStep(s.deps, s.options).status).toBe('submitted')
  })
  it('requires receipt identity and oracle custody to match before marking completion', () => {
    const s = setup()
    let current
    s.deps.verifySuccessorCustody = (record) => {
      current = record
      return {
        verified: true,
        accepted: true,
        queueId: record.queueId,
        destination: 'wrong@rig',
        ...record.binding,
      }
    }
    expect(executeHandoffStep(s.deps, s.options).status).toBe('submitted')
    s.deps.verifySuccessorCustody = () => ({
      verified: true,
      accepted: true,
      ...current.binding,
      queueId: current.queueId,
      destination: current.to,
    })
    expect(executeHandoffStep(s.deps, { goal: '521', phase: 4, handoffOnly: true }).status).toBe(
      'completed',
    )
    expect(s.records()[0].custodyReceipt.oracleOwner).toBe('test-engineer')
  })
})

describe('independent Claude review blockers', () => {
  it('rejects a supplied envelope that contradicts authoritative custody', () => {
    const s = setup()
    s.options.body =
      'Envelope-Version: pointer-v1\nGoal: other\nPhase: 4\nEpoch: 1\nOracle-Digest: wrong'
    expect(() => executeHandoffStep(s.deps, s.options)).toThrow(/envelope|binding/i)
  })
  it('refreshes authoritative fences after phase append and before queue dispatch', () => {
    const s = setup()
    let calls = 0
    s.deps.appendPhase = (options) => {
      expect(options.workflowBinding.fencingToken).toBe(9)
      s.binding.fencingToken = 10
      return { status: 0 }
    }
    s.deps.run = (_cmd, args) => {
      calls++
      return { status: 0 }
    }
    expect(() => executeHandoffStep(s.deps, s.options)).toThrow(/binding|fenc/i)
    expect(calls).toBe(0)
  })
  it('allows an explicitly distinct later operation without erasing accepted prior custody', () => {
    const s = setup()
    s.deps.verifySuccessorCustody = (record) => ({
      ...record.binding,
      verified: true,
      accepted: true,
      queueId: record.queueId,
      destination: record.to,
    })
    const first = executeHandoffStep(s.deps, s.options)
    expect(first.status).toBe('completed')
    const second = executeHandoffStep(s.deps, {
      ...s.options,
      key: 'later-phase4-candidate',
      candidateSha: 'new-candidate',
    })
    expect(second.queueId).not.toBe(first.queueId)
    expect(s.records()).toHaveLength(2)
  })
})

describe('positive handoff effect acknowledgements', () => {
  it.each(['', '{}', 'not-json'])(
    'retains unknown dispatch without positive identity: %s',
    (stdout) => {
      const s = setup()
      s.deps.run = () => ({ status: 0, stdout })
      expect(() => executeHandoffStep(s.deps, s.options)).toThrow(/acknowledg/i)
      expect(s.records()[0].state).toBe('dispatch-unknown')
    },
  )
  it.each([undefined, null, {}, { ok: false }])(
    'does not dispatch after ambiguous phase result %j',
    (result) => {
      const s = setup()
      let calls = 0
      s.deps.appendPhase = () => result
      s.deps.run = () => {
        calls++
        return { status: 0 }
      }
      expect(() => executeHandoffStep(s.deps, s.options)).toThrow(/phase/i)
      expect(calls).toBe(0)
    },
  )
})
