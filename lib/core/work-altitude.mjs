import { GATE_CLASSES, satisfyGate } from './gate.mjs'

// Work altitudes. A goal is the outcome a person accepts. A capability is the specification agents
// write under an accepted goal. A spec is the implementation unit, and phases 0-8 run inside it.
// These rules decide whether a record may open. A source stores records. It does not decide them.
// Person gates stay in posture.mjs and gate.mjs; this module adds none.

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

// High-assurance is the only capability that needs a person. Every other change class does not.
export function requiresPersonReview(record) {
  return workKind(record) === 'capability' && record.changeClass === 'high-assurance'
}

// Consent is never a field on a record. It is a sealed adequacy-of-intent gate bound to the parent's
// current revision, satisfied by a person's attestation. A capability is a specification of intent,
// so its high-assurance review is the same gate class over the capability's own revision.
function consentErrors(consent, parent) {
  const gate = consent?.gate
  if (!gate) return ['no sealed gate was given']
  if (gate.gateClass !== GATE_CLASSES.adequacyOfIntent) {
    return [`the gate is ${gate.gateClass}, not ${GATE_CLASSES.adequacyOfIntent}`]
  }
  if (gate.subjectDigest !== parent.revision) {
    return ['the gate is bound to a different revision of the parent']
  }
  return satisfyGate(gate, consent.attestation).errors
}

function requireConsent(consent, parent, what) {
  const errors = consentErrors(consent, parent)
  if (errors.length) throw new Error(`${what}: ${errors.join('; ')}`)
}

export function validateOpen({ record, parent = null, consent = null } = {}) {
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
    if (kind === 'capability') {
      requireConsent(consent, parent, 'A capability requires a person to accept its parent goal')
    }
    // A person can only review a capability that exists, so the review gates the specs under it.
    if (requiresPersonReview(parent)) {
      requireConsent(
        consent,
        parent,
        'A spec under a high-assurance capability requires its review',
      )
    }
  }
  return Object.freeze({ kind, parentKind })
}
