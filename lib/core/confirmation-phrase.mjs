// The person's confirmation phrase: one exact line that answers a waiting gate.
//
//   agree <subject> as <name>
//   changes <subject> as <name>
//   block <subject> as <name>
//
// <subject> is a prefix of the gate digest the seat showed, at least 12 lowercase hex characters.
// <name> is one word naming the person. Nothing else may be on the line, and loose approval words
// are refused. Recognizing a line records nothing: filing an answer belongs to the seat-filing part,
// and the decision rule stays in satisfyGate (lib/core/gate.mjs).

export const PHRASE_DECISIONS = Object.freeze({
  agree: 'agree',
  changes: 'changes-requested',
  block: 'blocked',
})

export const MIN_SUBJECT_LENGTH = 12

export const PHRASE_REFUSALS = Object.freeze({
  notALine: 'not-a-line',
  hiddenCharacter: 'hidden-character',
  notAPhrase: 'not-a-phrase',
  unknownDecision: 'unknown-decision',
  shortSubject: 'short-subject',
  invalidSubject: 'invalid-subject',
  noWaitingGate: 'no-waiting-gate',
  ambiguousSubject: 'ambiguous-subject',
})

const REASON_TEXT = {
  [PHRASE_REFUSALS.notALine]: 'the answer must be a single line of text',
  [PHRASE_REFUSALS.hiddenCharacter]:
    'the line holds a control, format, private-use, surrogate, or noncharacter code point',
  [PHRASE_REFUSALS.notAPhrase]:
    'the line must be exactly `agree|changes|block <subject> as <name>` with nothing else',
  [PHRASE_REFUSALS.unknownDecision]: 'the decision must be agree, changes, or block',
  [PHRASE_REFUSALS.shortSubject]: `the subject must be at least ${MIN_SUBJECT_LENGTH} characters of the gate digest`,
  [PHRASE_REFUSALS.invalidSubject]: 'the subject must be lowercase hex from the gate digest',
  [PHRASE_REFUSALS.noWaitingGate]: 'the subject matches no waiting gate',
  [PHRASE_REFUSALS.ambiguousSubject]:
    'the subject matches more than one waiting gate; send more of the digest',
}

function refuse(code) {
  return { ok: false, code, reason: REASON_TEXT[code] }
}

/** Reads one line as a confirmation phrase. Pure: it consults no gate and records nothing. */
export function parseConfirmationPhrase(line) {
  if (typeof line !== 'string') return refuse(PHRASE_REFUSALS.notALine)
  const trimmed = line.trim()
  if (/[\r\n]/.test(trimmed)) return refuse(PHRASE_REFUSALS.notALine)
  if (/\p{C}/u.test(trimmed)) return refuse(PHRASE_REFUSALS.hiddenCharacter)
  const tokens = trimmed.split(' ')
  if (tokens.length !== 4 || tokens.some((token) => !token) || tokens[2] !== 'as')
    return refuse(PHRASE_REFUSALS.notAPhrase)
  const [word, subject, , name] = tokens
  if (!Object.hasOwn(PHRASE_DECISIONS, word)) return refuse(PHRASE_REFUSALS.unknownDecision)
  if (!/^[0-9a-f]+$/.test(subject)) return refuse(PHRASE_REFUSALS.invalidSubject)
  if (subject.length < MIN_SUBJECT_LENGTH) return refuse(PHRASE_REFUSALS.shortSubject)
  if (/\s/.test(name)) return refuse(PHRASE_REFUSALS.notAPhrase)
  return { ok: true, decision: PHRASE_DECISIONS[word], subject, name }
}

/**
 * Resolves a phrase against the projected gates of one work item (`gateView(log).gates`). Only a
 * waiting gate can be answered, and the subject must name exactly one of them.
 */
export function matchConfirmationPhrase(line, gates = []) {
  const parsed = parseConfirmationPhrase(line)
  if (!parsed.ok) return parsed
  const matches = (Array.isArray(gates) ? gates : []).filter(
    (gate) => gate?.status === 'waiting' && gate.gateDigest?.startsWith(parsed.subject),
  )
  if (matches.length === 0) return refuse(PHRASE_REFUSALS.noWaitingGate)
  if (matches.length > 1) return refuse(PHRASE_REFUSALS.ambiguousSubject)
  return { ...parsed, gateDigest: matches[0].gateDigest }
}
