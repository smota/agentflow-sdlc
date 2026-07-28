export function renderCockpitPage({ title = 'AgentFlow Cockpit', body = '', user, repo } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    header { padding: 1rem 1.25rem; background: #111827; border-bottom: 1px solid #334155; }
    main { padding: 1rem; display: grid; gap: 1rem; }
    .panel { background: #111827; border: 1px solid #334155; border-radius: .75rem; padding: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: .5rem; padding: .75rem; }
    a { color: #93c5fd; }
    code, .badge { background: #334155; border-radius: .25rem; padding: .1rem .35rem; }
    .bad { color: #fca5a5; }
    .good { color: #86efac; }
  </style>
</head>
<body>
  <header><strong>AgentFlow Cockpit</strong>${repo ? ` <span class="badge">${escapeHtml(repo)}</span>` : ''}${user ? ` <span class="badge">${escapeHtml(user)}</span>` : ''}</header>
  <main>${body}</main>
</body>
</html>`
}

export function renderGoalBoard(board = {}) {
  return `<section class="panel"><h1>Goal Board</h1><div class="grid">${Object.entries(board)
    .map(
      ([column, cards]) =>
        `<section class="card"><h2>${escapeHtml(column)} (${cards.length})</h2>${cards
          .map(
            (card) =>
              `<p><a href="/issues/${card.number}">#${card.number}</a> ${escapeHtml(card.title)}<br><span class="badge">${escapeHtml(card.evidenceHealth)}</span> <span class="badge">${escapeHtml(card.nextSafeAction)}</span></p>`,
          )
          .join('')}</section>`,
    )
    .join('')}</div></section>`
}

export function renderIssueView(view) {
  return `<section class="panel"><h1>#${view.number} ${escapeHtml(view.title)}</h1><p><span class="badge">${escapeHtml(view.phaseState.currentPhase)}</span> <span class="badge">${escapeHtml(view.nextSafeAction)}</span></p></section>
  <section class="panel"><h2>SDLC Timeline</h2><div class="grid">${view.phases
    .map(
      (phase) =>
        `<div class="card"><strong>${phase.index}. ${escapeHtml(phase.label)}</strong><br>${escapeHtml(phase.status)}</div>`,
    )
    .join('')}</div></section>
  <section class="panel"><h2>Evidence Health</h2>${renderEvidenceHealth(view.evidenceHealth)}</section>
  <section class="panel"><h2>Comment Lanes</h2>${Object.entries(view.commentLanes)
    .map(([lane, comments]) => `<h3>${escapeHtml(lane)} (${comments.length})</h3>`)
    .join('')}</section>`
}

export function renderEvidenceHealth(health) {
  return `<p class="${health.status === 'complete' ? 'good' : 'bad'}">${escapeHtml(health.status)}</p><ul>${health.checks
    .map((check) => `<li>${check.ok ? '✓' : '✗'} ${escapeHtml(check.label)}</li>`)
    .join('')}</ul>`
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
