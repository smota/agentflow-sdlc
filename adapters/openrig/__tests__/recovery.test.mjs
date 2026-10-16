import { describe, expect, it } from 'vitest'
import { classifyExecutionFailure, recoverExecution } from '../recovery.mjs'
import { createRunService } from '../../../lib/application/run-service.mjs'
import { createMemoryRunStore } from '../../../lib/sources/run-store.mjs'
import { createLocalCooperativeIssuer } from '../../../lib/application/local-cooperative-issuer.mjs'
import { loadSdlcConfig } from '../../../lib/sdlc-state.mjs'
import { recordDigest } from '../../../lib/core/record-digest.mjs'

const nowMs = Date.parse('2026-10-15T12:00:00Z'),
  candidate = 'c'.repeat(64)
async function fixture({ stopped = true, outcome = 'confirmed' } = {}) {
  const delegationPolicy = {
    version: 1,
    issuers: [
      {
        id: 'local',
        origin: 'test:host',
        authorityRef: 'host:approval',
        mode: 'local-cooperative',
        allowedActions: ['rig:mutate'],
        allowThroughMerge: false,
      },
    ],
    requiredChecks: [],
    reviewPolicy: 'automated',
    materiality: 'fixed-scope-v1',
    allowSubdelegation: false,
    safetyReserve: 4,
  }
  const store = createMemoryRunStore({ durable: true })
  store.conditionalAdmission = 'single-parent-run-chain-v1'
  const issuer = createLocalCooperativeIssuer({
    policy: delegationPolicy,
    issuerId: 'local',
    approve: async () => ({ approved: true, decisionRef: 'test:approval' }),
  })
  const sdlcConfig = structuredClone(loadSdlcConfig())
  sdlcConfig.actionPolicy.profileMaximums.standard = 'external-action'
  const service = createRunService({
    sdlcConfig,
    posture: 'autonomous',
    store,
    delegationPolicy,
    clock: () => new Date(nowMs).toISOString(),
    authorize: (context) =>
      ['issue-grant', 'resolve-grant', 'revoke-grant'].includes(context.kind)
        ? issuer(context)
        : true,
    observeWriter: async () => ({ stopped }),
    observeWorkspace: async () => ({
      verified: true,
      candidateDigest: candidate,
      branch: 'work/test',
      commitSha: '1'.repeat(40),
    }),
    reconcileOperation: async (operation, admitted) =>
      outcome === 'unknown'
        ? { state: 'unknown' }
        : {
            verified: true,
            state: outcome,
            operationId: operation.id,
            payloadDigest: admitted.operationDigest,
            candidateDigest: candidate,
            sourceRevision: 'test:provider-1',
          },
  })
  const authority = { owner: 'original', generation: 0 }
  await service.start({
    runId: 'recovery-test',
    goalRef: 'issue:522',
    owner: authority.owner,
    boundary: 'external-action',
    authority,
  })
  await service.record(
    'candidate',
    { digest: candidate },
    { expectedRevision: (await service.read()).revision, authority },
  )
  const grant = await service.issueGrant(
    {
      issuerMode: 'local-cooperative',
      planDigest: 'a'.repeat(64),
      policyDigest: recordDigest(delegationPolicy),
      repository: 'test/repo',
      base: 'development',
      delegate: 'codex',
      allowedPaths: ['src/*'],
      allowedActions: ['rig:mutate'],
      capabilities: ['rig:mutate'],
      requiredChecks: [],
      reviewPolicy: 'automated',
      materiality: 'fixed-scope-v1',
      allowSubdelegation: false,
      maxAttempts: 2,
      maxExternalEffects: 2,
      expiry: new Date(nowMs + 600000).toISOString(),
    },
    { expectedRevision: (await service.read()).revision, authority },
  )
  const policy = {
    maxAttempts: 2,
    deadlineAt: nowMs + 120000,
    backoffMs: 1000,
    portTimeoutMs: 1000,
    fallback: {
      seat: 'dev.build',
      capabilityTier: 'balanced',
      platformChains: { 'dev.build': ['codex:openai-codex'] },
      tierMatrix: {
        balanced: {
          'codex:openai-codex': { runtime: 'codex', model: 'gpt-6.1-sol', effort: 'medium' },
        },
      },
    },
  }
  const currentContract = {
    runtime: 'pi',
    providerRoute: 'munito',
    model: 'qwen/qwen3.8-27b',
    effort: 'medium',
    profile: 'builder-pi',
  }
  const replacementContract = {
    runtime: 'codex',
    providerRoute: 'openai-codex',
    model: 'gpt-6.1-sol',
    effort: 'medium',
    profile: 'builder',
  }
  let dispatches = 0
  const args = {
    service,
    failure: { structuredError: { code: 'insufficient_quota', status: 429 } },
    policy,
    nowMs,
    owner: 'operator',
    currentContract,
    replacementContract,
    recovery: {
      owner: 'replacement',
      checkpointAuthority: authority,
      reconciliationAuthority: authority,
      boundary: 'external-action',
      writer: { host: 'test', pid: 123, instance: 'replacement' },
      authority: { owner: 'replacement', generation: 0 },
    },
    operation: {
      id: 'recover-incident-1',
      planDigest: 'a'.repeat(64),
      policyDigest: recordDigest(delegationPolicy),
      repository: 'test/repo',
      base: 'development',
      delegate: 'codex',
      action: 'rig:mutate',
      paths: ['src/file.mjs'],
      capabilities: ['rig:mutate'],
      candidateDigest: candidate,
      workspaceDigest: 'd'.repeat(64),
      checks: [],
      review: { policy: 'automated', outcome: 'pass', candidateDigest: candidate },
      arguments: { recoveryIncident: 'incident-1', recoveryPolicyDigest: recordDigest(policy) },
    },
    operationOptions: {
      expectedRevision: (await service.read()).revision,
      authority: { owner: 'replacement', generation: 1 },
      grantId: grant.grantId,
    },
    dispatch: async () => {
      dispatches++
      return { submitted: true }
    },
    inspectRecoveryContext: async ({ state, incident, policyDigest, operation }) => ({
      verified: true,
      runId: state.runId,
      revision: state.revision,
      generation: state.generation,
      currentContractDigest: recordDigest(currentContract),
      replacementContractDigest: recordDigest(replacementContract),
      authorized: true,
      healthy: true,
      healthyPlatforms: ['codex:openai-codex'],
      checkpointVerified: true,
      custodyVerified: true,
      reviewerIndependenceVerified: true,
      capabilityFloorsVerified: true,
      costPolicyVerified: true,
      quotaIndependent: true,
      incident,
      policyDigest,
      operationDigest: recordDigest(operation),
      observedAt: nowMs,
      artifactDigests: { oracle: 'e'.repeat(64) },
    }),
    readback: async ({ state, incident, operationId }) => ({
      verified: true,
      runId: state.runId,
      revision: state.revision,
      generation: state.generation,
      contract: replacementContract,
      incident,
      operationId,
      observedAt: nowMs,
      artifactDigests: { oracle: 'e'.repeat(64) },
    }),
  }
  return { args, service, dispatches: () => dispatches }
}

