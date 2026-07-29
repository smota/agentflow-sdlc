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
  { repo, view = 'goals', release = 'unreleased' } = {},
) {
  const metrics = commandCenter.metrics || {}
  const goals = commandCenter.goals || []
  const highlight = commandCenter.highlight
  const repoQuery = repo ? `repo=${encodeURIComponent(repo)}` : ''
  const query = (targetView) =>
    `/?${[repoQuery, `view=${targetView}`, targetView === 'releases' ? `release=${release}` : ''].filter(Boolean).join('&')}`
  return `<nav class="view-tabs"><a class="${view === 'goals' ? 'active' : ''}" href="${query('goals')}">Goals</a><a class="${view === 'releases' ? 'active' : ''}" href="${query('releases')}">Releases</a><a class="${view === 'reviews' ? 'active' : ''}" href="${query('reviews')}">Reviews</a><a class="${view === 'follow-ups' ? 'active' : ''}" href="${query('follow-ups')}">Follow-ups</a></nav>
  <section class="metrics">${metric('Awaiting release', metrics.awaitingRelease, 'release')}${metric('Missing release notes', metrics.missingReleaseNotes, 'warn')}${metric('Release blockers', metrics.releaseBlockers, 'warn')}${metric('Active goals', metrics.activeGoals)}${metric('Need attention', metrics.needAttention, 'warn')}${metric('Readiness health', `${metrics.evidenceHealthAverage || 0}/100`)}</section>
  ${renderSelectedDashboardView(commandCenter, view, repo, release)}
  <section class="command-workspace" id="goals">
    <aside class="panel nav-pane"><p class="eyebrow">Goal hierarchy</p>${renderGoalHierarchy(goals, repo)}</aside>
    <section class="workspace-main">${highlight ? renderHighlight({ ...highlight, repo }) : '<section class="panel"><h2>No active goals found</h2><p>Connect a repository with AgentFlow-managed goals to begin.</p></section>'}${renderGoalList(goals, repo)}</section>
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
  return renderReleaseDashboard(commandCenter.releaseDashboard || {}, repo, release)
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

function renderGoalCard(goal) {
  return `<article class="goal-card"><div><span class="badge ${stateClass(goal.status)}">${escapeHtml(displayState(goal.status))}</span><span class="badge">Goal #${goal.number}</span><h3><a href="${issueHref(goal.number, goal.repo)}">${escapeHtml(goal.title)}</a></h3><p>${escapeHtml(goal.highlights?.[0]?.value || '')}</p><p><span class="badge">${escapeHtml(goal.selectedPath.profile)}</span><span class="badge">${escapeHtml(goal.versionLens.state)}</span> <a href="${replayHref(goal.number, goal.repo)}">Goal Story</a></p></div><div class="mini-score">${goal.evidenceHealth.score}</div></article>`
}

function renderGoalList(goals = [], repo) {
  return `<section class="panel"><h2>Goal workspace</h2><div class="goal-list">${goals.map((goal) => renderGoalCard({ ...goal, repo })).join('')}</div></section>`
}

function renderGoalHierarchy(goals = [], repo) {
  if (!goals.length) return '<p>No goals found.</p>'
  const groups = goals.filter((goal) => goal.goalType === 'goal-group')
  const children = goals.filter((goal) => goal.goalType !== 'goal-group')
  return `<div class="hierarchy">${
    groups
      .map(
        (group) =>
          `<details open><summary>◎ ${escapeHtml(group.title)}</summary>${children
            .slice(0, 12)
            .map(
              (goal) =>
                `<a href="${issueHref(goal.number, repo)}">○ ${escapeHtml(goal.title)}<span>${escapeHtml(displayState(goal.status))}</span></a>`,
            )
            .join('')}</details>`,
      )
      .join('') ||
    children
      .map(
        (goal) =>
          `<a href="${issueHref(goal.number, repo)}">○ ${escapeHtml(goal.title)}<span>${escapeHtml(displayState(goal.status))}</span></a>`,
      )
      .join('')
  }</div>`
}

