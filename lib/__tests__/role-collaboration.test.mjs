import { describe, expect, it } from 'vitest'
import { createRoleHandoff } from '../role-catalog.mjs'
import {
  classifyRoleCollaboration,
  createAcceptanceContract,
  createAcceptanceDecision,
  createCouncilAdvice,
  createCouncilRequest,
  createCouncilSynthesis,
  createDeliveryReceipt,
  createReworkRequest,
  selectCouncilSeats,
  validateAcceptanceContract,
  validateAcceptanceDecision,
  validateCouncilRecord,
  validateDeliveryReceipt,
  validateReworkRequest,
  verifyRoleDelivery,
  verifyRoleAdvance,
} from '../core/role-collaboration.mjs'

const digest = (character) => character.repeat(64)
const evidenceRef = {
  kind: 'validation',
  system: 'local',
  uri: '.agent-runs/validation.json',
  authority: 'working-copy',
  relationship: 'verifies',
}

function acceptanceContract(overrides = {}) {
  return createAcceptanceContract({
    id: 'acceptance-1',
    subject: 'issue:188',
    ownerRole: 'agentflow:implementation-planner',
    deliveryRole: 'agentflow:developer',
    collaborationClass: 'bilateral',
    candidateDigest: digest('a'),
    criteria: [
      {
        id: 'planned-files',
        description: 'changed files stay within the implementation plan',
        verification: 'deterministic',
        required: true,
      },
      {
        id: 'design-intent',
        description: 'implementation preserves the design intent',
        verification: 'semantic',
        required: true,
      },
    ],
    councilPolicy: {
      required: false,
      seats: [],
      decisionOwner: 'agentflow:implementation-planner',
    },
    ...overrides,
  })
}

function delivery(contract, overrides = {}) {
  return createDeliveryReceipt({
    id: 'delivery-1',
    handoffDigest: handoff(contract).digest,
    contractDigest: contract.digest,
    producerRole: contract.deliveryRole,
    candidateDigest: contract.candidateDigest,
    criteriaResults: [
      { criterionId: 'planned-files', status: 'pass', evidenceRefs: [evidenceRef] },
      { criterionId: 'design-intent', status: 'pass', evidenceRefs: [evidenceRef] },
    ],
    evidenceRefs: [evidenceRef],
    provenance: { platform: 'codex', executor: 'codex-cli' },
    ...overrides,
  })
}

function handoff(contract, overrides = {}) {
  return createRoleHandoff({
    id: 'handoff-1',
    subject: contract.subject,
    state: 'issued',
    fromRole: contract.ownerRole,
    toRole: contract.deliveryRole,
    acceptanceContract: contract,
    ...overrides,
  })
}

