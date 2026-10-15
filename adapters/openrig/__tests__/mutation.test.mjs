import { describe, expect, it } from 'vitest'
import {
  planRigMutation,
  createRigMutationOperation,
  applyRigMutation,
  createRigMutationReconciler,
  reconcileRigMutation,
  planRigRollback,
} from '../mutation.mjs'
import { createRunService } from '../../../lib/application/run-service.mjs'
import { createLocalCooperativeIssuer } from '../../../lib/application/local-cooperative-issuer.mjs'
import {
  createGitHubRunStore,
  planGitHubCoordination,
} from '../../../lib/sources/github-run-store.mjs'
import { createRunEvent, reduceRun } from '../../../lib/core/run-state.mjs'
import { fakeGitHub } from '../../../lib/__tests__/github-run-store.fixture.mjs'
import { operationDigest } from '../../../lib/core/delegation-grant.mjs'
import { recordDigest } from '../../../lib/core/record-digest.mjs'
import { fingerprintCandidate } from '../../../lib/verification/workspace.mjs'
import { inspectProcessRuntime } from '../../../lib/verification/process-collector.mjs'

const now = '2026-10-15T12:00:00.000Z'
const beforeRig =
  'name: fixture-dev\npods:\n  - id: dev\n    members:\n      - id: build\n        runtime: codex\n        model: gpt-6.1-sol\n        profile: builder\n        effort: medium\n'
const configText =
  'recommended: selected\nseats:\n  dev.build:\n    runtimes:\n      codex: builder\n      pi: builder-pi\npresets:\n  selected:\n    dev.build:\n      runtime: pi\n      providerRoute: munito\n      model: qwen/test\n      effort: medium\n'
