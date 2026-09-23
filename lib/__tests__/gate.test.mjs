import { describe, expect, it } from 'vitest'
import {
  GATE_CLASSES,
  createGate,
  deriveCrossings,
  resolveRefreeze,
  satisfyGate,
} from '../core/gate.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
import { DEFAULT_PROFILE_MAXIMUMS } from '../sdlc-vocabulary.mjs'

const goalRevision = 'a'.repeat(64)
const candidateDigest = 'b'.repeat(64)
const otherCandidateDigest = 'c'.repeat(64)

// W8a defect fixture: this helper used to default to `platform: 'github', independence:
// 'independent'` — a reviewer that is neither the registered human platform nor declared as a
// human-gate reviewer — and every satisfaction test in this file built its "this satisfies the
// gate" case from it. That default was itself the bug D1 fixes: it happened to keep passing only
// because nothing here checked reviewer identity. Fixed to a genuine human reviewer so a satisfied
// assertion below actually demonstrates human consent, not merely a well-formed record.
function attestation(overrides = {}) {
  return createReviewAttestation({
    subject: 'demo',
    reviewedDigest: candidateDigest,
    reviewer: { platform: 'human', executor: 'human-reviewer', independence: 'human-gate' },
    decision: 'agree',
    timestamp: new Date(0).toISOString(),
    findings: [],
    ...overrides,
  })
}

describe('gate', () => {
  it('1. the three classes range over different subjects: a goalRevision attestation cannot satisfy a release-of-candidate gate', () => {
    const releaseGate = createGate({
      gateClass: GATE_CLASSES.releaseOfCandidate,
      subjectDigest: candidateDigest,
      subjectKind: 'candidateDigest',
      requiredRole: 'reviewer',
    })
    // An attestation reviewed against the goalRevision (not the candidate) must not satisfy it.
    const overGoal = attestation({ reviewedDigest: goalRevision })
    expect(satisfyGate(releaseGate, overGoal).ok).toBe(false)
    // Structurally: an adequacy-of-intent gate cannot even be constructed over a candidateDigest,
    // and a release-of-candidate gate cannot be constructed over a goalRevision.
    expect(() =>
      createGate({
        gateClass: GATE_CLASSES.adequacyOfIntent,
        subjectDigest: candidateDigest,
        subjectKind: 'candidateDigest',
        requiredRole: 'product-manager',
      }),
    ).toThrow()
    expect(() =>
      createGate({
        gateClass: GATE_CLASSES.releaseOfCandidate,
        subjectDigest: goalRevision,
        subjectKind: 'goalRevision',
        requiredRole: 'reviewer',
      }),
    ).toThrow()
  })

  it('2. a gate is unsatisfied until an attestation whose reviewedDigest matches arrives', () => {
    const gate = createGate({
      gateClass: GATE_CLASSES.releaseOfCandidate,
      subjectDigest: candidateDigest,
      subjectKind: 'candidateDigest',
      requiredRole: 'reviewer',
    })
    expect(satisfyGate(gate, undefined).ok).toBe(false)
    expect(satisfyGate(gate, attestation({ reviewedDigest: otherCandidateDigest })).ok).toBe(false)
    expect(satisfyGate(gate, attestation({ reviewedDigest: candidateDigest })).ok).toBe(true)
  })

  it('3. favourable hints do not satisfy a gate (invariant 9)', () => {
    const gate = createGate({
      gateClass: GATE_CLASSES.releaseOfCandidate,
      subjectDigest: candidateDigest,
      subjectKind: 'candidateDigest',
      requiredRole: 'reviewer',
      hints: [
        { id: 'confidence', value: 100, interpretation: 'Maximum possible confidence score' },
        { id: 'risk', value: 0, interpretation: 'Zero detected risk' },
        { id: 'auto-recommend', value: true, interpretation: 'Everything suggests approval' },
      ],
    })
    // No attestation at all: still unsatisfied, no matter how favourable the hints are.
    expect(satisfyGate(gate, undefined).ok).toBe(false)
    expect(satisfyGate(gate, null).ok).toBe(false)
    // Hints never appear anywhere in the satisfaction decision.
    expect(satisfyGate(gate, attestation({ reviewedDigest: candidateDigest })).ok).toBe(true)
  })

  it('4. bounded profile + external-action still fires a gate (the contradiction fixed)', () => {
    const crossings = deriveCrossings({
      effectiveBoundary: 'external-action',
      requestedBoundary: DEFAULT_PROFILE_MAXIMUMS.bounded,
    })
    expect(crossings.some((crossing) => crossing.kind === 'authority-escalation')).toBe(true)
  })

  it('5. each of the four derivable crossings fires independently, regardless of profile', () => {
    expect(
      deriveCrossings({ effectiveBoundary: 'external-action', requestedBoundary: 'observe' }).some(
        (c) => c.kind === 'authority-escalation',
      ),
    ).toBe(true)
    expect(
      deriveCrossings({ budget: { admitted: false, reason: 'Budget exhausted' } }).some(
        (c) => c.kind === 'budget-exhaustion',
      ),
    ).toBe(true)
    expect(
      deriveCrossings({ observation: { ageMs: 5000, maxAgeMs: 1000 } }).some(
        (c) => c.kind === 'evidence-expiry',
      ),
    ).toBe(true)
    expect(
      deriveCrossings({ independence: { selfReview: true, allowsSelfReview: false } }).some(
        (c) => c.kind === 'independence',
      ),
    ).toBe(true)
    // None of these take a profile at all, so none can be suppressed by one.
    expect(
      deriveCrossings({ effectiveBoundary: 'external-action', requestedBoundary: 'observe' }),
    ).not.toHaveProperty('profile')
  })

  it('6. resolveRefreeze: dropped criterion is weakening, shrunk-without-relaxing is narrowing, undecidable is weakening', () => {
    expect(
      resolveRefreeze({
        previousCriteria: [{ id: 'a', assertions: ['works'] }],
        nextCriteria: [],
      }),
    ).toBe('weakening')
    expect(
      resolveRefreeze({
        previousCriteria: [
          {
            id: 'a',
            assertions: ['works'],
            allowedOrigins: ['collector-observed', 'external-resolved'],
          },
        ],
        nextCriteria: [{ id: 'a', assertions: ['works'], allowedOrigins: ['collector-observed'] }],
      }),
    ).toBe('narrowing')
    expect(
      resolveRefreeze({
        previousCriteria: [{ id: 'a', assertions: ['works'] }],
        nextCriteria: null,
      }),
    ).toBe('weakening')
  })

  it('7. no gate anywhere is created from a phase number', () => {
    expect(() =>
      createGate({
        gateClass: GATE_CLASSES.agentEscalation,
        subjectDigest: candidateDigest,
        subjectKind: 'candidateDigest',
        requiredRole: 'reviewer',
        phase: 6,
      }),
    ).toThrow()
    expect(() =>
      createGate({
        gateClass: GATE_CLASSES.agentEscalation,
        subjectDigest: candidateDigest,
        subjectKind: 'phase',
        requiredRole: 'reviewer',
      }),
    ).toThrow()
  })
})

