// Portable advanced agent capability resolution.
//
// Skills request capabilities such as plan-before-edit or delegated-subagents. This module maps
// those portable intents to a deterministic resolution mode for the selected execution target. See
// docs/capabilities.md for the human-readable contract.

import { ALL_EXECUTION_TARGETS } from './execution-targets.mjs'

export const CAPABILITIES = [
  'plan-before-edit',
  'workflow-orchestration',
  'bounded-loop',
  'delegated-subagents',
]

export const CAPABILITY_MODES = [
  'native',
  'package',
  'framework-emulated',
  'manual',
  'optional-unavailable',
  'required-unavailable',
]

const DEFAULT_CAPABILITY_MATRIX = {
  'claude-cli': {
    'plan-before-edit': 'native',
    'workflow-orchestration': 'package',
    'bounded-loop': 'framework-emulated',
    'delegated-subagents': 'native',
  },
  'anthropic-api': {
    'plan-before-edit': 'framework-emulated',
    'workflow-orchestration': 'framework-emulated',
    'bounded-loop': 'framework-emulated',
    'delegated-subagents': 'optional-unavailable',
  },
  'codex-cli': {
    'plan-before-edit': 'framework-emulated',
    'workflow-orchestration': 'framework-emulated',
    'bounded-loop': 'framework-emulated',
    'delegated-subagents': 'optional-unavailable',
  },
  'provider-api': {
    'plan-before-edit': 'framework-emulated',
    'workflow-orchestration': 'framework-emulated',
    'bounded-loop': 'framework-emulated',
    'delegated-subagents': 'optional-unavailable',
  },
  'pi-parent': {
    'plan-before-edit': 'package',
    'workflow-orchestration': 'package',
    'bounded-loop': 'package',
    'delegated-subagents': 'package',
  },
  'pi-subagent': {
    'plan-before-edit': 'package',
    'workflow-orchestration': 'package',
    'bounded-loop': 'package',
    'delegated-subagents': 'package',
  },
  'pi-session': {
    'plan-before-edit': 'package',
    'workflow-orchestration': 'package',
    'bounded-loop': 'package',
    'delegated-subagents': 'package',
  },
  'pi-subagent-model': {
    'plan-before-edit': 'framework-emulated',
    'workflow-orchestration': 'framework-emulated',
    'bounded-loop': 'framework-emulated',
    'delegated-subagents': 'package',
  },
  'agy-cli': {
    'plan-before-edit': 'framework-emulated',
    'workflow-orchestration': 'framework-emulated',
    'bounded-loop': 'framework-emulated',
    'delegated-subagents': 'optional-unavailable',
  },
  'agy-session': {
    'plan-before-edit': 'framework-emulated',
    'workflow-orchestration': 'framework-emulated',
    'bounded-loop': 'framework-emulated',
    'delegated-subagents': 'manual',
  },
  human: {
    'plan-before-edit': 'manual',
    'workflow-orchestration': 'manual',
    'bounded-loop': 'manual',
    'delegated-subagents': 'manual',
  },
}

export function isKnownCapability(capability) {
  return CAPABILITIES.includes(capability)
}

export function isCapabilityMode(mode) {
  return CAPABILITY_MODES.includes(mode)
}

function configOverride({ config, executionTarget, capability }) {
  const direct = config?.capabilities?.[capability]?.executionTargets?.[executionTarget]
  if (typeof direct === 'string') return direct

  const targetCapabilities =
    config?.capabilityAdapters?.[executionTarget]?.capabilities?.[capability]
  if (typeof targetCapabilities === 'string') return targetCapabilities
  if (typeof targetCapabilities?.mode === 'string') return targetCapabilities.mode

  return null
}

