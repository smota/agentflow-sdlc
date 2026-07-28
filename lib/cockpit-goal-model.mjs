import { COCKPIT_PHASES, classifyIssue } from './cockpit-domain.mjs'
import { extractIssueRelationships, groupCommentsByLane } from './cockpit-markdown.mjs'

export const DISPLAY_STATES = {
  recorded: 'recorded',
  inferred: 'inferred',
  notApplicable: 'not-applicable',
  notRecorded: 'not-recorded',
  needsAttention: 'needs-attention',
  blocked: 'blocked',
  error: 'error',
}

export function buildAgentFlowGoalModel({
  issue,
  comments = [],
  pullRequests = [],
  checks = [],
  graph,
} = {}) {
  const classification = classifyIssue({
    labels: issue?.labels || [],
    body: issue?.body || '',
    comments,
  })
  const relationships = extractIssueRelationships({
    body: issue?.body || '',
    comments,
    pullRequests,
  })
  const roleContributions = buildRoleContributions({ issue, comments, pullRequests, checks })
  const evidenceHealth = buildEvidenceHealthCheck({
    issue,
    comments,
    pullRequests,
    checks,
    classification,
    relationships,
  })
  const nextBestActions = deriveNextBestActions({
    issue,
    comments,
    pullRequests,
    checks,
    evidenceHealth,
  })
  const status = deriveGoalStatus({ issue, pullRequests, nextBestActions, evidenceHealth })
  const highlights = deriveHighlights({
    issue,
    pullRequests,
    nextBestActions,
    evidenceHealth,
    relationships,
  })
  return {
    id: `goal:${issue.number}`,
    number: issue.number,
    title: issue.title,
    url: issue.html_url || issue.url,
    goalType: classification.isEpic
      ? 'goal-group'
      : relationships.followUps.length
        ? 'goal'
        : 'goal',
    status,
    confidence: evidenceHealth.score,
    nextBestActions,
    roleContributions,
    evidenceHealth,
    highlights,
    graph,
    durableLinks: buildDurableLinks({ issue, pullRequests, relationships }),
    source: { kind: 'github', issueNumber: issue.number },
  }
}

export function buildCommandCenterModel({
  issues = [],
  commentsByIssue = {},
  pullRequestsByIssue = {},
} = {}) {
  const goals = issues
    .filter((issue) => !issue.pull_request)
    .map((issue) =>
      buildAgentFlowGoalModel({
        issue,
        comments: commentsByIssue[issue.number] || [],
        pullRequests: pullRequestsByIssue[issue.number] || [],
      }),
    )
  const needingAttention = goals.filter((goal) =>
    ['needs-attention', 'blocked'].includes(goal.status),
  )
  const readyForReview = goals.filter((goal) =>
    goal.nextBestActions.some(
      (action) => action.id === 'request-review' || action.id === 'pr-readiness',
    ),
  )
  const healthAverage = goals.length
    ? Math.round(goals.reduce((sum, goal) => sum + goal.evidenceHealth.score, 0) / goals.length)
    : 0
  const topActions = goals
    .flatMap((goal) => goal.nextBestActions.map((action) => ({ ...action, goal })))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 7)
  return {
    metrics: {
      activeGoals: goals.filter((goal) => goal.status !== 'done').length,
      needAttention: needingAttention.length,
      readyForReview: readyForReview.length,
      evidenceHealthAverage: healthAverage,
      openFollowUps: goals.reduce((sum, goal) => sum + goal.durableLinks.followUps.length, 0),
      humanGatesPending: topActions.filter((action) => action.id === 'request-human-gate').length,
    },
    highlight:
      needingAttention[0] || goals.find((goal) => goal.status === 'ready') || goals[0] || null,
    topActions,
    goals,
  }
}

