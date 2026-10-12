import { describe, expect, it } from 'vitest'
import { validateIssueAgainstSdlc } from '../sdlc-state.mjs'
import { goalSubjectDigest } from '../core/person-gates.mjs'
import { githubGoalSubject } from '../sources/github-medium.mjs'
import {
  currentParts,
  replacementFindings,
  replacementOf,
  workProjectionFindings,
} from '../core/work-projection.mjs'

// The #371 shape: breakdown notes #373 to #379, and #393, the admitted taxonomy that replaces #373.
const marker = (kind, parent) =>
  `<!-- agentflow-work:${JSON.stringify({ kind, parent: parent ? `https://github.com/smota/agentflow-sdlc/issues/${parent}` : null })} -->`

const goal = (number) => ({
  number,
  title: 'goal: supervise the cockpit',
  body: `${marker('goal')}\n**Kind:** goal\n\n## Job\n\nx`,
  labels: ['kind:goal'],
})

const note = (number, parent = 371) => ({
  number,
  title: `capability: breakdown ${number}`,
  body: `**Kind:** capability\n\n**Epic:** #${parent}\n\n## Part\n\nx\n\nPart of #${parent}`,
  labels: ['kind:capability'],
})

const capability = (number, { parent = 371, replaces = [] } = {}) => ({
  number,
  title: `capability: admitted ${number}`,
  body: [
    marker('capability', parent),
    '**Kind:** capability\n\n## Part\n\nx',
    `Part of #${parent}`,
    ...replaces.map((item) => `Replaces #${item}`),
  ].join('\n\n'),
  labels: ['kind:capability'],
})

const spec = (number, parent) => ({
  number,
  title: `spec: unit ${number}`,
  body: `${marker('spec', parent)}\n**Kind:** spec\n\nPart of #${parent}`,
  labels: ['kind:spec'],
})

const notes = [373, 374, 375, 376, 377, 378, 379].map((number) => note(number))
const records = [goal(371), ...notes, capability(393, { replaces: [373] })]

const config = { labels: { type: ['feature'], forbiddenPrefixes: [] } }
const withAcceptance = (issue) => ({
  ...issue,
  body: `${issue.body}\n\n## Acceptance criteria\n- [ ] x`,
  labels: [...issue.labels, 'feature'],
})
const replacementCodes = (issue, set) =>
  validateIssueAgainstSdlc(withAcceptance(issue), config, { records: set })
    .findings.filter((item) => item.code.startsWith('issue.work-'))
    .map((item) => item.message)

