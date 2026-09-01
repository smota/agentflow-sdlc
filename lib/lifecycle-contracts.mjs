import {
  actionBoundaryAllows,
  canonicalRole,
  DEFAULT_PROFILE_MAXIMUMS,
  sdlcVocabulary,
} from './sdlc-vocabulary.mjs'
import { validateArtifactRef, validateArtifactRefs } from './evidence-contracts.mjs'

const SIGNAL_STATES = ['observed', 'proposed', 'triaged', 'accepted', 'rejected']
const SIGNAL_TRANSITIONS = new Set([
  'observed:proposed',
  'proposed:triaged',
  'triaged:accepted',
  'triaged:rejected',
])
const HANDOFF_STATES = ['proposed', 'ready', 'accepted', 'completed', 'blocked']
const HANDOFF_TRANSITIONS = new Set([
  'proposed:ready',
  'ready:accepted',
  'accepted:completed',
  'proposed:blocked',
  'ready:blocked',
  'accepted:blocked',
])

function result(errors, warnings = []) {
  return { ok: errors.length === 0, errors, warnings }
}

function requireString(errors, value, field) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${field} is required`)
}

export function validateExternalSignal(signal = {}, config = {}) {
  const errors = []
  const warnings = []
  if (signal.version !== 1) errors.push('version must be 1')
  requireString(errors, signal.id, 'id')
  requireString(errors, signal.state, 'state')
  requireString(errors, signal.summary, 'summary')
  if (signal.state && !SIGNAL_STATES.includes(signal.state)) {
    errors.push(`state must be one of: ${SIGNAL_STATES.join(', ')}`)
  }
  if (signal.state !== 'observed') {
    if (!SIGNAL_STATES.includes(signal.previousState)) {
      errors.push('previousState is required after observed')
    } else if (!SIGNAL_TRANSITIONS.has(`${signal.previousState}:${signal.state}`)) {
      errors.push(
        `external signal transition ${signal.previousState} -> ${signal.state} is not allowed`,
      )
    }
  }
  const triageRole = signal.triageRole ? canonicalRole(signal.triageRole, config) : null
  if (['triaged', 'accepted', 'rejected'].includes(signal.state)) {
    if (!['product-manager-jtbd', 'analyst'].includes(triageRole)) {
      errors.push('triageRole must be product-manager-jtbd or analyst after triage')
    }
  }
  if (signal.state === 'accepted') {
    if (!signal.goalRef || typeof signal.goalRef !== 'object') {
      errors.push('accepted signal requires goalRef ArtifactRef')
    } else {
      const goal = validateArtifactRef(signal.goalRef, config)
      errors.push(...goal.errors.map((error) => `goalRef.${error}`))
      warnings.push(...goal.warnings.map((warning) => `goalRef.${warning}`))
    }
  }
  if (triageRole && signal.triageRole !== triageRole) {
    warnings.push(`triageRole alias is deprecated; emit ${triageRole}`)
  }
  if (canonicalRole(signal.nextRole, config) === 'developer') {
    errors.push('external signal cannot route directly to developer')
  }
  const refs = validateArtifactRefs(signal.evidenceRefs ?? [], config)
  errors.push(...refs.errors)
  warnings.push(...refs.warnings)
  return result(errors, warnings)
}

export function validateDeliveryHandoff(handoff = {}, config = {}) {
  const errors = []
  const warnings = []
  if (handoff.version !== 1) errors.push('version must be 1')
  requireString(errors, handoff.id, 'id')
  requireString(errors, handoff.state, 'state')
  if (handoff.state && !HANDOFF_STATES.includes(handoff.state)) {
    errors.push(`state must be one of: ${HANDOFF_STATES.join(', ')}`)
  }
  if (handoff.state !== 'proposed') {
    if (!HANDOFF_STATES.includes(handoff.previousState)) {
      errors.push('previousState is required after proposed')
    } else if (!HANDOFF_TRANSITIONS.has(`${handoff.previousState}:${handoff.state}`)) {
      errors.push(
        `delivery handoff transition ${handoff.previousState} -> ${handoff.state} is not allowed`,
      )
    }
  }
  const sourceRole = canonicalRole(handoff.sourceRole, config)
  if (!sourceRole) errors.push('sourceRole must be a canonical workflow role')
  if (['ready', 'accepted', 'completed'].includes(handoff.state)) {
    requireString(errors, handoff.externalOwner, 'externalOwner')
    if (!['pr-readiness', 'tech-writer'].includes(sourceRole)) {
      errors.push('ready delivery handoff must originate from pr-readiness or tech-writer')
    }
    if (!handoff.rollbackRef && !handoff.rollbackNotApplicableReason) {
      errors.push('rollbackRef or rollbackNotApplicableReason is required')
    }
  }
  for (const field of ['artifactRefs', 'validationRefs', 'approvalRefs']) {
    if (!Array.isArray(handoff[field])) errors.push(`${field} must be an array`)
  }
  const refs = validateArtifactRefs(
    [
      ...(Array.isArray(handoff.artifactRefs) ? handoff.artifactRefs : []),
      ...(Array.isArray(handoff.validationRefs) ? handoff.validationRefs : []),
      ...(Array.isArray(handoff.approvalRefs) ? handoff.approvalRefs : []),
    ],
    config,
  )
  errors.push(...refs.errors)
  warnings.push(...refs.warnings)
  if (handoff.rollbackRef) {
    const rollback = validateArtifactRef(handoff.rollbackRef, config)
    errors.push(...rollback.errors.map((error) => `rollbackRef.${error}`))
    warnings.push(...rollback.warnings.map((warning) => `rollbackRef.${warning}`))
  }
  if (
    ['ready', 'accepted', 'completed'].includes(handoff.state) &&
    !(handoff.artifactRefs ?? []).length
  ) {
    errors.push('ready delivery handoff requires artifactRefs')
  }
  if (
    ['ready', 'accepted', 'completed'].includes(handoff.state) &&
    !(handoff.validationRefs ?? []).length
  ) {
    errors.push('ready delivery handoff requires validationRefs')
  }
  return result(errors, warnings)
}

export function validateActionBoundary(record = {}, config = {}) {
  const errors = []
  const warnings = []
  const vocabulary = sdlcVocabulary(config)
  if (record.version !== 1) errors.push('version must be 1')
  for (const field of ['requested', 'effective', 'profile'])
    requireString(errors, record[field], field)
  for (const field of ['requested', 'effective', 'parent']) {
    if (record[field] && !vocabulary.actionBoundaries.includes(record[field])) {
      errors.push(`${field} must be one of: ${vocabulary.actionBoundaries.join(', ')}`)
    }
  }
  const knownProfile = Boolean(config.paths?.[record.profile])
  const maximum =
    config.actionPolicy?.profileMaximums?.[record.profile] ??
    DEFAULT_PROFILE_MAXIMUMS[record.profile]
  if (!knownProfile || !maximum) errors.push(`unknown profile: ${record.profile ?? ''}`)
  if (maximum && !actionBoundaryAllows(maximum, record.effective, config)) {
    errors.push(`effective boundary ${record.effective} exceeds profile maximum ${maximum}`)
  }
  if (record.parent && !actionBoundaryAllows(record.parent, record.effective, config)) {
    errors.push('delegated effective boundary exceeds parent boundary')
  }
  if (
    record.requested &&
    record.effective &&
    !actionBoundaryAllows(record.requested, record.effective, config)
  ) {
    errors.push('effective boundary exceeds requested boundary')
  }
  if (record.effective === 'external-action') {
    if (
      config.actionPolicy?.externalActionRequiresHumanApproval !== false &&
      (!record.humanApprovalRef || typeof record.humanApprovalRef !== 'object')
    ) {
      errors.push('external-action requires humanApprovalRef ArtifactRef')
    } else if (record.humanApprovalRef) {
      const approval = validateArtifactRef(record.humanApprovalRef, config)
      errors.push(...approval.errors.map((error) => `humanApprovalRef.${error}`))
      warnings.push(...approval.warnings.map((warning) => `humanApprovalRef.${warning}`))
    }
    requireString(errors, record.owningRole, 'owningRole')
    if (!canonicalRole(record.owningRole, config)) errors.push('owningRole must be canonical')
  }
  if (record.enforcementRefs !== undefined && !Array.isArray(record.enforcementRefs)) {
    errors.push('enforcementRefs must be an array when present')
  } else {
    const enforcement = validateArtifactRefs(record.enforcementRefs ?? [], config)
    errors.push(...enforcement.errors)
    warnings.push(...enforcement.warnings)
  }
  return result(errors, warnings)
}

export function validateLifecycleContract(type, value, config = {}) {
  if (type === 'external-signal') return validateExternalSignal(value, config)
  if (type === 'delivery-handoff') return validateDeliveryHandoff(value, config)
  if (type === 'action-boundary') return validateActionBoundary(value, config)
  return result([`unsupported lifecycle contract type: ${type}`])
}