export function buildEvidenceHealthCheck({
  issue = {},
  comments = [],
  pullRequests = [],
  checks = [],
  classification,
  relationships,
} = {}) {
  const dimensions = [
    dimension(
      'scope',
      hasSection(issue.body, 'Acceptance criteria'),
      'Scope is testable',
      'Acceptance criteria recorded',
      'Clarify acceptance criteria',
    ),
    dimension(
      'design',
      hasSection(issue.body, 'Technical Design') || hasArchitectureSignal(comments),
      'Design is considered',
      'Design evidence recorded or inferred',
      'Check design impact',
    ),
    dimension(
      'implementation',
      pullRequests.length > 0,
      'Implementation is linked',
      'PR evidence linked',
      'Link implementation PR',
    ),
    dimension(
      'validation',
      checks.some(isPassingCheck) || hasValidationSignal(comments),
      'Validation is recorded',
      'Validation check or summary found',
      'Run or record validation',
    ),
    dimension(
      'review',
      hasReviewSignal(comments) || pullRequests.some((pr) => pr.merged_at || pr.mergedAt),
      'Review/gate is visible',
      'Review evidence found or merge indicates accepted review',
      'Record review or request gate',
    ),
    dimension(
      'followUps',
      true,
      'Follow-ups are tracked',
      `${relationships?.followUps?.length || 0} follow-up link(s) detected`,
      'Review follow-up disposition',
    ),
  ]
  if (!classification?.isAgentFlowManaged) {
    dimensions.unshift({
      id: 'managed',
      label: 'AgentFlow signal',
      score: 50,
      state: DISPLAY_STATES.inferred,
      detail: 'Goal inferred from GitHub issue; AgentFlow marker not recorded yet.',
      next: 'Normalize issue when needed.',
    })
  }
  const score = Math.round(
    dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length,
  )
  const grade = score >= 85 ? 'healthy' : score >= 65 ? 'needs-attention' : 'blocked'
  return { score, grade, dimensions }
}

function dimension(id, ok, label, detail, next) {
  return {
    id,
    label,
    score: ok ? 100 : 40,
    state: ok ? DISPLAY_STATES.recorded : DISPLAY_STATES.notRecorded,
    detail,
    next,
  }
}

export function buildRoleContributions({
  issue = {},
  comments = [],
  pullRequests = [],
  checks = [],
} = {}) {
  return COCKPIT_PHASES.map((phase) => {
    const inferred = inferRoleContribution(phase, { issue, comments, pullRequests, checks })
    return { role: phase.label, phase: phase.slug, ...inferred }
  })
}

function inferRoleContribution(phase, ctx) {
  const body = ctx.issue.body || ''
  if (phase.slug === 'product-manager-jtbd')
    return contribution(
      hasAnySection(body, ['Background & Problem Statement', 'Problem']),
      'Goal framed from issue body',
    )
  if (phase.slug === 'analyst')
    return contribution(hasSection(body, 'Acceptance criteria'), 'Acceptance criteria define done')
  if (phase.slug === 'architect')
    return contribution(
      hasSection(body, 'Technical Design') || hasArchitectureSignal(ctx.comments),
      'Design impact considered',
    )
  if (phase.slug === 'developer-planning')
    return contribution(
      hasSection(body, 'Test plan') || hasSection(body, 'Workflow classification'),
      'Plan/validation path recorded',
    )
  if (phase.slug === 'developer')
    return contribution(ctx.pullRequests.length > 0, 'Implementation PR linked')
  if (phase.slug === 'tester')
    return contribution(
      ctx.checks.some(isPassingCheck) || hasValidationSignal(ctx.comments),
      'Validation evidence recorded',
    )
  if (phase.slug === 'review')
    return contribution(
      hasReviewSignal(ctx.comments) || ctx.pullRequests.some((pr) => pr.merged_at || pr.mergedAt),
      'Review or acceptance gate visible',
    )
  if (phase.slug === 'tech-writer')
    return contribution(
      /docs|documentation|tech writer/i.test(body + commentsText(ctx.comments)),
      'Documentation considered',
    )
  if (phase.slug === 'pr-readiness')
    return contribution(ctx.pullRequests.length > 0, 'PR readiness linked')
  return { state: DISPLAY_STATES.notApplicable, summary: 'Not applicable', evidence: null }
}

function contribution(ok, summary) {
  return ok
    ? {
        state: DISPLAY_STATES.recorded,
        summary,
        evidence: 'durable or inferred from GitHub evidence',
      }
    : { state: DISPLAY_STATES.notRecorded, summary: 'Not recorded yet', evidence: null }
}

