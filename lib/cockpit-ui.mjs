export function renderCockpitPage({
  title = 'AgentFlow Cockpit',
  body = '',
  user,
  repo,
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
  <header class="shell-header"><img class="brand-logo" src="/assets/cockpit/agentflow-logo-transparent.png" alt="AgentFlow SDLC"><div><strong>Goal Command Center</strong><br><span>Move faster. Keep the work understandable.</span></div><nav>${repo ? `<span class="badge">${escapeHtml(repo)}</span>` : ''}${user ? ` <span class="badge">${escapeHtml(user)}</span>` : ''}</nav></header>
  <main>${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''}${body}</main>
</body>
</html>`
}

export function renderGoalBoard(commandCenter = {}) {
  const metrics = commandCenter.metrics || {}
  const goals = commandCenter.goals || []
  const highlight = commandCenter.highlight
  return `<section class="panel hero"><p class="eyebrow">AgentFlow Cockpit</p><h1>Goal Command Center</h1><p>Goals, confidence, evidence, follow-ups, and next-best-actions — synthesized from durable GitHub evidence.</p></section>
  <section class="metrics">${metric('Active goals', metrics.activeGoals)}${metric('Need attention', metrics.needAttention, 'warn')}${metric('Ready for review', metrics.readyForReview, 'ok')}${metric('Evidence health', `${metrics.evidenceHealthAverage || 0}/100`)}${metric('Follow-ups', metrics.openFollowUps)}${metric('Human gates', metrics.humanGatesPending, 'warn')}</section>
  ${highlight ? renderHighlight(highlight) : '<section class="panel"><h2>No active goals found</h2><p>Connect a repository with AgentFlow-managed issues to begin.</p></section>'}
  <section class="panel"><h2>Next-best-actions</h2>${renderNextActions(commandCenter.topActions || [])}</section>
  <section class="panel"><h2>Goals</h2><div class="goal-list">${goals.map(renderGoalCard).join('')}</div></section>`
}

function renderHighlight(goal) {
  return `<section class="panel highlight"><div><p class="eyebrow">Highlight</p><h2><a href="/issues/${goal.number}">#${goal.number} ${escapeHtml(goal.title)}</a></h2><p>${escapeHtml(goal.nextBestActions[0]?.reason || 'No blocker detected.')}</p></div><div class="health-orb ${goal.evidenceHealth.grade}"><strong>${goal.evidenceHealth.score}</strong><span>health</span></div></section>`
}

function renderNextActions(actions = []) {
  if (!actions.length) return '<p>No action needed. Goals are flowing.</p>'
  return `<ol class="action-list">${actions
    .map(
      (action) =>
        `<li><strong>${escapeHtml(action.label)}</strong><br><span>${escapeHtml(action.reason)}</span><br><a href="/issues/${action.goal.number}">Open goal #${action.goal.number}</a></li>`,
    )
    .join('')}</ol>`
}

function renderGoalCard(goal) {
  return `<article class="goal-card"><div><span class="badge ${stateClass(goal.status)}">${escapeHtml(displayState(goal.status))}</span><h3><a href="/issues/${goal.number}">#${goal.number} ${escapeHtml(goal.title)}</a></h3><p>${escapeHtml(goal.highlights?.[0]?.value || '')}</p></div><div class="mini-score">${goal.evidenceHealth.score}</div><p><a href="/issues/${goal.number}/replay">Goal Story</a></p></article>`
}

