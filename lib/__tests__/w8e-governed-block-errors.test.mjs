// W8e / D3 — "Human acceptance is unresolved" matched none of run-delivery.mjs's message regexes
// (`/stale|changed|conflict|Obsolete/`, `/unavailable|ENOENT/`, `/required|blocked|authorized/`), so
// a routine gate block — a human decision owed, not a genuine error — exited as a generic error (2)
// instead of the governed-block code (3). These tests are written FIRST, against the pre-fix code,
// and must fail for that reason: both cases below currently classify as RUN_EXIT_CODES.invalid.
//
// D3 also requires that rewording either message cannot change the exit code. That is only provable
// if classification is driven by an explicit type, not by matching the message text — so these tests
// reword each message and confirm the code does not move.
import { describe, expect, it } from 'vitest'
import { createRunService, GovernedBlockError } from '../application/run-service.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import {
  createAcceptanceContract,
  createAcceptanceDecision,
  createDeliveryReceipt,
} from '../core/role-collaboration.mjs'
import { createRoleHandoff } from '../role-catalog.mjs'
import { classifyDeliveryError, RUN_EXIT_CODES } from '../../scripts/run-delivery.mjs'

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
    resolveContract: async () => ({ verified: true, sourceRevision: 'goal-revision', value: contract }),
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

// Duplicated from lib/__tests__/run-service.test.mjs's `bilateralFixtureOverrides` — the minimum
// wiring needed for `advance()` to clear the human-acceptance and bilateral-collaboration checks and
// reach `verifyCriteria`, where the escalated-gate error is thrown.
function bilateralFixtureOverrides() {
  const bilateral = createAcceptanceContract({
    id: 'handover-policy',
    subject: 'issue:1',
    ownerRole: 'agentflow:product-manager',
    deliveryRole: 'agentflow:product-manager',
    collaborationClass: 'linear',
    candidateDigest: candidate,
    criteria: [
      { id: 'check', description: 'Current evidence', verification: 'deterministic', required: true },
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
  return {
    frozen,
    resolveContract: async () => ({ verified: true, sourceRevision: 'goal-revision', value: frozen }),
    resolveCollaboration: async () => ({
      verified: true,
      sources: { handoff, contract: bilateral, delivery, decision },
    }),
  }
}

describe('governed-block errors carry their exit code as a type, not a message (W8e / D3, test 4)', () => {
  it('"Human acceptance is unresolved" is a GovernedBlockError and classifies to the governed-block code', async () => {
    const { service } = await fixture({ authorize: async ({ kind }) => kind !== 'human-acceptance' })
    let caught = null
    try {
      await service.advance({ contract: {}, authority })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(GovernedBlockError)
    expect(caught.message).toContain('Human acceptance is unresolved')
    expect(classifyDeliveryError(caught)).toBe(RUN_EXIT_CODES.blocked)
    expect(classifyDeliveryError(caught)).not.toBe(RUN_EXIT_CODES.invalid)
  })

  it('an escalated gate is a GovernedBlockError and classifies to the same governed-block code', async () => {
    const { frozen, resolveContract, resolveCollaboration } = bilateralFixtureOverrides()
    const { service } = await fixture({ resolveContract, resolveCollaboration })
    await service.freezeContract({ expectedRevision: (await service.read()).revision, authority })
    await record(service, 'candidate', { digest: candidate })
    const plan = {
      candidateDigest: candidate,
      runRevision: (await service.read()).revision,
      criteria: [
        { ...frozen.criteria[0], allowedOrigins: ['agent-reported'], observationDigest: 'c'.repeat(64) },
      ],
    }
    let caught = null
    try {
      await service.advance({ contract: plan, authority })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(GovernedBlockError)
    expect(caught.message).toContain('agent-escalation')
    expect(classifyDeliveryError(caught)).toBe(RUN_EXIT_CODES.blocked)
  })

  it('rewording either message cannot change the exit code, because classification reads the type, not the text', () => {
    const reworded1 = new GovernedBlockError('A human needs to weigh in before this can continue')
    const reworded2 = new GovernedBlockError('Escalated: please have a person look at this')
    expect(classifyDeliveryError(reworded1)).toBe(RUN_EXIT_CODES.blocked)
    expect(classifyDeliveryError(reworded2)).toBe(RUN_EXIT_CODES.blocked)
    // A plain Error with the SAME reworded text, carrying no type, is not promoted to governed-block
    // by accident — proving the classifier is not secretly still keying off wording.
    expect(classifyDeliveryError(new Error('A human needs to weigh in before this can continue'))).toBe(
      RUN_EXIT_CODES.invalid,
    )
  })
})
