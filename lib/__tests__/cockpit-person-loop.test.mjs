import { describe, expect, it } from 'vitest'
import { writeCockpitAction } from '../cockpit-actions.mjs'
import { issueGates, renderGateAnswerBox, renderGateResults } from '../cockpit-gate-answer.mjs'
import { buildCockpitIssueView } from '../cockpit-read-model.mjs'
import { renderIssueView } from '../cockpit-ui.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'
import { fileCockpitAnswer, main } from '../../scripts/person-gates.mjs'

// #415: the person loop in the cockpit. A waiting person gate shows who must answer and the
// subject, beside the confirmation line. A note, a phase pass, a comment, and an on-behalf record
// leave it waiting. Only the person's line moves it, to agreed, refused, or stale. Nothing is sent
// to a coordinator.

const AT = '2026-10-11T20:10:00.000Z'
const TITLE = 'Serve the person loop'
const BODY = 'Ship it.'

function fakeGitHub() {
  const issues = new Map()
  const comments = new Map()
  const calls = []
  const client = {
    store: issues,
    async createIssue(_repo, { title, body }) {
      const number = issues.size + 1
      issues.set(number, {
        number,
        title,
        body,
        state: 'open',
        labels: [],
        html_url: `https://example.test/issues/${number}`,
        updated_at: AT,
      })
      comments.set(number, [])
      return structuredClone(issues.get(number))
    },
    async issue(_repo, number) {
      return structuredClone(issues.get(number))
    },
    async updateIssue(_repo, number, { body }) {
      issues.get(number).body = body
      return structuredClone(issues.get(number))
    },
    async issueComments(_repo, number) {
      return structuredClone(comments.get(number))
    },
    async createIssueComment(_repo, number, body) {
      const id = comments.get(number).length + 1
      const comment = { id, body, html_url: `https://example.test/issues/${number}#c${id}` }
      comments.get(number).push(comment)
      return structuredClone(comment)
    },
  }
  return {
    calls,
    comments,
    client: new Proxy(client, {
      get(target, name) {
        const value = target[name]
        if (typeof value !== 'function') return value
        return (...args) => {
          calls.push(name)
          return value(...args)
        }
      },
    }),
  }
}

// A goal at phase 3 with one goal gate waiting, named for `person` when one is given.
async function waitingGoal({ person = null } = {}) {
  const github = fakeGitHub()
  const created = await createGitHubMedium({ repo: 'o/r', client: github.client }).createGoal({
    title: TITLE,
    body: BODY,
    kind: 'goal',
  })
  const medium = () =>
    createGitHubMedium({ repo: 'o/r', number: created.number, client: github.client })
  for (const phase of [0, 1, 2, 3]) {
    await medium().appendTransition({
      phase,
      status: phase === 0 ? 'skipped' : 'pass',
      seat: ['pm.manager', 'pm.analyst', 'orch.arch', 'orch.arch'][phase],
      reason: phase === 0 ? 'framed' : null,
      idempotencyKey: `p${phase}`,
    })
  }
  const target = {
    github,
    number: created.number,
    medium,
    issue: () => github.client.store.get(created.number),
  }
  await cli(target, [
    'open',
    '--class',
    'adequacy-of-intent',
    '--role',
    'person',
    ...(person ? ['--person', person] : []),
  ])
  return target
}

function cli(target, [action, ...flags]) {
  const args = ['--medium', 'github', '--repo', 'o/r', '--issue', String(target.number)]
  return main([action, ...args, ...flags], {
    client: target.github.client,
    stdout: { write() {} },
    env: {},
    now: () => AT,
  })
}

const answer = (target, text) =>
  fileCockpitAnswer({
    repo: 'o/r',
    issue: target.number,
    text,
    client: target.github.client,
    env: {},
    now: () => AT,
  })

const gates = (target) => issueGates(target.issue())
const page = (target) =>
  renderIssueView(buildCockpitIssueView({ issue: target.issue(), comments: [], repo: 'o/r' }), {
    repo: 'o/r',
    personGates: gates(target),
  })
const lineFor = (gate, word = 'agree', name = 'Sam') =>
  `${word} ${gate.gateDigest.slice(0, 12)} as ${name}`

function expectStillWaiting(target, before) {
  const after = gates(target)
  expect(after).toHaveLength(1)
  expect(after[0]).toMatchObject({
    gateDigest: before.gateDigest,
    status: 'waiting',
    satisfied: false,
    answer: null,
  })
  expect(page(target)).toContain('id="gate-answer"')
  expect(page(target)).not.toContain('id="gate-results"')
}

