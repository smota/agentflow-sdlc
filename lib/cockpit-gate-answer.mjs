import { parseConfirmationPhrase } from './core/confirmation-phrase.mjs'
import { decisionCard } from './core/decision-card.mjs'
import { gateView } from './core/person-gates.mjs'
import { parseGateLog } from './sources/gate-block.mjs'
import { githubGoalSubject } from './sources/github-medium.mjs'

// The cockpit answer box (#384). A person answers a waiting gate from the cockpit with the same
// line they would send in chat: `agree|changes|block <subject> as <name>`. The box takes that one
// line and nothing else. It has no agree button and no approval wording of its own, and answering
// promotes no phase and dispatches no seat. The line is filed through `gates file`, so the record
// is the one the phrase parser gives.

// The seat named as the filer of a line typed into the cockpit.
export const COCKPIT_SEAT = 'cockpit'

// The person gates on a GitHub issue, read from its gate block as the GitHub medium reads them. An
// issue with no block, or a block that cannot be read, shows no gates.
export function issueGates(issue) {
  try {
    return gateView(parseGateLog(issue?.body ?? ''), {
      subjects: { goalRevision: githubGoalSubject(issue) },
    }).gates
  } catch {
    return []
  }
}

// The box holds one confirmation line. Anything else is refused before anything is filed.
export function acceptCockpitLine(text) {
  const phrase = parseConfirmationPhrase(text)
  if (!phrase.ok) return { ok: false, code: phrase.code, reason: phrase.reason }
  return { ok: true, line: text.trim() }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Each waiting gate shows its decision card, then one box for the person's line. A gate the card
// cannot word is not shown, so the box never offers a line the person cannot read about first.
export function renderGateAnswerBox({ goalTitle, gates = [], issue, repo, csrfToken } = {}) {
  const cards = gates
    .filter((gate) => gate?.status === 'waiting')
    .flatMap((gate) => {
      try {
        return [decisionCard({ goalTitle, gate, gates }).text]
      } catch {
        return []
      }
    })
  if (!cards.length) return ''
  const action = `/actions${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`
  return `<section class="panel gate-answer" id="gate-answer"><h2>A decision is waiting for you</h2>${cards
    .map((text) => `<pre class="decision-card">${escapeHtml(text)}</pre>`)
    .join('')}<form method="post" action="${action}" class="gate-answer-form">${
    csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''
  }<input type="hidden" name="issue" value="${escapeHtml(issue)}"><input type="hidden" name="type" value="gate-answer"><label for="gate-line">Your line <input type="text" id="gate-line" name="line" required autocomplete="off" spellcheck="false"></label><button type="submit">Send</button></form></section>`
}
