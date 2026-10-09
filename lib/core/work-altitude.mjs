import { describeRuntimePlatform } from '../runtime-platforms.mjs'

// Work altitudes. A goal is the outcome a person accepts. A capability is the specification agents
// write under an accepted goal. A spec is the implementation unit, and phases 0-8 run inside it.
// These rules decide whether a record may open. A source stores records. It does not decide them.
// Person gates stay in posture.mjs; this module adds none.

export const WORK_KINDS = Object.freeze(['goal', 'capability', 'spec'])

// A record with no kind predates the altitudes. It stays legal, and it is never read as a goal.
export const LEGACY_KIND = 'legacy'

const PARENT_KIND = Object.freeze({ goal: null, capability: 'goal', spec: 'capability' })

export function workKind(record) {
  const kind = record?.kind
  if (kind === undefined || kind === null) return LEGACY_KIND
  if (!WORK_KINDS.includes(kind)) {
    throw new Error(`Unknown work kind: ${kind}. Expected one of: ${WORK_KINDS.join(', ')}`)
  }
  return kind
}

// A decision counts as a person's only when its platform is the registered human platform.
function byPerson(decision) {
  return describeRuntimePlatform(decision?.platform)?.kind === 'human'
}

export function isAcceptedGoal(record) {
  return workKind(record) === 'goal' && byPerson(record.acceptedBy)
}

// High-assurance is the only capability that needs a person. Every other change class does not.
export function requiresPersonReview(record) {
  return workKind(record) === 'capability' && record.changeClass === 'high-assurance'
}

export function validateOpen({ record, parent = null } = {}) {
  const kind = workKind(record)
  if (kind === LEGACY_KIND) return Object.freeze({ kind, parentKind: null })

  const parentKind = PARENT_KIND[kind]
  if (!parentKind && parent) throw new Error('A goal has no parent')
  if (parentKind) {
    if (!parent) throw new Error(`A ${kind} requires a parent ${parentKind}`)
    const actual = workKind(parent)
    if (actual !== parentKind) {
      throw new Error(`A ${kind} requires a parent ${parentKind}, not a ${actual} record`)
    }
    if (kind === 'capability' && !isAcceptedGoal(parent)) {
      throw new Error('A capability requires a parent goal that a person has accepted')
    }
    // A person can only review a capability that exists, so the review gates the specs under it.
    if (requiresPersonReview(parent) && !byPerson(parent.personReview)) {
      throw new Error('A spec under a high-assurance capability requires a person review of it')
    }
  }
  return Object.freeze({ kind, parentKind })
}
