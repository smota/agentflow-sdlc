import {
  actionBoundaryAllows,
  canonicalRole,
  isAllowedTransition,
  sdlcVocabulary,
} from './sdlc-vocabulary.mjs'
import {
  ALL_EXECUTION_TARGETS,
  DELEGATION_BOUNDARIES,
  EXECUTION_TARGETS_BY_AGENT,
  TRANSPORTS,
} from './execution-targets.mjs'
import { isRegisteredRuntimePlatform } from './runtime-platforms.mjs'

function report(errors = [], warnings = []) {
  return { ok: errors.length === 0, errors, warnings }
}

function requiredString(errors, value, field) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${field} is required`)
}

function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

export function validateArtifactRef(reference = {}, config = {}) {
  const errors = []
  const warnings = []
  const vocabulary = sdlcVocabulary(config)
  requiredString(errors, reference.kind, 'kind')
  requiredString(errors, reference.system, 'system')
  requiredString(errors, reference.uri, 'uri')
  requiredString(errors, reference.authority, 'authority')
  requiredString(errors, reference.relationship, 'relationship')
  if (reference.kind && !vocabulary.artifactKinds.includes(reference.kind)) {
    errors.push(`kind must be one of: ${vocabulary.artifactKinds.join(', ')}`)
  }
  if (reference.authority && !vocabulary.sourceAuthorities.includes(reference.authority)) {
    errors.push(`authority must be one of: ${vocabulary.sourceAuthorities.join(', ')}`)
  }
  if (
    reference.relationship &&
    !vocabulary.artifactRelationships.includes(reference.relationship)
  ) {
    errors.push(`relationship must be one of: ${vocabulary.artifactRelationships.join(', ')}`)
  }
  if (!reference.revision && !reference.digest) {
    warnings.push('revision or digest should be recorded when the source supports immutable refs')
  }
  if (/^(?:data:|javascript:)/i.test(reference.uri ?? '')) {
    errors.push('uri must identify an external or repository artifact, not embedded content')
  }
  if (
    /(?:[?&](?:token|api[_-]?key|secret|password)=)|:\/\/[^/\s]+:[^/@\s]+@/i.test(
      reference.uri ?? '',
    )
  ) {
    errors.push('uri must not contain credentials or secret query parameters')
  }
  return report(errors, warnings)
}

export function validateArtifactRefs(references = [], config = {}) {
  const errors = []
  const warnings = []
  if (!Array.isArray(references)) return report(['artifact references must be an array'])
  for (const [index, reference] of references.entries()) {
    const result = validateArtifactRef(reference, config)
    errors.push(...result.errors.map((error) => `artifactRefs[${index}].${error}`))
    warnings.push(...result.warnings.map((warning) => `artifactRefs[${index}].${warning}`))
  }
  const authoritativeByKind = new Map()
  for (const reference of references.filter((item) => item.authority === 'authoritative')) {
    const key = `${reference.kind}:${reference.scope ?? 'default'}`
    authoritativeByKind.set(key, (authoritativeByKind.get(key) ?? 0) + 1)
  }
  for (const [key, count] of authoritativeByKind) {
    if (count > 1) errors.push(`multiple authoritative artifact references for ${key}`)
  }
  return report(errors, warnings)
}

export function validateTransitionEnvelope(envelope = {}, config = {}, platformConfig = {}) {
  const errors = []
  const warnings = []
  if (envelope.version !== 1) errors.push('version must be 1')
  requiredString(errors, envelope.subject, 'subject')
  requiredString(errors, envelope.fromRole, 'fromRole')
  requiredString(errors, envelope.toRole, 'toRole')
  requiredString(errors, envelope.decision, 'decision')
  requiredString(errors, envelope.nextContract, 'nextContract')
  requiredString(errors, envelope.timestamp, 'timestamp')
  if (envelope.timestamp && !validTimestamp(envelope.timestamp)) {
    errors.push('timestamp must be a valid date-time')
  }
  const fromRole = canonicalRole(envelope.fromRole, config)
  const toRole = canonicalRole(envelope.toRole, config)
  if (!fromRole) errors.push(`fromRole is not a canonical role: ${envelope.fromRole ?? ''}`)
  if (!toRole) errors.push(`toRole is not a canonical role: ${envelope.toRole ?? ''}`)
  if (fromRole && toRole && !isAllowedTransition(fromRole, toRole, config)) {
    errors.push(`transition ${fromRole} -> ${toRole} is not allowed`)
  }
  if (fromRole && envelope.fromRole !== fromRole) {
    warnings.push(`fromRole alias is deprecated; emit ${fromRole}`)
  }
  if (toRole && envelope.toRole !== toRole) {
    warnings.push(`toRole alias is deprecated; emit ${toRole}`)
  }
  if (!['pass', 'blocked', 'returned', 'skipped'].includes(envelope.decision)) {
    errors.push('decision must be pass, blocked, returned, or skipped')
  }
  for (const field of ['inputRefs', 'outputRefs', 'validationRefs']) {
    if (!Array.isArray(envelope[field])) errors.push(`${field} must be an array`)
  }
  if (envelope.openQuestions !== undefined && !Array.isArray(envelope.openQuestions)) {
    errors.push('openQuestions must be an array when present')
  }
  if (envelope.profile !== undefined && !config.paths?.[envelope.profile]) {
    errors.push(`profile is not configured: ${envelope.profile}`)
  }
  if (envelope.actionBoundary !== undefined) {
    const action = envelope.actionBoundary
    if (!action || typeof action !== 'object') {
      errors.push('actionBoundary must be an object when present')
    } else {
      if (action.version !== 1) errors.push('actionBoundary.version must be 1')
      if (action.profile !== envelope.profile) {
        errors.push('actionBoundary.profile must match envelope profile')
      }
      if (!actionBoundaryAllows(action.requested, action.effective, config)) {
        errors.push('actionBoundary.effective must not exceed requested')
      }
    }
  }
  const refs = validateArtifactRefs(
    [
      ...(Array.isArray(envelope.inputRefs) ? envelope.inputRefs : []),
      ...(Array.isArray(envelope.outputRefs) ? envelope.outputRefs : []),
      ...(Array.isArray(envelope.validationRefs) ? envelope.validationRefs : []),
    ],
    config,
  )
  errors.push(...refs.errors)
  warnings.push(...refs.warnings)
  if (!envelope.provenance || typeof envelope.provenance !== 'object') {
    errors.push('provenance is required')
  } else {
    for (const field of ['platform', 'executor', 'transport', 'delegationBoundary']) {
      requiredString(errors, envelope.provenance[field], `provenance.${field}`)
    }
    const { platform, executor, transport, delegationBoundary } = envelope.provenance
    if (platform && !isRegisteredRuntimePlatform(platform, platformConfig)) {
      errors.push(`provenance.platform is not registered: ${platform}`)
    }
    if (executor && !ALL_EXECUTION_TARGETS.includes(executor)) {
      errors.push(`provenance.executor must be one of: ${ALL_EXECUTION_TARGETS.join(', ')}`)
    }
    if (transport && !TRANSPORTS.includes(transport)) {
      errors.push(`provenance.transport must be one of: ${TRANSPORTS.join(', ')}`)
    }
    if (delegationBoundary && !DELEGATION_BOUNDARIES.includes(delegationBoundary)) {
      errors.push(
        `provenance.delegationBoundary must be one of: ${DELEGATION_BOUNDARIES.join(', ')}`,
      )
    }
    if (
      platform &&
      executor &&
      EXECUTION_TARGETS_BY_AGENT[platform] &&
      !EXECUTION_TARGETS_BY_AGENT[platform].includes(executor)
    ) {
      errors.push(`provenance.executor ${executor} does not belong to platform ${platform}`)
    }
  }
  return report(errors, warnings)
}

export function validateEvidenceContract(type, value, config = {}, platformConfig = {}) {
  if (type === 'artifact-ref') return validateArtifactRef(value, config)
  if (type === 'artifact-refs') return validateArtifactRefs(value, config)
  if (type === 'transition-envelope')
    return validateTransitionEnvelope(value, config, platformConfig)
  return report([`unsupported evidence contract type: ${type}`])
}
