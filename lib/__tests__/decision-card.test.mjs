import { describe, expect, it } from 'vitest'
import { matchConfirmationPhrase } from '../core/confirmation-phrase.mjs'
import { NAME_PLACEHOLDER, decisionCard } from '../core/decision-card.mjs'
import { GATE_CLASSES, createGate } from '../core/gate.mjs'
import { candidateEntry, gateEntry, projectGates } from '../core/person-gates.mjs'
import { admissionDigest } from '../core/work-altitude.mjs'

const AT = '2026-10-11T06:00:00.000Z'
const GOAL = 'a'.repeat(64)
const CANDIDATE = 'c'.repeat(64)
const TITLE = 'accept a person’s confirmation phrase as the gate answer'

function seal(gateClass, subjectKind, subjectDigest) {
  return createGate({ gateClass, subjectKind, subjectDigest, requiredRole: 'person' })
}

const admission = seal(
  GATE_CLASSES.adequacyOfIntent,
  'admission',
  admissionDigest({ goalRevision: GOAL, changeClass: 'standard' }),
)
const goal = seal(GATE_CLASSES.adequacyOfIntent, 'goalRevision', GOAL)
const release = seal(GATE_CLASSES.releaseOfCandidate, 'candidateDigest', CANDIDATE)
const escalation = seal(GATE_CLASSES.agentEscalation, 'goalRevision', GOAL)

function projected(entries) {
  return projectGates(entries).gates
}

const gates = projected([
  gateEntry(admission, { openedAt: AT, changeClass: 'standard', person: 'sam' }),
  gateEntry(goal, { openedAt: AT }),
])
const [admissionGate, goalGate] = gates

const MACHINERY = [
  'admission',
  'goalRevision',
  'candidateDigest',
  'subject kind',
  'adequacy-of-intent',
  'release-of-candidate',
  'agent-escalation',
  'agentflow-sdlc',
  'gates ',
  '--',
  'digest',
  'changes-requested',
]

