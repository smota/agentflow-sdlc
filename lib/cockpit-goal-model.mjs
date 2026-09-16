import { COCKPIT_PHASES, classifyIssue } from './cockpit-domain.mjs'
import { DEFAULT_PROFILE_REQUIREMENTS, DEFAULT_PROFILE_MAXIMUMS } from './sdlc-vocabulary.mjs'
import { extractIssueRelationships } from './cockpit-markdown.mjs'
import { goalRevision } from './core/goal-revision.mjs'
import { unitIdentity } from './core/unit-identity.mjs'
import { deriveCrossings, GATE_CLASSES } from './core/gate.mjs'
import { resolvePosture, requiredHumanGateClasses, DEFAULT_POSTURE } from './core/posture.mjs'
import {
  releaseAssignmentState as sdlcReleaseAssignmentState,
  releaseCandidateFromIssue,
  releaseImpactFromIssue,
} from './sdlc-state.mjs'

// W8b D1 — the change-class floor resolveHumanGate consults when no adopter `agent-workflow.config.json`
// has been threaded through yet. It mirrors defaults/sdlc.config.json's own `paths.*` values verbatim
// (self-review + human-approval per profile) plus the existing DEFAULT_PROFILE_MAXIMUMS boundary
// ceiling; a caller that has the adopter's real config (e.g. the cockpit server, once that wiring
// lands) can override it via `config`. Kept file-I/O-free so this module never reaches outside itself.
const FALLBACK_POSTURE_CONFIG = Object.freeze({
  paths: Object.freeze({
    bounded: Object.freeze({ allowsSelfReview: true, requiresHumanApproval: false }),
    standard: Object.freeze({ allowsSelfReview: true, requiresHumanApproval: false }),
    'high-assurance': Object.freeze({ allowsSelfReview: false, requiresHumanApproval: true }),
    exploratory: Object.freeze({ allowsSelfReview: true, requiresHumanApproval: false }),
  }),
  actionPolicy: Object.freeze({ profileMaximums: DEFAULT_PROFILE_MAXIMUMS }),
})

export const DISPLAY_STATES = {
  recorded: 'recorded',
  inferred: 'inferred',
  notApplicable: 'not-applicable',
  skippedByPath: 'skipped-by-path',
  notRecorded: 'not-recorded',
  needsAttention: 'needs-attention',
  blocked: 'blocked',
  error: 'error',
}

export const ROLE_REQUIREMENTS = DEFAULT_PROFILE_REQUIREMENTS

