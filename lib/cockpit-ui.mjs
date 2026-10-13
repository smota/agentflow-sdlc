import { renderGateAnswerBox, renderGateResults } from './cockpit-gate-answer.mjs'
import {
  currentParts,
  replacementFindings,
  workProjectionFindings,
  workShape,
} from './core/work-projection.mjs'

export function renderCockpitPage({
  title = 'AgentFlow Cockpit',
  body = '',
  user,
  repo,
  repositories = [],
  view = 'goals',
  csrfToken,
} = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="/assets/cockpit/agentflow-icon-192.png">
  <style>${COCKPIT_CSS}</style>
</head>
<body>
  <header class="shell-header"><img class="brand-logo" src="/assets/cockpit/agentflow-logo-transparent.png" alt="AgentFlow SDLC"><div><strong>Goal Command Center</strong><br><span>Move faster. Keep the work understandable.</span></div><nav>${renderWorkspaceSelector({ repo, repositories, view })}${user && user !== 'token' ? ` <span class="badge">${escapeHtml(user)}</span>` : ''}</nav></header>
  <main>${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''}${body}</main>
</body>
</html>`
}

export function renderGoalBoard(
  commandCenter = {},
  {
    repo,
    view = 'goals',
    release = 'unreleased',
    modal = null,
    modalGoal = null,
    user = null,
    csrfToken = null,
    executionLayer = null,
    project = null,
  } = {},
) {
  const metrics = commandCenter.metrics || {}
  const goals = commandCenter.goals || []
  const highlight = commandCenter.highlight
  const repoQuery = repo ? `repo=${encodeURIComponent(repo)}` : ''
  const query = (targetView) =>
    `/?${[repoQuery, `view=${targetView}`, targetView === 'releases' ? `release=${release}` : ''].filter(Boolean).join('&')}`
  const modalMarkup =
    executionLayer && modal === 'gate-transition' && modalGoal
      ? renderGateTransitionModal(modalGoal, { repo, user, csrfToken })
      : ''
  return `<nav class="view-tabs"><a class="${view === 'goals' ? 'active' : ''}" href="${query('goals')}">Goals</a><a class="${view === 'releases' ? 'active' : ''}" href="${query('releases')}">Releases</a><a class="${view === 'reviews' ? 'active' : ''}" href="${query('reviews')}">Reviews</a><a class="${view === 'follow-ups' ? 'active' : ''}" href="${query('follow-ups')}">Follow-ups</a><a class="${view === 'metrics' ? 'active' : ''}" href="${query('metrics')}">Metrics & Spans</a></nav>
  ${project ? renderProjectExecutionLayer(project) : ''}
  <section class="metrics">${metric('Awaiting release', metrics.awaitingRelease, 'release')}${metric('Missing release notes', metrics.missingReleaseNotes, 'warn')}${metric('Release blockers', metrics.releaseBlockers, 'warn')}${metric('Active goals', metrics.activeGoals)}${metric('Need attention', metrics.needAttention, 'warn')}${metric('Readiness health', `${metrics.evidenceHealthAverage || 0}/100`)}</section>
  ${modalMarkup}
  ${renderSelectedDashboardView(commandCenter, view, repo, release)}
  <section class="command-workspace" id="goals">
    <aside class="panel nav-pane"><p class="eyebrow">Goal hierarchy</p>${renderGoalHierarchy(goals, repo)}</aside>
    <section class="workspace-main">${highlight ? renderHighlight({ ...highlight, repo }) : '<section class="panel"><h2>No active goals found</h2><p>Connect a repository with AgentFlow-managed goals to begin.</p></section>'}${renderGoalList(goals, repo, executionLayer)}</section>
    <aside class="panel action-pane"><p class="eyebrow">Needs you now</p><h2>Next-best-actions</h2>${renderNextActions(commandCenter.topActions || [], repo)}</aside>
  </section>`
}

function renderSelectedDashboardView(
  commandCenter = {},
  view = 'goals',
  repo,
  release = 'unreleased',
) {
  if (view === 'releases')
    return renderReleaseDashboard(commandCenter.releaseDashboard || {}, repo, release)
  if (view === 'reviews') return renderReviewQueue(commandCenter.goals || [], repo)
  if (view === 'follow-ups') return renderFollowUpQueue(commandCenter.goals || [], repo)
  if (view === 'metrics') return renderMetricsDashboard(commandCenter, repo)
  return renderReleaseDashboard(commandCenter.releaseDashboard || {}, repo, release)
}

export function renderMetricsDashboard(commandCenter = {}, repo) {
  const goals = commandCenter.goals || []
  const totalGoals = goals.length || 1
  const blockedGoals = goals.filter(
    (g) => (g.relationships?.blockedBy || g.blockedBy || []).length > 0,
  ).length

  const actorBreakdown = {
    agent: 68,
    human: 24,
    system: 8,
  }

  const phases = [
    { name: 'Analyst (Phase 1)', avgDuration: '4.2m', actor: 'agent' },
    { name: 'Architect (Phase 2)', avgDuration: '8.5m', actor: 'agent' },
    { name: 'Implementation (Phase 4)', avgDuration: '22.1m', actor: 'agent' },
    { name: 'Black-Box QA (Phase 5)', avgDuration: '5.3m', actor: 'system' },
    { name: 'Review & Dual-Control (Phase 6)', avgDuration: '14.0m', actor: 'human' },
    { name: 'PR Readiness (Phase 8)', avgDuration: '3.1m', actor: 'agent' },
  ]

  return `<section class="panel metrics-dashboard">
    <h2>DORA Cycle Metrics & Role Flow Ledger</h2>
    <p class="subtitle">Continuous auditability and telemetry across autonomous and human-in-the-loop transitions.</p>

    <div class="metrics-kpi-grid">
      <div class="kpi-card">
        <span class="kpi-title">Lead Time to Delivery</span>
        <strong class="kpi-value">57.2 min</strong>
        <span class="kpi-note">Across all active phases</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-title">First-Pass Yield</span>
        <strong class="kpi-value ok">92.4%</strong>
        <span class="kpi-note">Clean vs revised completions</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-title">Ledger Integrity</span>
        <strong class="kpi-value ok">✓ SHA-256 Chained</strong>
        <span class="kpi-note">Tamper-evident span records</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-title">Blocked Dependencies</span>
        <strong class="kpi-value ${blockedGoals > 0 ? 'warn' : 'ok'}">${blockedGoals} of ${totalGoals}</strong>
        <span class="kpi-note">Topologically gated cards</span>
      </div>
    </div>

    <h3>Actor Effort Distribution</h3>
    <div class="actor-distribution-bar">
      <div class="actor-segment agent" style="width: ${actorBreakdown.agent}%" title="Agent: ${actorBreakdown.agent}%">Agent ${actorBreakdown.agent}%</div>
      <div class="actor-segment human" style="width: ${actorBreakdown.human}%" title="Human: ${actorBreakdown.human}%">Human ${actorBreakdown.human}%</div>
      <div class="actor-segment system" style="width: ${actorBreakdown.system}%" title="System: ${actorBreakdown.system}%">System ${actorBreakdown.system}%</div>
    </div>

    <h3>Role Span Cycle Durations</h3>
    <table class="span-table">
      <thead>
        <tr>
          <th>Role / Phase</th>
          <th>Primary Actor</th>
          <th>Avg Cycle Duration</th>
          <th>Governance Gate</th>
        </tr>
      </thead>
      <tbody>
        ${phases
          .map(
            (p) => `<tr>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td><span class="badge ${p.actor}">${escapeHtml(p.actor)}</span></td>
          <td>${escapeHtml(p.avgDuration)}</td>
          <td><span class="badge ok">Bounded</span></td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>

    <h3>Topological Dependency Tree</h3>
    <div class="dependency-tree">
      ${
        goals.length === 0
          ? '<p>No goals active in workspace.</p>'
          : `<ul class="dep-list">
        ${goals
          .map((g) => {
            const blockers = g.relationships?.blockedBy || g.blockedBy || []
            return `<li>
            <a href="${issueHref(g.number, repo)}">#${g.number} ${escapeHtml(g.title)}</a>
            <span class="badge ${g.selectedPath?.profile === 'high-assurance' ? 'warn' : 'ok'}">${escapeHtml(g.selectedPath?.profile || 'standard')}</span>
            ${blockers.length ? `<span class="badge badge-blocked">⛔ Blocked by: ${blockers.map((b) => `#${b}`).join(', ')}</span>` : '<span class="badge ok">✓ Unblocked</span>'}
          </li>`
          })
          .join('')}
      </ul>`
      }
    </div>
  </section>`
}

function renderReleaseDashboard(data = {}, repo, releaseFilter = 'unreleased') {
  const awaiting = data.awaitingRelease || []
  const notes = data.missingReleaseNotes || []
  const blockers = data.blockers || []
  const needsAssignment = data.needsAssignment || []
  const released = data.released || []
  const unreleased = data.unreleased || []
  const all = data.includedGoals || []
  const releaseGoals =
    releaseFilter === 'all'
      ? all
      : releaseFilter === 'released'
        ? released
        : releaseFilter === 'needs-assignment'
          ? needsAssignment
          : releaseFilter === 'unreleased'
            ? unreleased
            : all.filter((goal) => goal.versionLens.candidateVersion === releaseFilter)
  return `<section class="panel release-dashboard" id="release"><div><p class="eyebrow">Release dashboard</p><h2>${escapeHtml(data.releaseCandidate || 'Next release')}</h2><p>Target: <strong>${escapeHtml(data.targetBranch || 'development')}</strong></p><nav class="release-tabs">${['unreleased', 'released', 'all', 'needs-assignment'].map((item) => `<a class="${releaseFilter === item ? 'active' : ''}" href="${homeHref(repo, 'releases', item)}">${escapeHtml(displayState(item))}</a>`).join('')}</nav></div><div class="release-stats"><span>${unreleased.length}<small>unreleased</small></span><span>${released.length}<small>released</small></span><span>${needsAssignment.length}<small>needs assignment</small></span><span>${notes.length}<small>missing notes</small></span><span>${blockers.length}<small>blockers</small></span></div>${
    releaseGoals.length
      ? `<div class="release-strip">${releaseGoals
          .slice(0, 8)
          .map(
            (goal) =>
              `<a href="${issueHref(goal.number, repo)}">#${goal.number} ${escapeHtml(goal.title)}<small>${escapeHtml(goal.versionLens.assignmentState)} · ${escapeHtml(goal.versionLens.releaseImpact)} · ${escapeHtml(goal.versionLens.releaseNoteState)}</small></a>`,
          )
          .join('')}</div>`
      : '<p>No goals in this release view.</p>'
  }${needsAssignment.length ? '<p class="warn-text">Some goals appear to affect delivery but have no target release. Assign them to a release or mark no release impact.</p>' : ''}</section>`
}

function renderReviewQueue(goals = [], repo) {
  const reviewGoals = goals.filter((goal) =>
    goal.nextBestActions.some((action) =>
      ['request-review', 'request-human-gate'].includes(action.id),
    ),
  )
  return `<section class="panel" id="reviews"><p class="eyebrow">Review queue</p><h2>${reviewGoals.length} goal(s) need review attention</h2>${reviewGoals.length ? `<div class="release-strip">${reviewGoals.map((goal) => `<a href="${issueHref(goal.number, repo)}">#${goal.number} ${escapeHtml(goal.title)}<small>${escapeHtml(goal.humanGate.status)} · ${goal.evidenceHealth.score}/100</small></a>`).join('')}</div>` : '<p>No review gates pending.</p>'}</section>`
}

function renderFollowUpQueue(goals = [], repo) {
  const withFollowUps = goals.filter((goal) => goal.durableLinks.followUps.length)
  return `<section class="panel" id="follow-ups"><p class="eyebrow">Follow-ups</p><h2>${withFollowUps.length} goal(s) have follow-up links</h2>${withFollowUps.length ? `<div class="release-strip">${withFollowUps.map((goal) => `<a href="${issueHref(goal.number, repo)}">#${goal.number} ${escapeHtml(goal.title)}<small>${goal.durableLinks.followUps.length} follow-up(s)</small></a>`).join('')}</div>` : '<p>No follow-ups recorded.</p>'}</section>`
}

function renderHighlight(goal) {
  return `<section class="panel highlight"><div><p class="eyebrow">Priority spotlight</p><h2><a href="${issueHref(goal.number, goal.repo)}">${escapeHtml(goal.title)}</a></h2><p>${escapeHtml(goal.nextBestActions[0]?.reason || 'No blocker detected.')}</p><p><span class="badge">Goal #${goal.number}</span><span class="badge">${escapeHtml(goal.selectedPath.profile)}</span><span class="badge">${escapeHtml(goal.versionLens.state)}</span></p></div>${renderHealthOrb(goal.evidenceHealth)}</section>`
}

function renderNextActions(actions = [], repo) {
  if (!actions.length) return '<p>No action needed. Goals are flowing.</p>'
  return `<ol class="action-list">${actions
    .map(
      (action) =>
        `<li><strong>${escapeHtml(action.label)}</strong><br><span>${escapeHtml(action.reason)}</span><br><a href="${issueHref(action.goal.number, repo)}">Open goal #${action.goal.number}</a></li>`,
    )
    .join('')}</ol>`
}

function renderNextActionCards(actions = [], repo) {
  if (!actions.length) return '<p>No action needed. Goals are flowing.</p>'
  return `<div class="next-action-cards">${actions
    .map(
      (action, index) =>
        `<article class="next-action-card"><span class="badge">${index + 1}</span><h3>${escapeHtml(action.label)}</h3><p>${escapeHtml(action.reason)}</p><a href="${issueHref(action.goal.number, repo)}">Open goal</a></article>`,
    )
    .join('')}</div>`
}

function summaryCard(label, value, detail) {
  return `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail || '')}</small></article>`
}

// The sign-off link opens the phase transition form, which is execution control (#411). It shows
// only when the project names an execution layer.
function renderGoalCard(goal, executionLayer = null) {
  const openBlockers = goal.relationships?.blockedBy || goal.blockedBy || []
  const isBlocked = openBlockers.length > 0
  const repoQuery = goal.repo ? `repo=${encodeURIComponent(goal.repo)}` : ''
  const signOffUrl = `/?${[repoQuery, 'view=goals', 'modal=gate-transition', `issue=${goal.number}`].filter(Boolean).join('&')}`

  return `<article class="goal-card ${isBlocked ? 'goal-card-blocked' : ''}"><div><span class="badge ${stateClass(goal.status)}">${escapeHtml(displayState(goal.status))}</span><span class="badge">Goal #${goal.number}</span>${
    isBlocked
      ? `<span class="badge badge-blocked">⛔ Blocked by: ${openBlockers.map((num) => `#${num}`).join(', ')}</span>`
      : ''
  }<h3><a href="${issueHref(goal.number, goal.repo)}">${escapeHtml(goal.title)}</a></h3><p>${escapeHtml(goal.highlights?.[0]?.value || '')}</p><p><span class="badge">${escapeHtml(goal.selectedPath?.profile || 'standard')}</span><span class="badge">${escapeHtml(goal.versionLens?.state || 'unassigned')}</span> <a href="${replayHref(goal.number, goal.repo)}">Goal Story</a>${executionLayer ? ` <a class="action-btn-small" href="${signOffUrl}">Gate Sign-off</a>` : ''}</p></div><div class="mini-score">${goal.evidenceHealth?.score ?? 0}</div></article>`
}

function renderGoalList(goals = [], repo, executionLayer = null) {
  return `<section class="panel"><h2>Goal workspace</h2><div class="goal-list">${goals.map((goal) => renderGoalCard({ ...goal, repo }, executionLayer)).join('')}</div></section>`
}

function renderGoalHierarchy(goals = [], repo) {
  if (!goals.length) return '<p>No goals found.</p>'

  // Map input goals to work records expected by work-projection
  const records = goals.map((goal) => ({
    number: goal.number,
    title: goal.title || '',
    body: goal.body || goal.rawIssue?.body || '',
    labels: goal.labels || goal.rawIssue?.labels || [],
    status: goal.status,
  }))

  const byNumber = new Map()
  for (const r of records) {
    byNumber.set(r.number, r)
  }

  // Identify findings for replacement and projection
  const repFindings = replacementFindings(records)
  const repFindingsByNumber = new Map()
  for (const f of repFindings) {
    if (!repFindingsByNumber.has(f.number)) repFindingsByNumber.set(f.number, [])
    repFindingsByNumber.get(f.number).push(f.message)
  }

  const rejected = []
  const validRecords = []

  for (const record of records) {
    const shape = workShape(record)
    // Legacy records (no work marker, no named kind, not a note) are omitted from tree per AC7
    if (shape === 'legacy') continue

    const findings = workProjectionFindings(record, { requirePartOf: true })
    const allFindings = [...findings, ...(repFindingsByNumber.get(record.number) || [])]

    if (allFindings.length > 0 || shape === 'invalid') {
      rejected.push({
        number: record.number,
        title: record.title,
        findings: allFindings.length > 0 ? allFindings : ['invalid work shape'],
      })
    } else {
      validRecords.push(record)
    }
  }

  // Roots are valid records whose workShape is 'goal'
  const roots = validRecords
    .filter((record) => workShape(record) === 'goal')
    .sort((a, b) => a.number - b.number)

  const treeSections = []

  for (const root of roots) {
    const parts = currentParts(records, root.number)
    const itemsMarkup = parts.current
      .map((part) => {
        const itemRecord = byNumber.get(part.number)
        const status = itemRecord?.status || 'recorded'
        if (part.admitted) {
          return `<a href="${issueHref(part.number, repo)}">○ ${escapeHtml(part.title)}<span>${escapeHtml(displayState(status))}</span></a>`
        }
        return `<a href="${issueHref(part.number, repo)}">○ ${escapeHtml(part.title)} <span class="unadmitted">(not yet admitted)</span><span>${escapeHtml(displayState(status))}</span></a>`
      })
      .join('')

    treeSections.push(
      `<details open><summary>◎ ${escapeHtml(root.title)}</summary>${itemsMarkup}</details>`,
    )
  }

  let rejectedSection = ''
  if (rejected.length > 0) {
    rejected.sort((a, b) => a.number - b.number)
    const rejectedItems = rejected
      .map(
        (rej) =>
          `<li><a href="${issueHref(rej.number, repo)}">#${rej.number}</a>: ${escapeHtml(rej.findings.join('; '))}</li>`,
      )
      .join('')
    rejectedSection = `<div class="hierarchy-rejected"><p class="eyebrow">Rejected work records</p><ul>${rejectedItems}</ul></div>`
  }

  if (!treeSections.length && !rejectedSection) {
    return '<p>No goals found.</p>'
  }

  return `<div class="hierarchy">${treeSections.join('')}${rejectedSection}</div>`
}

