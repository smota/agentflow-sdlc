import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  evaluateOracleWriterAdmission,
  resolveOracleDispatch,
} from '../../adapters/openrig/agentflow-product/oracle-admission.mjs'
import { deliver, flushSquad } from '../../adapters/openrig/agentflow-product/handoff.mjs'
import { evaluateMultiWriterAdmission } from '../../adapters/openrig/agentflow-product/pipeline-admission.mjs'

const manifest = JSON.parse(readFileSync('manifests/path-ownership.json', 'utf8'))
const now = '2026-10-15T12:00:00.000Z'
const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function fixture() {
  const task = {
    goal: 'fixture-goal',
    owner: 'planner',
    runId: 'run-1',
    epoch: 3,
    fence: 8,
    worktree: '.worktrees/oracle',
    touchSurface: ['tests/oracles/schema.json'],
    builderIdentity: 'builder-1',
    reviewerIdentity: 'reviewer-1',
    reworkRound: 0,
  }
  const assignment = {
    id: 'assignment-1',
    mode: 'temporary',
    identity: 'writer-1',
    role: 'test-engineer',
    policySeat: 'dev.test-eng',
    target: 'dev-test-eng@fixture-dev',
    allowedPaths: ['tests/oracles/**'],
    worktree: task.worktree,
    custody: { owner: 'writer-1', oracleDigest: 'a'.repeat(64) },
    authorityRef: 'fixture://assignment-1',
    expiresAt: '2026-10-15T13:00:00.000Z',
    scope: {
      goal: task.goal,
      runId: task.runId,
      epoch: task.epoch,
      fence: task.fence,
      touchSurface: task.touchSurface,
    },
  }
  const resolveAuthority = () => ({
    verified: true,
    sourceRef: 'fixture://source',
    sourceRevision: 'revision-1',
    assignment: structuredClone(assignment),
    task: structuredClone(task),
    ownershipManifest: manifest,
  })
  return { task, assignment, resolveAuthority, now }
}
function harness(input = fixture()) {
  const home = mkdtempSync(join(tmpdir(), 'oracle-dispatch-'))
  dirs.push(home)
  const sent = []
  const deps = {
    home,
    env: {},
    now: () => new Date(now),
    cliPath: 'fixture-cli',
    resolveOracleTask: () => ({
      verified: true,
      task: structuredClone(input.task),
      sourceRef: 'fixture://task',
      sourceRevision: 'revision-1',
    }),
    resolveOracleAuthority: input.resolveAuthority,
    run: (command, args) => {
      if (command === 'fixture-cli')
        return { status: 0, stdout: JSON.stringify({ groups: [{ state: 'WIP', items: [] }] }) }
      if (args[0] === 'ps')
        return {
          status: 0,
          stdout: JSON.stringify([
            { canonicalSessionName: 'orch-arch@fixture-dev', agentActivity: { state: 'idle' } },
          ]),
        }
      if (args[0] === 'queue' && args[1] === 'list') return { status: 0, stdout: '[]' }
      sent.push({ command, args })
      return { status: 0, stdout: 'queued' }
    },
  }
  const options = {
    to: input.assignment.target,
    goal: input.task.goal,
    body: 'Bounded oracle repair',
    medium: 'filesystem',
    root: home,
    oracleAssignment: input.assignment,
  }
  return { deps, options, sent }
}

