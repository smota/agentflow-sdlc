import { describe, expect, it } from 'vitest'
import { evaluateGuardedAction, parseCockpitIntent } from '../cockpit-actions.mjs'
import {
  COCKPIT_SEAT,
  acceptCockpitLine,
  issueGates,
  renderGateAnswerBox,
} from '../cockpit-gate-answer.mjs'
import { buildCockpitIssueView } from '../cockpit-read-model.mjs'
import { renderIssueView } from '../cockpit-ui.mjs'
import { matchConfirmationPhrase, parseConfirmationPhrase } from '../core/confirmation-phrase.mjs'
import { allowedNext, currentPhase } from '../core/phase-graph.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'
import { fileCockpitAnswer, main } from '../../scripts/person-gates.mjs'

// #384: the cockpit answer box takes the same three lines a person sends in chat. It has no agree
// button and no approval wording of its own, and an answer promotes no phase and dispatches no seat.

const AT = '2026-10-11T18:40:00.000Z'
const TITLE = 'accept a person’s confirmation phrase as the gate answer'

// Records every call, so a test can show which ones an answer made.
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

// A goal issue at phase 3 with one goal gate waiting for the person.
async function waitingGoal() {
  const github = fakeGitHub()
  const created = await createGitHubMedium({ repo: 'o/r', client: github.client }).createGoal({
    title: TITLE,
    body: 'Ship it.',
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
  const args = ['--medium', 'github', '--repo', 'o/r', '--issue', String(created.number)]
  await main(['open', ...args, '--class', 'adequacy-of-intent', '--role', 'person'], {
    client: github.client,
    stdout: { write() {} },
    env: {},
    now: () => AT,
  })
  const issue = () => github.client.store.get(created.number)
  return { github, number: created.number, medium, issue }
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

function phaseRecord(goal) {
  return {
    transitions: goal.transitions,
    currentPhase: currentPhase(goal.transitions),
    allowedNext: allowedNext(goal.transitions),
  }
}

// Everything on the box except the decision cards, which carry the gate's own wording.
const withoutCards = (html) => html.replace(/<pre class="decision-card">[\s\S]*?<\/pre>/g, '')

describe('the cockpit answer box', () => {
  it('shows the decision card and one box for the line, with no agree button', async () => {
    const target = await waitingGoal()
    const gates = issueGates(target.issue())
    expect(gates.map((gate) => gate.status)).toEqual(['waiting'])
    const html = renderGateAnswerBox({
      goalTitle: TITLE,
      gates,
      issue: target.number,
      repo: 'o/r',
      csrfToken: 'token',
    })
    const subject = gates[0].gateDigest.slice(0, 12)
    for (const word of ['agree', 'changes', 'block']) {
      expect(html).toContain(`${word} ${subject} as &lt;your name&gt;`)
    }
    expect(html.match(/<button\b[^>]*>[^<]*<\/button>/g)).toEqual([
      '<button type="submit">Send</button>',
    ])
    expect(html.match(/<input\b[^>]*>/g).filter((input) => !/type="hidden"/.test(input))).toEqual([
      expect.stringContaining('type="text" id="gate-line" name="line"'),
    ])
    expect(html).not.toMatch(/checkbox|<select|radio/)
    expect(withoutCards(html)).not.toMatch(/agree|approv|sign.?off|confirm|accept|consent/i)
    expect(html).toContain('<input type="hidden" name="type" value="gate-answer">')
  })

  it('appears on the issue page while a gate waits, and not otherwise', async () => {
    const target = await waitingGoal()
    const view = buildCockpitIssueView({ issue: target.issue(), comments: [], repo: 'o/r' })
    const page = renderIssueView(view, { repo: 'o/r', personGates: issueGates(target.issue()) })
    expect(page).toContain('id="gate-answer"')
    expect(page.match(/id="gate-answer"/g)).toHaveLength(1)
    expect(renderIssueView(view, { repo: 'o/r' })).not.toContain('id="gate-answer"')
    expect(renderGateAnswerBox({ goalTitle: TITLE, gates: [] })).toBe('')
  })

  it('records each of the three lines as the phrase parser reads it, and moves no phase', async () => {
    const expected = { agree: 'agreed', changes: 'refused', block: 'refused' }
    for (const word of ['agree', 'changes', 'block']) {
      const target = await waitingGoal()
      const before = phaseRecord(await target.medium().readGoal())
      const gates = issueGates(target.issue())
      const line = `${word} ${gates[0].gateDigest.slice(0, 12)} as Sam`
      const parsed = matchConfirmationPhrase(line, gates)
      target.github.calls.splice(0)

      const filed = await answer(target, line)
      expect(filed.attestation).toMatchObject({
        decision: parsed.decision,
        reviewedDigest: gates[0].subjectDigest,
        reviewer: { platform: 'human', executor: parsed.name },
      })
      expect(filed.filing).toEqual({ line, filedBy: { seat: COCKPIT_SEAT } })

      const after = issueGates(target.issue())
      expect(after[0]).toMatchObject({
        gateDigest: parsed.gateDigest,
        status: expected[word],
        answer: { decision: parsed.decision, person: 'Sam', line },
      })
      // An answer promotes no phase, posts no comment, and sends nothing to a seat.
      expect(phaseRecord(await target.medium().readGoal())).toEqual(before)
      expect(new Set(target.github.calls)).toEqual(
        new Set(['issue', 'issueComments', 'updateIssue']),
      )
    }
  })

  it('files nothing for anything but one of the three lines', async () => {
    const target = await waitingGoal()
    const gates = issueGates(target.issue())
    const subject = gates[0].gateDigest.slice(0, 12)
    const body = target.issue().body
    for (const text of [
      '',
      'agree',
      'yes',
      'Approve',
      'LGTM',
      `approve ${subject} as Sam`,
      `agree ${subject}`,
      `agree ${subject} as Sam please`,
      `agree ${subject} as Sam\nthanks`,
      `agree ${subject} as Sam​`,
    ]) {
      const accepted = acceptCockpitLine(text)
      expect(accepted.ok, text).toBe(false)
      expect(accepted.code).toBe(parseConfirmationPhrase(text).code)
      await expect(answer(target, text), text).rejects.toThrow(/Nothing was filed/)
    }
    await expect(answer(target, `agree ${'f'.repeat(12)} as Sam`)).rejects.toThrow(
      /no-waiting-gate.*Nothing was filed/,
    )
    await expect(answer(target, `agree ${subject} as claude`)).rejects.toThrow(/Nothing was filed/)
    expect(target.issue().body).toBe(body)
  })

  it('takes the line as an intent of its own that needs no second confirmation', () => {
    const parsed = parseCockpitIntent({ type: 'gate-answer', issue: 1, line: 'agree abc as Sam' })
    expect(parsed).toEqual({
      ok: true,
      intent: { type: 'gate-answer', repo: undefined, issue: 1, line: 'agree abc as Sam' },
    })
    expect(evaluateGuardedAction({ action: 'gate-answer', userRole: 'operator' })).toEqual({
      ok: true,
      reasons: [],
    })
    expect(evaluateGuardedAction({ action: 'gate-answer', userRole: 'viewer' }).reasons).toEqual([
      'role-cannot-write',
    ])
  })
})
