import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateOracleWriterAdmission } from '../../adapters/openrig/agentflow-product/oracle-admission.mjs'
import { createRunService } from '../application/run-service.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'

function fixture() {
  const task = {
    protocol: 'run-v1',
    goal: 'issue:519',
    runId: 'existing-run',
    runRevision: 'a'.repeat(64),
    sourceRevision: 'existing-source-revision',
    owner: 'current-writer',
    generation: 0,
    revocationEpoch: 0,
    worktree: '.worktrees/oracle',
    touchSurface: ['tests/oracles/schema.json'],
    builderIdentity: 'builder',
    reviewerIdentity: 'reviewer',
  }
  const assignment = {
    id: 'native-assignment',
    mode: 'temporary',
    identity: 'oracle-author',
    role: 'test-engineer',
    policySeat: 'dev.test-eng',
    target: 'dev-test-eng@fixture',
    allowedPaths: ['tests/oracles/**'],
    worktree: task.worktree,
    custody: { owner: 'oracle-author', oracleDigest: 'b'.repeat(64) },
    authorityRef: 'source:existing-assignment',
    expiresAt: '2026-10-15T13:00:00Z',
    scope: { ...task },
  }
  return {
    task,
    assignment,
    now: '2026-10-15T12:00:00Z',
    resolveAuthority: () => ({
      verified: true,
      sourceRef: 'source:existing',
      sourceRevision: task.sourceRevision,
      task: structuredClone(task),
      assignment: structuredClone(assignment),
      ownershipManifest: JSON.parse(readFileSync('manifests/path-ownership.json', 'utf8')),
    }),
  }
}
describe('native run-v1 oracle assignment without invented counters (#519)', () => {
  it('consumes native zero counters from the existing run service source snapshot', async () => {
    const memory = createMemoryRunStore()
    const store = {
      ...memory,
      async read() {
        return { ...(await memory.read()), sourceRevision: 'fixture-coordination-revision' }
      },
    }
    const service = createRunService({ store, authorize: async () => true })
    await service.start({
      runId: 'existing-native',
      goalRef: 'issue:519',
      owner: 'native-writer',
      authority: { owner: 'native-writer', generation: 0 },
    })
    const snapshot = await service.read(),
      input = fixture()
    Object.assign(input.task, {
      goal: snapshot.state.goalRef,
      runId: snapshot.state.runId,
      runRevision: snapshot.revision,
      sourceRevision: snapshot.sourceRevision,
      owner: snapshot.state.owner,
      generation: snapshot.state.generation,
      revocationEpoch: snapshot.state.revocationEpoch,
    })
    input.assignment.scope = structuredClone(input.task)
    expect(evaluateOracleWriterAdmission(input).admitted).toBe(true)
    expect(snapshot.state.generation).toBe(0)
    expect(snapshot.state.revocationEpoch).toBe(0)
    expect(snapshot.state).not.toHaveProperty('epoch')
  })
  it('accepts existing native generation/revocationEpoch zero and preserves their identity', () => {
    const input = fixture(),
      before = structuredClone(input.task)
    const result = evaluateOracleWriterAdmission(input)
    expect(result.admitted).toBe(true)
    expect(result.assignment.scope).toMatchObject({
      protocol: 'run-v1',
      generation: 0,
      revocationEpoch: 0,
      runRevision: input.task.runRevision,
      sourceRevision: input.task.sourceRevision,
      owner: input.task.owner,
    })
    expect(result.assignment.scope).not.toHaveProperty('epoch')
    expect(result.assignment.scope).not.toHaveProperty('fence')
    expect(input.task).toEqual(before)
  })
  it.each(['runRevision', 'sourceRevision', 'owner', 'generation', 'revocationEpoch'])(
    'rejects mismatching native %s',
    (key) => {
      const input = fixture()
      input.assignment.scope[key] = typeof input.task[key] === 'number' ? 1 : 'different'
      expect(evaluateOracleWriterAdmission(input).admitted).toBe(false)
    },
  )
  it.each([-1, 0.5, '0', null, undefined])('rejects invalid native counters %j', (value) => {
    const input = fixture()
    input.task.generation = input.assignment.scope.generation = value
    expect(evaluateOracleWriterAdmission(input).admitted).toBe(false)
  })
  it('does not reinterpret zero native generation as a positive legacy epoch', () => {
    const input = fixture()
    input.task.protocol = input.assignment.scope.protocol = 'legacy'
    input.task.epoch = input.assignment.scope.epoch = 0
    input.task.fence = input.assignment.scope.fence = 0
    expect(evaluateOracleWriterAdmission(input).admitted).toBe(false)
  })
  it('rejects mixed or unknown counter protocols', () => {
    const input = fixture()
    input.task.epoch = input.assignment.scope.epoch = 1
    expect(evaluateOracleWriterAdmission(input).admitted).toBe(false)
    const unknown = fixture()
    unknown.task.protocol = unknown.assignment.scope.protocol = 'invented'
    expect(evaluateOracleWriterAdmission(unknown).admitted).toBe(false)
  })
})