const beforeContract = {
  seat: 'dev.build',
  runtime: 'codex',
  executionTarget: 'codex-cli',
  providerRoute: 'openai-codex',
  providerFamily: 'openai',
  model: 'gpt-6.1-sol',
  effort: 'medium',
  profile: 'builder',
}
const authority = { owner: 'writer', generation: 0 }
const policy = {
  version: 1,
  issuers: [
    {
      id: 'operator',
      mode: 'local-cooperative',
      origin: 'fixture',
      authorityRef: 'fixture://approval',
      allowedActions: ['rig:mutate'],
      allowThroughMerge: false,
    },
  ],
  requiredChecks: ['tests'],
  reviewPolicy: 'human',
  materiality: 'fixed-scope-v1',
  allowSubdelegation: false,
  safetyReserve: 8,
}
async function fixture() {
  const fake = fakeGitHub()
  const setupConfirm = (await planGitHubCoordination({ repo: 'test/repo', client: fake.client }))
    .digest
  const store = createGitHubRunStore({
    repo: 'test/repo',
    runId: 'mutation',
    client: fake.client,
    boundary: 'external-action',
    setupConfirm,
  })
  let state = null
  async function append(kind, payload) {
    const event = createRunEvent({
      runId: 'mutation',
      id: `${kind}-${state?.history.length ?? 0}`,
      kind,
      payload,
      previousDigest: state?.revision ?? null,
      generation: 0,
      timestamp: now,
    })
    state = reduceRun((await store.append(event, state?.revision ?? null)).events)
    return event
  }
  await append('started', {
    goalRef: 'issue:523',
    owner: 'writer',
    profile: 'high-assurance',
    boundary: 'external-action',
    delegationPolicy: policy,
  })
  await append('candidate', { digest: 'a'.repeat(64) })
  const checkpoint = await append('checkpoint', {
    kind: 'mutation-safe-boundary',
    publicationHolds: ['human-acceptance'],
  })
  const snapshot = await store.read()
  const workflow = {
    protocol: 'run-v1',
    runId: 'mutation',
    revision: state.revision,
    sourceRevision: snapshot.sourceRevision,
    owner: 'writer',
    generation: 0,
    revocationEpoch: 0,
    oracleDigest: null,
    custody: null,
    checkpointDigest: checkpoint.digest,
    publicationHolds: ['human-acceptance'],
  }
  const installed = {
    rigText: beforeRig,
    contracts: [beforeContract],
    sourceRevision: 'spec-1',
    occupants: { 'dev.build': { sessionId: 'old-session', generation: 'occupant-1' } },
  }
  const executorIdentity = inspectProcessRuntime(process.cwd(), {
    executable: process.execPath,
  }).identity
  const plan = planRigMutation({
    rigName: 'fixture-dev',
    desired: { rigText: beforeRig, configText },
    installed,
    workflow,
    executorIdentity,
  })
  let observation = null
  const plans = new Map([[plan.digest, plan]])
  const issuer = createLocalCooperativeIssuer({
    policy,
    issuerId: 'operator',
    approve: async () => ({ approved: true, decisionRef: 'fixture://explicit-decision' }),
  })
  const service = createRunService({
    store,
    posture: 'autonomous',
    delegationPolicy: policy,
    clock: () => now,
    authorize: (context) =>
      ['issue-grant', 'resolve-grant', 'revoke-grant'].includes(context.kind)
        ? issuer(context)
        : true,
    reconcileOperation: (pending, receipt) =>
      createRigMutationReconciler({
        plan: plans.get(receipt.operation.arguments.mutationPlanDigest),
        clock: () => now,
        observeRuntime: async ({ operation }) =>
          observation
            ? {
                ...structuredClone(observation),
                operationId: operation.id,
                payloadDigest: operationDigest(operation),
              }
            : null,
      })(pending, receipt),
  })
  const workspaceDigest = fingerprintCandidate(process.cwd(), {
    inputs: ['adapters/openrig/mutation.mjs'],
  }).digest
  const calls = []
  const inspectContext = async () => {
    const current = await service.read()
    return {
      verified: true,
      sourceRef: 'fixture://current',
      sourceRevision: installed.sourceRevision,
      installedRigText: installed.rigText,
      workflow: { ...workflow, revision: current.revision, sourceRevision: current.sourceRevision },
      executorIdentity,
      workspaceDigest,
      occupants: installed.occupants,
      runtimeGuards: {
        version: 'fixture-v1',
        sourceRef: 'fixture://guards',
        sourceRevision: 'guards-one',
        capabilities: ['source-revision-cas', 'occupant-cas', 'executor-digest'],
      },
      checkpoint: { verified: true, digest: checkpoint.digest, sourceRef: 'fixture://checkpoint' },
      priorWriters: { stopped: true, sourceRef: 'fixture://old-process' },
    }
  }
  const makeOperation = (p = plan, id = 'apply-1') =>
    createRigMutationOperation({
      plan: p,
      id,
      policyDigest: recordDigest(policy),
      repository: 'test/repo',
      base: 'main',
      delegate: 'fixture-operator',
      candidateDigest: 'a'.repeat(64),
      workspaceDigest,
      checks: [{ name: 'tests', outcome: 'pass', candidateDigest: 'a'.repeat(64) }],
      review: { outcome: 'pass', policy: 'human', candidateDigest: 'a'.repeat(64) },
    })
  async function grant(p = plan) {
    const current = await service.read()
    return service.issueGrant(
      {
        planDigest: p.digest,
        policyDigest: recordDigest(policy),
        repository: 'test/repo',
        base: 'main',
        delegate: 'fixture-operator',
        allowedPaths: [p.specPath],
        allowedActions: ['rig:mutate'],
        capabilities: ['rig:mutate'],
        requiredChecks: ['tests'],
        reviewPolicy: 'human',
        materiality: 'fixed-scope-v1',
        allowSubdelegation: false,
        maxAttempts: 1,
        maxExternalEffects: 1,
        expiry: '2026-10-16T12:00:00.000Z',
        issuerMode: 'local-cooperative',
      },
      { expectedRevision: current.revision, authority },
    )
  }
  const dispatch = async (operation) => {
    calls.push(operation)
    return { status: 0 }
  }
  return {
    plan,
    plans,
    workflow,
    installed,
    executorIdentity,
    service,
    grant,
    makeOperation,
    inspectContext,
    dispatch,
    calls,
    setObservation: (value) => {
      observation = value
    },
    now,
  }
}
function observed(f, plan = f.plan, fields = {}) {
  return {
    verified: true,
    complete: true,
    sourceRef: 'fixture://runtime',
    sourceRevision: 'runtime-revision-2',
    observedAt: now,
    rigName: plan.rigName,
    configDigest: plan.afterDigest,
    preservation: plan.preservation,
    entries: plan.afterContracts.map((c) => ({
      ...c,
      sessionId: 'new-session',
      generation: 'occupant-2',
      processReady: true,
      catchupVerified: true,
    })),
    ...fields,
  }
}