export function renderIssueView(view) {
  const goal = view.goal
  return `<section class="panel hero"><p class="eyebrow">Goal detail</p><h1>${escapeHtml(goal.title)}</h1><p><span class="badge ${stateClass(goal.status)}">${escapeHtml(displayState(goal.status))}</span> <span class="badge">${escapeHtml(goal.goalType)}</span> <a href="${escapeHtml(goal.durableLinks.issue || '#')}">GitHub source</a> <a href="/issues/${goal.number}/replay">Goal Story Replay</a></p></section>
  <section class="panel highlight"><div><h2>Next-best-action</h2>${renderNextActions(goal.nextBestActions.map((action) => ({ ...action, goal })).slice(0, 3))}</div><div class="health-orb ${goal.evidenceHealth.grade}"><strong>${goal.evidenceHealth.score}</strong><span>${escapeHtml(goal.evidenceHealth.grade)}</span></div></section>
  <section class="panel"><h2>Evidence Health Check</h2>${renderEvidenceHealthCheck(goal.evidenceHealth)}</section>
  <section class="panel"><h2>Role Flow Contributions</h2><div class="grid">${goal.roleContributions.map(renderRoleContribution).join('')}</div></section>
  <section class="panel"><h2>Graph Navigation</h2>${renderGraph(goal.graph)}</section>
  <section class="panel"><h2>Workflow lanes</h2>${Object.entries(view.commentLanes)
    .map(
      ([lane, comments]) =>
        `<details><summary>${escapeHtml(lane)} (${comments.length})</summary>${comments
          .map((comment) => `<p class="comment">${escapeHtml(summarize(comment.body || ''))}</p>`)
          .join('')}</details>`,
    )
    .join('')}</section>
  ${renderActionForms(view)}`
}

export function renderEvidenceHealth(health) {
  if (health.dimensions) return renderEvidenceHealthCheck(health)
  return `<p class="${health.status === 'complete' ? 'good' : 'bad'}">${escapeHtml(health.status)}</p><ul>${health.checks
    .map((check) => `<li>${check.ok ? '✓' : '✗'} ${escapeHtml(check.label)}</li>`)
    .join('')}</ul>`
}

function renderEvidenceHealthCheck(health) {
  return `<div class="health-summary"><div class="health-orb ${health.grade}"><strong>${health.score}</strong><span>${escapeHtml(health.grade)}</span></div><div class="health-dimensions">${health.dimensions
    .map(
      (dimension) =>
        `<details class="dimension"><summary><span class="badge ${stateClass(dimension.state)}">${escapeHtml(displayState(dimension.state))}</span> ${escapeHtml(dimension.label)} <strong>${dimension.score}/100</strong></summary><p>${escapeHtml(dimension.detail)}</p><p><em>${escapeHtml(dimension.next)}</em></p></details>`,
    )
    .join('')}</div></div>`
}

function renderRoleContribution(item) {
  return `<article class="card"><span class="badge ${stateClass(item.state)}">${escapeHtml(displayState(item.state))}</span><h3>${escapeHtml(item.role)}</h3><p>${escapeHtml(item.summary)}</p>${item.evidence ? `<small>${escapeHtml(item.evidence)}</small>` : ''}</article>`
}

