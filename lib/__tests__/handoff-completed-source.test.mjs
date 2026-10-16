import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatPointerEnvelope,
  parseQueueEnvelope,
  executeHandoffStep,
} from '../../adapters/openrig/agentflow-product/handoff-step.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'handoff-oracle-composition-'))
  roots.push(home)
  const task = {
    goal: '521',
    owner: 'planner',
    runId: 'existing-run',
    epoch: 7,
    fence: 9,
    worktree: '.worktrees/oracle',
    touchSurface: ['tests/oracles/schema.json'],
    builderIdentity: 'builder',
    reviewerIdentity: 'reviewer',
  }
  const assignment = {
    id: 'oracle-assignment',
    mode: 'temporary',
    identity: 'oracle-author',
    role: 'test-engineer',
    policySeat: 'dev.test-eng',
    target: 'dev-test-eng@fixture',
    allowedPaths: ['tests/oracles/**'],
    worktree: task.worktree,
    custody: { owner: 'oracle-author', oracleDigest: 'a'.repeat(64) },
    authorityRef: 'source:oracle-assignment',
    expiresAt: '2026-10-15T13:00:00Z',
    scope: {
      goal: task.goal,
      runId: task.runId,
      epoch: task.epoch,
      fence: task.fence,
      touchSurface: task.touchSurface,
    },
  }
  const binding = {
    verified: true,
    goal: task.goal,
    runId: task.runId,
    storeRef: 'existing-store',
    epoch: 7,
    minimumEpoch: 7,
    fencingToken: 9,
    oracleOwner: assignment.identity,
    oracleDigest: assignment.custody.oracleDigest,
  }
  let phases = 0,
    queues = 0,
    revoked = false
  const deps = {
    home,
    now: () => new Date('2026-10-15T12:00:00Z'),
    resolveWorkflowBinding: () => structuredClone(binding),
    resolveOracleTask: () => ({
      verified: true,
      sourceRef: 'source:task',
      sourceRevision: 'task-rev-1',
      task: structuredClone(task),
    }),
    resolveOracleAuthority: () => ({
      verified: !revoked,
      sourceRef: 'source:assignment',
      sourceRevision: 'assignment-rev-1',
      task: structuredClone(task),
      assignment: structuredClone(assignment),
      ownershipManifest: JSON.parse(readFileSync('manifests/path-ownership.json', 'utf8')),
    }),
    appendPhase: () => {
      phases++
      return { status: 0 }
    },
    run: (_cmd, args) => {
      queues++
      return { status: 0, stdout: JSON.stringify({ qitemId: args[args.indexOf('--id') + 1] }) }
    },
  }
  return {
    deps,
    task,
    assignment,
    options: {
      goal: task.goal,
      phase: 4,
      to: assignment.target,
      epoch: 7,
      oracleDigest: binding.oracleDigest,
      oracleAssignment: assignment,
    },
    counts: () => ({ phases, queues }),
    revoke: () => {
      revoked = true
    },
  }
}

describe('completed handoff requires fresh source acceptance (#521)', () => {
  function recordFile(f) {
    const dir = join(f.deps.home, '.openrig/state/handoff-outbox')
    return join(
      dir,
      readdirSync(dir).find((n) => n.endsWith('.json')),
    )
  }
  const receipt = (record) => ({
    verified: true,
    accepted: true,
    queueId: record.queueId,
    destination: record.to,
    ...record.binding,
  })
  it('does not promote a forged local completed state into verified custody without a source verifier', () => {
    const f = fixture()
    expect(executeHandoffStep(f.deps, f.options).status).toBe('submitted')
    const file = recordFile(f),
      record = JSON.parse(readFileSync(file, 'utf8'))
    record.state = 'completed'
    record.custodyReceipt = receipt(record)
    writeFileSync(file, JSON.stringify(record))
    const before = f.counts()
    expect(() =>
      executeHandoffStep(f.deps, {
        goal: f.options.goal,
        phase: f.options.phase,
        handoffOnly: true,
      }),
    ).toThrow(/custody|source|accept/i)
    expect(f.counts()).toEqual(before)
  })
  it('reverifies a genuine completed handoff against source acceptance on every recovery without queue replay', () => {
    const f = fixture()
    let verifications = 0
    f.deps.verifySuccessorCustody = (record) => {
      verifications++
      return receipt(record)
    }
    const first = executeHandoffStep(f.deps, f.options)
    expect(first.custodyVerified).toBe(true)
    const before = f.counts()
    const next = executeHandoffStep(f.deps, {
      goal: f.options.goal,
      phase: f.options.phase,
      handoffOnly: true,
    })
    expect(next.custodyVerified).toBe(true)
    expect(verifications).toBe(2)
    expect(f.counts()).toEqual(before)
  })
  it('holds revoked or unavailable acceptance while preserving the historical completed record', () => {
    const f = fixture()
    f.deps.verifySuccessorCustody = receipt
    expect(executeHandoffStep(f.deps, f.options).status).toBe('completed')
    const file = recordFile(f),
      before = readFileSync(file, 'utf8'),
      counts = f.counts()
    f.deps.verifySuccessorCustody = () => ({ verified: false, accepted: false })
    expect(() =>
      executeHandoffStep(f.deps, {
        goal: f.options.goal,
        phase: f.options.phase,
        handoffOnly: true,
      }),
    ).toThrow(/custody|source|accept/i)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(f.counts()).toEqual(counts)
  })
})
