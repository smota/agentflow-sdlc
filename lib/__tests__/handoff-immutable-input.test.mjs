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

describe('handoff actual queue input (#521)', () => {
  it('dispatches the canonical immutable body through stdin even if diagnostic body file changes at the call boundary', () => {
    const f = fixture()
    let observed
    f.deps.run = (_cmd, args, options) => {
      const dir = join(f.deps.home, '.openrig/state/handoff-outbox'),
        body = join(
          dir,
          readdirSync(dir).find((n) => n.endsWith('.body.txt')),
        )
      writeFileSync(body, 'Epoch: 1\nOracle-Digest: corrupted')
      observed = { file: args[args.indexOf('--body-file') + 1], input: options?.input }
      return { status: 0, stdout: JSON.stringify({ qitemId: args[args.indexOf('--id') + 1] }) }
    }
    const result = executeHandoffStep(f.deps, f.options)
    expect(observed).toEqual({ file: '-', input: result.envelope })
    expect(observed.input).not.toContain('corrupted')
  })
  it('holds a new key when prior same-goal phase scope has become unknown', () => {
    const f = fixture()
    executeHandoffStep(f.deps, f.options)
    const dir = join(f.deps.home, '.openrig/state/handoff-outbox'),
      file = join(
        dir,
        readdirSync(dir).find((n) => n.endsWith('.json')),
      ),
      record = JSON.parse(readFileSync(file, 'utf8'))
    delete record.binding
    writeFileSync(file, JSON.stringify(record))
    const counts = f.counts()
    expect(() => executeHandoffStep(f.deps, { ...f.options, key: 'new-key' })).toThrow(
      /prior|scope|binding|integrity/i,
    )
    expect(f.counts()).toEqual(counts)
  })
})
