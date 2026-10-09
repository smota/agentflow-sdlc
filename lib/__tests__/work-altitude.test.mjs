import { describe, expect, it } from 'vitest'
import { GATE_CLASSES, createGate } from '../core/gate.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
import {
  LEGACY_KIND,
  requiresPersonReview,
  validateOpen,
  workKind,
} from '../core/work-altitude.mjs'

const GOAL_REVISION = 'a'.repeat(64)
const CAPABILITY_REVISION = 'b'.repeat(64)
const goal = { kind: 'goal', revision: GOAL_REVISION }
const capability = { kind: 'capability', changeClass: 'standard', revision: CAPABILITY_REVISION }
const highAssurance = { ...capability, changeClass: 'high-assurance' }

function consentFor(
  revision,
  {
    decision = 'agree',
    platform = 'human',
    independence = 'human-gate',
    gateClass = GATE_CLASSES.adequacyOfIntent,
    reviewedDigest = revision,
  } = {},
) {
  return {
    gate: createGate({
      gateClass,
      subjectDigest: revision,
      subjectKind: 'goalRevision',
      requiredRole: 'person',
    }),
    attestation: createReviewAttestation({
      subject: 'work record',
      reviewedDigest,
      reviewer: { platform, executor: 'a person', independence },
      decision,
      timestamp: '2026-10-09T15:00:00Z',
    }),
  }
}

const open = (record, parent, consent) => () => validateOpen({ record, parent, consent })

describe('work altitude', () => {
  it('opens a goal with no parent and no consent', () => {
    expect(validateOpen({ record: { kind: 'goal' } })).toEqual({ kind: 'goal', parentKind: null })
    expect(open({ kind: 'goal' }, goal)).toThrow(/goal has no parent/)
  })

  it('opens a capability only when a person agreed to the current goal revision', () => {
    const record = { kind: 'capability' }
    expect(validateOpen({ record, parent: goal, consent: consentFor(GOAL_REVISION) })).toEqual({
      kind: 'capability',
      parentKind: 'goal',
    })
    expect(open(record)).toThrow(/requires a parent goal/)
    expect(open(record, goal)).toThrow(/no sealed gate/)
  })

  it('refuses a capability when the person refused the goal', () => {
    const record = { kind: 'capability' }
    for (const decision of ['blocked', 'changes-requested']) {
      expect(open(record, goal, consentFor(GOAL_REVISION, { decision }))).toThrow(
        /only agree opens it/,
      )
    }
  })

  it('refuses a capability when consent is bound to another revision, class, or reviewer', () => {
    const record = { kind: 'capability' }
    const other = 'c'.repeat(64)
    expect(open(record, goal, consentFor(other))).toThrow(/different revision/)
    expect(open(record, goal, consentFor(GOAL_REVISION, { reviewedDigest: other }))).toThrow(
      /reviewedDigest is stale/,
    )
    expect(
      open(record, goal, consentFor(GOAL_REVISION, { gateClass: GATE_CLASSES.agentEscalation })),
    ).toThrow(/not adequacy-of-intent/)
    expect(open(record, goal, consentFor(GOAL_REVISION, { platform: 'claude' }))).toThrow(
      /only a human reviewer/,
    )
    expect(open(record, goal, consentFor(GOAL_REVISION, { independence: 'independent' }))).toThrow(
      /only a human reviewer/,
    )
  })

  it('refuses a gate altered after sealing to point at the goal', () => {
    const consent = consentFor('c'.repeat(64))
    const tampered = { ...consent.gate, subjectDigest: GOAL_REVISION }
    const attestation = { ...consent.attestation, reviewedDigest: GOAL_REVISION }
    expect(open({ kind: 'capability' }, goal, { gate: tampered, attestation })).toThrow(
      /altered after sealing/,
    )
  })

  it('never reads consent from a field on the parent record', () => {
    const claimed = { ...goal, acceptedBy: { platform: 'human' }, decision: 'agree' }
    expect(open({ kind: 'capability' }, claimed)).toThrow(/no sealed gate/)
    const reviewed = { ...highAssurance, personReview: { platform: 'human' } }
    expect(open({ kind: 'spec' }, reviewed)).toThrow(/no sealed gate/)
  })

  it('refuses a spec without a parent capability', () => {
    expect(open({ kind: 'spec' })).toThrow(/requires a parent capability/)
    expect(validateOpen({ record: { kind: 'spec' }, parent: capability })).toEqual({
      kind: 'spec',
      parentKind: 'capability',
    })
  })

  it('requires an agreed review of a high-assurance capability before its specs open', () => {
    const spec = { kind: 'spec' }
    expect(requiresPersonReview(highAssurance)).toBe(true)
    expect(requiresPersonReview(capability)).toBe(false)
    expect(requiresPersonReview({ kind: 'spec', changeClass: 'high-assurance' })).toBe(false)
    expect(open(spec, highAssurance)).toThrow(/requires its review: no sealed gate/)
    for (const decision of ['blocked', 'changes-requested']) {
      expect(open(spec, highAssurance, consentFor(CAPABILITY_REVISION, { decision }))).toThrow(
        /only agree opens it/,
      )
    }
    expect(open(spec, highAssurance, consentFor(GOAL_REVISION))).toThrow(/different revision/)
    expect(
      validateOpen({
        record: spec,
        parent: highAssurance,
        consent: consentFor(CAPABILITY_REVISION),
      }),
    ).toEqual({ kind: 'spec', parentKind: 'capability' })
  })

  it('does not let a goal, a capability, and a spec stand in for each other', () => {
    const spec = { kind: 'spec' }
    const consent = consentFor(CAPABILITY_REVISION)
    expect(open({ kind: 'capability' }, capability, consent)).toThrow(
      /parent goal, not a capability/,
    )
    expect(open({ kind: 'capability' }, spec)).toThrow(/parent goal, not a spec/)
    expect(open(spec, goal, consentFor(GOAL_REVISION))).toThrow(/parent capability, not a goal/)
    expect(open(spec, spec)).toThrow(/parent capability, not a spec/)
    expect(() => workKind({ kind: 'epic' })).toThrow(/Unknown work kind: epic/)
  })

  it('treats a record with no kind as legacy, never as a goal', () => {
    const legacy = { title: 'An old issue', revision: GOAL_REVISION }
    expect(workKind(legacy)).toBe(LEGACY_KIND)
    expect(validateOpen({ record: legacy })).toEqual({ kind: LEGACY_KIND, parentKind: null })
    expect(open({ kind: 'capability' }, legacy, consentFor(GOAL_REVISION))).toThrow(
      /parent goal, not a legacy record/,
    )
  })
})
