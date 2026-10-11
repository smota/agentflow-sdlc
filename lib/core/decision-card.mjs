import { GATE_CLASSES } from './gate.mjs'
import {
  MIN_SUBJECT_LENGTH,
  matchConfirmationPhrase,
  parseConfirmationPhrase,
} from './confirmation-phrase.mjs'

// The decision card (#394): what a seat shows the person when a gate waits. It is words only: the
// goal, the decision, what follows each answer, and the exact lines to send. It shows no subject
// kind, no command, and no gate digest except the prefix inside each line (#380 C3). Building a
// card records nothing; the person's line is filed separately (`gates file`).

export const NAME_PLACEHOLDER = '<your name>'

const ON_REFUSAL = {
  changes: 'If you ask for changes, nothing opens and the work comes back to be changed.',
  block: 'If you block, nothing opens and the work does not go past this decision.',
}

function decisionFor(gate) {
  if (gate.gateClass === GATE_CLASSES.adequacyOfIntent && gate.subjectKind === 'admission') {
    const changeClass = oneLine(gate.changeClass)
    if (!changeClass) throw new Error('An admission card names the change class it admits')
    const parts = `${changeClass} parts`
    return {
      question: `May the ${parts} of this goal open?`,
      onAgree: `If you agree, the ${parts} open. Parts of any other class stay closed.`,
    }
  }
  if (gate.gateClass === GATE_CLASSES.adequacyOfIntent) {
    return {
      question: 'Is this goal what you want delivered?',
      onAgree: 'If you agree, the goal is settled as written and its parts can be proposed.',
    }
  }
  if (gate.gateClass === GATE_CLASSES.releaseOfCandidate) {
    return {
      question: 'May this candidate be released?',
      onAgree: 'If you agree, this candidate may be released.',
    }
  }
  if (gate.gateClass === GATE_CLASSES.agentEscalation) {
    return {
      question: 'Do you accept the way forward the seat proposes?',
      onAgree: 'If you agree, the seat goes on the way it proposed.',
    }
  }
  throw new Error(`No decision card for gate class ${gate.gateClass}`)
}

// The goal title and the change class are each shown on one line. Control characters and line
// breaks become spaces so neither can place a line of its own, such as a confirmation line, on
// the card.
function oneLine(value) {
  return String(value ?? '')
    .replace(/[\p{C}\s]+/gu, ' ')
    .trim()
}

// The shortest digest prefix, at least MIN_SUBJECT_LENGTH, that names only this waiting gate.
function subjectFor(gate, gates) {
  const others = gates
    .filter((other) => other?.status === 'waiting' && other.gateDigest !== gate.gateDigest)
    .map((other) => other.gateDigest)
  for (let length = MIN_SUBJECT_LENGTH; length <= gate.gateDigest.length; length += 1) {
    const prefix = gate.gateDigest.slice(0, length)
    if (!others.some((digest) => digest.startsWith(prefix))) return prefix
  }
  throw new Error('The gate digest does not name one waiting gate')
}

/**
 * Builds the card for one waiting gate. `gates` is the item's projected gates
 * (`gateView(log).gates`), so the subject in each line names only this gate. The line carries the
 * gate's named person when there is one; otherwise the person writes their own name.
 */
export function decisionCard({ goalTitle, gate, gates = [gate] } = {}) {
  if (gate?.status !== 'waiting')
    throw new Error('A decision card is only shown for a waiting gate')
  const title = oneLine(goalTitle)
  if (!title) throw new Error('A decision card names the goal')
  const { question, onAgree } = decisionFor(gate)
  const subject = subjectFor(gate, gates)

  const person = gate.who?.person ?? null
  const named =
    person !== null && matchConfirmationPhrase(`agree ${subject} as ${person}`, gates).ok
  const name = named ? person : NAME_PLACEHOLDER
  const lines = {
    agree: `agree ${subject} as ${name}`,
    changes: `changes ${subject} as ${name}`,
    block: `block ${subject} as ${name}`,
  }
  const check = matchConfirmationPhrase(`agree ${subject} as person`, gates)
  if (!check.ok || check.gateDigest !== gate.gateDigest) {
    throw new Error(`The card line would not answer this gate: ${check.reason ?? 'another gate'}`)
  }

  const prose = [
    `Decision for: ${title}`,
    question,
    '',
    onAgree,
    ON_REFUSAL.changes,
    ON_REFUSAL.block,
    '',
    named
      ? 'To decide, send one of these lines exactly as written:'
      : `To decide, send one of these lines with ${NAME_PLACEHOLDER} replaced by your name as one word:`,
  ]
  // Only the three lines below may read as a confirmation phrase.
  if (prose.some((line) => parseConfirmationPhrase(line).ok)) {
    throw new Error('The card prose holds a confirmation line')
  }
  const text = [...prose, lines.agree, lines.changes, lines.block].join('\n')

  return { text, lines, gateDigest: gate.gateDigest, named }
}
