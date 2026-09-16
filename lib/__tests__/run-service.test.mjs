import { describe, it, expect } from 'vitest'
import { createRunService } from '../application/run-service.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import { sealDeliveryRecord } from '../core/delivery-record.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
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
  it('freezes policy before evidence and escalates caller policy weakening to a human gate instead of crashing', async () => {
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
    // The criteria drift is detected, but detecting it and then crashing would waste the
    // detection: it now becomes a durable agent-escalation gate instead of an aborted call.
    const acceptance = await service.verifyCriteria(plan)
    expect(acceptance.status).toBe('escalated')
    expect(acceptance.gate.gateClass).toBe('agent-escalation')
    // W8c2 D2 — the subject is now a digest over the drift itself (drifted criteria + contract +
    // the frozen revision they diverged from), never the bare candidateDigest — binding by candidate
    // alone was the trap D2 closes (see test 3, 4 below).
    expect(acceptance.gate.subjectDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(acceptance.gate.subjectDigest).not.toBe(candidate)
    expect(acceptance.gate.hints.find((h) => h.id === 'refreeze-direction').value).toBe('weakening')
    await expect(service.advance({ contract: plan, authority })).rejects.toThrow('bilateral')
  })

  // W8c2 tests — written FIRST against the pre-fix code and confirmed to fail for the right reason:
  // verifyCriteria never consulted a recorded resolution at all, so test 2 failed with
  // `escalated`, not the expected non-escalated status; test 3 failed because there was no
  // per-drift subject to diverge in the first place (the gate's subject was always the bare
  // candidateDigest, identical for every drift); test 4 failed because an attestation over the
  // candidateDigest WAS exactly what the pre-fix gate's subject was, so it resolved successfully
  // instead of being refused.
  it('2 (W8c2 D3). a human resolution unblocks verifyCriteria on the same drifted plan', async () => {
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
    const escalated = await service.verifyCriteria(plan)
    expect(escalated.status).toBe('escalated')
    const attestation = createReviewAttestation({
      subject: 'escalation resolution',
      reviewedDigest: escalated.gate.subjectDigest,
      reviewer: { platform: 'human', executor: 'human-reviewer', independence: 'human-gate' },
      decision: 'agree',
      timestamp: new Date(0).toISOString(),
    })
    await service.resolveEscalation({
      expectedRevision: (await service.read()).revision,
      authority,
      attestation,
      contract: plan,
    })
    // Same candidate, same criteria — a real caller always re-reads the current revision before the
    // next call, exactly like `next`/`advance` do; the drift itself (what makes the subject) is
    // unchanged.
    const replan = { ...plan, runRevision: (await service.read()).revision }
    const reverified = await service.verifyCriteria(replan)
    expect(reverified.status).not.toBe('escalated')
    expect(reverified.gate).toBeUndefined()
  })

  it('3 (W8c2 D2 trap). a different drift on the same candidate escalates again after a prior resolution', async () => {
    const { service } = await fixture()
    await service.freezeContract({ expectedRevision: (await service.read()).revision, authority })
    await record(service, 'candidate', { digest: candidate })
    const firstPlan = {
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
    const firstEscalation = await service.verifyCriteria(firstPlan)
    expect(firstEscalation.status).toBe('escalated')
    const attestation = createReviewAttestation({
      subject: 'escalation resolution',
      reviewedDigest: firstEscalation.gate.subjectDigest,
      reviewer: { platform: 'human', executor: 'human-reviewer', independence: 'human-gate' },
      decision: 'agree',
      timestamp: new Date(0).toISOString(),
    })
    await service.resolveEscalation({
      expectedRevision: (await service.read()).revision,
      authority,
      attestation,
      contract: firstPlan,
    })
    // A DIFFERENT drift on the SAME candidate: different submitted criteria content.
    const secondPlan = {
      candidateDigest: candidate,
      runRevision: (await service.read()).revision,
      criteria: [
        {
          ...contract.criteria[0],
          allowedOrigins: ['collector-observed'],
          observationDigest: 'c'.repeat(64),
        },
      ],
    }
    const secondEscalation = await service.verifyCriteria(secondPlan)
    expect(secondEscalation.status).toBe('escalated')
    expect(secondEscalation.gate.subjectDigest).not.toBe(firstEscalation.gate.subjectDigest)
  })

  it('4 (W8c2 D2). an attestation over the candidate digest alone does not resolve a drift escalation', async () => {
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
    const escalated = await service.verifyCriteria(plan)
    expect(escalated.status).toBe('escalated')
    expect(escalated.gate.subjectDigest).not.toBe(candidate)
    const attestationOverCandidate = createReviewAttestation({
      subject: 'escalation resolution',
      reviewedDigest: candidate,
      reviewer: { platform: 'human', executor: 'human-reviewer', independence: 'human-gate' },
      decision: 'agree',
      timestamp: new Date(0).toISOString(),
    })
    await expect(
      service.resolveEscalation({
        expectedRevision: (await service.read()).revision,
        authority,
        attestation: attestationOverCandidate,
        contract: plan,
      }),
    ).rejects.toThrow('Escalation not resolved')
  })

  // W8c D5 — DEFECT FIXED. The `agent-escalation` gate class had no path to satisfaction at all:
  // verifyCriteria could raise it but nothing could ever resolve it. resolveEscalation reconstructs
  // the SAME gate deterministically (via verifyCriteria itself — W8c2 D2) and requires a real human
  // attestation (satisfyGate — lib/core/gate.mjs) over the gate's own subject to record a durable
  // resolution.
  //
  // W8c2 D3 — EXTENDED (test 5 in the spec's list). This test used to pass on recording alone: it
  // never called verifyCriteria again after resolution, so it could not have caught defect 2 (a
  // resolved escalation not unblocking the run — confirmed by reproduction: re-running verifyCriteria
  // on the same plan after this exact resolution sequence returned `escalated` again on the pre-fix
  // code). The final block below is the extension: it re-verifies and asserts the run proceeds.
  it('8. an escalated gate is resolved by a human attestation over its subject', async () => {
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
    const acceptance = await service.verifyCriteria(plan)
    expect(acceptance.status).toBe('escalated')
    // W8c2 D2 — the subject is now a drift digest, not the bare candidate (see test 3, 4).
    expect(acceptance.gate.subjectDigest).not.toBe(candidate)
    const driftSubject = acceptance.gate.subjectDigest

    // Wrong subject: refused, exactly like every other gate in this product.
    const wrongSubject = createReviewAttestation({
      subject: 'escalation resolution',
      reviewedDigest: 'd'.repeat(64),
      reviewer: { platform: 'human', executor: 'human-reviewer', independence: 'human-gate' },
      decision: 'agree',
      timestamp: new Date(0).toISOString(),
    })
    await expect(
      service.resolveEscalation({
        expectedRevision: (await service.read()).revision,
        authority,
        attestation: wrongSubject,
        contract: plan,
      }),
    ).rejects.toThrow('Escalation not resolved')

    // Not a human (or not declaring human-gate independence): refused too.
    const notHuman = createReviewAttestation({
      subject: 'escalation resolution',
      reviewedDigest: driftSubject,
      reviewer: { platform: 'codex', executor: 'agent', independence: 'independent' },
      decision: 'agree',
      timestamp: new Date(0).toISOString(),
    })
    await expect(
      service.resolveEscalation({
        expectedRevision: (await service.read()).revision,
        authority,
        attestation: notHuman,
        contract: plan,
      }),
    ).rejects.toThrow('Escalation not resolved')

    // A real human attestation, over the escalation gate's own subject, resolves it — durably.
    const humanAttestation = createReviewAttestation({
      subject: 'escalation resolution',
      reviewedDigest: driftSubject,
      reviewer: { platform: 'human', executor: 'human-reviewer', independence: 'human-gate' },
      decision: 'agree',
      timestamp: new Date(0).toISOString(),
    })
    const resolved = await service.resolveEscalation({
      expectedRevision: (await service.read()).revision,
      authority,
      attestation: humanAttestation,
      contract: plan,
    })
    expect(resolved.status).not.toBe('absent')
    const { events } = await service.read()
    const resolution = events.find((event) => event.payload?.kind === 'escalation-resolved')
    expect(resolution).toBeTruthy()
    expect(resolution.payload.gate.gateClass).toBe('agent-escalation')
    expect(resolution.payload.gate.subjectDigest).toBe(driftSubject)
    expect(resolution.payload.attestation.decision).toBe('agree')

    // EXTENSION (W8c2 spec test 5) — recording the resolution is not enough; the run must actually
    // proceed. Pre-fix, this next call returned `escalated` again (reproduced verbatim: "PROBE status
    // apos resolucao humana: escalated"), leaving a resolved run stuck forever.
    const replan = { ...plan, runRevision: (await service.read()).revision }
    const reverified = await service.verifyCriteria(replan)
    expect(reverified.status).not.toBe('escalated')
    expect(reverified.gate).toBeUndefined()
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