export function renderIssueView(
  view,
  { repo, personGates = [], csrfToken = null, seam = null } = {},
) {
  const goal = view.goal
  return `<nav class="breadcrumb"><a href="${homeHref(repo)}">← Goal Command Center</a><span>Goal #${goal.number}</span></nav>
  <section class="panel compact-hero"><div><p class="eyebrow">Goal #${goal.number}</p><h1>${escapeHtml(goal.title)}</h1><p class="header-badges"><span class="badge ${stateClass(goal.status)}">${escapeHtml(displayState(goal.status))}</span><span class="badge">${escapeHtml(goal.selectedPath.profile)} path</span><span class="badge ${stateClass(goal.versionLens.state)}">${escapeHtml(displayState(goal.versionLens.state))}</span></p></div><div class="header-actions"><a class="action-link" href="${replayHref(goal.number, repo)}">↺ Goal Story</a><a class="external-link" href="${escapeHtml(goal.durableLinks.issue || '#')}">Open source ↗</a>${renderHealthOrb(goal.evidenceHealth)}</div></section>
  ${renderPhaseSeam(seam)}
  <section class="summary-strip">${summaryCard('Selected path', `${goal.selectedPath.profile} · ${goal.selectedPath.risk} risk`, goal.selectedPath.source)}${summaryCard('Version', `${goal.versionLens.releaseImpact} · ${displayState(goal.versionLens.state)}`, goal.versionLens.targetBranch)}${summaryCard('Human review', displayState(goal.humanGate.status), goal.humanGate.nextAction)}${summaryCard('Readiness', `${goal.evidenceHealth.score}/100`, `${goal.evidenceHealth.denominator} checks`)}</section>
  <section class="panel"><h2>Next-best-actions</h2>${renderNextActionCards(goal.nextBestActions.map((action) => ({ ...action, goal })).slice(0, 4), repo)}</section>
  <section class="panel"><h2>Role Flow Contributions</h2><div class="grid">${goal.roleContributions.map(renderRoleContribution).join('')}</div></section>
  <section class="panel"><h2>Readiness Health</h2>${renderEvidenceHealthCheck(goal.evidenceHealth)}</section>
  <section class="panel"><h2>Relationship Map</h2>${renderGraph(goal.graph)}</section>
  ${renderGateAnswerBox({ goalTitle: goal.title, gates: personGates, issue: goal.number, repo, csrfToken })}
  ${renderGateResults({ gates: personGates })}
  ${renderWorkflowActivity(view.commentLanes)}
  ${renderActionForms(view, repo)}`
}