export function renderIssueView(view, { repo } = {}) {
  const goal = view.goal
  return `<nav class="breadcrumb"><a href="${homeHref(repo)}">← Goal Command Center</a><span>Goal #${goal.number}</span></nav>
  <section class="panel compact-hero"><div><p class="eyebrow">Goal #${goal.number}</p><h1>${escapeHtml(goal.title)}</h1><p class="header-badges"><span class="badge ${stateClass(goal.status)}">${escapeHtml(displayState(goal.status))}</span><span class="badge">${escapeHtml(goal.goalType)}</span><span class="badge">${escapeHtml(goal.selectedPath.profile)} path</span><span class="badge ${stateClass(goal.versionLens.state)}">${escapeHtml(displayState(goal.versionLens.state))}</span></p></div><div class="header-actions"><a class="action-link" href="${replayHref(goal.number, repo)}">↺ Goal Story</a><a class="external-link" href="${escapeHtml(goal.durableLinks.issue || '#')}">Open source ↗</a>${renderHealthOrb(goal.evidenceHealth)}</div></section>
  <section class="summary-strip">${summaryCard('Selected path', `${goal.selectedPath.profile} · ${goal.selectedPath.risk} risk`, goal.selectedPath.source)}${summaryCard('Version', `${goal.versionLens.releaseImpact} · ${displayState(goal.versionLens.state)}`, goal.versionLens.targetBranch)}${summaryCard('Human review', displayState(goal.humanGate.status), goal.humanGate.nextAction)}${summaryCard('Readiness', `${goal.evidenceHealth.score}/100`, `${goal.evidenceHealth.denominator} checks`)}</section>
  <section class="panel"><h2>Next-best-actions</h2>${renderNextActionCards(goal.nextBestActions.map((action) => ({ ...action, goal })).slice(0, 4), repo)}</section>
  <section class="panel"><h2>Role Flow Contributions</h2><div class="grid">${goal.roleContributions.map(renderRoleContribution).join('')}</div></section>
  <section class="panel"><h2>Readiness Health</h2>${renderEvidenceHealthCheck(goal.evidenceHealth)}</section>
  <section class="panel"><h2>Relationship Map</h2>${renderGraph(goal.graph)}</section>
  ${renderWorkflowActivity(view.commentLanes)}
  ${renderActionForms(view, repo)}`
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
.hierarchy { display:grid; gap:.45rem; } .hierarchy a { display:grid; grid-template-columns:1fr auto; gap:.5rem; padding:.45rem 0; border-bottom:1px solid var(--line); text-decoration:none; } .hierarchy span { color:var(--muted); font-size:.8rem; } .workspace-badge { background:var(--mist); border:1px solid var(--mint); border-radius:999px; padding:.2rem .6rem; color:var(--ink); }
a { color: var(--navy); text-underline-offset: 4px; } .badge { background: var(--mist); border: 1px solid var(--line); border-radius: 999px; padding: .14rem .5rem; margin: .1rem; display: inline-block; color: var(--ink); }
.badge.ok,.good { border-color: var(--teal); color: var(--teal); } .badge.warn { border-color: var(--coral); color: var(--coral); } .badge.bad,.bad { border-color: var(--coral); color: var(--coral); }
.health-summary { display:grid; grid-template-columns:auto 1fr; gap:1rem; align-items:start; } .health-orb { width: 7rem; height: 7rem; border-radius: 50%; display:grid; place-items:center; background: var(--mint); color: var(--navy); text-align:center; cursor:pointer; list-style:none; } .health-orb::-webkit-details-marker { display:none; } .health-orb strong { font-size:2rem; } .health-orb span { display:block; font-size:.8rem; } .health-orb.blocked { background:#fff0eb; color:var(--coral); } .health-orb.needs-attention { background:#fff7e6; color:#966b1f; }
.health-popover { position:relative; } .floating-health { display:none; position:absolute; right:0; top:calc(100% + .5rem); min-width:300px; max-width:420px; z-index:10; background:#fff; border:1px solid var(--mint); border-radius:.9rem; padding:1rem; box-shadow:0 18px 48px rgba(23,35,63,.18); } .health-popover[open] .floating-health, .health-popover:hover .floating-health, .health-popover:focus-within .floating-health { display:block; }
.dimension { border-bottom:1px solid var(--line); padding:.55rem 0; } .comment { border-left: 4px solid var(--teal); padding-left: .75rem; color: var(--muted); } .subtle { background:#fbfdfc; color:var(--muted); } .role-card { position:relative; padding-left:3.25rem; } .role-state,.state-dot { width:1.5rem; height:1.5rem; border-radius:50%; display:inline-grid; place-items:center; font-weight:900; border:1px solid var(--line); } .role-state { position:absolute; left:1rem; top:1rem; } .role-state.ok,.state-dot.ok { color:var(--teal); border-color:var(--teal); } .role-state.warn,.state-dot.warn { color:var(--coral); border-color:var(--coral); } .role-state.bad,.state-dot.bad { color:#b42318; border-color:#b42318; }
.action-list li { margin: .65rem 0; } .flow-timeline { list-style:none; margin:0; padding:0 0 0 1.2rem; position:relative; } .flow-timeline:before { content:""; position:absolute; left:1.95rem; top:.4rem; bottom:2rem; width:2px; background:linear-gradient(var(--teal),var(--coral)); } .flow-timeline li { position:relative; display:grid; grid-template-columns:2rem 1fr; gap:.75rem; margin:.85rem 0; } .timeline-dot { z-index:1; width:1.65rem; height:1.65rem; border-radius:50%; display:grid; place-items:center; background:#fff; border:2px solid var(--teal); font-weight:900; } .timeline-end span { color:var(--coral); font-weight:900; z-index:1; }
.graph-layout { display:grid; grid-template-columns: minmax(260px, 1fr) minmax(280px, .8fr); gap:1rem; } .graph-nodes { display:flex; flex-wrap:wrap; gap:.5rem; align-content:flex-start; } .graph-node { border:1px solid var(--line); border-radius:999px; padding:.45rem .7rem; background:var(--mist); text-decoration:none; } .detail-panel { border:1px solid var(--mint); background:#f8fcfb; border-radius:.9rem; padding:1rem; }
label { display: grid; gap: .35rem; margin: .75rem 0; } textarea { min-height: 6rem; } select, textarea, button { border-radius: .5rem; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: .6rem; } button { background: var(--coral); color: #fff; border-color: var(--coral); font-weight: 800; } .action-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:.8rem; } .action-card { border:1px solid var(--line); border-radius:.85rem; padding:1rem; background:#fff; } .warn-text { color:#966b1f; font-weight:700; }
@media(max-width:1000px){ .command-workspace{grid-template-columns:1fr} .nav-pane,.action-pane{position:static} .summary-strip,.next-action-cards{grid-template-columns:1fr 1fr} }
@media(max-width:820px){ .metrics{grid-template-columns:repeat(2,1fr)} .highlight,.health-summary,.graph-layout,.compact-hero,.release-dashboard{grid-template-columns:1fr} .summary-strip,.next-action-cards{grid-template-columns:1fr} .header-actions{justify-items:start} .release-stats{flex-wrap:wrap} }
`