// W8a — checkpoint G2 caught satisfyGate treating a well-formed record as consent. These are the
// seven tests the spec required to be written first, five of them here (the other two — the
// close-unit subject-mismatch refusal — live in cockpit-terminal-intent.test.mjs, next to the
// client that supplies it).
describe('gate satisfaction requires human consent (W8a)', () => {
  function releaseGate() {
    return createGate({
      gateClass: GATE_CLASSES.releaseOfCandidate,
      subjectDigest: candidateDigest,
      subjectKind: 'candidateDigest',
      requiredRole: 'reviewer',
    })
  }

  it('1. decision: blocked does not satisfy a gate', () => {
    expect(satisfyGate(releaseGate(), attestation({ decision: 'blocked' })).ok).toBe(false)
  })

  it('2. decision: changes-requested does not satisfy a gate', () => {
    expect(satisfyGate(releaseGate(), attestation({ decision: 'changes-requested' })).ok).toBe(
      false,
    )
  })

  it('3. an agent reviewer (platform: claude) does not satisfy a gate, whatever its independence', () => {
    for (const independence of ['independent', 'self-review', 'human-gate']) {
      const agentAttestation = attestation({
        reviewer: { platform: 'claude', executor: 'claude-cli', independence },
      })
      expect(satisfyGate(releaseGate(), agentAttestation).ok).toBe(false)
    }
  })

  it('4. independence: self-review does not satisfy a gate', () => {
    const selfReview = attestation({
      reviewer: { platform: 'human', executor: 'human-reviewer', independence: 'self-review' },
    })
    expect(satisfyGate(releaseGate(), selfReview).ok).toBe(false)
  })

  it('5. a gate whose subjectDigest was altered after sealing is refused', () => {
    const gate = releaseGate()
    // Tamper with the payload after sealing without recomputing the digest — exactly what a
    // corrupted store record or an in-flight mutation would look like. The attestation below is
    // reviewed against the ALTERED digest, so a naive digest-equality check alone would accept it;
    // only re-verifying the gate's own seal catches this.
    const tampered = { ...gate, subjectDigest: otherCandidateDigest }
    const overTamperedDigest = attestation({ reviewedDigest: otherCandidateDigest })
    expect(satisfyGate(tampered, overTamperedDigest).ok).toBe(false)
  })

  it('7. a human agree over the correct subject still satisfies the gate (regression guard)', () => {
    expect(satisfyGate(releaseGate(), attestation({ reviewedDigest: candidateDigest })).ok).toBe(
      true,
    )
  })
})
