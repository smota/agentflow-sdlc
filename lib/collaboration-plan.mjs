import { loadProjectConfig } from './role-routing.mjs'
import { resolveCapability } from './capabilities.mjs'

export const COLLABORATION_MODES = [
  'auto-minimal',
  'single-agent',
  'advisory',
  'council',
  'parallel-discovery',
  'spike',
  'human-gated',
]

export const PERMISSIONS = ['read-only', 'writer', 'test-runner', 'reviewer', 'human-gate']

const SENSITIVE_SURFACES = new Set(['security', 'auth', 'data', 'infra', 'billing'])

function list(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function hasSensitiveSurface(surfaces) {
  return surfaces.some((surface) => SENSITIVE_SURFACES.has(surface))
}

function helper(role, extra = {}) {
  return { role, permissions: 'read-only', ...extra }
}

export function selectCollaborationMode({
  requestedMode = 'auto-minimal',
  profile = 'standard',
  risk = 'medium',
  effort = 'medium',
  changeSurface = [],
  uncertainty = 'medium',
  broadDiscovery = false,
  isolatedSpike = false,
} = {}) {
  if (!COLLABORATION_MODES.includes(requestedMode)) {
    throw new Error(`collaboration mode must be one of: ${COLLABORATION_MODES.join(', ')}`)
  }
  if (requestedMode !== 'auto-minimal') return requestedMode

  const surfaces = list(changeSurface)
  if (profile === 'high-assurance' || hasSensitiveSurface(surfaces)) return 'human-gated'
  if (isolatedSpike) return 'spike'
  if (broadDiscovery || effort === 'high') return 'parallel-discovery'
  if (uncertainty === 'high' || risk === 'high') return 'council'
  if (profile === 'standard' || risk === 'medium' || uncertainty === 'medium') return 'advisory'
  return 'single-agent'
}

function helpersForMode(mode) {
  if (mode === 'advisory') return [helper('risk-scout')]
  if (mode === 'council') {
    return [
      helper('risk-scout'),
      helper('implementation-strategist'),
      helper('testability-scout'),
      helper('docs-impact-scout'),
    ]
  }
  if (mode === 'parallel-discovery') {
    return [
      helper('requirements-scout', { maxFiles: 40 }),
      helper('architecture-scout', { maxFiles: 40 }),
    ]
  }
  if (mode === 'spike') return [helper('spike-implementer', { permissions: 'writer' })]
  if (mode === 'human-gated') return [helper('human-reviewer', { permissions: 'human-gate' })]
  return []
}

function environmentForMode(mode) {
  if (mode === 'spike') return 'worktree'
  if (mode === 'human-gated') return 'human-handoff'
  if (mode === 'single-agent') return 'current-session'
  return 'forked-context'
}

function reasonForMode(mode, { profile, risk, effort, uncertainty, changeSurface }) {
  if (mode === 'single-agent')
    return 'low uncertainty and low coordination value; single-agent path is sufficient'
  if (mode === 'advisory')
    return 'standard or medium-risk work benefits from one focused read-only second opinion'
  if (mode === 'council')
    return 'high uncertainty or risk warrants role-local scout perspectives before parent synthesis'
  if (mode === 'parallel-discovery')
    return 'broad/high-effort scope warrants bounded read-only discovery fanout'
  if (mode === 'spike')
    return 'implementation uncertainty warrants isolated worktree experiment before parent ports changes'
  if (mode === 'human-gated')
    return 'sensitive or high-assurance surface requires human authority gate'
  return `auto-minimal evaluated profile=${profile}, risk=${risk}, effort=${effort}, uncertainty=${uncertainty}, surfaces=${list(changeSurface).join(',') || 'none'}`
}

export function resolveCollaborationPlan({
  issueNumber = null,
  requestedMode = 'auto-minimal',
  profile = 'standard',
  risk = 'medium',
  effort = 'medium',
  changeSurface = [],
  uncertainty = 'medium',
  broadDiscovery = false,
  isolatedSpike = false,
  executionTarget = 'pi-parent',
  config = loadProjectConfig(),
} = {}) {
  const configuredDefault = config?.collaboration?.defaultMode
  const mode = selectCollaborationMode({
    requestedMode: requestedMode ?? configuredDefault ?? 'auto-minimal',
    profile,
    risk,
    effort,
    changeSurface,
    uncertainty,
    broadDiscovery,
    isolatedSpike,
  })
  const delegated = resolveCapability({
    capability: 'delegated-subagents',
    executionTarget,
    required: !['single-agent', 'human-gated'].includes(mode),
    config,
  })
  const workflow = resolveCapability({
    capability: 'workflow-orchestration',
    executionTarget,
    required: true,
    config,
  })
  const helpers = helpersForMode(mode)
  const plan = {
    issueNumber,
    collaborationMode: mode,
    reason: reasonForMode(mode, { profile, risk, effort, uncertainty, changeSurface }),
    capabilities: [workflow, delegated],
    environment: environmentForMode(mode),
    helpers,
    writer: mode === 'spike' ? 'isolated-worktree-helper' : 'parent',
    humanGate: mode === 'human-gated',
    synthesisRequired: helpers.length > 0,
  }

  const errors = []
  if (!workflow.ok) errors.push(workflow.reason)
  if (!delegated.ok) errors.push(delegated.reason)
  const sharedWriters = helpers.filter((item) => item.permissions === 'writer' && mode !== 'spike')
  if (sharedWriters.length > 0)
    errors.push('shared-worktree helpers must not receive writer permission')

  return { ok: errors.length === 0, errors, plan }
}