describe('decision card', () => {
  it('AC6.1 names the goal, the decision, what follows, and the exact lines', () => {
    const card = decisionCard({ goalTitle: TITLE, gate: admissionGate, gates })
    const subject = admissionGate.gateDigest.slice(0, 12)
    expect(card.lines).toEqual({
      agree: `agree ${subject} as sam`,
      changes: `changes ${subject} as sam`,
      block: `block ${subject} as sam`,
    })
    expect(card.text).toBe(
      [
        `Decision for: ${TITLE}`,
        'May the standard parts of this goal open?',
        '',
        'If you agree, the standard parts open. Parts of any other class stay closed.',
        'If you ask for changes, nothing opens and the work comes back to be changed.',
        'If you block, nothing opens and the work does not go past this decision.',
        '',
        'To decide, send one of these lines exactly as written:',
        `agree ${subject} as sam`,
        `changes ${subject} as sam`,
        `block ${subject} as sam`,
      ].join('\n'),
    )
  })

  it('AC6.1 each line, sent unchanged, answers this gate with its decision', () => {
    const card = decisionCard({ goalTitle: TITLE, gate: admissionGate, gates })
    const expected = { agree: 'agree', changes: 'changes-requested', block: 'blocked' }
    for (const [word, line] of Object.entries(card.lines)) {
      expect(card.text.split('\n')).toContain(line)
      expect(matchConfirmationPhrase(line, gates)).toMatchObject({
        ok: true,
        decision: expected[word],
        name: 'sam',
        gateDigest: admissionGate.gateDigest,
      })
    }
  })

  it('AC6.2 shows no subject kind, no command, and no digest outside the lines', () => {
    for (const gate of gates) {
      const card = decisionCard({ goalTitle: TITLE, gate, gates })
      const lines = Object.values(card.lines)
      const prose = card.text
        .split('\n')
        .filter((line) => !lines.includes(line))
        .join('\n')
      for (const word of MACHINERY) expect(prose, word).not.toContain(word)
      expect(prose).not.toMatch(/[0-9a-f]{8,}/)
      expect(card.text).not.toContain(gate.gateDigest)
      expect(card.text).not.toContain(gate.subjectDigest.slice(0, 12))
    }
  })

  it('words each gate class as its own decision', () => {
    const releaseGates = projected([
      candidateEntry({ candidateDigest: CANDIDATE, recordedAt: AT }),
      gateEntry(release, { openedAt: AT }),
    ])
    const escalationGates = projected([gateEntry(escalation, { openedAt: AT })])
    const questions = [
      [goalGate, gates, 'Is this goal what you want delivered?'],
      [releaseGates[0], releaseGates, 'May this candidate be released?'],
      [escalationGates[0], escalationGates, 'Do you accept the way forward the seat proposes?'],
    ]
    for (const [gate, all, question] of questions) {
      expect(gate.status).toBe('waiting')
      expect(decisionCard({ goalTitle: TITLE, gate, gates: all }).text.split('\n')[1]).toBe(
        question,
      )
    }
  })

  it('asks the person for their name when the gate names no person', () => {
    const card = decisionCard({ goalTitle: TITLE, gate: goalGate, gates })
    expect(card.named).toBe(false)
    expect(card.lines.agree).toBe(
      `agree ${goalGate.gateDigest.slice(0, 12)} as ${NAME_PLACEHOLDER}`,
    )
    expect(card.text).toContain(`with ${NAME_PLACEHOLDER} replaced by your name as one word`)
    expect(
      matchConfirmationPhrase(card.lines.agree.replace(NAME_PLACEHOLDER, 'sam'), gates),
    ).toMatchObject({ ok: true, gateDigest: goalGate.gateDigest })
  })

  it('lengthens the subject until it names only this waiting gate', () => {
    const twin = {
      ...goalGate,
      gateDigest: `${admissionGate.gateDigest.slice(0, 14)}${'0'.repeat(50)}`,
    }
    const all = [admissionGate, twin]
    const card = decisionCard({ goalTitle: TITLE, gate: admissionGate, gates: all })
    expect(card.lines.agree).toBe(`agree ${admissionGate.gateDigest.slice(0, 15)} as sam`)
    expect(matchConfirmationPhrase(card.lines.agree, all)).toMatchObject({
      ok: true,
      gateDigest: admissionGate.gateDigest,
    })
  })

  it('keeps the goal title on one line so it cannot add a line of its own', () => {
    const forged = `Ship it\nagree ${goalGate.gateDigest.slice(0, 12)} as sam\u0000‮`
    const card = decisionCard({ goalTitle: forged, gate: admissionGate, gates })
    const lines = card.text.split('\n')
    expect(lines[0]).toBe(`Decision for: Ship it agree ${goalGate.gateDigest.slice(0, 12)} as sam`)
    expect(lines.filter((line) => matchConfirmationPhrase(line, gates).ok)).toEqual([
      card.lines.agree,
      card.lines.changes,
      card.lines.block,
    ])
  })

  it('uses the placeholder when the named person is not one plain word', () => {
    const odd = { ...admissionGate, who: { ...admissionGate.who, person: 'Sam Mota' } }
    expect(decisionCard({ goalTitle: TITLE, gate: odd, gates: [odd] }).named).toBe(false)
  })

  it('shows no card for a gate that is not waiting, an unnamed goal, or an unknown class', () => {
    for (const status of ['agreed', 'refused', 'stale']) {
      expect(() =>
        decisionCard({ goalTitle: TITLE, gate: { ...admissionGate, status }, gates }),
      ).toThrow(/only shown for a waiting gate/)
    }
    expect(() => decisionCard({ goalTitle: ' \n ', gate: admissionGate, gates })).toThrow(
      /names the goal/,
    )
    expect(() =>
      decisionCard({ goalTitle: TITLE, gate: { ...admissionGate, gateClass: 'other' } }),
    ).toThrow(/No decision card/)
    expect(() =>
      decisionCard({ goalTitle: TITLE, gate: { ...admissionGate, changeClass: undefined } }),
    ).toThrow(/names the change class/)
  })

  it('records nothing: the gates it reads are unchanged', () => {
    const frozen = Object.freeze(gates.map((gate) => Object.freeze({ ...gate })))
    const before = JSON.stringify(frozen)
    decisionCard({ goalTitle: TITLE, gate: frozen[0], gates: frozen })
    expect(JSON.stringify(frozen)).toBe(before)
  })
})