describe('role collaboration protocol', () => {
  it('classifies collaboration through explicit complexity triggers', () => {
    expect(
      classifyRoleCollaboration({ profile: 'bounded', risk: 'low', uncertainty: 'low' }),
    ).toMatchObject({ class: 'linear' })
    expect(classifyRoleCollaboration({ publicContract: true })).toMatchObject({
      class: 'council',
      triggers: ['public-contract'],
    })
    expect(classifyRoleCollaboration({ changeSurface: ['security'] })).toMatchObject({
      class: 'human-gated',
    })
  })

  it('keeps council seats role-based and excludes the accountable owner', () => {
    const seats = selectCouncilSeats({
      ownerRole: 'agentflow:architect',
      publicContract: true,
      changeSurface: ['docs'],
    })
    expect(seats.map((item) => item.role)).not.toContain('agentflow:architect')
    expect(seats.map((item) => item.role)).toEqual(
      expect.arrayContaining(['agentflow:analyst', 'agentflow:developer', 'agentflow:tester']),
    )
  })

  it('allows project policy to tune thresholds and council seats without changing taxonomy', () => {
    expect(
      classifyRoleCollaboration({
        domains: ['api', 'data'],
        policy: { councilDomainThreshold: 2 },
      }),
    ).toMatchObject({ class: 'council', triggers: ['cross-domain'] })
    expect(
      selectCouncilSeats({
        ownerRole: 'agentflow:architect',
        policy: {
          councilSeats: [
            { role: 'agentflow:architect', focus: 'owner', required: true },
            { role: 'agentflow:analyst', focus: 'business semantics', required: true },
          ],
        },
      }),
    ).toEqual([{ role: 'agentflow:analyst', focus: 'business semantics', required: true }])
  })

  it('rejects malformed role-collaboration policy', () => {
    expect(() => classifyRoleCollaboration({ policy: { councilDomainThreshold: 0 } })).toThrow(
      'councilDomainThreshold must be a positive integer',
    )
  })

  it('verifies objective criteria before requesting semantic acceptance', () => {
    const contract = acceptanceContract()
    const receipt = delivery(contract)
    expect(validateAcceptanceContract(contract)).toEqual({ ok: true, errors: [] })
    expect(validateDeliveryReceipt(receipt).ok).toBe(true)
    const report = verifyRoleDelivery({
      handoff: handoff(contract),
      contract,
      delivery: receipt,
    })
    expect(report.status).toBe('semantic-review-required')
    const decision = createAcceptanceDecision({
      id: 'decision-1',
      handoff: handoff(contract),
      contract,
      delivery: receipt,
      handoffDigest: handoff(contract).digest,
      contractDigest: contract.digest,
      deliveryDigest: receipt.digest,
      decidedByRole: contract.ownerRole,
      state: 'accepted',
      deterministicReport: report,
      semanticFindings: [
        {
          criterionId: 'design-intent',
          status: 'pass',
          reason: 'design constraints are preserved',
        },
      ],
      provenance: { platform: 'codex' },
    })
    expect(validateAcceptanceDecision(decision)).toEqual({ ok: true, errors: [] })
  })

  it('rejects stale candidates and emits a digest-bound rework request', () => {
    const contract = acceptanceContract()
    const receipt = delivery(contract, { candidateDigest: digest('c') })
    const report = verifyRoleDelivery({
      handoff: handoff(contract),
      contract,
      delivery: receipt,
    })
    expect(report.status).toBe('fail')
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'candidate-binding', status: 'fail' }),
    )
    const decision = createAcceptanceDecision({
      id: 'decision-2',
      handoff: handoff(contract),
      contract,
      delivery: receipt,
      handoffDigest: handoff(contract).digest,
      contractDigest: contract.digest,
      deliveryDigest: receipt.digest,
      decidedByRole: contract.ownerRole,
      state: 'rework-required',
      deterministicReport: report,
      provenance: { platform: 'codex' },
    })
    const rework = createReworkRequest({
      id: 'rework-1',
      acceptanceDecisionDigest: decision.digest,
      ownerRole: contract.ownerRole,
      deliveryRole: contract.deliveryRole,
      failedCriteria: ['candidate-binding'],
      requiredChanges: ['resubmit evidence for the current candidate digest'],
      evidenceDigest: receipt.digest,
    })
    expect(validateReworkRequest(rework)).toEqual({ ok: true, errors: [] })
  })

  it('requires a complete council synthesis for council-class acceptance', () => {
    const seats = selectCouncilSeats({ ownerRole: 'agentflow:implementation-planner' })
    const contract = acceptanceContract({
      collaborationClass: 'council',
      councilPolicy: {
        required: true,
        seats,
        decisionOwner: 'agentflow:implementation-planner',
      },
    })
    const request = createCouncilRequest({
      id: 'council-1',
      subject: contract.subject,
      ownerRole: contract.ownerRole,
      question: 'Is the delivery acceptable across the affected system?',
      evidenceDigest: delivery(contract).digest,
      seats,
    })
    const advice = seats.map((seat, index) =>
      createCouncilAdvice({
        id: `advice-${index}`,
        requestDigest: request.digest,
        role: seat.role,
        position: 'accept with current deterministic evidence',
        evidenceRefs: [evidenceRef],
        confidence: 'high',
      }),
    )
    const synthesis = createCouncilSynthesis({
      id: 'synthesis-1',
      requestDigest: request.digest,
      ownerRole: contract.ownerRole,
      adviceDigests: advice.map((item) => item.digest),
      decision: 'accept after semantic owner review',
    })
    expect(validateCouncilRecord(request).ok).toBe(true)
    expect(advice.every((item) => validateCouncilRecord(item).ok)).toBe(true)
    expect(validateCouncilRecord(synthesis).ok).toBe(true)
    const report = verifyRoleDelivery({
      handoff: handoff(contract),
      contract,
      delivery: delivery(contract),
      councilRequest: request,
      councilAdvice: advice,
      councilSynthesis: synthesis,
    })
    expect(report.status).toBe('semantic-review-required')
    expect(
      verifyRoleDelivery({
        handoff: handoff(contract),
        contract,
        delivery: delivery(contract),
        councilRequest: request,
        councilAdvice: advice.slice(1),
        councilSynthesis: synthesis,
      }).status,
    ).toBe('fail')
    const challengedAdvice = [
      createCouncilAdvice({
        ...advice[0],
        objections: [{ id: 'risk-1', description: 'contract ambiguity', blocking: true }],
      }),
      ...advice.slice(1),
    ]
    for (const [disposition, expected] of [
      [null, 'fail'],
      ['unresolved', 'fail'],
      ['deferred-with-owner', 'fail'],
      ['rejected-with-reason', 'semantic-review-required'],
      ['accepted', 'semantic-review-required'],
    ]) {
      const challengedSynthesis = createCouncilSynthesis({
        id: 'challenged-synthesis',
        requestDigest: request.digest,
        ownerRole: contract.ownerRole,
        adviceDigests: challengedAdvice.map((item) => item.digest),
        decision: 'owner decision',
        objectionDispositions: disposition
          ? [
              {
                adviceDigest: challengedAdvice[0].digest,
                objectionId: 'risk-1',
                blocking: true,
                disposition,
                reason: 'owner reviewed the contract evidence',
              },
            ]
          : [],
      })
      expect(
        verifyRoleDelivery({
          handoff: handoff(contract),
          contract,
          delivery: delivery(contract),
          councilRequest: request,
          councilAdvice: challengedAdvice,
          councilSynthesis: challengedSynthesis,
        }).status,
      ).toBe(expected)
    }
  })

  it('rejects missing semantic acceptance, stale reports, and a different decision owner', () => {
    const contract = acceptanceContract()
    const receipt = delivery(contract)
    const report = verifyRoleDelivery({ handoff: handoff(contract), contract, delivery: receipt })
    const input = {
      handoff: handoff(contract),
      contract,
      delivery: receipt,
      id: 'decision-negative',
      handoffDigest: handoff(contract).digest,
      contractDigest: contract.digest,
      deliveryDigest: receipt.digest,
      decidedByRole: contract.ownerRole,
      state: 'accepted',
      deterministicReport: report,
      semanticFindings: [{ criterionId: 'design-intent', status: 'pass', reason: 'reviewed' }],
      provenance: { platform: 'codex' },
    }
    expect(() => createAcceptanceDecision({ ...input, semanticFindings: [] })).toThrow(
      'semantic criterion',
    )
    expect(() =>
      createAcceptanceDecision({ ...input, decidedByRole: 'agentflow:developer' }),
    ).toThrow('handover owner')
    expect(() => createAcceptanceDecision({ ...input, deliveryDigest: digest('d') })).toThrow(
      'deliveryDigest',
    )
    expect(() =>
      createAcceptanceDecision({ ...input, deterministicReport: { ...report, checks: [] } }),
    ).toThrow('recomputed')
    expect(() =>
      createAcceptanceDecision({ ...input, deterministicReport: { status: 'pass' } }),
    ).toThrow('recomputed')
  })

  it('rejects superseded handovers and blocked deliveries', () => {
    const contract = acceptanceContract()
    expect(
      verifyRoleDelivery({
        handoff: handoff(contract, { state: 'superseded' }),
        contract,
        delivery: delivery(contract),
      }).status,
    ).toBe('fail')
    expect(
      verifyRoleDelivery({
        handoff: handoff(contract),
        contract,
        delivery: delivery(contract, { status: 'blocked' }),
      }).status,
    ).toBe('fail')
  })

  it('blocks advancement on rework, rejection, conditional acceptance, and stale evidence', () => {
    const contract = acceptanceContract()
    const sources = { handoff: handoff(contract), contract, delivery: delivery(contract) }
    const input = {
      ...sources,
      id: 'advance-decision',
      decidedByRole: contract.ownerRole,
      state: 'accepted',
      semanticFindings: [{ criterionId: 'design-intent', status: 'pass', reason: 'reviewed' }],
      provenance: { platform: 'codex' },
    }
    const decision = createAcceptanceDecision(input)
    expect(verifyRoleAdvance({ ...sources, decision, openReworkRequests: [] }).ok).toBe(true)
    expect(
      verifyRoleAdvance({ ...sources, decision, openReworkRequests: [{ id: 'open-rework' }] }).ok,
    ).toBe(false)
    expect(
      verifyRoleAdvance({
        ...sources,
        decision,
        delivery: delivery(contract, { candidateDigest: digest('e') }),
        openReworkRequests: [],
      }).ok,
    ).toBe(false)
    for (const state of ['rejected', 'accepted-with-conditions']) {
      const conditional = createAcceptanceDecision({
        ...input,
        state,
        conditions: ['resolve the remaining contract note'],
      })
      expect(
        verifyRoleAdvance({ ...sources, decision: conditional, openReworkRequests: [] }).ok,
      ).toBe(false)
    }
  })

  it('requires current human approval evidence for human-gated acceptance', () => {
    const ownerRole = 'agentflow:implementation-planner'
    const seats = [{ role: 'agentflow:tester', focus: 'safety evidence', required: true }]
    const contract = acceptanceContract({
      collaborationClass: 'human-gated',
      councilPolicy: { required: true, seats, decisionOwner: ownerRole },
    })
    const receipt = delivery(contract)
    const request = createCouncilRequest({
      id: 'human-council',
      subject: contract.subject,
      ownerRole,
      question: 'Is the evidence sufficient?',
      evidenceDigest: receipt.digest,
      seats,
    })
    const advice = [
      createCouncilAdvice({
        id: 'human-advice',
        requestDigest: request.digest,
        role: seats[0].role,
        position: 'accept',
        evidenceRefs: [evidenceRef],
      }),
    ]
    const synthesis = createCouncilSynthesis({
      id: 'human-synthesis',
      requestDigest: request.digest,
      ownerRole,
      adviceDigests: advice.map((item) => item.digest),
      decision: 'request human approval',
    })
    const input = {
      id: 'human-decision',
      handoff: handoff(contract),
      contract,
      delivery: receipt,
      councilRequest: request,
      councilAdvice: advice,
      councilSynthesis: synthesis,
      decidedByRole: ownerRole,
      state: 'accepted',
      semanticFindings: [{ criterionId: 'design-intent', status: 'pass', reason: 'reviewed' }],
      provenance: { platform: 'codex' },
    }
    expect(() => createAcceptanceDecision(input)).toThrow('human approval evidence')
    const humanApproval = {
      approved: true,
      actor: 'project-owner',
      actorType: 'human',
      deliveryDigest: receipt.digest,
      evidenceRef,
    }
    expect(createAcceptanceDecision({ ...input, humanApproval }).state).toBe('accepted')
    expect(() =>
      createAcceptanceDecision({
        ...input,
        humanApproval: { ...humanApproval, deliveryDigest: digest('f') },
      }),
    ).toThrow('human approval evidence')
  })
})
