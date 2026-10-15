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

describe('persisted handoff request consistency (#521)', () => {
  function paused() {
    const f = fixture()
    f.deps.run = () => ({ status: 1, stderr: 'fixture queue unavailable' })
    expect(() => executeHandoffStep(f.deps, f.options)).toThrow(/unknown/i)
    const dir = join(f.deps.home, '.openrig/state/handoff-outbox')
    const file = join(
      dir,
      readdirSync(dir).find((n) => n.endsWith('.json')),
    )
    return { ...f, file }
  }
  it('cannot authorize the original destination but recover to an edited outbox destination when --to is omitted', () => {
    const f = paused(),
      record = JSON.parse(readFileSync(f.file, 'utf8'))
    record.to = 'unauthorized@fixture'
    writeFileSync(f.file, JSON.stringify(record))
    const destinations = []
    f.deps.run = (_cmd, args) => {
      destinations.push(args[args.indexOf('--destination') + 1])
      return { status: 0, stdout: JSON.stringify({ qitemId: args[args.indexOf('--id') + 1] }) }
    }
    expect(() =>
      executeHandoffStep(f.deps, {
        goal: f.options.goal,
        phase: f.options.phase,
        handoffOnly: true,
      }),
    ).toThrow(/record|destination|consisten|integrity|binding/i)
    expect(destinations).toEqual([])
  })
  it('recovers an unchanged persisted operation with the same queue identity and original destination', () => {
    const f = paused(),
      record = JSON.parse(readFileSync(f.file, 'utf8'))
    let actual
    f.deps.run = (_cmd, args) => {
      actual = {
        destination: args[args.indexOf('--destination') + 1],
        id: args[args.indexOf('--id') + 1],
      }
      return { status: 0, stdout: JSON.stringify({ qitemId: actual.id }) }
    }
    expect(
      executeHandoffStep(f.deps, {
        goal: f.options.goal,
        phase: f.options.phase,
        handoffOnly: true,
      }).status,
    ).toBe('submitted')
    expect(actual).toEqual({ destination: record.to, id: record.queueId })
    expect(f.counts().phases).toBe(1)
  })
  it.each(['envelopeBody', 'phaseOptions', 'goal', 'phase', 'oracleAdmission', 'binding'])(
    'holds altered stored %s before queue dispatch',
    (field) => {
      const f = paused(),
        record = JSON.parse(readFileSync(f.file, 'utf8'))
      if (field === 'envelopeBody') record.envelopeBody += '\nEpoch: 1'
      if (field === 'phaseOptions') record.phaseOptions.to = 'unauthorized@fixture'
      if (field === 'goal') record.phaseOptions.goal = 'other'
      if (field === 'phase') record.phaseOptions.phase = 8
      if (field === 'oracleAdmission') record.oracleAdmission.taskBinding.sourceRevision = 'changed'
      if (field === 'binding') record.phaseOptions.workflowBinding.oracleOwner = 'changed'
      writeFileSync(f.file, JSON.stringify(record))
      let queues = 0
      f.deps.run = () => {
        queues++
        return { status: 0, stdout: '{}' }
      }
      expect(() =>
        executeHandoffStep(f.deps, {
          goal: f.options.goal,
          phase: f.options.phase,
          handoffOnly: true,
        }),
      ).toThrow()
      expect(queues).toBe(0)
    },
  )
})
