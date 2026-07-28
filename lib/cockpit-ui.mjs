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
  <style>${COCKPIT_CSS}</style>
</head>
<body>
  <header class="shell-header"><div class="brand-mark" aria-hidden="true">AF</div><div><strong>AgentFlow Cockpit</strong><br><span>Move faster. Keep work understandable.</span></div><nav>${repo ? `<span class="badge">${escapeHtml(repo)}</span>` : ''}${user ? ` <span class="badge">${escapeHtml(user)}</span>` : ''}</nav></header>
  <main>${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''}${body}</main>
</body>
</html>`
}

export function renderGoalBoard(board = {}) {
  return `<section class="panel hero"><h1>Goal Board</h1><p>Visible path from question to confidence. GitHub remains durable truth.</p></section><section class="panel"><div class="grid">${Object.entries(
    board,
  )
    .map(
      ([column, cards]) =>
        `<section class="card"><h2>${escapeHtml(column)} (${cards.length})</h2>${cards
          .map(
            (card) =>
              `<p><a href="/issues/${card.number}">#${card.number}</a> ${escapeHtml(card.title)}<br><span class="badge ${card.evidenceHealth === 'complete' ? 'ok' : 'warn'}">${escapeHtml(card.evidenceHealth)}</span> <span class="badge">${escapeHtml(card.nextSafeAction)}</span> <a href="/issues/${card.number}/replay">Replay</a></p>`,
          )
          .join('')}</section>`,
    )
    .join('')}</div></section>`
}

export function renderIssueView(view) {
  return `<section class="panel hero"><h1>#${view.number} ${escapeHtml(view.title)}</h1><p><span class="badge">${escapeHtml(view.phaseState.currentPhase)}</span> <span class="badge">${escapeHtml(view.nextSafeAction)}</span> <a href="/issues/${view.number}/replay">Goal Story Replay</a></p></section>
  <section class="panel"><h2>SDLC Timeline</h2><div class="grid">${view.phases
    .map(
      (phase) =>
        `<div class="card"><strong>${phase.index}. ${escapeHtml(phase.label)}</strong><br><span class="badge ${phase.status === 'active' ? 'accent' : ''}">${escapeHtml(phase.status)}</span></div>`,
    )
    .join('')}</div></section>
  <section class="panel"><h2>Evidence Health</h2>${renderEvidenceHealth(view.evidenceHealth)}</section>
  <section class="panel"><h2>Relationship Graph</h2>${renderGraph(view.graph)}</section>
  <section class="panel"><h2>Comment Lanes</h2>${Object.entries(view.commentLanes)
    .map(
      ([lane, comments]) =>
        `<details open><summary>${escapeHtml(lane)} (${comments.length})</summary>${comments
          .map((comment) => `<p class="comment">${escapeHtml(summarize(comment.body || ''))}</p>`)
          .join('')}</details>`,
    )
    .join('')}</section>
  ${renderActionForms(view)}`
}

export function renderEvidenceHealth(health) {
  return `<p class="${health.status === 'complete' ? 'good' : 'bad'}">${escapeHtml(health.status)}</p><ul>${health.checks
    .map((check) => `<li>${check.ok ? '✓' : '✗'} ${escapeHtml(check.label)}</li>`)
    .join('')}</ul>`
}

export function renderGoalStory(story) {
  return `<section class="panel hero"><h1>Goal Story Replay: #${story.goal.number} ${escapeHtml(story.goal.title)}</h1><p><span class="badge">${escapeHtml(story.status)}</span> <span class="badge">read-only reconstruction</span> <a href="/issues/${story.goal.number}/replay.md">Export markdown</a></p><p>Replay recreates evidence path; it never reruns agents.</p></section>
  <section class="panel"><h2>Compact timeline</h2>${renderReplayFilters()}${renderReplayEvents(story.compactEvents)}</section>
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
  return `<div class="graph"><h3>Nodes</h3><ul>${graph.nodes
    .map(
      (node) =>
        `<li><span class="badge">${escapeHtml(node.type)}</span> ${node.url ? `<a href="${escapeHtml(node.url)}">${escapeHtml(node.label)}</a>` : escapeHtml(node.label)}</li>`,
    )
    .join('')}</ul><h3>Edges</h3><ul>${graph.edges
    .map(
      (edge) =>
        `<li>${escapeHtml(edge.from)} <span class="badge">${escapeHtml(edge.type)}</span> ${escapeHtml(edge.to)}</li>`,
    )
    .join('')}</ul></div>`
}

function renderActionForms(view) {
  return `<section class="panel"><h2>Guarded actions</h2><p>Actions require server-side auth, CSRF, confirmation, and audit when enabled.</p><form method="post" action="/actions"><input type="hidden" name="issue" value="${view.number}"><label>Intent <select name="type"><option value="add-clarification">Add clarification</option><option value="request-checkpoint">Request checkpoint</option><option value="request-human-review">Request human review</option><option value="draft-follow-up">Draft follow-up</option><option value="post-handover">Post handover</option></select></label><label>Message <textarea name="body"></textarea></label><button type="submit">Preview guarded action</button></form></section>`
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
:root { --af-bg: #08111f; --af-panel: #101c2f; --af-card: #16243a; --af-line: #28405f; --af-text: #edf6ff; --af-muted: #9fb3c8; --af-blue: #4da3ff; --af-cyan: #31d2c6; --af-green: #72e28a; --af-amber: #f6c85f; --af-red: #ff7b8a; }
body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; margin: 0; background: radial-gradient(circle at top left, #12345a, var(--af-bg) 40%); color: var(--af-text); }
.shell-header { padding: 1rem 1.25rem; background: rgba(8,17,31,.94); border-bottom: 1px solid var(--af-line); display: flex; gap: .9rem; align-items: center; position: sticky; top: 0; }
.shell-header span { color: var(--af-muted); } .shell-header nav { margin-left: auto; }
.brand-mark { width: 2.5rem; height: 2.5rem; border-radius: 999px; display: grid; place-items: center; color: #06111f; font-weight: 800; background: linear-gradient(135deg, var(--af-cyan), var(--af-blue)); box-shadow: 0 0 28px rgba(77,163,255,.35); }
main { padding: 1rem; display: grid; gap: 1rem; } .hero { border-color: var(--af-blue); }
.panel { background: rgba(16,28,47,.94); border: 1px solid var(--af-line); border-radius: .9rem; padding: 1rem; box-shadow: 0 10px 30px rgba(0,0,0,.18); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
.card { background: var(--af-card); border: 1px solid var(--af-line); border-radius: .65rem; padding: .85rem; }
a { color: #8ed8ff; } code, .badge { background: #203653; border: 1px solid #34577d; border-radius: 999px; padding: .12rem .45rem; margin: .1rem; display: inline-block; }
.badge.ok { border-color: var(--af-green); color: var(--af-green); } .badge.warn, .bad { border-color: var(--af-amber); color: var(--af-amber); } .badge.accent, .good { border-color: var(--af-cyan); color: var(--af-cyan); }
.comment { border-left: 3px solid var(--af-cyan); padding-left: .75rem; color: var(--af-muted); }
.timeline li { margin: .55rem 0; } label { display: grid; gap: .35rem; margin: .75rem 0; } textarea { min-height: 6rem; } select, textarea, button { border-radius: .5rem; border: 1px solid var(--af-line); background: #0b1627; color: var(--af-text); padding: .6rem; } button { background: linear-gradient(135deg, var(--af-cyan), var(--af-blue)); color: #06111f; font-weight: 700; }
`
