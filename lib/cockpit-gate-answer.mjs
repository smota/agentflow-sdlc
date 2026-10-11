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

// Who must answer a waiting gate: the person the gate names, or else its required role.
function answererFor(gate) {
  return oneLine(gate.who?.person) || `the ${oneLine(gate.who?.role) || 'person'}`
}

// The subject in words (#415). The card already names the goal, so the title is not repeated. The
// digest is not shown: the prefix inside each line names it, and the line answers only while the
// subject is unchanged.
function subjectFor(gate) {
  const goal = 'this goal as written now, its title and body'
  if (gate.subjectKind === 'admission')
    return `opening the ${oneLine(gate.changeClass)} parts of ${goal}`
  if (gate.subjectKind === 'candidateDigest') return 'the candidate recorded on this goal'
  return goal
}

function oneLine(value) {
  return String(value ?? '')
    .replace(/[\p{C}\s]+/gu, ' ')
    .trim()
}

// Each waiting gate shows who must answer, the subject, and its decision card, then one box for the
// person's line. A gate the card cannot word is not shown, so the box never offers a line the
// person cannot read about first.
export function renderGateAnswerBox({ goalTitle, gates = [], issue, repo, csrfToken } = {}) {
  const cards = gates
    .filter((gate) => gate?.status === 'waiting')
    .flatMap((gate) => {
      try {
        const { text } = decisionCard({ goalTitle, gate, gates })
        return [
          `<div class="gate-waiting"><p class="gate-who">Who must answer: ${escapeHtml(
            answererFor(gate),
          )}</p><p class="gate-subject">Subject: ${escapeHtml(
            subjectFor(gate),
          )}</p><pre class="decision-card">${escapeHtml(text)}</pre></div>`,
        ]
      } catch {
        return []
      }
    })
  if (!cards.length) return ''
  const action = `/actions${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`
  return `<section class="panel gate-answer" id="gate-answer"><h2>A decision is waiting for you</h2>${cards.join(
    '',
  )}<form method="post" action="${action}" class="gate-answer-form">${
    csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">` : ''
  }<input type="hidden" name="issue" value="${escapeHtml(issue)}"><input type="hidden" name="type" value="gate-answer"><label for="gate-line">Your line <input type="text" id="gate-line" name="line" required autocomplete="off" spellcheck="false"></label><button type="submit">Send</button></form></section>`
}

const RESULT_WORDS = {
  agree: 'agreed',
  'changes-requested': 'refused, changes asked',
  blocked: 'refused, blocked',
}

// What became of each answered gate (#415): agreed, refused, or stale. Only the person's line moves
// a gate, so only answered gates are listed. A stale answer is shown and does not count.
export function renderGateResults({ gates = [] } = {}) {
  const rows = gates
    .filter((gate) => gate?.answer && ['agreed', 'refused', 'stale'].includes(gate.status))
    .map((gate) => {
      const { answer } = gate
      const result =
        gate.status === 'stale'
          ? 'stale: the subject changed after this answer, so it does not count'
          : (RESULT_WORDS[answer.decision] ?? gate.status)
      const line = answer.line ? ` with the line <code>${escapeHtml(answer.line)}</code>` : ''
      return `<li class="gate-result gate-${gate.status}"><strong>${escapeHtml(
        answer.person,
      )}</strong> answered${line}. Result: ${escapeHtml(result)}.</li>`
    })
  if (!rows.length) return ''
  return `<section class="panel gate-results" id="gate-results"><h2>Answered decisions</h2><ul>${rows.join(
    '',
  )}</ul></section>`
}