describe('the cockpit person loop', () => {
  it('shows a waiting gate with who must answer and the subject, beside the line and no agree button', async () => {
    for (const [person, who] of [
      ['Sam', 'Who must answer: Sam'],
      [null, 'Who must answer: the person'],
    ]) {
      const target = await waitingGoal({ person })
      const [gate] = gates(target)
      const html = renderGateAnswerBox({ goalTitle: TITLE, gates: [gate], issue: target.number })
      expect(html).toContain(`<p class="gate-who">${who}</p>`)
      expect(html).toContain(
        '<p class="gate-subject">Subject: this goal as written now, its title and body</p>',
      )
      expect(html).toContain(`Decision for: ${TITLE}`)
      expect(html).toContain(`agree ${gate.gateDigest.slice(0, 12)} as `)
      // The digest is shown only as the prefix inside each line.
      expect(html).not.toContain(gate.gateDigest.slice(0, 13))
      expect(html).not.toContain(gate.subjectDigest.slice(0, 12))
      expect(html.match(/<button\b[^>]*>[^<]*<\/button>/g)).toEqual([
        '<button type="submit">Send</button>',
      ])
    }
  })

  it('names an admission’s change class as its subject', () => {
    const html = renderGateAnswerBox({
      goalTitle: TITLE,
      gates: [
        {
          gateDigest: 'a'.repeat(64),
          gateClass: 'adequacy-of-intent',
          subjectKind: 'admission',
          changeClass: 'high-assurance',
          status: 'waiting',
          who: { role: 'person', platform: 'human', person: null },
        },
      ],
      issue: 1,
    })
    expect(html).toContain(
      'Subject: opening the high-assurance parts of this goal as written now, its title and body',
    )
  })

  it('leaves the gate waiting after every note the cockpit writes, even one holding the line', async () => {
    const target = await waitingGoal()
    const [gate] = gates(target)
    const body = target.issue().body
    for (const type of [
      'ask-status',
      'add-clarification',
      'request-checkpoint',
      'request-human-review',
      'update-issue-section',
      'post-handover',
      'draft-follow-up',
    ]) {
      const written = await writeCockpitAction({
        intent: { type, issue: target.number, body: `${type} note\n${lineFor(gate)}` },
        client: target.github.client,
        repo: 'o/r',
      })
      expect(written.ok, type).toBe(true)
      expectStillWaiting(target, gate)
    }
    // A note is a comment or a follow-up issue. It never touches the gate record.
    expect(target.issue().body).toBe(body)
    expect(target.github.comments.get(target.number).length).toBeGreaterThan(0)
  })

  it('leaves the gate waiting after a phase pass, a plain comment, and an on-behalf record', async () => {
    const target = await waitingGoal()
    const [gate] = gates(target)

    await target.medium().appendTransition({
      phase: 4,
      status: 'pass',
      seat: 'dev.build-sr',
      reason: null,
      idempotencyKey: 'p4',
    })
    expectStillWaiting(target, gate)

    await target.github.client.createIssueComment('o/r', target.number, lineFor(gate))
    await target.github.client.createIssueComment('o/r', target.number, 'Approved. LGTM.')
    expectStillWaiting(target, gate)

    await cli(target, [
      'on-behalf',
      '--principal',
      'Sam',
      '--actor-platform',
      'claude',
      '--actor-executor',
      'dev.build-sr',
      '--grant',
      'https://example.test/grant',
      '--action',
      'agree',
      '--subject-kind',
      'goalRevision',
      '--subject',
      gate.subjectDigest,
    ])
    expectStillWaiting(target, gate)
    expect((await target.medium().readGateLog()).map((entry) => entry.kind)).toEqual([
      'gate',
      'on-behalf',
    ])
  })

  it.each([
    ['agree', 'agreed', 'agreed'],
    ['changes', 'refused', 'refused, changes asked'],
    ['block', 'refused', 'refused, blocked'],
  ])('moves the gate with the %s line and shows the result', async (word, status, shown) => {
    const target = await waitingGoal()
    const [gate] = gates(target)
    const line = lineFor(gate, word)
    target.github.calls.splice(0)

    await answer(target, line)

    expect(gates(target)[0]).toMatchObject({
      status,
      satisfied: status === 'agreed',
      answer: { person: 'Sam', line },
    })
    const html = page(target)
    expect(html).not.toContain('id="gate-answer"')
    expect(html).toContain('id="gate-results"')
    expect(html).toContain(
      `<strong>Sam</strong> answered with the line <code>${line}</code>. Result: ${shown}.`,
    )
    // The answer is written to the gate record only. Nothing goes to a coordinator or a seat.
    expect(new Set(target.github.calls)).toEqual(new Set(['issue', 'issueComments', 'updateIssue']))
  })

  it.each([
    ['title', (issue) => (issue.title = 'A different goal')],
    ['body', (issue) => (issue.body = issue.body.replace(BODY, 'Ship something else.'))],
  ])('shows the answer stale after a %s change, where it does not count', async (_part, change) => {
    const target = await waitingGoal()
    const [gate] = gates(target)
    const line = lineFor(gate)
    await answer(target, line)

    change(target.issue())

    const after = gates(target)
    expect(after.find((g) => g.gateDigest === gate.gateDigest)).toMatchObject({
      status: 'stale',
      satisfied: false,
      answer: { line },
    })
    // A new gate waits on the changed goal, and the old line cannot answer it.
    const owed = after.find((g) => g.gateDigest !== gate.gateDigest)
    expect(owed).toMatchObject({ status: 'waiting', answer: null })
    await expect(answer(target, line)).rejects.toThrow(/no-waiting-gate/)
    expect(after.some((g) => g.satisfied)).toBe(false)

    const html = page(target)
    expect(html).toContain('id="gate-answer"')
    expect(html).toContain(
      `<strong>Sam</strong> answered with the line <code>${line}</code>. Result: stale: the subject changed after this answer, so it does not count.`,
    )
  })

  it('lists no result for a gate nobody answered', () => {
    expect(renderGateResults({ gates: [] })).toBe('')
    expect(
      renderGateResults({
        gates: [{ gateDigest: 'b'.repeat(64), status: 'stale', answer: null }],
      }),
    ).toBe('')
  })
})