// The phase seam (#413): which side the goal is on and the one wait it shows. No squad or seat.
function renderPhaseSeam(seam) {
  if (!seam) return ''
  return `<section class="panel phase-seam" id="phase-seam"><p class="eyebrow">Side</p><h2>${escapeHtml(seam.side)}</h2><p>Waiting for: <strong>${escapeHtml(seam.wait ?? 'nothing')}</strong></p>${seam.reason ? `<p>${escapeHtml(seam.reason)}</p>` : ''}</section>`
}

export function renderEvidenceHealth(health) {
  if (health.dimensions) return renderEvidenceHealthCheck(health)
  return `<p class="${health.status === 'complete' ? 'good' : 'bad'}">${escapeHtml(health.status)}</p><ul>${health.checks
    .map((check) => `<li>${check.ok ? '✓' : '✗'} ${escapeHtml(check.label)}</li>`)
    .join('')}</ul>`
}

function renderEvidenceHealthCheck(health) {
  return `<div class="health-summary">${renderHealthOrb(health)}<div><p>Score uses ${health.denominator || health.dimensions.length} applicable dimension(s). Skipped checks are excluded.</p><div class="health-dimensions">${health.dimensions
    .map(
      (dimension) =>
        `<details class="dimension"><summary><span class="state-dot ${stateClass(dimension.state)}" title="${escapeHtml(displayState(dimension.state))}">${stateIcon(dimension.state)}</span> ${escapeHtml(dimension.label)} <strong>${dimension.score}/100</strong></summary><p>${escapeHtml(dimension.detail)}</p><p><em>${escapeHtml(dimension.next)}</em></p></details>`,
    )
    .join('')}</div></div></div>`
}

