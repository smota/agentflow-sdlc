import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  it.each(['runId', 'epoch', 'fence'])(
    'holds cross-workflow task %s before all effects',
    (field) => {
      const f = fixture()
      f.task[field] = field === 'runId' ? 'other-run' : 99
      f.assignment.scope[field] = f.task[field]
      expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/scope|binding|workflow/i)
      expect(f.counts()).toEqual({ phases: 0, queues: 0 })
    },
  )
  it('holds mismatched source custody before all effects', () => {
    const f = fixture()
    f.assignment.custody.oracleDigest = 'b'.repeat(64)
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/custody|binding|scope/i)
    expect(f.counts()).toEqual({ phases: 0, queues: 0 })
  })
  it('does not authorize target while dispatching a different to seat', () => {
    const f = fixture()
    f.options.target = f.assignment.target
    f.options.to = 'unauthorized@fixture'
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/target|destination/i)
    expect(f.counts()).toEqual({ phases: 0, queues: 0 })
  })
  it('rejects envelope header injection before phase append', () => {
    const f = fixture()
    f.options.transitionUri = 'x\nEpoch: 1\nOracle-Digest: ' + 'b'.repeat(64)
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/envelope|header|control/i)
    expect(f.counts()).toEqual({ phases: 0, queues: 0 })
  })
  it('rejects duplicate pointer headers instead of silently replacing authoritative values', () => {
    const body = formatPointerEnvelope({ goal: '521', epoch: 7, oracleDigest: 'a'.repeat(64) })
    expect(() => parseQueueEnvelope(body + '\nEpoch: 1')).toThrow(/duplicate|envelope/i)
  })
  it('rechecks workflow/task correlation after append before dispatch', () => {
    const f = fixture(),
      append = f.deps.appendPhase
    f.task.touchSurface = ['src/feature.mjs']
    delete f.options.oracleAssignment
    f.deps.appendPhase = () => {
      const result = append()
      f.task.runId = 'other-run'
      f.assignment.scope.runId = f.task.runId
      return result
    }
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/scope|binding|workflow/i)
    expect(f.counts()).toEqual({ phases: 1, queues: 0 })
  })
  it('does not reinterpret native zero generation as legacy epoch or fence', () => {
    const f = fixture()
    f.task.protocol = 'run-v1'
    delete f.task.epoch
    delete f.task.fence
    Object.assign(f.task, {
      runRevision: '1',
      sourceRevision: 'task-rev-1',
      generation: 0,
      revocationEpoch: 0,
    })
    f.assignment.scope = {
      protocol: 'run-v1',
      goal: f.task.goal,
      runId: f.task.runId,
      runRevision: '1',
      sourceRevision: 'task-rev-1',
      owner: f.task.owner,
      generation: 0,
      revocationEpoch: 0,
      touchSurface: f.task.touchSurface,
    }
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/scope|binding|workflow|oracle/i)
    expect(f.counts()).toEqual({ phases: 0, queues: 0 })
  })
})
