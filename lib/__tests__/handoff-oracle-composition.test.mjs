import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executeHandoffStep } from '../../adapters/openrig/agentflow-product/handoff-step.mjs'

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
describe('source handoff composes oracle capability admission (#521)', () => {
  it('holds protected work without an oracle writer before phase or queue effects', () => {
    const f = fixture()
    delete f.options.oracleAssignment
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/oracle|writer|capability/i)
    expect(f.counts()).toEqual({ phases: 0, queues: 0 })
  })
  it('holds unresolved task scope despite a valid workflow binding', () => {
    const f = fixture()
    delete f.deps.resolveOracleTask
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/scope|source|task/i)
    expect(f.counts()).toEqual({ phases: 0, queues: 0 })
  })
  it('appends and queues only for a source-authorized independent assignment', () => {
    const f = fixture(),
      result = executeHandoffStep(f.deps, f.options)
    expect(result.status).toBe('submitted')
    expect(f.counts()).toEqual({ phases: 1, queues: 1 })
  })
  it('rechecks assignment revocation after phase append and before queue dispatch', () => {
    const f = fixture(),
      original = f.deps.appendPhase
    f.deps.appendPhase = () => {
      const result = original()
      f.revoke()
      return result
    }
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/oracle|authority|source/i)
    expect(f.counts()).toEqual({ phases: 1, queues: 0 })
  })
  it('does not silently replace the original nonprotected task scope after append', () => {
    const f = fixture()
    f.task.touchSurface = ['docs/original.md']
    delete f.options.oracleAssignment
    const original = f.deps.appendPhase
    f.deps.appendPhase = () => {
      const result = original()
      f.task.touchSurface = ['docs/different.md']
      return result
    }
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/task|scope|source/i)
    expect(f.counts()).toEqual({ phases: 1, queues: 0 })
  })
})
