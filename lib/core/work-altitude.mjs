import { GATE_CLASSES, satisfyGate } from './gate.mjs'
import { recordDigest } from './record-digest.mjs'

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

// Consent is never a field on a record. It is a sealed adequacy-of-intent gate satisfied by a
// person's attestation, bound to the digest of exactly what the person agreed to.
//
// A capability's change class decides whether its specs need a review, so the class is part of
// what the person admits: the gate covers the goal revision and the class together. The admission
// is kept on the capability as evidence and checked again against the class stored when a spec
// opens. Editing the class afterwards breaks the binding, so a downgrade fails closed. A matching
// admission is never enough on its own: only a separate review of a high-assurance capability
// opens a spec.
export function admissionDigest({ goalRevision, changeClass = null }) {
  return recordDigest({ goalRevision, changeClass })
}

function consentErrors(consent, subjectDigest) {
  const gate = consent?.gate
  if (!gate) return ['no sealed gate was given']
  if (gate.gateClass !== GATE_CLASSES.adequacyOfIntent) {
    return [`the gate is ${gate.gateClass}, not ${GATE_CLASSES.adequacyOfIntent}`]
  }
  if (gate.subjectDigest !== subjectDigest) return ['the gate is bound to a different subject']
  return satisfyGate(gate, consent.attestation).errors
}

function requireConsent(consent, subjectDigest, what) {
  const errors = consentErrors(consent, subjectDigest)
  if (errors.length) throw new Error(`${what}: ${errors.join('; ')}`)
}

// Returns the admission a medium must store on a new capability. Nothing else is stored as consent.
export function validateOpen({ record, parent = null, consent = null } = {}) {
  const kind = workKind(record)
  if (kind === LEGACY_KIND) return Object.freeze({ kind, parentKind: null })

  const parentKind = PARENT_KIND[kind]
  if (!parentKind && parent) throw new Error('A goal has no parent')
  if (!parentKind) return Object.freeze({ kind, parentKind })
  if (!parent) throw new Error(`A ${kind} requires a parent ${parentKind}`)
  const actual = workKind(parent)
  if (actual !== parentKind) {
    throw new Error(`A ${kind} requires a parent ${parentKind}, not a ${actual} record`)
  }

  if (kind === 'capability') {
    const goalRevision = parent.revision
    requireConsent(
      consent,
      admissionDigest({ goalRevision, changeClass: record.changeClass }),
      'A capability requires a person to accept its parent goal at this change class',
    )
    const admission = { goalRevision, gate: consent.gate, attestation: consent.attestation }
    return Object.freeze({ kind, parentKind, admission })
  }

  const admission = parent.admission
  requireConsent(
    admission,
    admissionDigest({ goalRevision: admission?.goalRevision, changeClass: parent.changeClass }),
    'A spec requires a capability whose stored change class a person admitted',
  )
  // The stored admission lives in the record it vouches for. Whoever can edit the record can
  // replace the class and the admission together with a freshly sealed pair, and the seal still
  // matches. A matching seal only proves the record is self-consistent, so it never opens a spec.
  if (!requiresPersonReview(parent)) {
    throw new Error(
      'A spec must not open on a stored capability admission alone, even when it is sealed',
    )
  }
  // A person can only review a capability that exists, so the review gates the specs under it.
  if (consent?.gate?.digest && consent.gate.digest === admission.gate?.digest) {
    throw new Error(
      'A spec under a high-assurance capability requires its review, not its admission',
    )
  }
  requireConsent(
    consent,
    parent.revision,
    'A spec under a high-assurance capability requires its review',
  )
  return Object.freeze({ kind, parentKind })
}