describe('verified rig mutation with real source-backed run service #523', () => {
  it('previews an immutable complete delta and restart/rollback obligations without effects', async () => {
    const f = await fixture()
    expect(f.plan.effects).toEqual([])
    expect(f.plan.affectedSeats).toEqual(['dev.build'])
    expect(f.plan.restarts).toContain('dev.build')
    expect(f.plan.changes[0].fields.runtime).toEqual({ before: 'codex', after: 'pi' })
    expect(f.plan.requiredActions).toEqual(['rig:mutate'])
    expect(f.plan.rollback.restoresWorkflowHistory).toBe(false)
    expect(Object.isFrozen(f.plan)).toBe(true)
    expect(f.calls).toEqual([])
  })
  it('holds before effects without a trusted host inspector', async () => {
    const f = await fixture()
    const g = await f.grant()
    await expect(
      applyRigMutation({
        plan: f.plan,
        runService: f.service,
        operation: f.makeOperation(),
        authority,
        grantId: g.grantId,
        dispatch: f.dispatch,
      }),
    ).rejects.toThrow(/inspect|source|host/i)
    expect(f.calls).toEqual([])
  })
  it('rejects stale installed configuration and missing grant before dispatch', async () => {
    const f = await fixture()
    const g = await f.grant()
    f.installed.rigText += '# changed\n'
    await expect(
      applyRigMutation({
        ...f,
        runService: f.service,
        operation: f.makeOperation(),
        authority,
        grantId: g.grantId,
      }),
    ).rejects.toThrow(/stale|changed/i)
    expect(f.calls).toEqual([])
  })
  it('does not treat command success as confirmed and does not restart twice on replay', async () => {
    const f = await fixture()
    const g = await f.grant()
    const options = {
      ...f,
      runService: f.service,
      operation: f.makeOperation(),
      authority,
      grantId: g.grantId,
    }
    expect((await applyRigMutation(options)).status).toBe('submitted')
    expect((await applyRigMutation(options)).status).toBe('reconciliation-required')
    expect(f.calls).toHaveLength(1)
    expect(
      (
        await reconcileRigMutation({
          plan: f.plan,
          runService: f.service,
          operationId: 'apply-1',
          authority,
        })
      ).status,
    ).toBe('unknown')
  })
  it('requires fresh actual contract and a replaced occupant before reporting confirmed', async () => {
    const f = await fixture()
    const g = await f.grant()
    await applyRigMutation({
      ...f,
      runService: f.service,
      operation: f.makeOperation(),
      authority,
      grantId: g.grantId,
    })
    f.setObservation(
      observed(f, f.plan, {
        entries: [
          {
            ...f.plan.afterContracts[0],
            sessionId: 'old-session',
            generation: 'occupant-1',
            processReady: true,
            catchupVerified: true,
          },
        ],
      }),
    )
    expect(
      (
        await reconcileRigMutation({
          plan: f.plan,
          runService: f.service,
          operationId: 'apply-1',
          authority,
        })
      ).status,
    ).toBe('unknown')
    f.setObservation(observed(f))
    expect(
      (
        await reconcileRigMutation({
          plan: f.plan,
          runService: f.service,
          operationId: 'apply-1',
          authority,
        })
      ).status,
    ).toBe('confirmed')
  })
  it('keeps ambiguous dispatch pending and never repeats the restart', async () => {
    const f = await fixture()
    const g = await f.grant()
    const options = {
      ...f,
      runService: f.service,
      operation: f.makeOperation(),
      authority,
      grantId: g.grantId,
      dispatch: async (op) => {
        f.calls.push(op)
        throw new Error('lost response')
      },
    }
    expect((await applyRigMutation(options)).status).toBe('unknown')
    expect((await applyRigMutation(options)).status).toBe('reconciliation-required')
    expect(f.calls).toHaveLength(1)
  })
  it('refuses tampered operation arguments and preserves publication holds', async () => {
    const f = await fixture()
    const g = await f.grant()
    const operation = f.makeOperation()
    operation.arguments.rigName = 'other-rig'
    await expect(
      applyRigMutation({ ...f, runService: f.service, operation, authority, grantId: g.grantId }),
    ).rejects.toThrow()
    expect(f.calls).toEqual([])
    expect(f.plan.preservation.publicationHolds).toEqual(['human-acceptance'])
  })
  it('plans rollback as a distinct compensating operation without resetting native counters/history', async () => {
    const f = await fixture()
    const rollback = planRigRollback({
      originalPlan: f.plan,
      installed: {
        ...f.installed,
        rigText: f.plan.afterRigText,
        contracts: f.plan.afterContracts,
        sourceRevision: 'spec-2',
      },
      workflow: f.workflow,
      executorIdentity: f.executorIdentity,
    })
    expect(rollback.mode).toBe('rollback')
    expect(rollback.originalPlanDigest).toBe(f.plan.digest)
    expect(rollback.afterContracts[0]).toMatchObject(beforeContract)
    expect(rollback.preservation.generation).toBe(0)
    expect(rollback.preservation.revocationEpoch).toBe(0)
    expect(rollback.rollback.restoresWorkflowHistory).toBe(false)
    expect(rollback.digest).not.toBe(f.plan.digest)
  })
})

