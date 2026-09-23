import { describe, expect, it } from 'vitest'
import { GATE_CLASSES, createGate, satisfyGate, deriveCrossings } from '../core/gate.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
import { verifyObservation } from '../core/verification-observation.mjs'
import { sealDeliveryRecord } from '../core/delivery-record.mjs'
import { POSTURE_NAMES, DEFAULT_POSTURE, resolvePosture } from '../core/posture.mjs'
import { actionBoundaryRank } from '../sdlc-vocabulary.mjs'
import { loadSdlcConfig } from '../sdlc-state.mjs'

const config = loadSdlcConfig(process.cwd())
const goalRevision = 'a'.repeat(64)
const candidateDigest = 'b'.repeat(64)

function signedAttestation(overrides = {}) {
  return createReviewAttestation({
    subject: 'demo',
    reviewedDigest: candidateDigest,
    reviewer: { platform: 'github', executor: 'human-reviewer', independence: 'independent' },
    decision: 'agree',
    timestamp: new Date(0).toISOString(),
    findings: [],
    ...overrides,
  })
}

describe('posture (D1: posture as a resolvable second axis)', () => {
  it('1. autonomous posture + high-assurance change class: the high-assurance floor wins', () => {
    const effective = resolvePosture({
      posture: 'autonomous',
      changeClass: 'high-assurance',
      config,
    })
    // autonomous alone would not require a human at release; the high-assurance floor forces it.
    expect(effective.humanGateClasses).toContain(GATE_CLASSES.releaseOfCandidate)
    // autonomous alone allows self-review; the high-assurance floor forbids it.
    expect(effective.allowsSelfReview).toBe(false)
    // Attempting to relax the floor by injecting fields through the posture-resolution call itself
    // must have no effect: resolvePosture only reads a posture *name*, never an arbitrary shape.
    const tampered = resolvePosture({
      posture: 'autonomous',
      changeClass: 'high-assurance',
      config,
      humanGateClasses: [],
      allowsSelfReview: true,
    })
    expect(tampered.humanGateClasses).toContain(GATE_CLASSES.releaseOfCandidate)
    expect(tampered.allowsSelfReview).toBe(false)
  })

  it('2. a posture can tighten a bounded change but cannot loosen a high-assurance one', () => {
    // advisory never mutates a worktree, even for a change class whose own ceiling is open-pr.
    const tightened = resolvePosture({ posture: 'advisory', changeClass: 'bounded', config })
    expect(tightened.maxBoundary).toBe('propose')
    // delegated does not itself require a human at release, but it cannot loosen high-assurance,
    // which does.
    const cannotLoosen = resolvePosture({
      posture: 'delegated',
      changeClass: 'high-assurance',
      config,
    })
    expect(cannotLoosen.humanGateClasses).toContain(GATE_CLASSES.releaseOfCandidate)
    expect(cannotLoosen.allowsSelfReview).toBe(false)
  })

  it('3. at every posture, an agent-raised escalation halts the affected intent subtree', () => {
    for (const posture of POSTURE_NAMES) {
      for (const changeClass of Object.keys(config.paths)) {
        const effective = resolvePosture({ posture, changeClass, config })
        // No posture's table may downgrade escalation to an advisory flag: it is always present.
        expect(effective.humanGateClasses).toContain(GATE_CLASSES.agentEscalation)
      }
      // And the halt is real, not just listed: an escalation gate stays unsatisfied without a
      // matching human attestation, regardless of posture.
      const escalationGate = createGate({
        gateClass: GATE_CLASSES.agentEscalation,
        subjectDigest: goalRevision,
        subjectKind: 'goalRevision',
        requiredRole: 'reviewer',
      })
      expect(satisfyGate(escalationGate, undefined).ok).toBe(false)
      expect(satisfyGate(escalationGate, null).ok).toBe(false)
    }
  })

  it('4. at every posture, an unsigned or implicit approval is refused', () => {
    for (const posture of POSTURE_NAMES) {
      const effective = resolvePosture({ posture, changeClass: 'standard', config })
      const gate = createGate({
        gateClass: GATE_CLASSES.releaseOfCandidate,
        subjectDigest: candidateDigest,
        subjectKind: 'candidateDigest',
        requiredRole: 'reviewer',
      })
      // No attestation at all (implicit / ambient approval).
      expect(satisfyGate(gate, undefined).ok).toBe(false)
      // An attestation with no declared independence (an ambient boolean masquerading as review).
      expect(satisfyGate(gate, signedAttestation({ reviewer: undefined })).ok).toBe(false)
      // Posture's allowsSelfReview can never make satisfyGate accept this — the function has no
      // posture parameter to accept one through.
      expect(effective.posture).toBe(posture)
      expect(satisfyGate(gate, undefined).ok).toBe(false)
    }
  })

  it('5. at every posture, a forged-evidence role pass is refused (the theatre case never returns)', () => {
    for (const posture of POSTURE_NAMES) {
      // resolvePosture's output carries no evidence-origin knob at all: posture cannot launder
      // forged evidence through it, structurally, because there is nothing to launder through.
      const effective = resolvePosture({ posture, changeClass: 'bounded', config })
      expect(effective).not.toHaveProperty('allowedOrigins')
      expect(effective).not.toHaveProperty('observationRequired')

      const forged = sealDeliveryRecord('verification-observation', {
        id: 'obs-1',
        invocationId: 'inv-1',
        criterionId: 'crit-1',
        producer: 'agent',
        candidateDigest,
        definitionDigest: 'd'.repeat(64),
        origin: 'agent-reported', // self-reported, not observed — a forged/theatre origin
        outcome: 'pass',
        isolation: 'immutable',
        startedAt: new Date(0).toISOString(),
        completedAt: new Date(1000).toISOString(),
        assertions: [{ id: 'a1', outcome: 'pass' }],
      })
      const resolution = verifyObservation({
        observation: forged,
        candidateDigest,
        definitionDigest: 'd'.repeat(64),
        requiredAssertions: ['a1'],
        sourceVerified: true,
      })
      expect(resolution.status).toBe('blocked')
      expect(resolution.errors).toContain('Observation origin does not satisfy policy')
    }
  })

  it('6. assisted is the default posture when nothing is configured', () => {
    expect(DEFAULT_POSTURE).toBe('assisted')
    const effective = resolvePosture({ changeClass: 'bounded', config })
    expect(effective.posture).toBe('assisted')
    const explicitEmpty = resolvePosture({ posture: undefined, changeClass: 'bounded', config })
    expect(explicitEmpty.posture).toBe('assisted')
  })

  it('8. no posture can raise the maximum boundary above what its change-class floor allows', () => {
    for (const posture of POSTURE_NAMES) {
      for (const changeClass of Object.keys(config.paths)) {
        const effective = resolvePosture({ posture, changeClass, config })
        const floorMaximum = config.actionPolicy.profileMaximums[changeClass]
        // The effective boundary can never rank above (be more autonomous than) the change
        // class's own configured ceiling — the most permissive posture (autonomous) still cannot
        // push a bounded/standard/exploratory change past its own floor's maximum.
        expect(actionBoundaryRank(effective.maxBoundary, config)).toBeLessThanOrEqual(
          actionBoundaryRank(floorMaximum, config),
        )
      }
    }
    // And even at the floor's own ceiling (external-action, reachable only via high-assurance),
    // deriveCrossings — which takes no posture at all — still unconditionally demands a human:
    // irreversibility always has a human somewhere, regardless of posture.
    const atFloor = resolvePosture({ posture: 'autonomous', changeClass: 'high-assurance', config })
    expect(atFloor.maxBoundary).toBe('external-action')
    const crossings = deriveCrossings({ effectiveBoundary: atFloor.maxBoundary })
    expect(crossings.some((c) => c.kind === 'authority-escalation')).toBe(true)
  })
})
