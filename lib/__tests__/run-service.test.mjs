import { describe, it, expect } from 'vitest'
import { createRunService } from '../application/run-service.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import { sealDeliveryRecord } from '../core/delivery-record.mjs'
import {
  createAcceptanceContract,
  createAcceptanceDecision,
  createDeliveryReceipt,
} from '../core/role-collaboration.mjs'
import { createRoleHandoff } from '../role-catalog.mjs'

const candidate = 'a'.repeat(64),
  definition = 'b'.repeat(64)
const authority = { owner: 'writer', generation: 0 }
const contract = {
  version: 2,
  goalRevision: 'issue-revision',
  criteria: [{ id: 'check', definitionDigest: definition, assertions: ['works'] }],
}
async function fixture(overrides = {}) {
  const store = createMemoryRunStore()
  const ports = {
    store,
    authorize: async () => true,
    resolveContract: async () => ({
      verified: true,
      sourceRevision: 'goal-revision',
      value: contract,
    }),
    ...overrides,
  }
  const service = createRunService(ports)
  await service.start({
    runId: 'demo',
    goalRef: 'issue:1',
    owner: 'writer',
    boundary: 'mutate-worktree',
    authority,
  })
  return { service, store, ports }
}
async function record(service, kind, payload) {
  return service.record(kind, payload, {
    expectedRevision: (await service.read()).revision,
    authority,
  })
}
describe('governed run service', () => {
  it('authorizes cancellation against the paused snapshot and supplies the submitted operation', async () => {
    let observed
    const { service } = await fixture({
      budget: { level: 'provider-enforced', limit: 0 },
      observeUsage: async () => ({ verified: true, used: 0 }),
      authorize: async ({ kind, state }) => kind !== 'safe-stop' || state.status === 'paused',
      requestSafeStop: async (state, context) => {
        observed = { state, context }
        return { verified: true, stopped: true }
      },
    })
    expect((await service.admitAttempt({ authority, estimatedNext: 1 })).safeStop).toBe('confirmed')
    expect(observed.state.status).toBe('paused')
    expect(observed.state.revision).toBe(observed.context.revision)
    expect(observed.state.operations[observed.context.operationId].state).toBe('submitted')
    expect((await service.status()).pendingOperations).toHaveLength(0)
  })
  it('pauses locally even when external cancellation is not authorized', async () => {
    let stopped = false
    const { service } = await fixture({
      authorize: async ({ kind }) => kind !== 'safe-stop',
      budget: { level: 'provider-enforced', limit: 0 },
      observeUsage: async () => ({ verified: true, used: 0 }),
      requestSafeStop: async () => {
        stopped = true
      },
    })
    expect((await service.admitAttempt({ authority, estimatedNext: 1 })).safeStop).toBe(
      'not-authorized',
    )
    expect((await service.status()).status).toBe('paused')
    expect(stopped).toBe(false)
  })
  it('rejects obsolete admission before consulting or stopping a provider', async () => {
    let usageReads = 0,
      stops = 0
    const { service } = await fixture({
      budget: { level: 'provider-enforced', limit: 0 },
      observeUsage: async () => {
        usageReads++
        return { verified: false }
      },
      requestSafeStop: async () => {
        stops++
      },
    })
    await expect(
      service.admitAttempt({ estimatedNext: 1, authority: { owner: 'old', generation: 0 } }),
    ).rejects.toThrow('writer')
    await expect(
      service.admitAttempt({ estimatedNext: 1, authority: { owner: 'writer', generation: 9 } }),
    ).rejects.toThrow('writer')
    expect(usageReads).toBe(0)
    expect(stops).toBe(0)
    expect((await service.status()).status).toBe('active')
  })
  it('preserves a paused checkpoint when provider cancellation fails', async () => {
    const { service } = await fixture({
      budget: { level: 'provider-enforced', limit: 0 },
      observeUsage: async () => ({ verified: true, used: 0 }),
      requestSafeStop: async () => {
        throw new Error('Provider disconnected')
      },
    })
    const result = await service.admitAttempt({ estimatedNext: 1, authority })
    expect(result.admitted).toBe(false)
    expect(result.safeStop).toBe('unknown')
    expect((await service.status()).status).toBe('paused')
    expect((await service.status()).pendingOperations[0].kind).toBe('provider-safe-stop')
    expect((await service.status()).nextAction).toBe('reconcile-operations')
  })
  it('advances a current observed candidate with its actual bilateral acceptance', async () => {
    const bilateral = createAcceptanceContract({
      id: 'handover-policy',
      subject: 'issue:1',
      ownerRole: 'agentflow:product-manager',
      deliveryRole: 'agentflow:product-manager',
      collaborationClass: 'linear',
      candidateDigest: candidate,
      criteria: [
        {
          id: 'check',
          description: 'Current evidence',
          verification: 'deterministic',
          required: true,
        },
      ],
      councilPolicy: { required: false, seats: [], decisionOwner: 'agentflow:product-manager' },
    })
    const handoff = createRoleHandoff({
      id: 'handover',
      subject: 'issue:1',
      state: 'issued',
      fromRole: bilateral.ownerRole,
      toRole: bilateral.deliveryRole,
      acceptanceContract: bilateral,
    })
    const evidenceRef = {
      kind: 'validation',
      system: 'local',
      uri: 'observed:check',
      authority: 'working-copy',
      relationship: 'verifies',
    }
    const delivery = createDeliveryReceipt({
      id: 'delivery',
      handoffDigest: handoff.digest,
      contractDigest: bilateral.digest,
      producerRole: bilateral.deliveryRole,
      candidateDigest: candidate,
      criteriaResults: [{ criterionId: 'check', status: 'pass', evidenceRefs: [evidenceRef] }],
      evidenceRefs: [evidenceRef],
      provenance: { platform: 'codex', executor: 'test-fixture' },
    })
    const decision = createAcceptanceDecision({
      id: 'accepted',
      handoff,
      contract: bilateral,
      delivery,
      decidedByRole: bilateral.ownerRole,
      state: 'accepted',
      provenance: { platform: 'codex', executor: 'test-fixture' },
    })
    const frozen = {
      ...contract,
      ownerRole: bilateral.ownerRole,
      collaborationContractDigest: bilateral.digest,
    }
    const { service } = await fixture({
      resolveContract: async () => ({
        verified: true,
        sourceRevision: 'goal-revision',
        value: frozen,
      }),
      resolveCollaboration: async () => ({
        verified: true,
        sources: { handoff, contract: bilateral, delivery, decision },
      }),
      resolveObservation: async (observation) => ({ verified: true, observation }),
    })
    await service.freezeContract({ expectedRevision: (await service.read()).revision, authority })
    await record(service, 'candidate', { digest: candidate })
    const observation = sealDeliveryRecord('verification-observation', {
      id: 'test',
      invocationId: 'test',
      producer: 'fixture-collector',
      criterionId: 'check',
      candidateDigest: candidate,
      definitionDigest: definition,
      origin: 'collector-observed',
      isolation: 'cooperative',
      outcome: 'pass',
      assertions: [{ id: 'works', outcome: 'pass' }],
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
    })
    await record(service, 'observation', { observation })
    const plan = {
      candidateDigest: candidate,
      runRevision: (await service.read()).revision,
      criteria: [{ ...frozen.criteria[0], observationDigest: observation.digest }],
    }
    expect((await service.advance({ contract: plan, authority })).role).toBe('analyst')
  })
  it('denies false or unknown authorization', async () => {
    for (const verdict of [false, undefined, null]) {
      const service = createRunService({
        store: createMemoryRunStore(),
        authorize: async () => verdict,
      })
      await expect(
        service.start({ runId: 'demo', goalRef: 'issue:1', owner: 'writer' }),
      ).rejects.toThrow('authorized')
      expect((await service.status()).status).toBe('absent')
    }
  })
  it('rejects stale writer generations and arbitrary rework clearing', async () => {
    const { service } = await fixture()
    const options = {
      expectedRevision: (await service.read()).revision,
      authority: { ...authority, generation: 1 },
    }
    await expect(service.record('checkpoint', {}, options)).rejects.toThrow('generation')
    await expect(service.record('rework-resolved', { id: 'finding' }, options)).rejects.toThrow(
      'governed',
    )
  })
  it('freezes policy before evidence and rejects caller policy weakening', async () => {
    const { service } = await fixture()
    await service.freezeContract({ expectedRevision: (await service.read()).revision, authority })
    await record(service, 'candidate', { digest: candidate })
    const plan = {
      candidateDigest: candidate,
      runRevision: (await service.read()).revision,
      criteria: [
        {
          ...contract.criteria[0],
          allowedOrigins: ['agent-reported'],
          observationDigest: 'c'.repeat(64),
        },
      ],
    }
    await expect(service.verifyCriteria(plan)).rejects.toThrow('cannot be changed')
    await expect(service.advance({ contract: plan, authority })).rejects.toThrow('bilateral')
  })
  it('invalidates evidence when a recovered workspace has changed', async () => {
    const { service } = await fixture({
      observeWriter: async () => ({ stopped: true }),
      observeWorkspace: async () => ({ verified: true, candidateDigest: 'c'.repeat(64) }),
    })
    await record(service, 'candidate', { digest: candidate })
    const plan = await service.recoveryPlan({
      owner: 'replacement',
      boundary: 'mutate-worktree',
      writer: { host: 'test', pid: 123, instance: 'replacement' },
    })
    await service.resume({ plan, authority: { owner: 'replacement', generation: 0 } })
    expect((await service.read()).state.candidateDigest).toBeNull()
  })
  it('rejects a source change during recovery inspection', async () => {
    let interfere = false,
      store
    const { service, store: initial } = await fixture({
      observeWriter: async () => {
        if (interfere) {
          const current = await store.read()
          await store.append(
            createRunEvent({
              runId: 'demo',
              id: 'concurrent',
              previousDigest: current.revision,
              kind: 'checkpoint',
            }),
            current.revision,
          )
        }
        return { stopped: true }
      },
      observeWorkspace: async () => ({ verified: true, candidateDigest: null }),
    })
    store = initial
    const plan = await service.recoveryPlan({
      owner: 'replacement',
      boundary: 'mutate-worktree',
      writer: { host: 'test', pid: 123, instance: 'replacement' },
    })
    interfere = true
    await expect(
      service.resume({ plan, authority: { owner: 'replacement', generation: 0 } }),
    ).rejects.toThrow('changed')
    expect((await service.read()).state.generation).toBe(0)
  })
  it('does not accept forged or stale source observations', async () => {
    const { service } = await fixture({
      resolveObservation: async (observation) => ({ verified: false, observation }),
    })
    await service.freezeContract({ expectedRevision: (await service.read()).revision, authority })
    await record(service, 'candidate', { digest: candidate })
    const observation = sealDeliveryRecord('verification-observation', {
      id: 'id',
      invocationId: 'id',
      producer: 'claimed',
      criterionId: 'check',
      candidateDigest: candidate,
      definitionDigest: definition,
      origin: 'collector-observed',
      isolation: 'cooperative',
      outcome: 'pass',
      assertions: [{ id: 'works', outcome: 'pass' }],
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
    })
    await record(service, 'observation', { observation })
    expect(
      (
        await service.verifyCriteria({
          candidateDigest: candidate,
          runRevision: (await service.read()).revision,
          criteria: [{ ...contract.criteria[0], observationDigest: observation.digest }],
        })
      ).status,
    ).toBe('blocked')
  })
})