export function buildAgentFlowGoalModel({
  issue,
  comments = [],
  pullRequests = [],
  checks = [],
  graph,
  baseBranch = 'development',
  repo,
  satisfiedGates = [],
  posture = DEFAULT_POSTURE,
  postureConfig = FALLBACK_POSTURE_CONFIG,
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
  const selectedPath = deriveSelectedPath({ issue, comments, pullRequests })
  const versionLens = deriveVersionLens({ issue, comments, pullRequests, baseBranch })
  // Revision: the content digest, computed by the ONE shared recipe (lib/core/goal-revision.mjs)
  // that scripts/run-delivery.mjs's run track also calls — never re-typed here (W8c D2). Computed
  // here (rather than further down) because deriveHumanGate needs it: an adequacy-of-intent gate
  // always ranges over the goal's OWN revision (lib/core/gate.mjs), so that is the subject a
  // satisfied gate must match to complete the human gate below (W8b D2).
  const revision = goalRevision({
    repo,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    updatedAt: issue.updated_at,
  })
  // Identity: stable across edits, unlike revision above — the ONE identity function (W8c D1),
  // namespaced by source and repo so two repositories can never collide on the same issue number.
  // Run ids used by a human's close-unit (scripts/cockpit-server.mjs) and by the actuator
  // (scripts/actuate-readiness.mjs) both derive from this SAME identity, so a human decision and the
  // gate it answers land on the same run.
  const identity = unitIdentity({ repo, id: issue.number })
  const humanGate = deriveHumanGate({
    selectedPath,
    comments,
    pullRequests,
    subjectDigest: revision,
    satisfiedGates,
    posture,
    config: postureConfig,
  })
  const roleContributions = buildRoleContributions({
    issue,
    comments,
    pullRequests,
    checks,
    selectedPath,
  })
  const evidenceHealth = buildReadinessHealth({
    issue,
    comments,
    pullRequests,
    checks,
    classification,
    relationships,
    selectedPath,
    roleContributions,
    versionLens,
  })
  const nextBestActions = deriveNextBestActions({
    issue,
    comments,
    pullRequests,
    checks,
    selectedPath,
    evidenceHealth,
    versionLens,
  })
  const status = deriveGoalStatus({ issue, pullRequests, nextBestActions, evidenceHealth })
  const highlights = deriveHighlights({
    pullRequests,
    nextBestActions,
    evidenceHealth,
    relationships,
    selectedPath,
    versionLens,
  })
  // `revision` was computed above, before humanGate, because deriveHumanGate needs it as the
  // adequacy-of-intent gate's subject. `id` IS the canonical identity (W8c D1) — stable across
  // edits, namespaced by source and repo — and is what relations, the unit graph, and run ids key
  // by. Anything keying, comparing or deduplicating an edit's CONTENT must still use `revision`.
  return {
    id: identity,
    revision,
    number: issue.number,
    title: issue.title,
    url: issue.html_url || issue.url,
    // partOf is an opaque parent reference reconstructed from body text (never the source system's
    // native hierarchy — see extractIssueRelationships). It carries the parent's identity (D3: keyed
    // by identity, never revision — revision is resolved once all intents in a batch are known,
    // resolvePartOf, called from buildCommandCenterModel; a standalone build only knows the parent's
    // issue number).
    partOf: relationships.partOfIssue
      ? {
          number: relationships.partOfIssue,
          identity: unitIdentity({ repo, id: relationships.partOfIssue }),
          revision: null,
        }
      : null,
    status,
    selectedPath,
    confidence: evidenceHealth.score,
    nextBestActions,
    roleContributions,
    evidenceHealth,
    versionLens,
    humanGate,
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
  repo,
} = {}) {
  const goals = resolvePartOf(
    issues
      .filter((issue) => !issue.pull_request)
      .map((issue) =>
        buildAgentFlowGoalModel({
          issue,
          comments: commentsByIssue[issue.number] || [],
          pullRequests: pullRequestsByIssue[issue.number] || [],
          repo,
        }),
      ),
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
  const releaseDashboard = buildReleaseDashboard(goals)
  return {
    metrics: {
      activeGoals: goals.filter((goal) => goal.status !== 'done').length,
      needAttention: needingAttention.length,
      readyForReview: readyForReview.length,
      evidenceHealthAverage: healthAverage,
      openFollowUps: goals.reduce((sum, goal) => sum + goal.durableLinks.followUps.length, 0),
      humanGatesPending: topActions.filter((action) => action.id === 'request-human-gate').length,
      awaitingRelease: releaseDashboard.awaitingRelease.length,
      missingReleaseNotes: releaseDashboard.missingReleaseNotes.length,
      releaseBlockers: releaseDashboard.blockers.length,
    },
    highlight:
      needingAttention[0] || goals.find((goal) => goal.status === 'ready') || goals[0] || null,
    topActions,
    releaseDashboard,
    goals,
  }
}

// AgentFlow reconstructs the intent tree from opaque parent references, never from the source
// system's native hierarchy. Each intent already knows its parent's issue NUMBER (scraped from body
// text). Once a batch of intents is known, this resolves that opaque reference to the parent's
// actual revision — walking this repeatedly (parent's own partOf, in turn) reconstructs a tree of
// arbitrary depth even though the source system (e.g. GitHub) only ever exposes one level.
export function resolvePartOf(goals = []) {
  // D3 (W8c) — keyed by IDENTITY, never revision. Revision is a content digest that changes on
  // every edit; keying this map by revision would break every partOf relation the instant its
  // parent (or the child itself) was edited. `goal.id` is the canonical identity (D1).
  const byIdentity = new Map(goals.map((goal) => [goal.id, goal]))
  return goals.map((goal) => {
    if (!goal.partOf) return goal
    const parent = byIdentity.get(goal.partOf.identity)
    return {
      ...goal,
      partOf: {
        number: goal.partOf.number,
        identity: goal.partOf.identity,
        revision: parent?.revision ?? null,
      },
    }
  })
}

export function buildReleaseDashboard(goals = []) {
  const awaitingRelease = goals.filter((goal) => goal.versionLens.state === 'awaiting-release')
  const missingReleaseNotes = goals.filter(
    (goal) => goal.versionLens.releaseNoteState === 'needs-decision',
  )
  const needsAssignment = goals.filter(
    (goal) => goal.versionLens.assignmentState === 'needs-assignment',
  )
  const released = goals.filter((goal) => goal.versionLens.assignmentState === 'released')
  const unreleased = goals.filter((goal) =>
    ['assigned', 'needs-assignment'].includes(goal.versionLens.assignmentState),
  )
  const blockers = goals.filter(
    (goal) => goal.status === 'blocked' || goal.humanGate.status === 'not-requested',
  )
  const explicitCandidate = goals.find((goal) => goal.versionLens.candidateVersion)?.versionLens
    .candidateVersion
  const releaseCandidate = explicitCandidate || 'Next release'
  const targetBranch =
    awaitingRelease[0]?.versionLens.targetBranch ||
    goals[0]?.versionLens?.targetBranch ||
    'development'
  return {
    releaseCandidate,
    targetBranch,
    awaitingRelease,
    missingReleaseNotes,
    needsAssignment,
    released,
    unreleased,
    blockers,
    includedGoals: goals.filter((goal) => goal.versionLens.releaseImpact !== 'none'),
    readyCount: awaitingRelease.filter((goal) => !missingReleaseNotes.includes(goal)).length,
  }
}

export function deriveSelectedPath({ issue = {}, comments = [], pullRequests = [] } = {}) {
  const body = `${issue.body || ''}\n${commentsText(comments)}`
  const labelNames = (issue.labels || [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter(Boolean)
  const explicitProfile = fieldMatch(
    body,
    /(profile|workflow classification)\s*:?\s*(bounded|standard|high-assurance|exploratory)/i,
  )
  const profile = explicitProfile || profileFromSignals({ body, labels: labelNames, pullRequests })
  const risk = riskFromSignals({ body, labels: labelNames, profile })
  const requirements = ROLE_REQUIREMENTS[profile] || ROLE_REQUIREMENTS.standard
  const applicableRoles = [...requirements.required]
  const skippedRoles = COCKPIT_PHASES.filter((phase) =>
    requirements.optional.includes(phase.slug),
  ).map((phase) => ({
    role: phase.slug,
    label: phase.label,
    state: DISPLAY_STATES.skippedByPath,
    reason: skipReason({ phase, profile, risk }),
    scoreImpact: 'excluded',
  }))
  return {
    profile,
    risk,
    applicableRoles,
    skippedRoles,
    source: explicitProfile ? 'recorded' : 'inferred',
  }
}

// This answers "does a human have to act here?" from actual gates (lib/core/gate.mjs) and posture
// (lib/core/posture.mjs), never from a hardcoded profile string or regex over comment prose.
//
// W8b2 D1/D2 — `required` no longer collapses to "profile is high-assurance" alone, and no longer
// reads `!effective.allowsSelfReview` either — `allowsSelfReview` answers a different question
// (may a reviewer review their own work) and, standing in for "is a human required", disagreed with
// what the posture itself declares (`resolvePosture(...).humanGateClasses`) in 9 of 16 posture x
// change-class combinations, including the factory default (`assisted` on an ordinary `bounded` or
// `standard` change), where it silently required no human at all. `required` now comes from the
// single pure `requiredHumanGateClasses` (lib/core/posture.mjs) — the same function
// `requiresHumanAcceptance` in lib/application/run-service.mjs calls, so the two decision points
// cannot diverge. A derivable crossing (deriveCrossings) still fires independently, so e.g. an
// exploratory issue that has opened a PR — exceeding what an exploratory path may do unattended —
// also requires a human, exactly like the bounded-run-taking-an-external-action contradiction this
// replaces.
//
// W8b D2 — `complete` is decided only by a satisfied gate over this goal's own subject (a gate
// `lib/core/gate.mjs`'s `satisfyGate` already accepted a real human's attestation for), passed in as
// `satisfiedGates` — never by GitHub's `reviewDecision`, and never by an agent's own comment text
// claiming approval. Wiring the actual source of those satisfied gates (the run store's anchored
// decisions) is W8c; this function only ever takes them as input and defaults to none. GitHub's
// `reviewDecision` is not discarded — it is surfaced as an advisory `hint` for a human to read
// (invariant 9) and never participates in `complete` or `status`.
export function deriveHumanGate({
  selectedPath,
  comments = [],
  pullRequests = [],
  subjectDigest = null,
  satisfiedGates = [],
  posture = DEFAULT_POSTURE,
  config = FALLBACK_POSTURE_CONFIG,
} = {}) {
  const changeClass =
    selectedPath?.profile && config.paths?.[selectedPath.profile]
      ? selectedPath.profile
      : 'standard'
  const effective = resolvePosture({ posture, changeClass, config })
  const effectiveBoundary = pullRequests.length ? 'open-pr' : 'observe'
  const crossings = deriveCrossings({ effectiveBoundary, requestedBoundary: effective.maxBoundary })
  const required =
    requiredHumanGateClasses({ posture, changeClass, config, crossings }).length > 0
  const complete = satisfiedGates.some(
    (gate) =>
      gate?.gateClass === GATE_CLASSES.adequacyOfIntent &&
      subjectDigest != null &&
      gate?.subjectDigest === subjectDigest,
  )
  const requested = required && !complete && hasHumanGateSignal(comments)
  const status = !required
    ? 'not-required'
    : complete
      ? 'approved'
      : requested
        ? 'requested'
        : 'not-requested'
  const reviewDecision = pullRequests.find((pr) => pr.reviewDecision)?.reviewDecision ?? null
  return {
    required,
    reason: required
      ? (crossings[0]?.reason ?? 'Selected path requires a human approval gate.')
      : 'Selected path does not require a human approval gate.',
    status,
    complete,
    // Advisory only (invariant 9): shown to a human, never read by `complete`/`status` above. Proven
    // by test 5 in lib/__tests__/w8b-gate-placement.test.mjs — changing reviewDecision changes only
    // this hint's value, never completion.
    hints: [
      {
        id: 'github-review-decision',
        value: reviewDecision,
        interpretation:
          'Advisory signal from GitHub only; a PR review decision never satisfies or completes this gate.',
      },
    ],
    nextAction:
      required && !complete
        ? requested
          ? 'Track human approval gate to decision.'
          : 'Request human approval gate.'
        : 'No human gate action needed.',
  }
}

export function deriveVersionLens({
  issue = {},
  comments = [],
  pullRequests = [],
  baseBranch = 'development',
} = {}) {
  const body = `${issue.body || ''}\n${commentsText(comments)}`
  const labels = (issue.labels || [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter(Boolean)
  const mergedPr = pullRequests.find((pr) => pr.merged_at || pr.mergedAt)
  const targetBranch = mergedPr?.base?.ref || pullRequests[0]?.base?.ref || baseBranch
  const releaseImpact = releaseImpactFromIssue({ ...issue, body, labels })
  const awaitingRelease =
    labels.includes('awaiting-release') || Boolean(mergedPr && targetBranch === 'development')
  const candidateVersion = releaseCandidateFromIssue({ ...issue, body, labels })
  const releaseNoteState = /release note|changelog/i.test(body)
    ? 'recorded'
    : releaseImpact === 'none'
      ? 'not-needed'
      : 'needs-decision'
  const assignmentState = sdlcReleaseAssignmentState({
    ...issue,
    body,
    labels: awaitingRelease ? [...labels, 'awaiting-release'] : labels,
  })
  return {
    state:
      issue.state === 'closed' && !awaitingRelease
        ? 'delivered-or-closed'
        : awaitingRelease
          ? 'awaiting-release'
          : mergedPr
            ? 'merged'
            : 'in-progress',
    targetBranch,
    releaseImpact,
    awaitingRelease,
    candidateVersion,
    releaseNoteState,
    assignmentState,
    explanation: awaitingRelease
      ? `Merged to ${targetBranch}; release delivery still needs tracking.`
      : mergedPr
        ? `Merged to ${targetBranch}.`
        : 'No merged delivery PR detected yet.',
  }
}

export function buildReadinessHealth({
  issue = {},
  comments = [],
  pullRequests = [],
  checks = [],
  classification,
  relationships,
  selectedPath,
  roleContributions,
  versionLens,
} = {}) {
  const dimensions = [
    scoredDimension(
      'scope',
      hasSection(issue.body, 'Acceptance criteria'),
      true,
      'Scope clarity',
      'Acceptance criteria recorded',
      'Clarify acceptance criteria',
    ),
    scoredDimension(
      'path',
      true,
      true,
      'Path fit',
      `${selectedPath.profile} path selected (${selectedPath.source})`,
      'Review path if risk changes',
    ),
    roleFlowDimension(roleContributions),
    scoredDimension(
      'validation',
      checks.some(isPassingCheck) || hasValidationSignal(comments),
      selectedPath.applicableRoles.includes('tester'),
      'Validation result',
      'Validation check or summary found',
      'Run or record validation',
    ),
    scoredDimension(
      'reviewer',
      hasReviewSignal(comments) || pullRequests.some((pr) => pr.merged_at || pr.mergedAt),
      selectedPath.applicableRoles.includes('reviewer'),
      'Review readiness',
      'Review evidence found or merge indicates accepted review',
      'Record review or request gate',
    ),
    scoredDimension(
      'followUps',
      true,
      true,
      'Follow-up hygiene',
      `${relationships?.followUps?.length || 0} follow-up link(s) detected`,
      'Review follow-up disposition',
    ),
    scoredDimension(
      'version',
      versionLens.releaseImpact !== 'unknown',
      true,
      'Version impact',
      versionLens.explanation,
      'Decide release impact if unclear',
    ),
  ]
  if (!classification?.isAgentFlowManaged) {
    dimensions.unshift({
      id: 'managed',
      label: 'AgentFlow signal',
      score: 70,
      applicable: true,
      state: DISPLAY_STATES.inferred,
      detail: 'Goal inferred from GitHub issue; AgentFlow marker not recorded yet.',
      next: 'Normalize issue when needed.',
    })
  }
  const applicable = dimensions.filter((item) => item.applicable)
  const score = applicable.length
    ? Math.round(applicable.reduce((sum, item) => sum + item.score, 0) / applicable.length)
    : 100
  const grade = score >= 85 ? 'healthy' : score >= 65 ? 'needs-attention' : 'blocked'
  return {
    score,
    grade,
    dimensions,
    denominator: applicable.length,
    excluded: dimensions.filter((item) => !item.applicable).map((item) => item.id),
  }
}

export function buildEvidenceHealthCheck(args = {}) {
  return buildReadinessHealth({
    ...args,
    selectedPath: args.selectedPath || deriveSelectedPath(args),
    roleContributions:
      args.roleContributions ||
      buildRoleContributions({
        ...args,
        selectedPath: args.selectedPath || deriveSelectedPath(args),
      }),
    versionLens: args.versionLens || deriveVersionLens(args),
  })
}

function scoredDimension(id, ok, applicable, label, detail, next) {
  if (!applicable)
    return {
      id,
      label,
      score: 100,
      applicable: false,
      state: DISPLAY_STATES.skippedByPath,
      detail: 'Excluded by selected path.',
      next: 'No action needed.',
    }
  return {
    id,
    label,
    score: ok ? 100 : 40,
    applicable: true,
    state: ok ? DISPLAY_STATES.recorded : DISPLAY_STATES.needsAttention,
    detail,
    next,
  }
}

function roleFlowDimension(roleContributions = []) {
  const applicable = roleContributions.filter((item) => item.applicable)
  const complete = applicable.filter((item) => item.status === 'complete').length
  const score = applicable.length ? Math.round((complete / applicable.length) * 100) : 100
  return {
    id: 'roleFlow',
    label: 'Role flow completion',
    score,
    applicable: true,
    state: score >= 85 ? DISPLAY_STATES.recorded : DISPLAY_STATES.needsAttention,
    detail: `${complete}/${applicable.length} applicable roles complete. Skipped-by-path roles excluded.`,
    next: score >= 85 ? 'Continue role flow.' : 'Complete applicable role contributions.',
  }
}

export function buildRoleContributions({
  issue = {},
  comments = [],
  pullRequests = [],
  checks = [],
  selectedPath = deriveSelectedPath({ issue, comments, pullRequests }),
} = {}) {
  return COCKPIT_PHASES.map((phase) => {
    const applicable = selectedPath.applicableRoles.includes(phase.slug)
    if (!applicable) {
      const skipped = selectedPath.skippedRoles.find((item) => item.role === phase.slug)
      return {
        role: phase.label,
        phase: phase.slug,
        status: 'skipped-by-path',
        applicable: false,
        state: DISPLAY_STATES.skippedByPath,
        summary: skipped?.reason || 'Skipped by selected path',
        evidence: [],
        scoreImpact: 'excluded',
      }
    }
    const inferred = inferRoleContribution(phase, { issue, comments, pullRequests, checks })
    return { role: phase.label, phase: phase.slug, applicable: true, ...inferred }
  })
}

function inferRoleContribution(phase, ctx) {
  const body = ctx.issue.body || ''
  if (phase.slug === 'product-manager')
    return contribution(
      hasAnySection(body, ['Background & Problem Statement', 'Problem']),
      'Goal framed from issue body',
      ['Issue body'],
    )
  if (phase.slug === 'analyst')
    return contribution(
      hasSection(body, 'Acceptance criteria'),
      'Acceptance criteria define done',
      ['Acceptance criteria'],
    )
  if (phase.slug === 'architect')
    return contribution(
      hasSection(body, 'Technical Design') || hasArchitectureSignal(ctx.comments),
      'Design impact considered',
      ['Technical design or architecture comment'],
    )
  if (phase.slug === 'implementation-planner')
    return contribution(
      hasSection(body, 'Test plan') || hasSection(body, 'Workflow classification'),
      'Plan/validation path recorded',
      ['Test plan or workflow classification'],
    )
  if (phase.slug === 'developer')
    return contribution(ctx.pullRequests.length > 0, 'Implementation PR linked', ['Pull request'])
  if (phase.slug === 'tester')
    return contribution(
      ctx.checks.some(isPassingCheck) || hasValidationSignal(ctx.comments),
      'Validation evidence recorded',
      ['Validation summary or check'],
    )
  if (phase.slug === 'reviewer')
    return contribution(
      hasReviewSignal(ctx.comments) || ctx.pullRequests.some((pr) => pr.merged_at || pr.mergedAt),
      'Review or acceptance gate visible',
      ['Review/gate signal'],
    )
  if (phase.slug === 'technical-writer')
    return contribution(
      /docs|documentation|tech writer/i.test(body + commentsText(ctx.comments)),
      'Documentation considered',
      ['Documentation signal'],
    )
  if (phase.slug === 'pr-readiness')
    return contribution(ctx.pullRequests.length > 0, 'PR readiness linked', ['Pull request'])
  return {
    status: 'not-applicable',
    state: DISPLAY_STATES.notApplicable,
    summary: 'Not applicable',
    evidence: [],
  }
}

function contribution(ok, summary, evidence) {
  return ok
    ? { status: 'complete', state: DISPLAY_STATES.recorded, summary, evidence }
    : {
        status: 'not-started',
        state: DISPLAY_STATES.notRecorded,
        summary: 'Not recorded yet',
        evidence: [],
      }
}

export function deriveNextBestActions({
  issue = {},
  comments = [],
  pullRequests = [],
  checks = [],
  selectedPath = deriveSelectedPath({ issue, comments, pullRequests }),
  versionLens = deriveVersionLens({ issue, comments, pullRequests }),
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
  if (
    selectedPath.applicableRoles.includes('architect') &&
    !hasSection(body, 'Technical Design') &&
    !hasArchitectureSignal(comments)
  )
    actions.push(
      action(
        'check-design',
        'Check design impact',
        'Architecture/design contribution is applicable but not recorded.',
        80,
      ),
    )
  if (!pullRequests.length)
    actions.push(
      action(
        'connect-pr',
        'Connect implementation PR',
        'No delivery PR is linked to this goal yet.',
        70,
      ),
    )
  if (
    selectedPath.applicableRoles.includes('tester') &&
    !checks.some(isPassingCheck) &&
    !hasValidationSignal(comments)
  )
    actions.push(
      action(
        'record-validation',
        'Record validation result',
        'Validation contribution is applicable but not recorded.',
        90,
      ),
    )
  if (
    selectedPath.applicableRoles.includes('reviewer') &&
    !hasReviewSignal(comments) &&
    pullRequests.length
  )
    actions.push(
      action(
        'request-review',
        'Request or record review',
        'Delivery exists; review/gate status should be visible.',
        75,
      ),
    )
  if (selectedPath.profile === 'high-assurance' && !hasHumanGateSignal(comments))
    actions.push(
      action(
        'request-human-gate',
        'Request human approval gate',
        'This selected path requires an explicit human decision before readiness.',
        95,
      ),
    )
  if (versionLens.releaseNoteState === 'needs-decision')
    actions.push(
      action(
        'decide-release-impact',
        'Decide release impact',
        'Version/release lens needs release note or no-impact decision.',
        55,
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
  pullRequests = [],
  nextBestActions = [],
  evidenceHealth,
  relationships,
  selectedPath,
  versionLens,
}) {
  return [
    { label: 'Current focus', value: nextBestActions[0]?.label || 'Continue role flow' },
    { label: 'Readiness health', value: `${evidenceHealth.score}/100 (${evidenceHealth.grade})` },
    { label: 'Selected path', value: `${selectedPath.profile} · ${selectedPath.risk} risk` },
    { label: 'Version', value: `${versionLens.releaseImpact} · ${versionLens.state}` },
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

function profileFromSignals({ body, labels, pullRequests }) {
  if (
    /high-assurance|security|auth|remote|regulated|human gate/i.test(body) ||
    labels.some((label) => /security|high-assurance/i.test(label))
  )
    return 'high-assurance'
  if (/exploratory|spike|research/i.test(body)) return 'exploratory'
  if (
    /docs-only|documentation|typo|bounded|low-risk/i.test(body) ||
    labels.includes('documentation')
  )
    return 'bounded'
  if (pullRequests.length && !/Technical Design/i.test(body)) return 'bounded'
  return 'standard'
}
function riskFromSignals({ body, labels, profile }) {
  if (
    profile === 'high-assurance' ||
    /security|auth|remote|migration|data loss|deploy/i.test(body) ||
    labels.some((label) => /security|high-risk/i.test(label))
  )
    return 'high'
  if (/architecture|integration|workflow|release/i.test(body)) return 'medium'
  return 'low'
}
function skipReason({ phase, profile, risk }) {
  if (profile === 'bounded')
    return `${phase.label} skipped by bounded low-risk path; no readiness penalty.`
  if (profile === 'exploratory') return `${phase.label} not required for exploratory path yet.`
  return `${phase.label} optional for ${profile} path.`
}
function fieldMatch(text, regex) {
  return text.match(regex)?.[2]?.toLowerCase()
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
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
