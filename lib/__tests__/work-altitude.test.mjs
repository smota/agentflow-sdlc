import { describe, expect, it } from 'vitest'
import {
  LEGACY_KIND,
  isAcceptedGoal,
  requiresPersonReview,
  validateOpen,
  workKind,
} from '../core/work-altitude.mjs'

const person = { platform: 'human' }
const agent = { platform: 'claude' }
const acceptedGoal = { kind: 'goal', acceptedBy: person }
const capability = { kind: 'capability', changeClass: 'standard' }

describe('work altitude', () => {
  it('opens a goal with no parent and no acceptance yet', () => {
    expect(validateOpen({ record: { kind: 'goal' } })).toEqual({ kind: 'goal', parentKind: null })
    expect(() => validateOpen({ record: { kind: 'goal' }, parent: acceptedGoal })).toThrow(
      /goal has no parent/,
    )
  })

  it('refuses a capability without a parent goal a person accepted', () => {
    expect(() => validateOpen({ record: capability })).toThrow(/requires a parent goal/)
    expect(() => validateOpen({ record: capability, parent: { kind: 'goal' } })).toThrow(
      /person has accepted/,
    )
    expect(() =>
      validateOpen({ record: capability, parent: { kind: 'goal', acceptedBy: agent } }),
    ).toThrow(/person has accepted/)
    expect(validateOpen({ record: capability, parent: acceptedGoal })).toEqual({
      kind: 'capability',
      parentKind: 'goal',
    })
  })

  it('refuses a spec without a parent capability', () => {
    expect(() => validateOpen({ record: { kind: 'spec' } })).toThrow(/requires a parent capability/)
    expect(validateOpen({ record: { kind: 'spec' }, parent: capability })).toEqual({
      kind: 'spec',
      parentKind: 'capability',
    })
  })

  it('requires a person review only before specs open under a high-assurance capability', () => {
    const highAssurance = { kind: 'capability', changeClass: 'high-assurance' }
    const spec = { kind: 'spec' }
    expect(requiresPersonReview(highAssurance)).toBe(true)
    expect(requiresPersonReview(capability)).toBe(false)
    expect(requiresPersonReview({ kind: 'spec', changeClass: 'high-assurance' })).toBe(false)
    expect(validateOpen({ record: highAssurance, parent: acceptedGoal })).toEqual({
      kind: 'capability',
      parentKind: 'goal',
    })
    expect(() => validateOpen({ record: spec, parent: highAssurance })).toThrow(
      /requires a person review/,
    )
    expect(() =>
      validateOpen({ record: spec, parent: { ...highAssurance, personReview: agent } }),
    ).toThrow(/requires a person review/)
    expect(
      validateOpen({ record: spec, parent: { ...highAssurance, personReview: person } }),
    ).toEqual({ kind: 'spec', parentKind: 'capability' })
    expect(() => validateOpen({ record: spec, parent: capability })).not.toThrow()
  })

  it('does not let a goal, a capability, and a spec stand in for each other', () => {
    const spec = { kind: 'spec' }
    expect(() => validateOpen({ record: capability, parent: capability })).toThrow(
      /parent goal, not a capability/,
    )
    expect(() => validateOpen({ record: capability, parent: spec })).toThrow(
      /parent goal, not a spec/,
    )
    expect(() => validateOpen({ record: spec, parent: acceptedGoal })).toThrow(
      /parent capability, not a goal/,
    )
    expect(() => validateOpen({ record: spec, parent: spec })).toThrow(
      /parent capability, not a spec/,
    )
    expect(isAcceptedGoal({ kind: 'capability', acceptedBy: person })).toBe(false)
    expect(() => workKind({ kind: 'epic' })).toThrow(/Unknown work kind: epic/)
  })

  it('treats a record with no kind as legacy, never as a goal', () => {
    const legacy = { title: 'An old issue', acceptedBy: person }
    expect(workKind(legacy)).toBe(LEGACY_KIND)
    expect(validateOpen({ record: legacy })).toEqual({ kind: LEGACY_KIND, parentKind: null })
    expect(isAcceptedGoal(legacy)).toBe(false)
    expect(() => validateOpen({ record: capability, parent: legacy })).toThrow(
      /parent goal, not a legacy record/,
    )
  })
})