describe('structured execution failure classification (#522)', () => {
  it.each([
    ['insufficient_quota', 429, 'quota-exhausted'],
    ['rate_limit_exceeded', 429, 'temporary-rate-limit'],
    ['invalid_api_key', 401, 'authentication'],
    ['model_not_found', 404, 'model-unavailable'],
    ['entry_not_found', 400, 'restore-integrity'],
    ['EACCES', null, 'local-permission'],
    ['ENOENT', null, 'local-path'],
    ['overloaded', 503, 'provider-unavailable'],
  ])('classifies %s', (code, status, classification) => {
    expect(
      classifyExecutionFailure({ structuredError: { code, status }, nowMs }).classification,
    ).toBe(classification)
  })
  it('does not mistake usage metadata or echoed prose for failures', () => {
    expect(
      classifyExecutionFailure({
        structuredError: {
          rate_limits: { used_percent: 100 },
          message: 'quota exceeded in historical context',
        },
        nowMs,
      }).classification,
    ).toBe('unknown')
  })
  it('uses evidenced retry-after seconds, with no invented reset', () => {
    expect(
      classifyExecutionFailure({
        structuredError: { status: 429 },
        responseHeaders: { 'Retry-After': '7' },
        nowMs,
      }),
    ).toMatchObject({
      classification: 'temporary-rate-limit',
      retryAt: nowMs + 7000,
      providerResetUnknown: false,
    })
    expect(classifyExecutionFailure({ structuredError: { status: 429 }, nowMs })).toMatchObject({
      retryAt: null,
      providerResetUnknown: true,
    })
  })
})