export function renderGoalStory(story) {
  return `<section class="panel hero"><h1>Goal Story Replay: #${story.goal.number} ${escapeHtml(story.goal.title)}</h1><p><span class="badge">${escapeHtml(story.status)}</span> <span class="badge">read-only reconstruction</span> <a href="/issues/${story.goal.number}/replay.md">Export markdown</a></p><p>Replay recreates evidence path; it never reruns agents.</p></section>
  <section class="panel"><h2>Compact replay</h2>${renderReplayFilters()}${renderReplayEvents(story.compactEvents)}</section>
  <section class="panel"><h2>Evidence gaps</h2>${story.missing.length ? `<ul>${story.missing.map((item) => `<li class="bad">${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="good">None detected.</p>'}</section>
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
  if (!events.length) return '<p>No durable events found.</p>'
  return `<ol class="timeline">${events
    .map(
      (event) =>
        `<li><span class="badge ${event.evidenceStatus === 'durable' ? 'ok' : 'warn'}">${escapeHtml(event.evidenceStatus)}</span> <strong>${escapeHtml(event.type)}</strong> ${escapeHtml(event.summary)}${event.evidence?.url ? ` <a href="${escapeHtml(event.evidence.url)}">evidence</a>` : ''}</li>`,
    )
    .join('')}</ol>`
}

function renderGraph(graph = { nodes: [], edges: [] }) {
  if (!graph.nodes?.length) return '<p>No relationship graph available.</p>'
  const first = graph.nodes[0]
  return `<div class="graph-layout"><div class="graph-nodes">${graph.nodes
    .map(
      (node) =>
        `<a class="graph-node ${escapeHtml(node.type)}" href="#node-${escapeHtml(node.id)}"><span>${iconFor(node.type)}</span>${escapeHtml(node.label)}</a>`,
    )
    .join(
      '',
    )}</div><aside class="detail-panel"><h3>Detail panel</h3><p>Select a node to inspect durable evidence and next action.</p><p><strong>${escapeHtml(first?.label || 'Goal')}</strong></p><ul>${graph.edges
    .slice(0, 8)
    .map(
      (edge) =>
        `<li>${escapeHtml(edge.from)} → <span class="badge">${escapeHtml(edge.type)}</span> → ${escapeHtml(edge.to)}</li>`,
    )
    .join('')}</ul></aside></div>`
}

function renderActionForms(view) {
  return `<section class="panel"><h2>Guided actions</h2><p>Actions require server-side auth, CSRF, confirmation, and audit when enabled.</p><form method="post" action="/actions"><input type="hidden" name="issue" value="${view.number}"><label>Intent <select name="type"><option value="add-clarification">Add clarification</option><option value="request-checkpoint">Request checkpoint</option><option value="request-human-review">Request human review</option><option value="draft-follow-up">Draft follow-up</option><option value="post-handover">Post handover</option></select></label><label>Message <textarea name="body"></textarea></label><button type="submit">Preview guarded action</button></form></section>`
}

function metric(label, value, klass = '') {
  return `<article class="metric ${klass}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong></article>`
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
  return ['recorded', 'healthy', 'done', 'ready', 'moving'].includes(value)
    ? 'ok'
    : ['blocked', 'error'].includes(value)
      ? 'bad'
      : 'warn'
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
.metrics { display: grid; grid-template-columns: repeat(6, 1fr); gap: .75rem; } .metric { background: var(--navy); color: #fff; padding: 1rem; border-radius: .8rem; } .metric span { color: #dce3ef; display:block; font-size:.82rem; } .metric strong { font-size: 1.7rem; } .metric.ok { background: var(--teal); } .metric.warn { background: var(--coral); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1rem; } .card,.goal-card { background: #fff; border: 1px solid var(--line); border-radius: .85rem; padding: 1rem; }
.goal-list { display:grid; gap:.75rem; } .goal-card { display:grid; grid-template-columns:1fr auto; align-items:center; gap:1rem; } .mini-score { width:3.2rem; height:3.2rem; border-radius:50%; display:grid; place-items:center; background:var(--mint); color:var(--navy); font-weight:850; }
a { color: var(--navy); text-underline-offset: 4px; } .badge { background: var(--mist); border: 1px solid var(--line); border-radius: 999px; padding: .14rem .5rem; margin: .1rem; display: inline-block; color: var(--ink); }
.badge.ok,.good { border-color: var(--teal); color: var(--teal); } .badge.warn { border-color: var(--coral); color: var(--coral); } .badge.bad,.bad { border-color: var(--coral); color: var(--coral); }
.health-summary { display:grid; grid-template-columns:auto 1fr; gap:1rem; align-items:start; } .health-orb { width: 7rem; height: 7rem; border-radius: 50%; display:grid; place-items:center; background: var(--mint); color: var(--navy); text-align:center; } .health-orb strong { font-size:2rem; } .health-orb span { display:block; font-size:.8rem; } .health-orb.blocked { background:#fff0eb; color:var(--coral); } .health-orb.needs-attention { background:#fff7e6; color:#966b1f; }
.dimension { border-bottom:1px solid var(--line); padding:.55rem 0; } .comment { border-left: 4px solid var(--teal); padding-left: .75rem; color: var(--muted); }
.action-list li,.timeline li { margin: .65rem 0; } .graph-layout { display:grid; grid-template-columns: minmax(260px, 1fr) minmax(280px, .8fr); gap:1rem; } .graph-nodes { display:flex; flex-wrap:wrap; gap:.5rem; align-content:flex-start; } .graph-node { border:1px solid var(--line); border-radius:999px; padding:.45rem .7rem; background:var(--mist); text-decoration:none; } .detail-panel { border:1px solid var(--mint); background:#f8fcfb; border-radius:.9rem; padding:1rem; }
label { display: grid; gap: .35rem; margin: .75rem 0; } textarea { min-height: 6rem; } select, textarea, button { border-radius: .5rem; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: .6rem; } button { background: var(--coral); color: #fff; border-color: var(--coral); font-weight: 800; }
@media(max-width:820px){ .metrics{grid-template-columns:repeat(2,1fr)} .highlight,.health-summary,.graph-layout{grid-template-columns:1fr} }
`
