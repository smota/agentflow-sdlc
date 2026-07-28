import { COCKPIT_PHASES, classifyIssue, derivePhaseState } from './cockpit-domain.mjs'
import { extractIssueRelationships, groupCommentsByLane } from './cockpit-markdown.mjs'

export function buildCockpitIssueView({
  issue,
  comments = [],
  pullRequests = [],
  rolePasses = [],
  validations = [],
  reviewFindings = [],
} = {}) {
  const classification = classifyIssue({
    labels: issue?.labels || [],
    body: issue?.body || '',
    comments,
  })
  const phaseState = derivePhaseState({ issue, rolePasses, validations, reviewFindings })
  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url || issue.url,
    state: issue.state,
    classification,
    phaseState,
    phases: COCKPIT_PHASES.map((phase) => ({
      ...phase,
      status:
        phase.slug === phaseState.currentPhase
          ? 'active'
          : hasRolePass(rolePasses, phase)
            ? 'complete'
            : 'unknown',
    })),
    evidenceHealth: buildEvidenceHealth({
      issue,
      rolePasses,
      validations,
      reviewFindings,
      classification,
    }),
    commentLanes: groupCommentsByLane(comments),
    relationships: extractIssueRelationships({ body: issue.body || '', comments, pullRequests }),
    nextSafeAction: phaseState.nextSafeAction,
  }
}

export function buildGoalBoard({ issues = [] } = {}) {
  const columns = Object.fromEntries(GOAL_COLUMNS.map((column) => [column, []]))
  for (const issue of issues) {
    const view = buildCockpitIssueView({ issue })
    columns[classifyGoalColumn(view)].push({
      number: issue.number,
      title: issue.title,
      url: issue.html_url || issue.url,
      evidenceHealth: view.evidenceHealth.status,
      nextSafeAction: view.nextSafeAction,
      isEpic: view.classification.isEpic,
    })
  }
  return columns
}

export function buildEpicRollup({ epic, childIssues = [] } = {}) {
  const childViews = childIssues.map((issue) => buildCockpitIssueView({ issue }))
  return {
    epic: buildCockpitIssueView({ issue: epic }),
    children: childViews,
    totals: {
      children: childViews.length,
      blocked: childViews.filter(
        (view) =>
          view.nextSafeAction !== 'advance-next-phase' || view.evidenceHealth.status !== 'complete',
      ).length,
      evidenceComplete: childViews.filter((view) => view.evidenceHealth.status === 'complete')
        .length,
    },
  }
}

export function buildEvidenceHealth({
  issue = {},
  rolePasses = [],
  validations = [],
  reviewFindings = [],
  classification,
} = {}) {
  const checks = [
    {
      id: 'agentflow-managed',
      ok: Boolean(classification?.isAgentFlowManaged),
      label: 'AgentFlow-managed issue signal',
    },
    {
      id: 'acceptance',
      ok: /## Acceptance criteria/i.test(issue.body || ''),
      label: 'Acceptance criteria section',
    },
    { id: 'test-plan', ok: /## Test plan/i.test(issue.body || ''), label: 'Test plan section' },
    {
      id: 'role-pass',
      ok: rolePasses.length === 0 || derivePhaseState({ issue, rolePasses }).rolePassComplete,
      label: 'Role-pass evidence complete',
    },
    {
      id: 'validation',
      ok: validations.length === 0 || validations.every((item) => item.status === 'passed'),
      label: 'Validation not failing',
    },
    {
      id: 'review',
      ok: !reviewFindings.some(
        (finding) => finding.severity === 'blocker' || finding.status === 'blocking',
      ),
      label: 'No blocking review findings',
    },
  ]
  const missing = checks.filter((check) => !check.ok)
  return { status: missing.length ? 'incomplete' : 'complete', checks, missing }
}

function hasRolePass(rolePasses, phase) {
  return rolePasses.some(
    (pass) => pass.phaseSlug === phase.slug || Number(pass.phase) === phase.index,
  )
}

function classifyGoalColumn(view) {
  if (view.evidenceHealth.status !== 'complete') return 'Blocked'
  if (view.nextSafeAction === 'resolve-review-findings') return 'Review'
  if (view.nextSafeAction === 'return-to-developer') return 'Validation'
  if (view.nextSafeAction === 'complete-role-pass-evidence') return 'Blocked'
  if (view.phaseState.currentPhase === 'pr-readiness') return 'PR Ready'
  return 'Scoped'
}

export const GOAL_COLUMNS = [
  'Intake',
  'Scoped',
  'Planned',
  'Implementation',
  'Validation',
  'Review',
  'PR Ready',
  'Done',
  'Blocked',
]