export function deriveNextBestActions({
  issue = {},
  comments = [],
  pullRequests = [],
  checks = [],
  evidenceHealth,
} = {}) {
  const actions = []
  const body = issue.body || ''
  if (!hasSection(body, 'Acceptance criteria'))
    actions.push(
      action(
        'clarify-scope',
        'Clarify goal acceptance criteria',
        'Scope needs testable acceptance criteria.',
        100,
      ),
    )
  if (!hasSection(body, 'Technical Design') && classificationRisk(body) !== 'low')
    actions.push(
      action(
        'check-design',
        'Check design impact',
        'Design evidence is not recorded for this goal.',
        80,
      ),
    )
  if (!pullRequests.length)
    actions.push(
      action('connect-pr', 'Connect implementation PR', 'No PR is linked to this goal yet.', 70),
    )
  if (!checks.some(isPassingCheck) && !hasValidationSignal(comments))
    actions.push(
      action('record-validation', 'Record validation evidence', 'Validation proof is missing.', 90),
    )
  if (!hasReviewSignal(comments) && pullRequests.length)
    actions.push(
      action(
        'request-review',
        'Request or record review',
        'Implementation exists; review evidence should be visible.',
        75,
      ),
    )
  if (/high-assurance|security|remote|auth/i.test(body) && !hasHumanGateSignal(comments))
    actions.push(
      action(
        'request-human-gate',
        'Request human gate',
        'Sensitive/high-assurance work needs explicit human review.',
        95,
      ),
    )
  if (!actions.length)
    actions.push(
      action(
        'continue-flow',
        'Continue role flow',
        'No blocker detected; advance the next appropriate role.',
        30,
      ),
    )
  return actions.sort((a, b) => b.priority - a.priority)
}

function action(id, label, reason, priority) {
  return { id, label, reason, priority }
}

function deriveGoalStatus({ issue = {}, pullRequests = [], nextBestActions = [], evidenceHealth }) {
  if (issue.state === 'closed' || pullRequests.some((pr) => pr.merged_at || pr.mergedAt))
    return 'done'
  if (nextBestActions.some((action) => action.priority >= 95)) return 'blocked'
  if (evidenceHealth.grade !== 'healthy') return 'needs-attention'
  if (nextBestActions.some((action) => ['request-review', 'pr-readiness'].includes(action.id)))
    return 'ready'
  return 'moving'
}

function deriveHighlights({
  issue = {},
  pullRequests = [],
  nextBestActions = [],
  evidenceHealth,
  relationships,
}) {
  return [
    { label: 'Current focus', value: nextBestActions[0]?.label || 'Continue role flow' },
    { label: 'Evidence health', value: `${evidenceHealth.score}/100 (${evidenceHealth.grade})` },
    {
      label: 'Delivery',
      value: pullRequests.length ? `${pullRequests.length} linked PR(s)` : 'No PR linked yet',
    },
    { label: 'Follow-ups', value: `${relationships.followUps.length} tracked` },
  ]
}

function buildDurableLinks({ issue = {}, pullRequests = [], relationships }) {
  return {
    issue: issue.html_url || issue.url,
    pullRequests: pullRequests.map((pr) => pr.html_url || pr.url).filter(Boolean),
    followUps: relationships.followUps || [],
  }
}

function hasSection(body = '', heading) {
  return new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'im').test(body)
}
function hasAnySection(body, headings) {
  return headings.some((heading) => hasSection(body, heading))
}
function hasArchitectureSignal(comments) {
  return /architect|architecture|technical design|ADR/i.test(commentsText(comments))
}
function hasValidationSignal(comments) {
  return /validation|pnpm test|tests? passed|check/i.test(commentsText(comments))
}
function hasReviewSignal(comments) {
  return /review|approved|finding|gate/i.test(commentsText(comments))
}
function hasHumanGateSignal(comments) {
  return /human (security|acceptance|review)|human gate/i.test(commentsText(comments))
}
function commentsText(comments = []) {
  return comments.map((comment) => comment.body || '').join('\n')
}
function isPassingCheck(check) {
  return ['success', 'passed'].includes(check.conclusion || check.state || check.status)
}
function classificationRisk(body = '') {
  return /high-assurance|security|remote|auth/i.test(body) ? 'high' : 'low'
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
