import { describe, expect, it } from 'vitest'
import {
  planRigMutation,
  createRigMutationOperation,
  applyRigMutation,
  createRigMutationReconciler,
  planRigRollback,
} from '../mutation.mjs'
import { inspectProcessRuntime } from '../../../lib/verification/process-collector.mjs'
import { operationDigest } from '../../../lib/core/delegation-grant.mjs'

function fixture() {
  const rigText =
    'name: review\npods:\n  - id: dev\n    members:\n      - id: build\n        runtime: codex\n        profile: builder\n        model: gpt-6.1-sol\n        effort: medium\n'
  const configText =
    'recommended: selected\nseats:\n  dev.build:\n    runtimes:\n      codex: builder\npresets:\n  selected:\n    dev.build:\n      runtime: codex\n      model: gpt-6-astra\n'
  const workflow = {
    protocol: 'run-v1',
    runId: 'review',
    revision: 'revision',
    sourceRevision: 'source',
    owner: 'writer',
    generation: 0,
    revocationEpoch: 0,
    oracleDigest: null,
    custody: null,
    checkpointDigest: 'a'.repeat(64),
    publicationHolds: ['human'],
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
        profile: 'builder',
        effort: 'medium',
        capabilityTier: 'balanced',
      },
    ],
    sourceRevision: 'spec',
    occupants: { 'dev.build': { sessionId: 'old', generation: 'old' } },
  }
  const executorIdentity = inspectProcessRuntime(process.cwd(), {
    executable: process.execPath,
  }).identity
  const inputs = {
    rigName: 'review',
    desired: { rigText, configText },
    installed,
    workflow,
    executorIdentity,
  }
  const plan = planRigMutation(inputs)
  const operation = (p = plan) =>
    createRigMutationOperation({
      plan: p,
      id: p.mode === 'rollback' ? 'rollback' : 'apply',
      policyDigest: 'b'.repeat(64),
      repository: 'test/repo',
      base: 'main',
      delegate: 'operator',
      candidateDigest: 'c'.repeat(64),
      workspaceDigest: 'd'.repeat(64),
      checks: [],
      review: {},
    })
  const state = {
    runId: workflow.runId,
    owner: workflow.owner,
    generation: 0,
    revocationEpoch: 0,
    oracleDigest: null,
    admissions: {},
    operations: {},
  }
  const context = {
    verified: true,
    sourceRef: 'fixture://current',
    sourceRevision: installed.sourceRevision,
    installedRigText: installed.rigText,
    workflow,
    executorIdentity,
    workspaceDigest: 'd'.repeat(64),
    occupants: installed.occupants,
    runtimeGuards: {
      version: 'fixture-v1',
      sourceRef: 'fixture://guards',
      sourceRevision: 'guards-one',
      capabilities: ['source-revision-cas', 'occupant-cas', 'executor-digest'],
    },
    checkpoint: {
      verified: true,
      sourceRef: 'fixture://checkpoint',
      digest: workflow.checkpointDigest,
    },
    priorWriters: { stopped: true, sourceRef: 'fixture://stopped' },
  }
  let effects = 0
  const runService = {
    read: async () => ({
      state,
      revision: workflow.revision,
      sourceRevision: workflow.sourceRevision,
    }),
    executeDelegatedOperation: async (op, opts, dispatch) => {
      await dispatch(op, {})
      return { replayed: false }
    },
  }
  const apply = (p = plan) =>
    applyRigMutation({
      plan: p,
      operation: operation(p),
      runService,
      authority: { owner: 'writer', generation: 0 },
      grantId: 'fixture-only',
      inspectContext: async () => context,
      dispatch: async () => {
        effects++
      },
    })
  return { inputs, plan, context, state, operation, apply, effects: () => effects }
}
const now = '2026-10-15T12:00:00.000Z'
describe('independent Haiku advisory review regressions #523', () => {
  it('rejects a plan whose incumbent changed even when configuration did not', async () => {
    const f = fixture()
    f.context.occupants = { 'dev.build': { sessionId: 'interloper', generation: 'other' } }
    await expect(f.apply()).rejects.toThrow(/occupant|incumbent/i)
    expect(f.effects()).toBe(0)
  })
  it('holds when the host cannot enforce atomic config/occupant/executable guards', async () => {
    const f = fixture()
    delete f.context.runtimeGuards
    await expect(f.apply()).rejects.toThrow(/guard|atomic|capability/i)
    expect(f.effects()).toBe(0)
  })
  it('binds the chosen executable and incumbent/source revision into the operation', () => {
    const f = fixture()
    const args = f.operation().arguments
    expect(args.executorIdentityDigest).toBe(f.plan.executorIdentity.digest)
    expect(args.expectedSourceRevision).toBe(f.plan.sourceRevision)
    expect(args.expectedOccupants).toMatchObject({
      'dev.build': { sessionId: 'old', generation: 'old' },
    })
  })
  it('rejects empty or truthy-string custody for pinned oracles', () => {
    const f = fixture()
    for (const custody of [{}, 'unknown']) {
      const plan = planRigMutation({
        ...f.inputs,
        workflow: { ...f.inputs.workflow, oracleDigest: 'e'.repeat(64), custody },
      })
      expect(plan.admissionHolds.some((item) => /custody/i.test(item.reason))).toBe(true)
    }
  })
  it('holds rollback while the exact original operation is unresolved', async () => {
    const f = fixture()
    const rollback = planRigRollback({
      originalPlan: f.plan,
      installed: {
        ...f.inputs.installed,
        rigText: f.plan.afterRigText,
        contracts: f.plan.afterContracts,
      },
      workflow: f.inputs.workflow,
      executorIdentity: f.inputs.executorIdentity,
    })
    const original = f.operation()
    f.state.admissions.apply = { operation: original, operationDigest: operationDigest(original) }
    f.state.operations.apply = { state: 'submitted' }
    f.context.installedRigText = rollback.beforeRigText
    await expect(f.apply(rollback)).rejects.toThrow(/original|unresolved|terminal/i)
    expect(f.effects()).toBe(0)
  })
  it.each([false, true])(
    'rejects incomplete or additional runtime occupants (extra=%s)',
    async (extra) => {
      const f = fixture()
      const op = f.operation()
      const observed = {
        verified: true,
        sourceRef: 'fixture://runtime',
        sourceRevision: 'runtime',
        rigName: f.plan.rigName,
        observedAt: now,
        operationId: op.id,
        payloadDigest: operationDigest(op),
        configDigest: f.plan.afterDigest,
        preservation: f.plan.preservation,
        complete: extra,
        entries: [
          {
            ...f.plan.afterContracts[0],
            sessionId: 'new',
            generation: 'new',
            processReady: true,
            catchupVerified: true,
          },
          ...(extra ? [{ seat: 'unplanned', sessionId: 'rogue', generation: 'rogue' }] : []),
        ],
      }
      const result = await createRigMutationReconciler({
        plan: f.plan,
        observeRuntime: async () => observed,
        clock: () => now,
      })({}, { operation: op })
      expect(result.state).toBe('unknown')
    },
  )
})
