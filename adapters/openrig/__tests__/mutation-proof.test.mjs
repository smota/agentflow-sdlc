import { describe, expect, it } from 'vitest'
import {
  planRigMutation,
  applyRigMutation,
  createRigMutationOperation,
  createRigMutationReconciler,
  planRigRollback,
} from '../mutation.mjs'
import { operationDigest } from '../../../lib/core/delegation-grant.mjs'
import { fingerprintCandidate } from '../../../lib/verification/workspace.mjs'
import { inspectProcessRuntime } from '../../../lib/verification/process-collector.mjs'

const now = '2026-10-15T12:00:00.000Z'
function fixture() {
  const rigText =
    'name: proof\npods:\n  - id: dev\n    members:\n      - id: build\n        runtime: codex\n        profile: builder\n        model: gpt-6.1-sol\n        effort: medium\n'
  const configText =
    'recommended: selected\nseats:\n  dev.build:\n    runtimes:\n      codex: builder\npresets:\n  selected:\n    dev.build:\n      runtime: codex\n      model: gpt-6-astra\n'
  const workflow = {
    protocol: 'run-v1',
    runId: 'proof',
    owner: 'writer',
    revision: 'revision-1',
    sourceRevision: 'source-1',
    generation: 0,
    revocationEpoch: 0,
    oracleDigest: null,
    custody: null,
    publicationHolds: ['human-gate'],
    checkpointDigest: 'e'.repeat(64),
  }
  const installed = {
    rigText,
    contracts: [
      {
        seat: 'dev.build',
        runtime: 'codex',
        executionTarget: 'codex-cli',
        providerRoute: 'openai-codex',
        providerFamily: 'openai',
        model: 'gpt-6.1-sol',
        effort: 'medium',
        profile: 'builder',
        capabilityTier: 'balanced',
      },
    ],
    sourceRevision: 'spec-1',
    occupants: { 'dev.build': { sessionId: 'old', generation: 'old' } },
  }
  const executorIdentity = inspectProcessRuntime(process.cwd(), {
    executable: process.execPath,
  }).identity
  const plan = planRigMutation({
    rigName: 'proof',
    desired: { rigText, configText },
    installed,
    workflow,
    executorIdentity,
  })
  const rollback = planRigRollback({
    originalPlan: plan,
    installed: {
      ...installed,
      sourceRevision: 'spec-2',
      rigText: plan.afterRigText,
      contracts: plan.afterContracts,
      occupants: { 'dev.build': { sessionId: 'new', generation: 'new' } },
    },
    workflow,
    executorIdentity,
  })
  const operation = (subject) =>
    createRigMutationOperation({
      plan: subject,
      id: 'compensate',
      policyDigest: 'a'.repeat(64),
      repository: 'test/repo',
      base: 'main',
      delegate: 'operator',
      candidateDigest: 'b'.repeat(64),
      workspaceDigest: fingerprintCandidate(process.cwd(), {
        inputs: ['adapters/openrig/mutation.mjs'],
      }).digest,
      checks: [],
      review: {},
    })
  return { plan, rollback, operation }
}
const observation = (plan, entries, operation) => ({
  operationId: operation?.id ?? null,
  payloadDigest: operation ? operationDigest(operation) : null,
  verified: true,
  complete: true,
  sourceRef: 'fixture://readback',
  sourceRevision: 'runtime-3',
  rigName: plan.rigName,
  observedAt: now,
  configDigest: plan.afterDigest,
  preservation: plan.preservation,
  entries:
    entries ??
    plan.afterContracts.map((c) => ({
      ...c,
      sessionId: 'restored',
      generation: 'restored',
      processReady: true,
      catchupVerified: true,
    })),
})

