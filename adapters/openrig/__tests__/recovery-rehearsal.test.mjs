import { describe, expect, it } from 'vitest'
import { classifyExecutionFailure, recoverExecution } from '../recovery.mjs'
import { createRunService } from '../../../lib/application/run-service.mjs'
import { createMemoryRunStore } from '../../../lib/sources/run-store.mjs'
import { createLocalCooperativeIssuer } from '../../../lib/application/local-cooperative-issuer.mjs'
import { createRunEvent } from '../../../lib/core/run-state.mjs'
import { createOracleCustodyReceipt } from '../../../lib/core/oracle-custody.mjs'
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
  const service = createRunService({
    posture: 'autonomous',
    store,
    delegationPolicy,
    clock: () => new Date(nowMs).toISOString(),
    resolveOracleCustody: async (request) => ({
      verified: true,
      receipt: createOracleCustodyReceipt({
        request,
        verifier: 'rehearsal-source',
        verifiedAt: new Date(nowMs).toISOString(),
      }),
    }),
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
  await store.append(
    createRunEvent({
      runId: 'recovery-test',
      id: 'fixture-start',
      kind: 'started',
      payload: {
        goalRef: 'issue:528',
        owner: authority.owner,
        profile: 'high-assurance',
        boundary: 'external-action',
        delegationPolicy,
      },
    }),
    null,
  )
  await service.record(
    'candidate',
    { digest: candidate },
    { expectedRevision: (await service.read()).revision, authority },
  )
  // Synthetic accepted phases are fixture setup, not production phase evidence.
  for (let phase = 0; phase < 3; phase++) {
    const snapshot = await service.read()
    await store.append(
      createRunEvent({
        runId: snapshot.state.runId,
        id: `fixture-phase-${phase}`,
        previousDigest: snapshot.revision,
        kind: 'advanced',
        payload: {
          from: phase,
          to: phase + 1,
          candidateDigest: candidate,
          acceptanceDigest: 'b'.repeat(64),
        },
      }),
      snapshot.revision,
    )
  }
  await service.pinOracle({ digest: 'e'.repeat(64), authority })
  const ref = (name) => ({
    kind: 'validation',
    system: 'github',
    uri: `https://example.invalid/${name}`,
    authority: 'authoritative',
    relationship: 'verifies',
    revision: 'fixture-source-1',
    digest: 'b'.repeat(64),
  })
  await service.recordOracleCustody({
    authority,
    proposal: {
      mode: 'historical-author',
      oracleDigest: 'e'.repeat(64),
      identity: 'independent-test-engineer',
      assignmentRef: ref('assignment'),
      manifestRef: ref('manifest'),
      evidenceRefs: [ref('proof')],
      provenance: { platform: 'pi', executor: 'pi-session' },
    },
  })
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

describe('cross-capability recovery rehearsals (#528)', () => {
  it('holds after generation transfer until active source custody is renewed, despite pre-transfer host booleans', async () => {
    const f = await fixture()
    expect((await f.service.read()).state.oracleCustody.author.generation).toBe(0)
    const result = await recoverExecution(f.args)
    const after = await f.service.read()
    expect(after.state.oracleDigest).toBe('e'.repeat(64))
    expect(after.events.some((event) => event.kind === 'oracle-custody-recorded')).toBe(true)
    expect(f.dispatches()).toBe(0)
    expect(result.status).toBe('held')
    expect(after.state.admissions).toEqual({})
  })
  it('does not repeat ownership transfer after a crash between resume and operation admission', async () => {
    const f = await fixture()
    const execute = f.service.executeDelegatedOperation
    f.service.executeDelegatedOperation = async () => {
      throw new Error('fixture crash before admit')
    }
    await recoverExecution(f.args)
    const transferred = await f.service.read()
    expect(transferred.state.generation).toBe(1)
    expect(transferred.state.admissions).toEqual({})
    f.service.executeDelegatedOperation = execute
    f.args.operationOptions.expectedRevision = transferred.revision
    f.args.operationOptions.authority.generation = 2
    const current = { owner: 'replacement', generation: 1 }
    f.args.recovery.checkpointAuthority = current
    f.args.recovery.reconciliationAuthority = current
    f.args.recovery.authority = current
    const result = await recoverExecution(f.args)
    expect((await f.service.read()).state.generation).toBe(1)
    expect(f.dispatches()).toBe(0)
    expect(result.status).toBe('held')
  })
})
