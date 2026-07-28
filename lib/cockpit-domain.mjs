export const COCKPIT_PHASES = [
  { index: 0, slug: 'product-manager-jtbd', label: 'Product manager / JTBD' },
  { index: 1, slug: 'analyst', label: 'Analyst' },
  { index: 2, slug: 'architect', label: 'Architect' },
  { index: 3, slug: 'developer-planning', label: 'Developer planning' },
  { index: 4, slug: 'developer', label: 'Developer' },
  { index: 5, slug: 'tester', label: 'Tester' },
  { index: 6, slug: 'review', label: 'Review' },
  { index: 7, slug: 'tech-writer', label: 'Tech writer' },
  { index: 8, slug: 'pr-readiness', label: 'PR readiness' },
]

export const COCKPIT_COMMENT_MARKERS = {
  workflowStatus: 'agentflow:workflow-status',
  handover: 'agent-handover',
  rolePass: 'agentflow:role-pass',
  humanReviewRequest: 'agentflow:human-review-request',
  validationSummary: 'agentflow:validation-summary',
  followUpProposal: 'agentflow:follow-up-proposal',
}

export const COCKPIT_COMMENT_LANES = [
  'Workflow Status',
  'Handover',
  'Decisions',
  'Clarifications',
  'Review Findings',
  'Validation',
  'Follow-ups',
]

export function normalizeRepoId(repo) {
  if (typeof repo !== 'string') return ''
  return repo
    .trim()
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
}

export function createCockpitProject({
  repo,
  defaultBranch = 'development',
  authPolicy = {},
} = {}) {
  const id = normalizeRepoId(repo)
  if (!/^[^/\s]+\/[^/\s]+$/.test(id)) {
    throw new Error('Cockpit project repo must be owner/name')
  }
  return {
    id,
    githubRepo: id,
    defaultBranch,
    configSource: 'agent-workflow.config.json',
    durableTruth: 'github',
    localTelemetry: 'optional',
    authPolicy,
  }
}

export function classifyIssue({ labels = [], body = '', comments = [] } = {}) {
  const labelNames = labels
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter(Boolean)
  const markerText = [body, ...comments.map((comment) => comment.body || '')].join('\n')
  return {
    isEpic: labelNames.includes('epic') || /## Feature Tracking/i.test(body),
    isAgentFlowManaged:
      labelNames.some((name) => name.startsWith('drafted-by:') || name === 'agentflow:managed') ||
      markerText.includes(COCKPIT_COMMENT_MARKERS.workflowStatus) ||
      markerText.includes(COCKPIT_COMMENT_MARKERS.handover),
    labels: labelNames,
  }
}

export function derivePhaseState({
  issue = {},
  rolePasses = [],
  validations = [],
  reviewFindings = [],
} = {}) {
  const phaseLabel = (issue.labels || [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .find((name) => name?.startsWith('phase:'))
  const currentPhase = phaseLabel
    ? phaseLabel.slice('phase:'.length)
    : inferCurrentPhase(rolePasses)
  const missingRolePassFields = rolePasses.flatMap((pass) => missingRolePassFieldsFor(pass))
  const failingValidations = validations.filter((validation) => validation.status === 'failed')
  const blockingReviewFindings = reviewFindings.filter(
    (finding) => finding.severity === 'blocker' || finding.status === 'blocking',
  )
  return {
    currentPhase,
    rolePassComplete: missingRolePassFields.length === 0,
    missingRolePassFields,
    validationStatus: failingValidations.length
      ? 'failed'
      : validations.length
        ? 'passed'
        : 'missing',
    reviewStatus: blockingReviewFindings.length
      ? 'blocked'
      : reviewFindings.length
        ? 'findings'
        : 'unknown',
    nextSafeAction: deriveNextSafeAction({
      currentPhase,
      missingRolePassFields,
      failingValidations,
      blockingReviewFindings,
    }),
  }
}

function inferCurrentPhase(rolePasses) {
  const last = rolePasses.at(-1)
  return last?.phaseSlug || last?.role || 'intake'
}

export function missingRolePassFieldsFor(pass = {}) {
  return ['phase', 'role', 'read', 'decisions', 'uncertainties', 'nextRoleContract'].filter(
    (field) =>
      pass[field] == null ||
      pass[field] === '' ||
      (Array.isArray(pass[field]) && pass[field].length === 0),
  )
}

function deriveNextSafeAction({
  missingRolePassFields,
  failingValidations,
  blockingReviewFindings,
}) {
  if (missingRolePassFields.length) return 'complete-role-pass-evidence'
  if (failingValidations.length) return 'return-to-developer'
  if (blockingReviewFindings.length) return 'resolve-review-findings'
  return 'advance-next-phase'
}
