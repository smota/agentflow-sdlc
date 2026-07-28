export const COCKPIT_INTENTS = [
  'ask-status',
  'add-clarification',
  'request-checkpoint',
  'request-human-review',
  'draft-follow-up',
  'update-issue-section',
  'post-handover',
  'start-next-phase',
]

export const FORBIDDEN_REMOTE_ACTIONS = [
  'mark-validation-passed',
  'mark-review-passed',
  'bypass-human-gate',
  'merge-pr',
  'weaken-acceptance-criteria',
  'delete-evidence',
]

export function parseCockpitIntent(input = {}) {
  const type = input.type || input.intent
  if (!COCKPIT_INTENTS.includes(type)) {
    return { ok: false, errors: [`unknown-intent:${type || 'missing'}`] }
  }
  return {
    ok: true,
    intent: {
      type,
      repo: input.repo,
      issue: input.issue,
      body: input.body || '',
      evidenceRefs: input.evidenceRefs || [],
      requiresDurableEvidence: MATERIAL_INTENTS.has(type),
    },
  }
}

export function evaluateGuardedAction({
  action,
  userRole = 'viewer',
  highAssurance = false,
  confirmation = false,
} = {}) {
  const reasons = []
  if (FORBIDDEN_REMOTE_ACTIONS.includes(action)) reasons.push('forbidden-by-policy')
  if (WRITE_ACTIONS.has(action) && !['operator', 'maintainer', 'admin'].includes(userRole))
    reasons.push('role-cannot-write')
  if (ADMIN_ACTIONS.has(action) && !['maintainer', 'admin'].includes(userRole))
    reasons.push('role-cannot-admin')
  if (highAssurance && HIGH_ASSURANCE_BLOCKED_ACTIONS.has(action))
    reasons.push('high-assurance-human-gate-required')
  if ((WRITE_ACTIONS.has(action) || ADMIN_ACTIONS.has(action)) && !confirmation)
    reasons.push('confirmation-required')
  return { ok: reasons.length === 0, reasons }
}

export function createActionPreview({ action, target, summary, durableEffect } = {}) {
  return {
    action,
    target,
    summary,
    durableEffect,
    requiresConfirmation: WRITE_ACTIONS.has(action) || ADMIN_ACTIONS.has(action),
  }
}

export function formatDurableActionBody(intent) {
  const body = intent.body || ''
  if (intent.type === 'post-handover') return `<!-- agent-handover -->\n${body}`
  if (intent.type === 'request-human-review')
    return `<!-- agentflow:human-review-request -->\n${body}`
  if (intent.type === 'draft-follow-up') return `<!-- agentflow:follow-up-proposal -->\n${body}`
  if (intent.type === 'add-clarification') return `Clarification:\n\n${body}`
  if (intent.type === 'request-checkpoint') return `Checkpoint requested:\n\n${body}`
  return body
}

const MATERIAL_INTENTS = new Set([
  'add-clarification',
  'request-checkpoint',
  'request-human-review',
  'draft-follow-up',
  'update-issue-section',
  'post-handover',
  'start-next-phase',
])

const WRITE_ACTIONS = new Set([
  'add-clarification',
  'request-human-review',
  'draft-follow-up',
  'update-issue-section',
  'post-handover',
])

const ADMIN_ACTIONS = new Set(['start-next-phase'])

const HIGH_ASSURANCE_BLOCKED_ACTIONS = new Set(['start-next-phase'])