describe('oracle writer admission #519', () => {
  it('holds protected work without a source-authorized independent writer', () => {
    const f = fixture()
    expect(evaluateOracleWriterAdmission({ task: f.task, now }).admitted).toBe(false)
  })
  it.each(['builder-1', 'reviewer-1'])(
    'rejects feature/reviewer identity %s even with a test-eng label',
    (identity) => {
      const f = fixture()
      f.assignment.identity = identity
      f.assignment.custody.owner = identity
      expect(evaluateOracleWriterAdmission(f).admitted).toBe(false)
    },
  )
  it('rejects caller supplied authorization booleans without a source resolver', () => {
    const f = fixture()
    delete f.resolveAuthority
    f.assignment.authorized = true
    expect(evaluateOracleWriterAdmission(f).admitted).toBe(false)
  })
  it.each(['temporary', 'persistent'])(
    'records a verified %s assignment without provisioning anything',
    (mode) => {
      const f = fixture()
      f.assignment.mode = mode
      const result = evaluateOracleWriterAdmission(f)
      expect(result.admitted).toBe(true)
      expect(result.assignment).toMatchObject({
        identity: 'writer-1',
        allowedPaths: ['tests/oracles/**'],
        worktree: '.worktrees/oracle',
        custody: f.assignment.custody,
        reviewerIdentity: 'reviewer-1',
      })
      expect(result.effects).toEqual([])
    },
  )
  it('rejects broad or forbidden path grants using the canonical ownership manifest', () => {
    const f = fixture()
    f.assignment.allowedPaths = ['**']
    expect(evaluateOracleWriterAdmission(f).admitted).toBe(false)
  })
  it('rejects source/task epoch drift and missing custody', () => {
    const f = fixture()
    f.assignment.scope.epoch = 2
    expect(evaluateOracleWriterAdmission(f).admitted).toBe(false)
    f.assignment.scope.epoch = 3
    delete f.assignment.custody
    expect(evaluateOracleWriterAdmission(f).admitted).toBe(false)
  })
  it('requires reconsidered bounded scope after repeated failed repairs', () => {
    const f = fixture()
    f.task.reworkRound = 2
    expect(evaluateOracleWriterAdmission(f)).toMatchObject({
      admitted: false,
      status: 'ORACLE_REPAIR_SCOPE_REVIEW_REQUIRED',
    })
    f.assignment.repairScope = {
      revision: 'scope-2',
      previousRevision: 'scope-1',
      reason: 'Narrow to schema failures',
      owner: 'planner',
    }
    expect(evaluateOracleWriterAdmission(f).admitted).toBe(true)
  })
  it('holds actual dispatch when writer is absent and supports a valid source assignment', () => {
    const f = fixture()
    const h = harness(f)
    delete h.options.oracleAssignment
    expect(deliver(h.deps, h.options).status).toBe('held')
    expect(h.sent).toEqual([])
    const good = harness(f)
    expect(deliver(good.deps, good.options).status).toBe('delivered')
    expect(good.sent).toHaveLength(1)
  })
  it('holds unresolved task scope and rechecks authority on held flush', () => {
    const f = fixture()
    const h = harness(f)
    delete h.deps.resolveOracleTask
    expect(deliver(h.deps, h.options).status).toBe('held')
    expect(h.sent).toEqual([])
    h.deps.resolveOracleTask = () => ({
      verified: true,
      task: f.task,
      sourceRef: 'fixture://task',
      sourceRevision: 'revision-1',
    })
    h.deps.resolveOracleAuthority = () => ({ verified: false })
    expect(flushSquad(h.deps, 'fixture-dev', null).delivered).toBe(null)
    expect(h.sent).toEqual([])
  })
  it('cannot bypass multi-writer admission by routing protected work to a builder', () => {
    const f = fixture()
    const result = evaluateMultiWriterAdmission({
      candidate: { ...f.task, phase: 4 },
      activeSlices: [],
    })
    expect(result.admitted).toBe(false)
    expect(result.status).toMatch(/ORACLE/)
  })
  it('detects nested oracles and refuses a self-reported source task', () => {
    const f = fixture()
    f.task.touchSurface = ['packages/a/tests/oracles/case.json']
    expect(evaluateOracleWriterAdmission({ task: f.task, now }).admitted).toBe(false)
    expect(resolveOracleDispatch({ deps: {}, request: { task: f.task }, now }).admitted).toBe(false)
  })
})