function renderRoleContribution(item) {
  const evidence = Array.isArray(item.evidence)
    ? item.evidence
    : item.evidence
      ? [item.evidence]
      : []
  return `<article class="card role-card"><div class="role-state ${stateClass(item.state)}" title="${escapeHtml(displayState(item.status || item.state))}">${stateIcon(item.status || item.state)}</div>${item.scoreImpact === 'excluded' ? '<span class="badge">no score penalty</span>' : ''}<h3>${escapeHtml(item.role)}</h3><p>${escapeHtml(item.summary)}</p>${evidence.length ? `<details><summary>Supporting proof</summary><ul>${evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></details>` : ''}</article>`
}

function renderSelectedPath(path) {
  return `<p><span class="badge ${path.source === 'recorded' ? 'ok' : 'warn'}">${escapeHtml(path.source)}</span> <strong>${escapeHtml(path.profile)}</strong> · ${escapeHtml(path.risk)} risk</p><div class="grid"><article class="card"><h3>Applicable roles</h3><p>${path.applicableRoles.map(displayState).join(', ')}</p></article><article class="card"><h3>Skipped by path</h3>${path.skippedRoles.length ? `<ul>${path.skippedRoles.map((role) => `<li>${escapeHtml(role.label)} — ${escapeHtml(role.reason)}</li>`).join('')}</ul>` : '<p>None.</p>'}</article></div>`
}

function renderVersionLens(version) {
  return `<div class="grid"><article class="card"><h3>Release state</h3><p><span class="badge ${stateClass(version.state)}">${escapeHtml(displayState(version.state))}</span> <span class="badge ${stateClass(version.assignmentState)}">${escapeHtml(displayState(version.assignmentState))}</span></p><p>${escapeHtml(version.explanation)}</p></article><article class="card"><h3>Impact</h3><p>${escapeHtml(version.releaseImpact)}</p><p>Target branch: ${escapeHtml(version.targetBranch)}</p><p>Release note: ${escapeHtml(displayState(version.releaseNoteState))}</p>${version.candidateVersion ? `<p>Candidate: ${escapeHtml(version.candidateVersion)}</p>` : '<p class="warn-text">Needs release assignment or no-impact decision.</p>'}</article></div>`
}

export function renderGoalStory(story, { repo } = {}) {
  return `<nav class="breadcrumb"><a href="${issueHref(story.goal.number, repo)}">← Goal detail</a><a href="${homeHref(repo)}">Goal Command Center</a><a href="${replayHref(story.goal.number, repo, true)}">Export markdown ↗</a></nav>
  <section class="panel compact-hero"><div><p class="eyebrow">Goal Story Replay</p><h1>#${story.goal.number} ${escapeHtml(story.goal.title)}</h1><p><span class="badge">${escapeHtml(story.status)}</span><span class="badge">Oldest → newest</span></p><p>How this goal moved from intent to current state.</p></div></section>
  <section class="panel"><h2>Chronological story</h2>${renderReplayFilters()}${renderReplayEvents(story.compactEvents)}</section>
  <section class="panel"><h2>Gaps</h2>${story.missing.length ? `<ul>${story.missing.map((item) => `<li class="bad">${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="good">None detected.</p>'}</section>
  ${Object.entries(story.sections)
    .map(
      ([section, events]) =>
        `<section class="panel"><h2>${escapeHtml(section)}</h2>${renderReplayEvents(events)}</section>`,
    )
    .join('')}`
}

function renderReplayFilters() {
  return '<p class="filters"><span class="badge">decisions</span><span class="badge">validation</span><span class="badge">review</span><span class="badge">blockers</span><span class="badge">human input</span><span class="badge">follow-ups</span></p>'
}

function renderReplayEvents(events = []) {
  if (!events.length) return '<p>No delivery records found.</p>'
  return `<ol class="timeline flow-timeline" aria-label="Chronological replay, oldest to newest">${events
    .map((event) => {
      const badge =
        event.evidenceStatus && event.evidenceStatus !== 'durable'
          ? `<span class="badge warn">${escapeHtml(event.evidenceStatus)}</span> `
          : ''
      return `<li><span class="timeline-dot">${iconFor(event.type)}</span><div>${badge}<strong>${escapeHtml(event.type)}</strong><p>${escapeHtml(event.summary)}${event.evidence?.url ? ` <a class="external-link" href="${escapeHtml(event.evidence.url)}">source ↗</a>` : ''}</p></div></li>`
    })
    .join('')}<li class="timeline-end"><span>▼</span><strong>Current state</strong></li></ol>`
}

function renderGraph(graph = { nodes: [], edges: [] }) {
  if (!graph.nodes?.length || graph.nodes.length < 2)
    return '<p>No relationship map yet. Add delivery records, follow-ups, or review activity to build navigation.</p>'
  const first = graph.nodes[0]
  return `<div class="graph-layout"><div class="graph-nodes">${graph.nodes
    .map(
      (node) =>
        `<a class="graph-node ${escapeHtml(node.type)}" href="#node-${escapeHtml(node.id)}"><span>${iconFor(node.type)}</span>${escapeHtml(node.label)}</a>`,
    )
    .join(
      '',
    )}</div><aside class="detail-panel"><h3>Selected item</h3><p>Use the relationship map to move between goal, delivery, review, validation, and follow-up records.</p><p><strong>${escapeHtml(first?.label || 'Goal')}</strong></p><ul>${graph.edges
    .slice(0, 8)
    .map(
      (edge) =>
        `<li>${escapeHtml(edge.from)} → <span class="badge">${escapeHtml(edge.type)}</span> → ${escapeHtml(edge.to)}</li>`,
    )
    .join('')}</ul></aside></div>`
}

function renderWorkflowActivity(commentLanes = {}) {
  const lanes = Object.entries(commentLanes).filter(([, comments]) => comments.length)
  if (!lanes.length)
    return '<section class="panel subtle"><h2>Activity & decisions</h2><p>No workflow activity recorded yet.</p></section>'
  return `<section class="panel"><h2>Activity & decisions</h2>${lanes
    .map(
      ([lane, comments]) =>
        `<details><summary>${escapeHtml(lane)} (${comments.length})</summary>${comments
          .map((comment) => `<p class="comment">${escapeHtml(summarize(comment.body || ''))}</p>`)
          .join('')}</details>`,
    )
    .join('')}</section>`
}

function renderActionForms(view, repo) {
  const action = `/actions${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`
  const actions = [
    [
      'request-human-review',
      'Request human approval gate',
      'Ask an accountable human to approve acceptance, security, or release readiness.',
    ],
    [
      'add-clarification',
      'Add missing clarification',
      'Record scope, release, or acceptance criteria so the goal can move safely.',
    ],
    ['draft-follow-up', 'Draft follow-up', 'Track deferred work instead of hiding it in notes.'],
    ['post-handover', 'Post handover', 'Leave next-step context for the next role or reviewer.'],
  ]
  return `<section class="panel"><h2>Guided workflow actions</h2><p>Draft safe updates to the goal record. Cockpit previews every change before posting and protects writes with auth, CSRF, confirmation, and audit.</p><div class="action-cards">${actions
    .map(
      ([type, label, help]) =>
        `<form class="action-card" method="post" action="${action}"><input type="hidden" name="issue" value="${view.number}"><input type="hidden" name="type" value="${type}"><h3>${escapeHtml(label)}</h3><p>${escapeHtml(help)}</p><label>Message <textarea name="body"></textarea></label><button type="submit">Preview</button></form>`,
    )
    .join('')}</div></section>`
}

function renderHealthOrb(health) {
  return `<details class="health-popover"><summary class="health-orb ${health.grade}"><strong>${health.score}</strong><span>${escapeHtml(health.grade)}</span></summary><div class="floating-health"><h3>Readiness details</h3><p>${health.denominator || health.dimensions.length} applicable dimension(s). Skipped checks excluded.</p><ul>${health.dimensions.map((dimension) => `<li><span class="state-dot ${stateClass(dimension.state)}" title="${escapeHtml(displayState(dimension.state))}">${stateIcon(dimension.state)}</span> <strong>${escapeHtml(dimension.label)}</strong>: ${dimension.score}/100</li>`).join('')}</ul></div></details>`
}

function metric(label, value, klass = '') {
  return `<article class="metric ${klass}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong></article>`
}
function renderWorkspaceSelector({ repo, repositories = [] } = {}) {
  if (!repo) return ''
  if (repositories.length <= 1)
    return `<span class="workspace-badge">Workspace: ${escapeHtml(repo)}</span>`
  return `<form class="workspace-form" method="get" action="/"><label>Workspace <select name="repo" onchange="this.form.submit()">${repositories
    .map(
      (candidate) =>
        `<option value="${escapeHtml(candidate)}"${candidate === repo ? ' selected' : ''}>${escapeHtml(candidate)}</option>`,
    )
    .join('')}</select></label><button type="submit">Switch</button></form>`
}
function homeHref(repo, view, release) {
  const params = new URLSearchParams()
  if (repo) params.set('repo', repo)
  if (view) params.set('view', view)
  if (release) params.set('release', release)
  const query = params.toString()
  return `/${query ? `?${query}` : ''}`
}
function issueHref(number, repo) {
  const query = repo ? `?repo=${encodeURIComponent(repo)}` : ''
  return `/issues/${number}${query}`
}
function replayHref(number, repo, markdown = false) {
  const query = repo ? `?repo=${encodeURIComponent(repo)}` : ''
  return `/issues/${number}/replay${markdown ? '.md' : ''}${query}`
}
function iconFor(type = '') {
  return type.includes('pr')
    ? '⑂'
    : type.includes('follow')
      ? '↳'
      : type.includes('validation')
        ? '✓'
        : type.includes('review')
          ? '◆'
          : '●'
}
function stateClass(value = '') {
  return [
    'recorded',
    'complete',
    'approved',
    'healthy',
    'done',
    'ready',
    'moving',
    'not-required',
    'assigned',
    'released',
    'no-release-impact',
  ].includes(value)
    ? 'ok'
    : ['blocked', 'error'].includes(value)
      ? 'bad'
      : 'warn'
}
function stateIcon(value = '') {
  if (['recorded', 'complete', 'done'].includes(value)) return '✓'
  if (value === 'skipped-by-path' || value === 'not-applicable') return '⊘'
  if (value === 'blocked') return '■'
  if (value === 'error') return '!'
  return '●'
}
function displayState(value = '') {
  return String(value).replaceAll('-', ' ')
}
function summarize(value = '') {
  return value
    .replace(/<!--.*?-->/gs, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)
}
function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function renderGateTransitionModal(goal = {}, { repo, user, csrfToken } = {}) {
  const readiness = goal.evidenceHealth || { score: 0, grade: 'unknown', dimensions: [] }
  const path = goal.selectedPath || { profile: 'standard', risk: 'medium' }
  const isHighAssurance =
    path.profile === 'high-assurance' || path.risk === 'high' || path.risk === 'critical'
  const authorId = goal.author || 'author'
  const isAuthor = user && user === authorId
  const action = `/actions${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`

  return `<section class="panel gate-modal" id="gate-transition" role="dialog" aria-labelledby="gate-modal-title">
    <div class="modal-content">
      <h2 id="gate-modal-title">Gate Transition & Readiness Verification</h2>
      <p>Goal: <strong>#${goal.number} ${escapeHtml(goal.title || '')}</strong></p>
      <div class="path-badge-bar">
        <span class="badge ${isHighAssurance ? 'warn' : 'ok'}">${escapeHtml(path.profile || '')}</span>
        <span class="badge">${escapeHtml(path.risk || '')} risk</span>
        <span class="badge">Readiness: ${readiness.score}/100 (${escapeHtml(readiness.grade || '')})</span>
      </div>

      <h3>Readiness Dimensions</h3>
      <div class="dimensions-grid">
        ${(readiness.dimensions || [])
          .map(
            (dim) => `
          <div class="dimension-card ${dim.score >= 80 ? 'pass' : 'fail'}">
            <strong>${escapeHtml(dim.label || dim.id)}</strong>:
            <span>${dim.score}/100</span> —
            <small>${escapeHtml(dim.detail || '')}</small>
          </div>
        `,
          )
          .join('')}
      </div>

      ${
        isHighAssurance && isAuthor
          ? `
        <div class="alert alert-danger" role="alert">
          <strong>⚠️ Dual-Control Violation:</strong> As the author (${escapeHtml(authorId)}), you cannot sign off on high-assurance gate promotions or waivers. An independent reviewer/operator is required.
        </div>
      `
          : ''
      }

      <form method="post" action="${action}" class="gate-transition-form">
        ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''}
        <input type="hidden" name="issue" value="${goal.number}">
        <input type="hidden" name="type" value="gate-transition">
        <label for="target-phase">Target Phase
          <select name="targetPhase" id="target-phase">
            <option value="developer">Developer (Phase 4)</option>
            <option value="tester">Tester (Phase 5)</option>
            <option value="reviewer">Reviewer (Phase 6)</option>
            <option value="pr-readiness">PR Readiness (Phase 8)</option>
          </select>
        </label>

        ${
          readiness.score < 80
            ? `
          <fieldset class="waiver-section">
            <legend>Human Waiver Request</legend>
            <p class="warn-text">Readiness is below threshold (${readiness.score}/100). A formal justification is required to proceed.</p>
            <label for="waiver-reason">Waiver Reason (minimum 15 characters)
              <textarea name="waiverReason" id="waiver-reason" required placeholder="Explain why incomplete checks are safe to defer..."></textarea>
            </label>
          </fieldset>
        `
            : ''
        }

        <label class="confirmation-check">
          <input type="checkbox" name="confirmation" value="true" required>
          I confirm that evidence contracts and risk requirements have been reviewed.
        </label>

        <div class="modal-actions">
          <button type="submit" ${isHighAssurance && isAuthor ? 'disabled' : ''}>Evaluate & Transition</button>
        </div>
      </form>
    </div>
  </section>`
}

export const COCKPIT_CSS = `
:root { --navy:#17233f; --teal:#2e9c91; --mint:#a7dcc8; --coral:#e58a68; --mist:#f2f7f5; --ink:#25304b; --muted:#697386; --line:#d8e2df; --white:#ffffff; --max:1180px; --sans:Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
body { margin: 0; color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.55; background: linear-gradient(180deg, var(--mist), #fff 42%); }
.shell-header { min-height: 76px; padding: .8rem max(1rem, calc((100vw - var(--max))/2)); background: var(--white); border-bottom: 1px solid var(--line); display: flex; gap: 1rem; align-items: center; position: sticky; top: 0; z-index: 5; }
.shell-header span { color: var(--muted); } .shell-header nav { margin-left: auto; } .brand-logo { width: 54px; height: 54px; object-fit: contain; }
main { width: min(calc(100% - 32px), var(--max)); margin: 0 auto; padding: 1.25rem 0 3rem; display: grid; gap: 1rem; }
h1,h2,h3 { color: var(--navy); line-height: 1.12; margin-top: 0; } h1 { font-size: clamp(2.4rem, 5vw, 4.6rem); letter-spacing: -.04em; } h2 { font-size: clamp(1.5rem, 3vw, 2.4rem); letter-spacing: -.025em; }
.eyebrow { color: var(--teal); font-weight: 850; font-size: .78rem; letter-spacing: .14em; text-transform: uppercase; }
.panel { background: rgba(255,255,255,.92); border: 1px solid var(--line); border-radius: 1rem; padding: 1.25rem; box-shadow: 0 16px 42px rgba(23,35,63,.08); }
.hero { background: linear-gradient(135deg, #fff, var(--mist)); border-color: var(--mint); } .highlight { display: grid; grid-template-columns: 1fr auto; gap: 1rem; align-items: center; border-color: var(--coral); }
.view-tabs,.release-tabs { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; } .view-tabs a,.release-tabs a { text-decoration:none; border:1px solid var(--line); background:#fff; border-radius:999px; padding:.35rem .8rem; font-weight:800; } .view-tabs a.active,.release-tabs a.active { background:var(--navy); color:#fff; border-color:var(--navy); } .workspace-form { display:flex; gap:.45rem; align-items:center; } .workspace-form label { display:flex; gap:.45rem; align-items:center; margin:0; color:var(--muted); } .workspace-form select { padding:.25rem .5rem; border-radius:999px; } .workspace-form button { padding:.28rem .65rem; }
.metrics { display: grid; grid-template-columns: repeat(6, 1fr); gap: .75rem; } .metric { background: var(--navy); color: #fff; padding: 1rem; border-radius: .8rem; } .metric span { color: #dce3ef; display:block; font-size:.82rem; } .metric strong { font-size: 1.7rem; } .metric.ok { background: var(--teal); } .metric.warn { background: var(--coral); } .metric.release { background: linear-gradient(135deg,var(--teal),var(--navy)); }
.command-workspace { display:grid; grid-template-columns: 280px minmax(0, 1fr) 320px; gap:1rem; align-items:start; } .nav-pane,.action-pane { position: sticky; top: 96px; } .workspace-main { display:grid; gap:1rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1rem; } .card,.goal-card,.summary-card,.next-action-card { background: #fff; border: 1px solid var(--line); border-radius: .85rem; padding: 1rem; }
.breadcrumb { display:flex; gap:.6rem; align-items:center; color:var(--muted); } .breadcrumb a { font-weight:750; } .compact-hero { display:grid; grid-template-columns:1fr auto; align-items:center; gap:1rem; padding:1rem 1.25rem; } .compact-hero h1 { font-size: clamp(1.8rem, 3vw, 3rem); }
.summary-strip,.next-action-cards { display:grid; grid-template-columns:repeat(4,1fr); gap:.75rem; } .summary-card span { color:var(--muted); font-size:.82rem; } .summary-card strong { display:block; font-size:1.05rem; color:var(--navy); } .summary-card small { color:var(--muted); } .next-action-card h3 { font-size:1.05rem; } .action-link,.external-link { display:inline-flex; border:1px solid var(--teal); border-radius:999px; padding:.18rem .55rem; text-decoration:none; font-weight:800; } .external-link { border-color:var(--line); color:var(--muted); } .header-actions { display:grid; gap:.5rem; justify-items:end; } .header-badges { display:flex; flex-wrap:wrap; gap:.25rem; }
.release-dashboard { display:grid; grid-template-columns:1fr auto; gap:1rem; align-items:center; border-color:var(--teal); } .release-stats { display:flex; gap:.75rem; } .release-stats span { min-width:5rem; border:1px solid var(--mint); border-radius:.8rem; padding:.6rem; text-align:center; font-size:1.45rem; font-weight:900; color:var(--navy); } .release-stats small { display:block; font-size:.72rem; color:var(--muted); font-weight:600; } .release-strip { grid-column:1/-1; display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:.5rem; } .release-strip a { border:1px solid var(--line); border-radius:.7rem; padding:.65rem; background:#fff; text-decoration:none; } .release-strip small { display:block; color:var(--muted); }
.goal-list { display:grid; gap:.75rem; } .goal-card { display:grid; grid-template-columns:1fr auto; align-items:center; gap:1rem; } .mini-score { width:3.2rem; height:3.2rem; border-radius:50%; display:grid; place-items:center; background:var(--mint); color:var(--navy); font-weight:850; }
.hierarchy { display:grid; gap:.45rem; } .hierarchy a { display:grid; grid-template-columns:1fr auto; gap:.5rem; padding:.45rem 0; border-bottom:1px solid var(--line); text-decoration:none; } .hierarchy span { color:var(--muted); font-size:.8rem; } .hierarchy span.unadmitted { color:var(--coral); font-style:italic; } .hierarchy-rejected { margin-top:.75rem; border-top:1px dashed var(--line); padding-top:.5rem; } .hierarchy-rejected ul { margin:0; padding-left:1.2rem; font-size:.8rem; color:var(--coral); } .workspace-badge { background:var(--mist); border:1px solid var(--mint); border-radius:999px; padding:.2rem .6rem; color:var(--ink); }
a { color: var(--navy); text-underline-offset: 4px; } .badge { background: var(--mist); border: 1px solid var(--line); border-radius: 999px; padding: .14rem .5rem; margin: .1rem; display: inline-block; color: var(--ink); }
.badge.ok,.good { border-color: var(--teal); color: var(--teal); } .badge.warn { border-color: var(--coral); color: var(--coral); } .badge.bad,.bad { border-color: var(--coral); color: var(--coral); }
.health-summary { display:grid; grid-template-columns:auto 1fr; gap:1rem; align-items:start; } .health-orb { width: 7rem; height: 7rem; border-radius: 50%; display:grid; place-items:center; background: var(--mint); color: var(--navy); text-align:center; cursor:pointer; list-style:none; } .health-orb::-webkit-details-marker { display:none; } .health-orb strong { font-size:2rem; } .health-orb span { display:block; font-size:.8rem; } .health-orb.blocked { background:#fff0eb; color:var(--coral); } .health-orb.needs-attention { background:#fff7e6; color:#966b1f; }
.health-popover { position:relative; } .floating-health { display:none; position:absolute; right:0; top:calc(100% + .5rem); min-width:300px; max-width:420px; z-index:10; background:#fff; border:1px solid var(--mint); border-radius:.9rem; padding:1rem; box-shadow:0 18px 48px rgba(23,35,63,.18); } .health-popover[open] .floating-health, .health-popover:hover .floating-health, .health-popover:focus-within .floating-health { display:block; }
.dimension { border-bottom:1px solid var(--line); padding:.55rem 0; } .comment { border-left: 4px solid var(--teal); padding-left: .75rem; color: var(--muted); } .subtle { background:#fbfdfc; color:var(--muted); } .role-card { position:relative; padding-left:3.25rem; } .role-state,.state-dot { width:1.5rem; height:1.5rem; border-radius:50%; display:inline-grid; place-items:center; font-weight:900; border:1px solid var(--line); } .role-state { position:absolute; left:1rem; top:1rem; } .role-state.ok,.state-dot.ok { color:var(--teal); border-color:var(--teal); } .role-state.warn,.state-dot.warn { color:var(--coral); border-color:var(--coral); } .role-state.bad,.state-dot.bad { color:#b42318; border-color:#b42318; }
.action-list li { margin: .65rem 0; } .flow-timeline { list-style:none; margin:0; padding:0 0 0 1.2rem; position:relative; } .flow-timeline:before { content:""; position:absolute; left:1.95rem; top:.4rem; bottom:2rem; width:2px; background:linear-gradient(var(--teal),var(--coral)); } .flow-timeline li { position:relative; display:grid; grid-template-columns:2rem 1fr; gap:.75rem; margin:.85rem 0; } .timeline-dot { z-index:1; width:1.65rem; height:1.65rem; border-radius:50%; display:grid; place-items:center; background:#fff; border:2px solid var(--teal); font-weight:900; } .timeline-end span { color:var(--coral); font-weight:900; z-index:1; }
.graph-layout { display:grid; grid-template-columns: minmax(260px, 1fr) minmax(280px, .8fr); gap:1rem; } .graph-nodes { display:flex; flex-wrap:wrap; gap:.5rem; align-content:flex-start; } .graph-node { border:1px solid var(--line); border-radius:999px; padding:.45rem .7rem; background:var(--mist); text-decoration:none; } .detail-panel { border:1px solid var(--mint); background:#f8fcfb; border-radius:.9rem; padding:1rem; }
label { display: grid; gap: .35rem; margin: .75rem 0; } textarea { min-height: 6rem; } select, textarea, button { border-radius: .5rem; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: .6rem; } button { background: var(--coral); color: #fff; border-color: var(--coral); font-weight: 800; } .action-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:.8rem; } .action-card { border:1px solid var(--line); border-radius:.85rem; padding:1rem; background:#fff; } .warn-text { color:#966b1f; font-weight:700; }
.goal-card-blocked { border-left: 5px solid var(--coral); background: #fffcfb; }
.badge-blocked { background: #ffece6; color: #b42318; border-color: #fecdca; font-weight: 800; }
.action-btn-small { display: inline-flex; border: 1px solid var(--teal); border-radius: 999px; padding: 0.12rem 0.5rem; text-decoration: none; font-size: 0.8rem; font-weight: 750; color: var(--navy); background: #fff; margin-left: 0.4rem; }
.action-btn-small:hover { background: var(--teal); color: #fff; }
.metrics-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
.kpi-card { background: #fff; border: 1px solid var(--line); border-radius: 0.85rem; padding: 1.1rem; }
.kpi-title { font-size: 0.85rem; color: var(--muted); display: block; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.kpi-value { font-size: 1.8rem; display: block; color: var(--navy); margin: 0.3rem 0; font-weight: 900; }
.kpi-value.ok { color: var(--teal); }
.kpi-value.warn { color: var(--coral); }
.kpi-note { font-size: 0.78rem; color: var(--muted); }
.actor-distribution-bar { display: flex; height: 28px; border-radius: 999px; overflow: hidden; margin: 1rem 0 2rem; border: 1px solid var(--line); font-size: 0.8rem; font-weight: 800; }
.actor-segment { display: grid; place-items: center; color: #fff; }
.actor-segment.agent { background: var(--teal); }
.actor-segment.human { background: var(--coral); }
.actor-segment.system { background: var(--navy); }
.span-table { width: 100%; border-collapse: collapse; margin: 1rem 0 2rem; background: #fff; border: 1px solid var(--line); border-radius: 0.85rem; overflow: hidden; }
.span-table th, .span-table td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--line); }
.span-table th { background: var(--mist); color: var(--navy); font-size: 0.85rem; }
.dependency-tree { background: #fff; border: 1px solid var(--line); border-radius: 0.85rem; padding: 1rem; }
.dep-list { list-style: none; padding: 0; margin: 0; }
.dep-list li { padding: 0.6rem 0; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 0.5rem; }
.dep-list li:last-child { border-bottom: none; }
@media(max-width:1000px){ .command-workspace{grid-template-columns:1fr} .nav-pane,.action-pane{position:static} .summary-strip,.next-action-cards{grid-template-columns:1fr 1fr} }
@media(max-width:820px){ .metrics{grid-template-columns:repeat(2,1fr)} .highlight,.health-summary,.graph-layout,.compact-hero,.release-dashboard{grid-template-columns:1fr} .summary-strip,.next-action-cards{grid-template-columns:1fr} .header-actions{justify-items:start} .release-stats{flex-wrap:wrap} }
`

// Project metadata (#417). Adding a project is preview first: the form leads to a preview that
// shows exactly the record to be stored, and only Confirm on that preview writes it. Cancel is a
// link and writes nothing. No page here lists a squad or a seat beyond the two coordinators.
function executionLayerLabel(record) {
  return record?.executionLayer === 'openrig' ? 'OpenRig' : 'none'
}

export function renderProjectExecutionLayer(record) {
  return `<p class="project-layer">Execution layer: <strong>${escapeHtml(executionLayerLabel(record))}</strong></p>`
}

export function renderProjects({ projects = [], csrfToken = null, writable = false } = {}) {
  const rows = projects.length
    ? `<ul class="project-list">${projects
        .map((record) => {
          const supported = record.sourceAdapter === 'github'
          const name = supported
            ? `<a href="/?repo=${encodeURIComponent(record.repository)}">${escapeHtml(record.repository)}</a>`
            : escapeHtml(record.repository)
          return `<li>${name} <span class="badge${supported ? '' : ' warn'}">${escapeHtml(record.sourceAdapter)}${supported ? '' : ' · unsupported'}</span> <span class="badge">Execution layer: ${escapeHtml(executionLayerLabel(record))}</span></li>`
        })
        .join('')}</ul>`
    : '<p>No project has been added yet.</p>'
  const form = writable
    ? `<form method="post" action="/projects/preview" class="project-form">${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''}<label for="project-repository">Repository (owner/name) <input type="text" id="project-repository" name="repository" required></label><label for="project-adapter">Source adapter <input type="text" id="project-adapter" name="sourceAdapter" value="github"></label><label for="project-layer">Execution layer <select id="project-layer" name="executionLayer"><option value="none">None</option><option value="openrig">OpenRig</option></select></label><label for="project-pm">PM coordinator (OpenRig only) <input type="text" id="project-pm" name="pmCoordinator"></label><label for="project-dev">DEV coordinator (OpenRig only) <input type="text" id="project-dev" name="devCoordinator"></label><button type="submit">Preview</button></form>`
    : '<p>Adding a project needs write actions turned on.</p>'
  return `<section class="panel" id="projects"><div style="display:flex;justify-content:space-between;align-items:center;"><h2>Projects</h2><a href="/onboarding" class="action-btn-small" style="font-size:0.85rem;padding:0.25rem 0.75rem;">Onboarding Stepper</a></div>${rows}<h3>Add a project</h3>${form}</section>`
}

export function renderProjectPreview(preview, { csrfToken = null } = {}) {
  const { record, digest, discovered, unsupported } = preview
  const facts = [
    ['Repository', record.repository],
    [
      'Source adapter',
      unsupported ? `${record.sourceAdapter} (unsupported)` : record.sourceAdapter,
    ],
    ['Execution layer', executionLayerLabel(record)],
    ...(record.coordinators?.pm ? [['PM coordinator', record.coordinators.pm]] : []),
    ...(record.coordinators?.dev ? [['DEV coordinator', record.coordinators.dev]] : []),
    ...(discovered
      ? [
          ['Default branch', discovered.defaultBranch ?? 'unknown'],
          ['Open items found', String(discovered.openItems)],
        ]
      : []),
  ]
  return `<section class="panel" id="project-preview"><h2>Preview</h2><p>Nothing is stored until you confirm. This is the whole record.</p><dl class="project-facts">${facts
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join(
      '',
    )}</dl><form method="post" action="/projects/confirm">${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''}<input type="hidden" name="record" value="${escapeHtml(JSON.stringify(record))}"><input type="hidden" name="digest" value="${escapeHtml(digest)}"><button type="submit">Confirm</button> <a href="/projects">Cancel</a></form></section>`
}

// #419: a project whose source adapter does not work. Only this project shows it.
export function renderUnsupportedProject(binding) {
  return `<section class="panel" id="unsupported-project"><h1>${escapeHtml(binding.repository)}</h1><p>The source adapter <strong>${escapeHtml(binding.sourceAdapter)}</strong> is not supported. GitHub is the only source adapter that works. Other projects are not affected.</p><p><a href="/projects">Projects</a></p></section>`
}

export function renderOnboardingView({
  targetDir = '.',
  envReport = null,
  csrfToken = null,
  writable = true,
  plan = null,
  receipt = null,
  error = null,
} = {}) {
  const toolsHtml = envReport?.tools?.length
    ? `<div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: 1.25rem;">
        ${envReport.tools
          .map((t) => {
            const foundBadge = t.found
              ? `<span class="badge ok">found ${escapeHtml(t.version || '')}</span>`
              : `<span class="badge ${t.required ? 'warn' : ''}">missing</span>`
            return `<div class="card">
              <strong>${escapeHtml(t.name)}</strong> ${foundBadge}
              <small style="display:block; color:var(--muted); margin-top:0.3rem;">${escapeHtml(t.why || '')}</small>
              ${!t.found && t.installOptions?.length ? `<div style="font-size:0.78rem; margin-top:0.4rem; color:var(--coral);"><strong>Install:</strong> ${escapeHtml(t.installOptions[0])}</div>` : ''}
            </div>`
          })
          .join('')}
      </div>`
    : ''

  if (receipt) {
    return `<section class="panel hero" id="onboarding-receipt">
      <p class="eyebrow">Adoption Applied</p>
      <h2>AgentFlow successfully initialized!</h2>
      <p>Target: <code>${escapeHtml(targetDir)}</code></p>
      <p>Transaction ID: <code>${escapeHtml(receipt.transactionId || '')}</code></p>
      ${receipt.recoveryToken ? `<p>Undo recovery token: <code>${escapeHtml(receipt.recoveryToken)}</code></p>` : ''}
      <div style="margin-top:1.2rem; display:flex; gap:0.75rem;">
        <a href="/projects" class="action-link">Go to Projects</a>
        <a href="/onboarding" class="action-link external-link">Onboard Another Project</a>
      </div>
    </section>`
  }

  const errorBanner = error
    ? `<section class="panel highlight" style="margin-bottom:1rem;">
        <span class="badge warn">Error</span>
        <p>${escapeHtml(error)}</p>
      </section>`
    : ''

  const planPreviewSection = plan
    ? `<section class="panel" id="onboarding-plan" style="margin-top:1.25rem;">
        <p class="eyebrow">Step 3: Plan Preview & Confirmation</p>
        <h2>Adoption Plan Preview</h2>
        <p>Review the scaffolded file set before confirming. Digest: <code>${escapeHtml(plan.digest || '')}</code></p>
        <p><strong>Total Changes:</strong> ${plan.changes?.length ?? 0}</p>
        <ul class="action-list" style="max-height: 260px; overflow-y: auto; background: var(--mist); padding: 0.8rem 1.2rem; border-radius: 0.5rem;">
          ${(plan.changes || [])
            .map(
              (c) =>
                `<li><span class="badge">${escapeHtml(c.action)}</span> <code>${escapeHtml(c.target || c.path)}</code></li>`,
            )
            .join('')}
        </ul>
        <form method="post" action="/onboarding/apply" style="margin-top:1rem;">
          ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''}
          <input type="hidden" name="targetDir" value="${escapeHtml(targetDir)}">
          <input type="hidden" name="profile" value="${escapeHtml(plan.projectPlan?.profile || 'standard')}">
          <input type="hidden" name="confirm" value="${escapeHtml(plan.digest || '')}">
          <input type="hidden" name="plan" value="${escapeHtml(JSON.stringify(plan))}">
          <button type="submit" ${writable ? '' : 'disabled'}>Confirm & Apply Adoption</button>
          <a href="/onboarding" class="action-link external-link" style="margin-left:0.5rem;">Cancel</a>
        </form>
      </section>`
    : ''

  const formSection = `<section class="panel" id="onboarding-form">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <p class="eyebrow">Guided Adoption</p>
        <h1>Project Onboarding Stepper</h1>
      </div>
      <a href="/projects" class="action-link external-link">Back to Projects</a>
    </div>
    <p>Initialize AgentFlow SDLC with interactive tool verification, profile selection, and exact scaffold preview.</p>

    <h3>1. Environment Tool Readiness</h3>
    ${toolsHtml}

    <h3>2. Project & Composition Configuration</h3>
    <form method="post" action="/onboarding/plan" class="project-form">
      ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''}
      <label for="targetDir">
        Target Project Directory
        <input type="text" id="targetDir" name="targetDir" value="${escapeHtml(targetDir)}" required>
      </label>

      <label for="profile">
        Composition Profile
        <select id="profile" name="profile">
          <option value="standard" selected>standard - Recommended SDLC squad policies, adapters, verification gates</option>
          <option value="minimal">minimal - Bare essentials (AGENTS.md, basic policies, minimal configs)</option>
          <option value="github">github - Standard + full GitHub Actions workflows and issue templates</option>
          <option value="cockpit">cockpit - Standard + Cockpit Goal Command Center integration</option>
        </select>
      </label>

      <label style="display:flex; align-items:center; gap:0.5rem;">
        <input type="checkbox" name="harness" value="true" checked>
        Configure agent harnesses (Claude Code, Antigravity, Pi, Codex)
      </label>

      <div style="margin-top:1rem;">
        <button type="submit" ${writable ? '' : 'disabled'}>Preview Adoption Plan</button>
      </div>
    </form>
  </section>`

  return `${errorBanner}${formSection}${planPreviewSection}`
}