describe('rig mutation source authority denial #523', () => {
  it('rejects a missing typed grant and obsolete writer before effects', async () => {
    const f = await fixture()
    const grant = await f.grant()
    await expect(
      applyRigMutation({
        ...f,
        runService: f.service,
        operation: f.makeOperation(),
        authority,
        grantId: 'missing',
      }),
    ).rejects.toThrow(/grant/i)
    await expect(
      applyRigMutation({
        ...f,
        runService: f.service,
        operation: f.makeOperation(),
        authority: { owner: 'obsolete', generation: 0 },
        grantId: grant.grantId,
      }),
    ).rejects.toThrow(/writer|identity/i)
    expect(f.calls).toEqual([])
  })
  it('rechecks preservation after asynchronous admission and holds changed publication authority', async () => {
    const f = await fixture()
    const grant = await f.grant()
    let checks = 0
    const inspectContext = async () => {
      const context = await f.inspectContext()
      if (++checks > 1) context.workflow.publicationHolds = []
      return context
    }
    const result = await applyRigMutation({
      ...f,
      runService: f.service,
      operation: f.makeOperation(),
      authority,
      grantId: grant.grantId,
      inspectContext,
    })
    expect(result.status).toBe('unknown')
    expect(f.calls).toEqual([])
    expect(checks).toBe(2)
  })
})

describe('source-backed compensating mutation execution #523', () => {
  it.each(['confirmed', 'failed'])(
    'reconciles original %s then independently grants and verifies rollback',
    async (originalOutcome) => {
      const f = await fixture()
      const grant = await f.grant()
      await applyRigMutation({
        ...f,
        runService: f.service,
        operation: f.makeOperation(),
        authority,
        grantId: grant.grantId,
      })
      f.setObservation({
        ...observed(f),
        ...(originalOutcome === 'failed'
          ? { outcome: 'failed', effects: [{ seat: 'dev.build', state: 'partial' }] }
          : {}),
      })
      expect(
        (
          await reconcileRigMutation({
            plan: f.plan,
            runService: f.service,
            operationId: 'apply-1',
            authority,
          })
        ).status,
      ).toBe(originalOutcome)
      Object.assign(f.installed, {
        rigText: f.plan.afterRigText,
        contracts: f.plan.afterContracts,
        sourceRevision: 'spec-2',
        occupants: { 'dev.build': { sessionId: 'new-session', generation: 'occupant-2' } },
      })
      const rollback = planRigRollback({
        originalPlan: f.plan,
        installed: f.installed,
        workflow: f.workflow,
        executorIdentity: f.executorIdentity,
      })
      f.plans.set(rollback.digest, rollback)
      const compensationGrant = await f.grant(rollback)
      const result = await applyRigMutation({
        ...f,
        plan: rollback,
        runService: f.service,
        operation: f.makeOperation(rollback, 'rollback-1'),
        authority,
        grantId: compensationGrant.grantId,
      })
      expect(result.status).toBe('submitted')
      f.setObservation({
        ...observed(f, rollback),
        entries: rollback.afterContracts.map((c) => ({
          ...c,
          sessionId: 'rollback-session',
          generation: 'occupant-3',
          processReady: true,
          catchupVerified: true,
        })),
      })
      expect(
        await reconcileRigMutation({
          plan: rollback,
          runService: f.service,
          operationId: 'rollback-1',
          authority,
        }),
      ).toMatchObject({ status: 'confirmed', recovery: 'rollback-verified' })
      const current = await f.service.read()
      expect(current.state.generation).toBe(0)
      expect(current.state.revocationEpoch).toBe(0)
      expect(current.state.admissions['apply-1']).toBeTruthy()
      expect(current.state.admissions['rollback-1']).toBeTruthy()
      expect(f.calls).toHaveLength(2)
    },
  )
})