describe('runtime proof and compensating rollback negatives #523', () => {
  it('returns explicit rollback-verified only after the old contract is observed on a replacement occupant', async () => {
    const f = fixture()
    const op = f.operation(f.rollback)
    const result = await createRigMutationReconciler({
      plan: f.rollback,
      observeRuntime: async () => observation(f.rollback, undefined, op),
      clock: () => now,
    })({}, { operation: op })
    expect(result).toMatchObject({
      verified: true,
      state: 'confirmed',
      recovery: 'rollback-verified',
    })
  })
  it('records explicit rollback failure from exact authoritative operation failure', async () => {
    const f = fixture()
    const op = f.operation(f.rollback)
    const result = await createRigMutationReconciler({
      plan: f.rollback,
      observeRuntime: async () => ({
        ...observation(f.rollback, undefined, op),
        outcome: 'failed',
        operationId: op.id,
        payloadDigest: operationDigest(op),
        effects: [{ seat: 'dev.build', state: 'partial' }],
      }),
      clock: () => now,
    })({}, { operation: op })
    expect(result).toMatchObject({ state: 'failed', recovery: 'rollback-failed' })
  })
  it.each(['model', 'effort', 'providerRoute'])(
    'rejects readback with changed actual %s',
    async (field) => {
      const f = fixture()
      const op = f.operation(f.plan)
      const actual = observation(f.plan, undefined, op)
      actual.entries[0][field] = 'wrong'
      expect(
        (
          await createRigMutationReconciler({
            plan: f.plan,
            observeRuntime: async () => actual,
            clock: () => now,
          })({}, { operation: op })
        ).state,
      ).toBe('unknown')
    },
  )
  it('rejects stale runtime observation and changed publication holds', async () => {
    const f = fixture()
    const op = f.operation(f.plan)
    const actual = observation(f.plan, undefined, op)
    actual.observedAt = '2026-10-15T10:00:00.000Z'
    expect(
      (
        await createRigMutationReconciler({
          plan: f.plan,
          observeRuntime: async () => actual,
          clock: () => now,
        })({}, { operation: op })
      ).state,
    ).toBe('unknown')
    actual.observedAt = now
    actual.preservation = { ...actual.preservation, publicationHolds: [] }
    expect(
      (
        await createRigMutationReconciler({
          plan: f.plan,
          observeRuntime: async () => actual,
          clock: () => now,
        })({}, { operation: op })
      ).state,
    ).toBe('unknown')
  })
})

describe('current workspace custody regression #523', () => {
  it('rejects changed artifact fingerprint before a source-admitted runtime effect', async () => {
    const f = fixture()
    const operation = f.operation(f.plan)
    const workflow = { ...f.plan.preservation, ...f.plan.workflowAnchor }
    const state = {
      runId: workflow.runId,
      owner: workflow.owner,
      generation: workflow.generation,
      revocationEpoch: workflow.revocationEpoch,
      oracleDigest: workflow.oracleDigest,
      admissions: {},
    }
    const runService = {
      read: async () => ({
        state,
        revision: workflow.revision,
        sourceRevision: workflow.sourceRevision,
      }),
      executeDelegatedOperation: async (op, options, dispatch) => {
        await dispatch(op, {})
        return { replayed: false }
      },
    }
    const inspectContext = async () => ({
      verified: true,
      sourceRef: 'fixture://source',
      sourceRevision: f.plan.sourceRevision,
      installedRigText: f.plan.beforeRigText,
      workflow,
      workspaceDigest: 'f'.repeat(64),
      executorIdentity: f.plan.executorIdentity,
      checkpoint: {
        verified: true,
        digest: workflow.checkpointDigest,
        sourceRef: 'fixture://checkpoint',
      },
      priorWriters: { stopped: true, sourceRef: 'fixture://stopped' },
    })
    let calls = 0
    await expect(
      applyRigMutation({
        plan: f.plan,
        runService,
        operation,
        authority: { owner: workflow.owner, generation: workflow.generation },
        grantId: 'fixture',
        inspectContext,
        dispatch: async () => {
          calls++
        },
      }),
    ).rejects.toThrow(/workspace|artifact/i)
    expect(calls).toBe(0)
  })
})

describe('offline mutation preview #523', () => {
  it('shows deltas with unknown source authority instead of inventing workflow counters', () => {
    const f = fixture()
    const plan = planRigMutation({
      rigName: f.plan.rigName,
      desired: {
        rigText: f.plan.afterRigText,
        configText:
          'recommended: keep\nseats:\n  dev.build:\n    runtimes:\n      codex: builder\npresets:\n  keep:\n    dev.build: codex\n',
      },
      installed: {
        rigText: f.plan.beforeRigText,
        contracts: f.plan.beforeContracts,
        sourceRevision: 'local-config-fingerprint',
      },
      workflow: null,
    })
    expect(plan.effects).toEqual([])
    expect(plan.affectedSeats).toContain('dev.build')
    expect(plan.preservation).toBe(null)
    expect(plan.admissionHolds.length).toBeGreaterThan(0)
  })
})

describe('operation-bound runtime proof regression #523', () => {
  it('cannot confirm a matching rig readback that belongs to another operation', async () => {
    const f = fixture()
    const operation = f.operation(f.plan)
    const result = await createRigMutationReconciler({
      plan: f.plan,
      observeRuntime: async () => ({
        ...observation(f.plan, undefined, operation),
        operationId: 'different-operation',
        payloadDigest: 'c'.repeat(64),
      }),
      clock: () => now,
    })({}, { operation })
    expect(result.state).toBe('unknown')
  })
})
