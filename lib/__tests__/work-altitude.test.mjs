import { describe, expect, it } from 'vitest'
import { GATE_CLASSES, createGate } from '../core/gate.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
import {
  LEGACY_KIND,
  admissionDigest,
  requiresPersonReview,
  validateOpen,
  workKind,
} from '../core/work-altitude.mjs'

const GOAL_REVISION = 'a'.repeat(64)
const CAPABILITY_REVISION = 'b'.repeat(64)
const goal = { kind: 'goal', revision: GOAL_REVISION }

function consentFor(
  subjectDigest,
  {
    decision = 'agree',
    platform = 'human',
    independence = 'human-gate',
    gateClass = GATE_CLASSES.adequacyOfIntent,
    reviewedDigest = subjectDigest,
  } = {},
) {
  return {
    gate: createGate({
      gateClass,
      subjectDigest,
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

const admit = (changeClass) =>
  consentFor(admissionDigest({ goalRevision: GOAL_REVISION, changeClass }))

// A capability as a medium would store it: opened under the goal, carrying its admission.
function admitted(changeClass) {
  const record = { kind: 'capability', changeClass }
  const { admission } = validateOpen({ record, parent: goal, consent: admit(changeClass) })
  return { ...record, revision: CAPABILITY_REVISION, admission }
}

const capability = admitted('standard')
const highAssurance = admitted('high-assurance')
const open = (record, parent, consent) => () => validateOpen({ record, parent, consent })

describe('work altitude', () => {
  it('opens a goal with no parent and no consent', () => {
    expect(validateOpen({ record: { kind: 'goal' } })).toEqual({ kind: 'goal', parentKind: null })
    expect(open({ kind: 'goal' }, goal)).toThrow(/goal has no parent/)
  })

  it('opens a capability only when a person admitted the goal revision at its change class', () => {
    const record = { kind: 'capability', changeClass: 'standard' }
    const consent = admit('standard')
    const opened = validateOpen({ record, parent: goal, consent })
    expect(opened).toMatchObject({ kind: 'capability', parentKind: 'goal' })
    expect(opened.admission).toEqual({ goalRevision: GOAL_REVISION, ...consent })
    expect(open(record)).toThrow(/requires a parent goal/)
    expect(open(record, goal)).toThrow(/no sealed gate/)
    expect(open(record, goal, admit('high-assurance'))).toThrow(/different subject/)
    expect(open(record, goal, consentFor(GOAL_REVISION))).toThrow(/different subject/)
  })

  it('refuses a capability when the person refused the goal', () => {
    const record = { kind: 'capability', changeClass: 'standard' }
    const subject = admissionDigest({ goalRevision: GOAL_REVISION, changeClass: 'standard' })
    for (const decision of ['blocked', 'changes-requested']) {
      expect(open(record, goal, consentFor(subject, { decision }))).toThrow(/only agree opens it/)
    }
  })

  it('refuses a capability when consent is bound to another revision, class, or reviewer', () => {
    const record = { kind: 'capability', changeClass: 'standard' }
    const subject = admissionDigest({ goalRevision: GOAL_REVISION, changeClass: 'standard' })
    const other = 'c'.repeat(64)
    expect(open(record, goal, consentFor(other))).toThrow(/different subject/)
    expect(open(record, goal, consentFor(subject, { reviewedDigest: other }))).toThrow(
      /reviewedDigest is stale/,
    )
    expect(
      open(record, goal, consentFor(subject, { gateClass: GATE_CLASSES.agentEscalation })),
    ).toThrow(/not adequacy-of-intent/)
    expect(open(record, goal, consentFor(subject, { platform: 'claude' }))).toThrow(
      /only a human reviewer/,
    )
    expect(open(record, goal, consentFor(subject, { independence: 'independent' }))).toThrow(
      /only a human reviewer/,
    )
  })

  it('refuses a gate altered after sealing to point at the admission', () => {
    const subject = admissionDigest({ goalRevision: GOAL_REVISION, changeClass: 'standard' })
    const consent = consentFor('c'.repeat(64))
    const tampered = { ...consent.gate, subjectDigest: subject }
    const attestation = { ...consent.attestation, reviewedDigest: subject }
    expect(
      open({ kind: 'capability', changeClass: 'standard' }, goal, { gate: tampered, attestation }),
    ).toThrow(/altered after sealing/)
  })

  it('never reads consent from a field on the parent record', () => {
    const claimed = { ...goal, acceptedBy: { platform: 'human' }, decision: 'agree' }
    expect(open({ kind: 'capability' }, claimed)).toThrow(/no sealed gate/)
    const reviewed = { ...highAssurance, personReview: { platform: 'human' } }
    expect(open({ kind: 'spec' }, reviewed)).toThrow(/requires its review: no sealed gate/)
  })

  it('refuses a spec without a parent capability a person admitted', () => {
    expect(open({ kind: 'spec' })).toThrow(/requires a parent capability/)
    const unadmitted = {
      kind: 'capability',
      changeClass: 'standard',
      revision: CAPABILITY_REVISION,
    }
    expect(open({ kind: 'spec' }, unadmitted)).toThrow(/admitted: no sealed gate/)
  })

  it('refuses a spec after the stored change class is downgraded', () => {
    const downgraded = { ...highAssurance, changeClass: 'standard' }
    expect(open({ kind: 'spec' }, downgraded)).toThrow(
      /admitted: the gate is bound to a different subject/,
    )
    const unset = { ...highAssurance, changeClass: null }
    expect(open({ kind: 'spec' }, unset)).toThrow(/different subject/)
    const upgraded = { ...capability, changeClass: 'high-assurance' }
    expect(open({ kind: 'spec' }, upgraded, consentFor(CAPABILITY_REVISION))).toThrow(
      /different subject/,
    )
    const reanchored = {
      ...downgraded,
      admission: { ...downgraded.admission, goalRevision: 'd'.repeat(64) },
    }
    expect(open({ kind: 'spec' }, reanchored)).toThrow(/different subject/)
  })

  it('never opens a spec on a stored admission, even one the editor resealed', () => {
    const spec = { kind: 'spec' }
    const alone = /must not open on a stored capability admission alone/
    expect(open(spec, capability)).toThrow(alone)
    expect(open(spec, capability, capability.admission)).toThrow(alone)
    expect(open(spec, capability, consentFor(CAPABILITY_REVISION))).toThrow(alone)
    const resealed = {
      ...highAssurance,
      changeClass: 'standard',
      admission: { goalRevision: GOAL_REVISION, ...admit('standard') },
    }
    expect(open(spec, resealed)).toThrow(alone)
    expect(open(spec, resealed, resealed.admission)).toThrow(alone)
    expect(open(spec, highAssurance, highAssurance.admission)).toThrow(
      /requires its review, not its admission/,
    )
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
    expect(open(spec, highAssurance, consentFor(GOAL_REVISION))).toThrow(/different subject/)
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
    expect(open({ kind: 'capability' }, capability, admit(undefined))).toThrow(
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
    expect(open({ kind: 'capability' }, legacy, admit(undefined))).toThrow(
      /parent goal, not a legacy record/,
    )
  })
})
