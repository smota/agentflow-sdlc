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

describe('distinct-key handoff continuation (#521)', () => {
  const receipt = (record) => ({
    verified: true,
    accepted: true,
    queueId: record.queueId,
    destination: record.to,
    ...record.binding,
  })
  it('holds a new key while the same source generation has an unresolved prior delivery', () => {
    const f = fixture()
    expect(executeHandoffStep(f.deps, f.options).status).toBe('submitted')
    const before = f.counts()
    expect(() =>
      executeHandoffStep(f.deps, { ...f.options, key: 'new-candidate', candidateSha: 'next' }),
    ).toThrow(/prior|unresolved|custody|accept/i)
    expect(f.counts()).toEqual(before)
  })
  it('permits a new candidate after fresh source acceptance of prior completion', () => {
    const f = fixture()
    let verifies = 0
    f.deps.verifySuccessorCustody = (record) => {
      verifies++
      return receipt(record)
    }
    const first = executeHandoffStep(f.deps, f.options)
    const next = executeHandoffStep(f.deps, {
      ...f.options,
      key: 'new-candidate',
      candidateSha: 'next',
    })
    expect(next.queueId).not.toBe(first.queueId)
    expect(next.custodyVerified).toBe(true)
    expect(f.counts()).toEqual({ phases: 2, queues: 2 })
    expect(verifies).toBeGreaterThanOrEqual(3)
  })
  it('does not trust a forged completed local state when a new key attempts to bypass the old delivery', () => {
    const f = fixture()
    executeHandoffStep(f.deps, f.options)
    const dir = join(f.deps.home, '.openrig/state/handoff-outbox'),
      file = join(
        dir,
        readdirSync(dir).find((n) => n.endsWith('.json')),
      ),
      record = JSON.parse(readFileSync(file, 'utf8'))
    record.state = 'completed'
    writeFileSync(file, JSON.stringify(record))
    const before = f.counts()
    expect(() =>
      executeHandoffStep(f.deps, { ...f.options, key: 'new-candidate', candidateSha: 'next' }),
    ).toThrow(/prior|unresolved|custody|accept/i)
    expect(f.counts()).toEqual(before)
  })
  it('does not globally block a new fenced generation behind an obsolete delivery', () => {
    const f = fixture()
    executeHandoffStep(f.deps, f.options)
    f.task.fence = 10
    f.assignment.scope.fence = 10
    const original = f.deps.resolveWorkflowBinding
    f.deps.resolveWorkflowBinding = (options) => ({ ...original(options), fencingToken: 10 })
    const next = executeHandoffStep(f.deps, { ...f.options, key: 'new-generation' })
    expect(next.status).toBe('submitted')
    expect(f.counts()).toEqual({ phases: 2, queues: 2 })
  })
})