export function resolveCapability({
  capability,
  executionTarget,
  required = false,
  config = {},
} = {}) {
  if (!isKnownCapability(capability)) {
    throw new Error(`capability must be one of: ${CAPABILITIES.join(', ')}`)
  }
  if (!ALL_EXECUTION_TARGETS.includes(executionTarget)) {
    throw new Error(`executionTarget must be one of: ${ALL_EXECUTION_TARGETS.join(', ')}`)
  }

  const configuredMode = configOverride({ config, executionTarget, capability })
  if (configuredMode && !isCapabilityMode(configuredMode)) {
    throw new Error(
      `invalid capability mode "${configuredMode}" for ${executionTarget}/${capability}`,
    )
  }

  const defaultMode =
    DEFAULT_CAPABILITY_MATRIX[executionTarget]?.[capability] ?? 'optional-unavailable'
  let mode = configuredMode ?? defaultMode
  if (required && mode === 'optional-unavailable') mode = 'required-unavailable'

  return {
    ok: mode !== 'required-unavailable',
    capability,
    executionTarget,
    required: Boolean(required),
    mode,
    status:
      mode === 'required-unavailable'
        ? 'blocked'
        : mode === 'optional-unavailable'
          ? 'skipped'
          : 'satisfied',
    adapter: adapterForExecutionTarget(executionTarget),
    reason: reasonForMode({
      mode,
      capability,
      executionTarget,
      configured: Boolean(configuredMode),
    }),
  }
}

export function adapterForExecutionTarget(executionTarget) {
  if (executionTarget === 'claude-cli' || executionTarget === 'anthropic-api') return 'claude-code'
  if (executionTarget === 'codex-cli' || executionTarget === 'provider-api') return 'codex-cli'
  if (executionTarget.startsWith('pi-')) return 'pi'
  if (executionTarget.startsWith('agy-')) return 'agy'
  if (executionTarget === 'human') return 'manual'
  return 'generic-framework'
}

function reasonForMode({ mode, capability, executionTarget, configured }) {
  const source = configured ? 'project config override' : 'default adapter matrix'
  if (mode === 'required-unavailable') {
    return `${capability} is required for ${executionTarget} but no native, package, framework, or manual implementation is configured`
  }
  if (mode === 'optional-unavailable') {
    return `${capability} is optional for ${executionTarget} and unavailable; record fallback/skip evidence`
  }
  return `${capability} resolved as ${mode} for ${executionTarget} from ${source}`
}

export function validateCapabilityEvidence(evidence = {}) {
  const errors = []
  const warnings = []
  const used = Array.isArray(evidence.capabilitiesUsed) ? evidence.capabilitiesUsed : []

  for (const [index, item] of used.entries()) {
    const prefix = `capabilitiesUsed[${index}]`
    if (!isKnownCapability(item.name))
      errors.push(`${prefix}.name must be one of: ${CAPABILITIES.join(', ')}`)
    if (!isCapabilityMode(item.mode))
      errors.push(`${prefix}.mode must be one of: ${CAPABILITY_MODES.join(', ')}`)
    if (item.required === true && item.mode === 'optional-unavailable') {
      errors.push(`${prefix} is required but recorded optional-unavailable`)
    }
    if (item.mode === 'required-unavailable' && item.status !== 'blocked') {
      errors.push(`${prefix} required-unavailable must have status "blocked"`)
    }
    if (item.name === 'bounded-loop') {
      if (!Number.isInteger(item.maxIterations) || item.maxIterations < 1) {
        errors.push(`${prefix} bounded-loop must record maxIterations >= 1`)
      }
      if (!Array.isArray(item.stopConditions) || item.stopConditions.length === 0) {
        errors.push(`${prefix} bounded-loop must record stopConditions`)
      }
    }
    if (
      item.name === 'delegated-subagents' &&
      ['native', 'package', 'manual'].includes(item.mode)
    ) {
      for (const field of ['transport', 'delegationBoundary', 'contextBoundary']) {
        if (!item[field]) errors.push(`${prefix} delegated-subagents must record ${field}`)
      }
      if (item.singleWriterRule !== true) {
        warnings.push(`${prefix} delegated-subagents should record singleWriterRule: true`)
      }
    }
    if (item.name === 'plan-before-edit' && item.required === true && !item.artifact) {
      errors.push(`${prefix} required plan-before-edit must record an artifact`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}
