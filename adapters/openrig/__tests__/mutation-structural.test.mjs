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

describe('structural rig mutations and policy holds (#523)', () => {
  async function structuralFixture({
    addition = '        cwd: /workspace/new\n',
    activation = 'active',
  } = {}) {
    const f = await fixture()
    const installed = {
      ...f.installed,
      contracts: f.installed.contracts.map((c) => ({ ...c, capabilityTier: 'balanced' })),
    }
    const desired = {
      rigText: installed.rigText.replace(
        '        effort: medium\n',
        '        effort: medium\n' + addition,
      ),
      configText:
        'recommended: keep\nseats:\n  dev.build:\n    runtimes:\n      codex: builder\npresets:\n  keep:\n    dev.build: codex\n',
      config: { adapters: { openrig: { executionPolicy: { activation } } } },
    }
    const plan = planRigMutation({
      rigName: 'fixture-dev',
      installed,
      desired,
      workflow: f.workflow,
      executorIdentity: f.executorIdentity,
    })
    f.plans.set(plan.digest, plan)
    return { ...f, installed, desired, plan }
  }
  it.each([
    '        cwd: /workspace/new\n',
    '        env: {MODE: changed}\n',
    '        startup: run-new-task\n',
  ])('requires an observed replacement for non-tuple structural change %s', async (addition) => {
    const f = await structuralFixture({ addition }),
      plan = f.plan
    expect(plan.beforeDigest).not.toBe(plan.afterDigest)
    expect(plan.affectedSeats).toEqual(['dev.build'])
    expect(plan.restarts).toEqual(['dev.build'])
    const grant = await f.grant(plan)
    const op = f.makeOperation(plan)
    expect(
      (
        await applyRigMutation({
          ...f,
          operation: op,
          runService: f.service,
          authority,
          grantId: grant.grantId,
        })
      ).status,
    ).toBe('submitted')
    f.setObservation(
      observed(f, plan, {
        entries: plan.afterContracts.map((c) => ({
          ...c,
          sessionId: 'old-session',
          generation: 'occupant-1',
          processReady: true,
          catchupVerified: true,
        })),
      }),
    )
    expect(
      (await reconcileRigMutation({ plan, runService: f.service, operationId: op.id, authority }))
        .status,
    ).toBe('unknown')
    f.setObservation(observed(f, plan))
    expect(
      (await reconcileRigMutation({ plan, runService: f.service, operationId: op.id, authority }))
        .status,
    ).toBe('confirmed')
  })
  it('holds a direct host mutation when source policy activation is held', async () => {
    const f = await structuralFixture({ activation: 'held' })
    expect(f.plan.admissionHolds.some((h) => h.code === 'EXECUTION_POLICY_HELD')).toBe(true)
    const grant = await f.grant(f.plan)
    await expect(
      applyRigMutation({
        ...f,
        operation: f.makeOperation(f.plan),
        runService: f.service,
        authority,
        grantId: grant.grantId,
      }),
    ).rejects.toThrow(/held/i)
    expect(f.calls).toEqual([])
  })
  it('does not force a restart for comment-only differences with identical tuples', async () => {
    const f = await structuralFixture({ addition: '        # documentation only\n' })
    expect(f.plan.affectedSeats).toEqual([])
    expect(f.plan.restarts).toEqual([])
  })
  it('does not drop held activation on rollback planning', async () => {
    const f = await structuralFixture({ activation: 'held' })
    const rollback = planRigRollback({
      originalPlan: f.plan,
      installed: { ...f.installed, rigText: f.plan.afterRigText, contracts: f.plan.afterContracts },
      workflow: f.workflow,
      executorIdentity: f.executorIdentity,
    })
    expect(rollback.admissionHolds.some((h) => h.code === 'EXECUTION_POLICY_HELD')).toBe(true)
  })
})