describe('run-service backed recovery (#522)', () => {
  it('uses existing recovery, fencing, typed admission and source reconciliation before readback', async () => {
    const f = await fixture(),
      result = await recoverExecution(f.args)
    expect(result.status).toBe('recovered')
    expect(f.dispatches()).toBe(1)
    const snapshot = await f.service.read()
    expect(snapshot.state.owner).toBe('replacement')
    expect(snapshot.state.generation).toBe(1)
    expect(snapshot.state.operations[f.args.operation.id].state).toBe('confirmed')
    expect(snapshot.events.some((event) => event.kind === 'resumed')).toBe(true)
  })
  it('holds live prior writers without dispatch or transfer', async () => {
    const f = await fixture({ stopped: false })
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(f.dispatches()).toBe(0)
    expect((await f.service.read()).state.generation).toBe(0)
  })
  it('does not treat another model on the exhausted provider route as fallback', async () => {
    const f = await fixture()
    f.args.replacementContract = { ...f.args.currentContract, model: 'another-model' }
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(f.dispatches()).toBe(0)
  })
  it('keeps ambiguous dispatch pending and never retries it blindly', async () => {
    const f = await fixture({ outcome: 'unknown' })
    f.args.dispatch = async () => {
      throw new Error('PRIVATE_RAW_ERROR')
    }
    expect((await recoverExecution(f.args)).status).toBe('held')
    const second = await recoverExecution(f.args)
    expect(second.status).toBe('held')
    expect(JSON.stringify(second)).not.toContain('PRIVATE_RAW_ERROR')
    expect(Object.keys((await f.service.read()).state.admissions)).toHaveLength(1)
  })
  it('holds missing trusted readers, authentication failures and artifact drift', async () => {
    const a = await fixture()
    delete a.args.inspectRecoveryContext
    expect((await recoverExecution(a.args)).status).toBe('held')
    const b = await fixture()
    b.args.failure.structuredError = { status: 401 }
    expect((await recoverExecution(b.args)).status).toBe('held')
    expect(b.dispatches()).toBe(0)
    const c = await fixture()
    c.args.readback = async ({ state, incident, operationId }) => ({
      verified: true,
      runId: state.runId,
      revision: state.revision,
      generation: state.generation,
      contract: c.args.replacementContract,
      incident,
      operationId,
      observedAt: nowMs,
      artifactDigests: { oracle: 'f'.repeat(64) },
    })
    expect((await recoverExecution(c.args)).status).toBe('held')
  })
  it('returns finite policy backoff without pretending it is provider reset timing', async () => {
    const f = await fixture()
    f.args.failure.structuredError = { status: 429 }
    expect(await recoverExecution(f.args)).toMatchObject({
      status: 'retry-later',
      retryAt: nowMs + 1000,
      providerResetUnknown: true,
    })
    expect(f.dispatches()).toBe(0)
  })
  it('holds expired budgets and stale operation options before ownership transfer', async () => {
    const f = await fixture()
    f.args.policy.deadlineAt = nowMs
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(f.dispatches()).toBe(0)
    const g = await fixture()
    g.args.operationOptions.authority.generation = 0
    expect((await recoverExecution(g.args)).status).toBe('held')
    expect((await g.service.read()).state.generation).toBe(0)
  })

  it('persists bounded transient retry attempts and refuses policy/deadline resets', async () => {
    const f = await fixture()
    f.args.failure.structuredError = { status: 429 }
    expect((await recoverExecution(f.args)).status).toBe('retry-later')
    expect((await recoverExecution(f.args)).status).toBe('retry-later')
    expect(await recoverExecution(f.args)).toMatchObject({
      status: 'held',
      reason: 'incident-attempt-budget-exhausted',
    })
    expect(f.dispatches()).toBe(0)
    const checkpoints = (await f.service.read()).events.filter(
      (event) => event.kind === 'checkpoint',
    )
    expect(checkpoints).toHaveLength(2)
    f.args.policy.deadlineAt += 1000
    f.args.operation.arguments.recoveryPolicyDigest = recordDigest(f.args.policy)
    expect(await recoverExecution(f.args)).toMatchObject({
      status: 'held',
      reason: 'incident-policy-changed',
    })
  })

  it('cannot checkpoint retries using inferred current writer authority', async () => {
    const f = await fixture()
    f.args.failure.structuredError = { status: 429 }
    delete f.args.recovery.checkpointAuthority
    expect(await recoverExecution(f.args)).toMatchObject({
      status: 'held',
      reason: 'attempt-checkpoint-unavailable',
    })
    expect((await f.service.read()).events.some((event) => event.kind === 'checkpoint')).toBe(false)
  })

  it('requires explicit healthy fallback inventory and matching selector output', async () => {
    const f = await fixture(),
      inspect = f.args.inspectRecoveryContext
    f.args.inspectRecoveryContext = async (context) => {
      const receipt = await inspect(context)
      delete receipt.healthyPlatforms
      return receipt
    }
    expect(await recoverExecution(f.args)).toMatchObject({
      status: 'held',
      reason: 'fallback-policy-or-health-unverified',
    })
    expect(f.dispatches()).toBe(0)
    const g = await fixture()
    g.args.policy.fallback.tierMatrix.balanced['codex:openai-codex'].effort = 'low'
    g.args.operation.arguments.recoveryPolicyDigest = recordDigest(g.args.policy)
    expect(await recoverExecution(g.args)).toMatchObject({
      status: 'held',
      reason: 'fallback-selection-mismatch',
    })
    expect(g.dispatches()).toBe(0)
  })

  it('does not dispatch without a valid typed source grant', async () => {
    const f = await fixture()
    f.args.operationOptions.grantId = 'not-issued'
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(f.dispatches()).toBe(0)
    expect(Object.keys((await f.service.read()).state.admissions)).toHaveLength(0)
  })

  it('bounds unavailable trusted ports without leaking exceptions or dispatching', async () => {
    const f = await fixture()
    f.args.policy.portTimeoutMs = 5
    f.args.operation.arguments.recoveryPolicyDigest = recordDigest(f.args.policy)
    f.args.inspectRecoveryContext = () => new Promise(() => {})
    const result = await recoverExecution(f.args)
    expect(result).toMatchObject({ status: 'held', reason: 'recovery-context-unavailable' })
    expect(f.dispatches()).toBe(0)
  })
})
