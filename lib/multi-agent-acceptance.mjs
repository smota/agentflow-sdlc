import { validateTransitionEnvelope } from './evidence-contracts.mjs'
import { validateActionBoundary } from './lifecycle-contracts.mjs'

function prefix(errors, label, values) {
  errors.push(...values.map((value) => `${label}.${value}`))
}

export function validateClaudeAgyAcceptance(
  { claude, agy } = {},
  config = {},
  platformConfig = {},
) {
  const errors = []
  const warnings = []
  for (const [label, envelope, expected] of [
    [
      'claude',
      claude,
      { platform: 'claude', executor: 'claude-cli', from: 'analyst', to: 'architect' },
    ],
    [
      'agy',
      agy,
      { platform: 'agy', executor: 'agy-cli', from: 'architect', to: 'developer-planning' },
    ],
  ]) {
    if (!envelope || typeof envelope !== 'object') {
      errors.push(`${label} output must be a JSON object`)
      continue
    }
    const transition = validateTransitionEnvelope(envelope, config, platformConfig)
    prefix(errors, label, transition.errors)
    warnings.push(...transition.warnings.map((value) => `${label}.${value}`))
    if (envelope.fromRole !== expected.from || envelope.toRole !== expected.to) {
      errors.push(`${label} must emit canonical transition ${expected.from} -> ${expected.to}`)
    }
    if (envelope.provenance?.platform !== expected.platform) {
      errors.push(`${label}.provenance.platform must be ${expected.platform}`)
    }
    if (envelope.provenance?.executor !== expected.executor) {
      errors.push(`${label}.provenance.executor must be ${expected.executor}`)
    }
    const action = validateActionBoundary(envelope.actionBoundary, config)
    prefix(errors, `${label}.actionBoundary`, action.errors)
    warnings.push(...action.warnings.map((value) => `${label}.actionBoundary.${value}`))
    if (envelope.actionBoundary?.profile !== envelope.profile) {
      errors.push(`${label}.actionBoundary.profile must match envelope profile`)
    }
    for (const refusal of [
      'directExternalSignalToDeveloper',
      'highAssuranceSelfReview',
      'boundaryWidening',
    ]) {
      if (envelope.refusals?.[refusal] !== true) {
        errors.push(`${label}.refusals.${refusal} must be true`)
      }
    }
  }
  if (claude?.subject && agy?.subject && claude.subject !== agy.subject) {
    errors.push('Claude and Agy subjects must match')
  }
  if (claude?.toRole && agy?.fromRole && claude.toRole !== agy.fromRole) {
    errors.push('Claude toRole must equal Agy fromRole')
  }
  if (!claude?.extensionPlays?.includes('evidence-analysis')) {
    errors.push('Claude Analyst output must record extension play evidence-analysis')
  }
  return { ok: errors.length === 0, errors, warnings }
}
