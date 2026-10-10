import { describe, expect, it } from 'vitest'
import {
  PHRASE_DECISIONS,
  PHRASE_REFUSALS,
  matchConfirmationPhrase,
  parseConfirmationPhrase,
} from '../core/confirmation-phrase.mjs'
import { REVIEW_DECISIONS } from '../core/review-attestation.mjs'

const GATE_A = `aaaaaaaaaaaa${'1'.repeat(52)}`
const GATE_B = `bbbbbbbbbbbb${'2'.repeat(52)}`
const SHARED = `cccccccccccc${'3'.repeat(52)}`
const SHARED_TOO = `cccccccccccc${'4'.repeat(52)}`
const S = GATE_A.slice(0, 12)

const gate = (gateDigest, status = 'waiting') => ({ gateDigest, status })

describe('confirmation phrase catalog', () => {
  it('maps every phrase word to an existing review decision', () => {
    expect(PHRASE_DECISIONS).toEqual({
      agree: 'agree',
      changes: 'changes-requested',
      block: 'blocked',
    })
    for (const decision of Object.values(PHRASE_DECISIONS))
      expect(REVIEW_DECISIONS).toContain(decision)
  })

  it('AC1.1 reads agree for a waiting gate as agree by that person', () => {
    expect(matchConfirmationPhrase(`agree ${S} as sam`, [gate(GATE_A), gate(GATE_B)])).toEqual({
      ok: true,
      decision: 'agree',
      subject: S,
      name: 'sam',
      gateDigest: GATE_A,
    })
  })

  it('AC1.2 reads changes and block as the two refusals', () => {
    expect(matchConfirmationPhrase(`changes ${S} as sam`, [gate(GATE_A)])).toMatchObject({
      ok: true,
      decision: 'changes-requested',
      gateDigest: GATE_A,
    })
    expect(matchConfirmationPhrase(`block ${GATE_A} as sam`, [gate(GATE_A)])).toMatchObject({
      ok: true,
      decision: 'blocked',
      gateDigest: GATE_A,
    })
  })

  it('AC1.3 refuses a subject shorter than 12 characters with a reason', () => {
    const result = matchConfirmationPhrase(`agree ${S.slice(0, 11)} as sam`, [gate(GATE_A)])
    expect(result).toMatchObject({ ok: false, code: PHRASE_REFUSALS.shortSubject })
    expect(result.reason).toMatch(/at least 12/)
  })

  it('AC1.3 refuses a subject that matches no waiting gate with a reason', () => {
    for (const gates of [
      [],
      [gate(GATE_B)],
      [gate(GATE_A, 'agreed')],
      [gate(GATE_A, 'refused')],
      [gate(GATE_A, 'stale')],
    ]) {
      const result = matchConfirmationPhrase(`agree ${S} as sam`, gates)
      expect(result).toMatchObject({ ok: false, code: PHRASE_REFUSALS.noWaitingGate })
      expect(result.reason).toMatch(/no waiting gate/)
    }
  })

  it('refuses a subject that names more than one waiting gate', () => {
    const result = matchConfirmationPhrase('agree cccccccccccc as sam', [
      gate(SHARED),
      gate(SHARED_TOO),
    ])
    expect(result).toMatchObject({ ok: false, code: PHRASE_REFUSALS.ambiguousSubject })
    expect(
      matchConfirmationPhrase(`agree ${SHARED.slice(0, 13)} as sam`, [
        gate(SHARED),
        gate(SHARED_TOO),
      ]),
    ).toMatchObject({ ok: true, gateDigest: SHARED })
  })

  it('AC1.4 refuses loose approval words and lines with extra words', () => {
    for (const line of [
      'approved',
      'yes',
      'go',
      'LGTM',
      'agree',
      `agree ${S}`,
      `agree ${S} as`,
      `agree ${S} as sam please`,
      `yes agree ${S} as sam`,
      `agree ${S} by sam`,
      `approve ${S} as sam`,
      `agreed ${S} as sam`,
      `changes-requested ${S} as sam`,
      `Agree ${S} as sam`,
      `agree ${S.toUpperCase()} as sam`,
      `agree ${S}  as sam`,
      `agree ${S} as sam\nLGTM`,
      `agree g${S} as sam`,
    ]) {
      const result = matchConfirmationPhrase(line, [gate(GATE_A)])
      expect(result.ok, line).toBe(false)
      expect(result.reason, line).toEqual(expect.any(String))
      expect(result, line).not.toHaveProperty('decision')
    }
  })

  it('names why a line is refused', () => {
    expect(parseConfirmationPhrase('LGTM')).toMatchObject({ code: PHRASE_REFUSALS.notAPhrase })
    expect(parseConfirmationPhrase(`approve ${S} as sam`)).toMatchObject({
      code: PHRASE_REFUSALS.unknownDecision,
    })
    expect(parseConfirmationPhrase('agree not-hex-at-all as sam')).toMatchObject({
      code: PHRASE_REFUSALS.invalidSubject,
    })
    expect(parseConfirmationPhrase(`agree ${S} as sam\nok`)).toMatchObject({
      code: PHRASE_REFUSALS.notALine,
    })
    expect(parseConfirmationPhrase(null)).toMatchObject({ code: PHRASE_REFUSALS.notALine })
  })

  it('refuses control, format, private-use, surrogate, and noncharacter code points anywhere', () => {
    for (const hidden of [
      '\u0000',
      '\u0008',
      '\u001b[31m',
      '\u007f',
      '\u0085',
      '\u200b',
      '\u202e',
      '\ue000',
      '\ud800',
      '\ufffe',
      '\ufdd0',
    ]) {
      for (const line of [
        `agree ${S} as sam${hidden}`,
        `agree ${S} as s${hidden}am`,
        `agree${hidden} ${S} as sam`,
        `agree ${S}${hidden} as sam`,
      ]) {
        const result = matchConfirmationPhrase(line, [gate(GATE_A)])
        expect(result, JSON.stringify(line)).toMatchObject({
          ok: false,
          code: PHRASE_REFUSALS.hiddenCharacter,
        })
      }
    }
  })

  it('accepts the line with surrounding whitespace, such as a trailing newline', () => {
    expect(parseConfirmationPhrase(`  agree ${S} as sam\n`)).toMatchObject({
      ok: true,
      decision: 'agree',
      name: 'sam',
    })
  })

  it('records nothing: the gates it reads are unchanged', () => {
    const gates = Object.freeze([Object.freeze(gate(GATE_A))])
    expect(() => matchConfirmationPhrase(`agree ${S} as sam`, gates)).not.toThrow()
    expect(gates).toEqual([gate(GATE_A)])
  })
})