describe('one current record per part', () => {
  it('AC1 lists taxonomy once, as #393, and not #373', () => {
    const parts = currentParts(records, 371)
    const numbers = parts.current.map((part) => part.number)
    expect(numbers).toEqual([374, 375, 376, 377, 378, 379, 393])
    expect(numbers.filter((number) => number === 393)).toHaveLength(1)
    expect(parts.replaced).toEqual([{ number: 373, by: 393 }])
  })

  it('AC2 lists each note with no replacement once, as not yet admitted', () => {
    const { current } = currentParts(records, 371)
    for (const number of [374, 375, 376, 377, 378, 379]) {
      expect(current.filter((part) => part.number === number)).toEqual([
        { number, title: `capability: breakdown ${number}`, kind: 'capability', admitted: false },
      ])
    }
    expect(current.find((part) => part.number === 393).admitted).toBe(true)
  })

  it('AC3 reads the note unchanged and names the record that replaces it', () => {
    const before = JSON.stringify(records)
    expect(replacementOf(records, 373)).toBe(393)
    expect(replacementOf(records, 374)).toBeNull()
    currentParts(records, 371)
    replacementFindings(records)
    expect(JSON.stringify(records)).toBe(before)
  })

  it('AC4 rejects a second capability that replaces the same note', () => {
    const set = [...records, capability(394, { replaces: [373] })]
    expect(replacementFindings(set)).toEqual([
      { number: 394, message: '#373 is already replaced by #393' },
    ])
    expect(replacementCodes(capability(394, { replaces: [373] }), set)).toEqual([
      '#373 is already replaced by #393',
    ])
    expect(replacementCodes(capability(393, { replaces: [373] }), set)).toEqual([])
    expect(currentParts(set, 371).current.map((part) => part.number)).toContain(394)
    expect(currentParts(set, 371).replaced).toEqual([{ number: 373, by: 393 }])
  })

  it('refuses one capability that names more than one note', () => {
    const two = capability(394, { replaces: [374, 375] })
    expect(workProjectionFindings(two)).toEqual(['a capability replaces at most one note'])
    expect(replacementFindings([...records, two])).toEqual([
      { number: 394, message: 'a capability replaces at most one note' },
    ])
    expect(currentParts([...records, two], 371).replaced).toEqual([{ number: 373, by: 393 }])
  })

  it('AC5 rejects a replacement of a note under another parent', () => {
    const set = [...records, goal(386), capability(397, { parent: 386, replaces: [374] })]
    expect(replacementFindings(set)).toEqual([
      { number: 397, message: 'cannot replace #374, which is part of #371, not #386' },
    ])
    expect(replacementOf(set, 374)).toBeNull()
  })

  it('AC6 rejects a replacement of a goal, a spec, an admitted capability, or itself', () => {
    const set = [...records, spec(500, 393)]
    const cases = [
      [371, 'cannot replace #371, a goal'],
      [500, 'cannot replace #500, a spec'],
      [393, 'cannot replace #393, an admitted capability'],
      [600, 'a record cannot replace itself'],
    ]
    for (const [target, message] of cases) {
      const claim = capability(600, { replaces: [target] })
      expect(replacementCodes(claim, [...set, claim])).toEqual([message])
    }
    expect(workProjectionFindings(capability(600, { replaces: [600] }))).toEqual([
      'a record cannot replace itself',
    ])
  })

  it('refuses a replacement claimed by a goal, a spec, or a note', () => {
    const claimed = (record) => ({ ...record, body: `${record.body}\n\nReplaces #374` })
    expect(workProjectionFindings(claimed(goal(371)))).toEqual([
      'a goal cannot replace a record; only an admitted capability can',
    ])
    expect(workProjectionFindings(claimed(spec(500, 393)))).toEqual([
      'a spec cannot replace a record; only an admitted capability can',
    ])
    expect(workProjectionFindings(claimed(note(375)))).toEqual([
      'only an admitted capability can name Replaces #<note>',
    ])
  })

  it('reads a replacement only from its own line', () => {
    const prose = capability(394)
    prose.body += '\n\nThe hand-written breakdown that this replaces #374 is history.'
    expect(replacementOf([...records, prose], 374)).toBeNull()
  })

  it('AC7 accepts a note with no replacement and still checks its parent', () => {
    for (const record of notes) expect(workProjectionFindings(record)).toEqual([])
    expect(replacementCodes(note(374), records)).toEqual([])
    const orphan = { ...note(380), body: '**Kind:** capability\n\n## Part\n\nx' }
    expect(workProjectionFindings(orphan)).toEqual([
      'a not-yet-admitted part needs one Part of #<parent>',
    ])
    const crossed = { ...note(380), body: '**Kind:** capability\n\n**Epic:** #1\n\nPart of #371' }
    expect(workProjectionFindings(crossed)).toEqual([
      '**Epic:** must repeat Part of #371 and no other parent',
    ])
    // Without the title and the label, a bare kind line is still not a record.
    expect(
      workProjectionFindings({ ...note(380), labels: [] }).includes(
        'the body names a kind but has no work marker',
      ),
    ).toBe(true)
    // An admitted capability still needs a marker that matches its title and label.
    expect(workProjectionFindings({ ...capability(393), labels: ['kind:spec'] })).toEqual([
      'the issue must wear kind:capability and no other kind label',
    ])
  })

  it('AC8 gives the same lists and verdicts for filesystem and GitHub records', () => {
    const contested = [
      ...records,
      capability(394, { replaces: [373] }),
      goal(386),
      capability(397, { parent: 386, replaces: [374] }),
    ]
    const asGithub = contested.map((record) => ({
      ...record,
      labels: record.labels.map((name) => ({ name })),
    }))
    const reversed = [...asGithub].reverse()
    for (const set of [asGithub, reversed]) {
      expect(currentParts(set, 371)).toEqual(currentParts(contested, 371))
      expect(replacementFindings(set)).toEqual(replacementFindings(contested))
    }
  })

  it('AC9 does not move the subject a person agreed or a gate bound to it', () => {
    const before = capability(393)
    const after = capability(393, { replaces: [373] })
    expect(githubGoalSubject(after)).toBe(githubGoalSubject(before))
    expect(goalSubjectDigest({ title: after.title, body: after.body })).toBe(
      goalSubjectDigest({ title: before.title, body: before.body }),
    )
    // The #393 body sets Part of apart with three line breaks. Adding the line keeps every other byte.
    const live = { title: before.title, body: 'Excludes.\n\n\nPart of #371' }
    for (const added of ['\n\nReplaces #373', '\n\nReplaces #373\n', '\nReplaces #373']) {
      expect(githubGoalSubject({ ...live, body: live.body + added })).toBe(githubGoalSubject(live))
    }
    const middle = { title: 't', body: 'a\n\nReplaces #373\n\nb' }
    expect(goalSubjectDigest(middle)).toBe(goalSubjectDigest({ title: 't', body: 'a\n\nb' }))
    // A body without the line keeps its digest exactly, blank lines and all.
    expect(goalSubjectDigest({ title: 't', body: 'a\n\n\n\nb' })).not.toBe(
      goalSubjectDigest({ title: 't', body: 'a\n\nb' }),
    )
  })
})

describe('the issue validator lists parts from the record set', () => {
  it('lists the parts of #371 once and names the replacement of #373', () => {
    const others = records.filter((record) => record.number !== 371)
    const report = validateIssueAgainstSdlc(withAcceptance(goal(371)), config, { records: others })
    expect(report.parts.current.map((part) => part.number)).toEqual([
      374, 375, 376, 377, 378, 379, 393,
    ])
    expect(report.parts.replaced).toEqual([{ number: 373, by: 393 }])
    const read = validateIssueAgainstSdlc(withAcceptance(note(373)), config, { records })
    expect(read.ok).toBe(true)
    expect(read.replacedBy).toBe(393)
    expect(validateIssueAgainstSdlc(withAcceptance(note(373)), config).parts).toBeUndefined()
  })
})
