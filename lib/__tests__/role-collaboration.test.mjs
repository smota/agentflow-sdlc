import { describe, expect, it } from 'vitest'
import { createRoleHandoff, validateRoleHandoff } from '../role-catalog.mjs'
import { phaseZeroCollaboration } from './phase-zero-bootstrap.mjs'
import {
  CRITERION_SEVERITIES,
  DEFAULT_MAX_REWORK_ROUNDS,
  SEMANTIC_FINDING_STATUSES,
  classifyRoleCollaboration,
  createAcceptanceContract,
  createAcceptanceDecision,
  createCouncilAdvice,
  createCouncilRequest,
  createCouncilSynthesis,
  createDeliveryReceipt,
  createReworkRequest,
  createUnfreezeResolution,
  selectCouncilSeats,
  unfreezeLedger,
  validateAcceptanceContract,
  validateAcceptanceDecision,
  validateCouncilRecord,
  validateDeliveryReceipt,
  validateReworkRequest,
  validateRoleCollaborationPolicy,
  verifyRoleDelivery,
  verifyRoleAdvance,
} from '../core/role-collaboration.mjs'
import { recordDigest } from '../core/record-digest.mjs'

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

  it('advances a catalog-valid phase-0 handoff and does not accept a self-handoff', () => {
    const records = phaseZeroCollaboration({
      subject: 'issue:1',
      candidateDigest: digest('a'),
    })
    expect(records.contract.ownerRole).toBe('agentflow:requester')
    expect(records.contract.deliveryRole).toBe('agentflow:product-manager')
    expect(validateRoleHandoff({ handoff: records.handoff }).ok).toBe(true)
    const sources = {
      handoff: records.handoff,
      contract: records.contract,
      delivery: records.delivery,
    }
    expect(verifyRoleDelivery(sources).status).toBe('pass')
    expect(
      verifyRoleAdvance({ ...sources, decision: records.decision, openReworkRequests: [] }).ok,
    ).toBe(true)

    const self = phaseZeroCollaboration({
      subject: 'issue:1',
      candidateDigest: digest('a'),
      fromRole: 'agentflow:product-manager',
      toRole: 'agentflow:product-manager',
      id: 'self',
    })
    const rejected = validateRoleHandoff({ handoff: self.handoff })
    expect(rejected.ok).toBe(false)
    expect(rejected.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'handoff.transition' })]),
    )
  })

  it('validates criterion severity and role collaboration policy maxReworkRounds', () => {
    expect(CRITERION_SEVERITIES).toEqual(['blocking', 'advisory'])
    expect(SEMANTIC_FINDING_STATUSES).toEqual(['pass', 'fail', 'observation', 'unverified'])
    expect(DEFAULT_MAX_REWORK_ROUNDS).toBe(2)

    const contractWithSeverities = acceptanceContract({
      criteria: [
        {
          id: 'crit-blocking',
          description: 'must pass',
          verification: 'semantic',
          required: true,
          severity: 'blocking',
        },
        {
          id: 'crit-advisory',
          description: 'observation only',
          verification: 'semantic',
          required: true,
          severity: 'advisory',
        },
      ],
    })
    expect(validateAcceptanceContract(contractWithSeverities).ok).toBe(true)

    const invalidContract = acceptanceContract({
      criteria: [
        {
          id: 'crit-invalid',
          description: 'bad severity',
          verification: 'semantic',
          required: true,
          severity: 'critical',
        },
      ],
    })
    const invalidRes = validateAcceptanceContract(invalidContract)
    expect(invalidRes.ok).toBe(false)
    expect(invalidRes.errors).toContain('criteria[0].severity is invalid')

    expect(validateRoleCollaborationPolicy({ maxReworkRounds: 2 }).ok).toBe(true)
    expect(validateRoleCollaborationPolicy({ maxReworkRounds: 0 }).ok).toBe(false)
    expect(validateRoleCollaborationPolicy({ maxReworkRounds: 'two' }).ok).toBe(false)
  })

  it('permits advisory semantic criteria to have observation findings without blocking acceptance', () => {
    const contract = createAcceptanceContract({
      id: 'acceptance-advisory-test',
      subject: 'issue:436',
      ownerRole: 'agentflow:architect',
      deliveryRole: 'agentflow:developer',
      collaborationClass: 'bilateral',
      candidateDigest: digest('b'),
      criteria: [
        {
          id: 'core-spec',
          description: 'core requirements pass',
          verification: 'semantic',
          required: true,
          severity: 'blocking',
        },
        {
          id: 'exploratory-limits',
          description: 'exploratory edge case observations',
          verification: 'semantic',
          required: true,
          severity: 'advisory',
        },
      ],
    })
    const h = handoff(contract)
    const d = delivery(contract)
    const report = verifyRoleDelivery({ handoff: h, contract, delivery: d })
    expect(report.status).toBe('semantic-review-required')
    expect(report.semanticCriteria).toEqual(['core-spec'])
    expect(report.advisorySemanticCriteria).toEqual(['exploratory-limits'])

    // Passing decision with observation on advisory criterion
    const decisionWithObservation = createAcceptanceDecision({
      id: 'decision-obs',
      handoff: h,
      contract,
      delivery: d,
      decidedByRole: contract.ownerRole,
      state: 'accepted',
      semanticFindings: [
        { criterionId: 'core-spec', status: 'pass', reason: 'specification fully implemented' },
        {
          criterionId: 'exploratory-limits',
          status: 'observation',
          reason: 'disclosed edge case limit documented',
        },
      ],
    })
    expect(decisionWithObservation.state).toBe('accepted')
    expect(validateAcceptanceDecision(decisionWithObservation).ok).toBe(true)

    // Verify advancement succeeds with observation finding
    const advanceRes = verifyRoleAdvance({
      handoff: h,
      contract,
      delivery: d,
      decision: decisionWithObservation,
      openReworkRequests: [],
    })
    expect(advanceRes.ok).toBe(true)

    // Unverified finding on advisory criterion is also accepted
    const decisionWithUnverified = createAcceptanceDecision({
      id: 'decision-unverified',
      handoff: h,
      contract,
      delivery: d,
      decidedByRole: contract.ownerRole,
      state: 'accepted',
      semanticFindings: [
        { criterionId: 'core-spec', status: 'pass', reason: 'specification fully implemented' },
        {
          criterionId: 'exploratory-limits',
          status: 'unverified',
          reason: 'deferred to integration environment',
        },
      ],
    })
    expect(validateAcceptanceDecision(decisionWithUnverified).ok).toBe(true)

    // Missing advisory finding also does not fail validation (advisory is non-blocking)
    const decisionWithoutAdvisory = createAcceptanceDecision({
      id: 'decision-no-advisory',
      handoff: h,
      contract,
      delivery: d,
      decidedByRole: contract.ownerRole,
      state: 'accepted',
      semanticFindings: [
        { criterionId: 'core-spec', status: 'pass', reason: 'specification fully implemented' },
      ],
    })
    expect(validateAcceptanceDecision(decisionWithoutAdvisory).ok).toBe(true)

    // Blocking criterion failure still fails validation
    expect(() =>
      createAcceptanceDecision({
        id: 'decision-blocking-failed',
        handoff: h,
        contract,
        delivery: d,
        decidedByRole: contract.ownerRole,
        state: 'accepted',
        semanticFindings: [
          { criterionId: 'core-spec', status: 'fail', reason: 'missing core feature' },
          { criterionId: 'exploratory-limits', status: 'observation', reason: 'disclosed limit' },
        ],
      }),
    ).toThrow('all semantic findings must pass')
  })

  it('derives rework rounds from the ledger and fences the epoch when the breaker trips', () => {
    const contract = acceptanceContract()
    const fields = {
      acceptanceDecisionDigest: digest('d'),
      ownerRole: contract.ownerRole,
      deliveryRole: contract.deliveryRole,
      failedCriteria: ['core-spec'],
      requiredChanges: ['fix core spec'],
      evidenceDigest: digest('e'),
    }
    const ledger0 = { currentRound: 0, fencingToken: 0, rounds: [], frozen: false }

    expect(() =>
      createReworkRequest({ ...fields, id: 'client-round', round: 1, ledger: ledger0 }),
    ).toThrow('client-provided rework round is rejected')
    expect(() => createReworkRequest({ ...fields, id: 'client-iteration', iteration: 2 })).toThrow(
      'client-provided rework round is rejected',
    )

    const rework1 = createReworkRequest({ ...fields, id: 'rework-round-1', ledger: ledger0 })
    expect(rework1.round).toBe(1)
    expect(validateReworkRequest(rework1).ok).toBe(true)

    const ledger1 = { ...ledger0, currentRound: 1, rounds: [{ round: 1 }] }
    const rework2 = createReworkRequest({ ...fields, id: 'rework-round-2', ledger: ledger1 })
    expect(rework2.round).toBe(2)
    expect(validateReworkRequest(rework2).ok).toBe(true)

    const fromHistory = createReworkRequest({
      ...fields,
      id: 'rework-history',
      ledger: { currentRound: 0, fencingToken: 0, rounds: [{ round: 1 }], frozen: false },
    })
    expect(fromHistory.round).toBe(2)

    const forged = { ...rework2, round: 3, digest: '' }
    forged.digest = recordDigest(forged)
    const forgedValidation = validateReworkRequest(forged, { maxReworkRounds: 9 })
    expect(forgedValidation.ok).toBe(false)
    expect(forgedValidation.errors).toContain('rework round 3 is past the circuit breaker')
    expect(forgedValidation.errors.join(' ')).not.toContain('escalation required')

    const ledger2 = {
      currentRound: 2,
      fencingToken: 4,
      rounds: [{ round: 1 }, { round: 2 }],
      frozen: false,
      targetIdentityDigest: digest('a'),
    }
    let tripped = null
    try {
      createReworkRequest({ ...fields, id: 'rework-round-3', ledger: ledger2 })
    } catch (error) {
      tripped = error
    }
    expect(tripped).toBeInstanceOf(Error)
    expect(tripped.message).toBe('rework circuit breaker tripped')
    expect(tripped.message).not.toContain('escalation required')
    expect(tripped.ledger.frozen).toBe(true)
    expect(tripped.ledger.fencingToken).toBe(5)
    expect(tripped.ledger.currentRound).toBe(2)
    expect(tripped.packet.type).toBe('reverse-seam-packet')
    expect(tripped.packet.triggerCondition).toBe('rework-exhausted')
    expect(tripped.packet.fencingToken).toBe(5)
    expect(() =>
      createReworkRequest({ ...fields, id: 'after-freeze', ledger: tripped.ledger }),
    ).toThrow('rework is rejected on a frozen ledger')
    expect(tripped.ledger.fencingToken).toBe(5)

    const h = handoff(contract)
    const d = delivery(contract)
    const decision = createAcceptanceDecision({
      id: 'dec-test',
      handoff: h,
      contract,
      delivery: d,
      decidedByRole: contract.ownerRole,
      state: 'accepted',
      semanticFindings: [{ criterionId: 'design-intent', status: 'pass', reason: 'ok' }],
    })
    const advanceResult = verifyRoleAdvance({
      handoff: h,
      contract,
      delivery: d,
      decision,
      openReworkRequests: [],
      ledger: tripped.ledger,
      commit: { fencingToken: 4 },
    })
    expect(advanceResult.ok).toBe(false)
    expect(advanceResult.errors).toContain('phase advancement is rejected on a frozen ledger')
    expect(advanceResult.errors).toContain(
      'commit or transition authored after the fencing token is rejected',
    )
    expect(advanceResult.errors.join(' ')).not.toContain('escalation required')

    const openAdvance = verifyRoleAdvance({
      handoff: h,
      contract,
      delivery: d,
      decision,
      openReworkRequests: [],
      ledger: ledger0,
      commit: { fencingToken: 0 },
    })
    expect(openAdvance.ok).toBe(true)
  })

  it('maps accept_and_register to accepted-with-conditions only without blockers, a tripped breaker, or a sensitive surface', () => {
    const contract = acceptanceContract()
    const h = handoff(contract)
    const d = delivery(contract)
    const followUp = {
      issueUrl: 'https://github.com/smota/agentflow-sdlc/issues/461',
      note: 'non-blocking telemetry discrepancy',
    }
    const decision = createAcceptanceDecision({
      id: 'accept-and-register',
      handoff: h,
      contract,
      delivery: d,
      decidedByRole: contract.ownerRole,
      state: 'accepted-with-conditions',
      conditions: [followUp],
      semanticFindings: [{ criterionId: 'design-intent', status: 'pass', reason: 'ok' }],
    })
    const ledger = { frozen: false, findingsLedger: {} }
    const base = {
      handoff: h,
      contract,
      delivery: d,
      decision,
      openReworkRequests: [],
      ledger,
      changeSurface: ['docs'],
    }
    expect(verifyRoleAdvance(base).ok).toBe(true)

    const missingUrl = createAcceptanceDecision({
      id: 'accept-and-register-no-url',
      handoff: h,
      contract,
      delivery: d,
      decidedByRole: contract.ownerRole,
      state: 'accepted-with-conditions',
      conditions: ['resolve the remaining contract note'],
      semanticFindings: [{ criterionId: 'design-intent', status: 'pass', reason: 'ok' }],
    })
    expect(verifyRoleAdvance({ ...base, decision: missingUrl }).errors.join(' ')).toContain(
      'idempotent GitHub follow-up issue URL',
    )

    expect(
      verifyRoleAdvance({
        ...base,
        ledger: {
          frozen: false,
          findingsLedger: {
            f1: { initialSeverity: 'blocker', severity: 'nit', description: 'downgraded' },
          },
        },
      }).errors,
    ).toContain(
      'accept_and_register is rejected because a finding was initially logged as [B] Blocker',
    )

    expect(
      verifyRoleAdvance({ ...base, ledger: { frozen: true, findingsLedger: {} } }).errors,
    ).toContain('accept_and_register is rejected while the circuit breaker is tripped')

    for (const surface of ['auth', 'crypto', 'migration', 'billing']) {
      expect(verifyRoleAdvance({ ...base, changeSurface: [surface] }).errors).toContain(
        'accept_and_register is rejected on a sensitive surface',
      )
    }
  })

  it('clears a frozen ledger only with a signed unfreeze resolution for the next fencing token', () => {
    const frozen = {
      currentRound: 2,
      fencingToken: 5,
      frozen: true,
      rounds: [{ round: 1 }, { round: 2 }],
    }
    expect(() => unfreezeLedger(frozen, { resolution: 're-scope' })).toThrow(
      /signed unfreeze resolution/,
    )
    expect(() =>
      createUnfreezeResolution({
        resolution: 'rewrite',
        actor: 'pm.analyst',
        rationale: 'not in the closed set',
        fencingToken: 6,
      }),
    ).toThrow(/resolution must be re-scope/)
    expect(() =>
      unfreezeLedger(
        { ...frozen, frozen: false },
        createUnfreezeResolution({
          resolution: 'abandonment',
          actor: 'orch.arch',
          rationale: 'stop the slice',
          fencingToken: 6,
        }),
      ),
    ).toThrow('ledger is not frozen')

    const stale = createUnfreezeResolution({
      resolution: 'person-waiver',
      actor: 'person',
      rationale: 'waive this fence only',
      fencingToken: 5,
    })
    expect(() => unfreezeLedger(frozen, stale)).toThrow(/next epoch token/)

    const signed = createUnfreezeResolution({
      resolution: 're-scope',
      actor: 'pm.analyst',
      rationale: 'return to phase 1',
      fencingToken: 6,
    })
    const opened = unfreezeLedger(frozen, signed)
    expect(opened.frozen).toBe(false)
    expect(opened.fencingToken).toBe(6)
    expect(opened.unfreezeResolutionDigest).toBe(signed.digest)
    expect(frozen.frozen).toBe(true)
    expect(frozen.fencingToken).toBe(5)
  })
})
