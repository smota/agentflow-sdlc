import { validateTransitionEnvelope } from './evidence-contracts.mjs'
import { validateActionBoundary } from './lifecycle-contracts.mjs'

function prefix(errors, label, values) {
  errors.push(...values.map((value) => `${label}.${value}`))
}

export function validateMultiAgentAcceptance(
  transitions = [],
  config = {},
  platformConfig = {},
  options = {},
) {
  const errors = []
  const warnings = []

  if (!Array.isArray(transitions) || transitions.length === 0) {
    errors.push('transitions must be a non-empty array')
    return { ok: false, errors, warnings }
  }

  for (const item of transitions) {
    const label = item.label || 'transition'
    const envelope = item.envelope
    const expected = item.expected || {}

    if (!envelope || typeof envelope !== 'object') {
      errors.push(`${label} output must be a JSON object`)
      continue
    }

    const transition = validateTransitionEnvelope(envelope, config, platformConfig)
    prefix(errors, label, transition.errors)
    warnings.push(...transition.warnings.map((value) => `${label}.${value}`))

    if (expected.from && envelope.fromRole !== expected.from) {
      errors.push(`${label} fromRole must be ${expected.from}`)
    }
    if (expected.to && envelope.toRole !== expected.to) {
      errors.push(`${label} toRole must be ${expected.to}`)
    }
    if (expected.platform && envelope.provenance?.platform !== expected.platform) {
      errors.push(`${label}.provenance.platform must be ${expected.platform}`)
    }
    if (expected.executor && envelope.provenance?.executor !== expected.executor) {
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

    if (Array.isArray(item.requiredExtensionPlays)) {
      for (const play of item.requiredExtensionPlays) {
        if (!envelope.extensionPlays?.includes(play)) {
          errors.push(`${label} output must record extension play ${play}`)
        }
      }
    }
  }

  // Chain Linkage Invariants (Codex B4 & B7)
  for (let i = 0; i < transitions.length - 1; i++) {
    const current = transitions[i]
    const next = transitions[i + 1]
    if (current.envelope?.subject && next.envelope?.subject) {
      if (current.envelope.subject !== next.envelope.subject) {
        errors.push(`${current.label || 'current'} and ${next.label || 'next'} subjects must match`)
      }
    }
    if (options.requireConsecutiveLinkage !== false) {
      if (current.envelope?.toRole && next.envelope?.fromRole) {
        if (current.envelope.toRole !== next.envelope.fromRole) {
          errors.push(
            `${current.label || 'current'} toRole (${current.envelope.toRole}) must equal ${next.label || 'next'} fromRole (${next.envelope.fromRole})`,
          )
        }
      }
    }

    // Independence Invariant across review boundaries (Codex B4)
    const isReviewHandoff =
      next.envelope?.toRole === 'reviewer' || next.envelope?.fromRole === 'reviewer'
    if (isReviewHandoff) {
      const samePlatform =
        current.envelope?.provenance?.platform === next.envelope?.provenance?.platform
      const sameExecutor =
        current.envelope?.provenance?.executor === next.envelope?.provenance?.executor
      if (samePlatform && sameExecutor) {
        // Must record degraded assurance or self-review
        const independence = next.envelope?.actionBoundary?.independenceBoundary
        if (independence === 'independent') {
          errors.push(
            `INDEPENDENCE_VIOLATION: ${current.label} and ${next.label} share executor ${sameExecutor} but declare independenceBoundary: independent`,
          )
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

export function validateClaudeAgyAcceptance(
  { claude, agy } = {},
  config = {},
  platformConfig = {},
) {
  return validateMultiAgentAcceptance(
    [
      {
        label: 'claude',
        envelope: claude,
        expected: { platform: 'claude', executor: 'claude-cli', from: 'analyst', to: 'architect' },
        requiredExtensionPlays: ['evidence-analysis'],
      },
      {
        label: 'agy',
        envelope: agy,
        expected: {
          platform: 'agy',
          executor: 'agy-cli',
          from: 'architect',
          to: 'implementation-planner',
        },
      },
    ],
    config,
    platformConfig,
    { requireConsecutiveLinkage: true },
  )
}
