import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { admitGateEntry, answerEntry, gateEntry, projectGates } from '../core/person-gates.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
import { createFilesystemMedium } from '../sources/filesystem-medium.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'
import { main } from '../../scripts/person-gates.mjs'

// #404: a confirmation line answers the one waiting gate whose subject it names. Filing it does not
// move that subject. When the goal title or body changes, the answer is stale, and sending the same
// line again does not rebind it to the new subject.

const AT = '2026-10-11T19:00:00.000Z'
const SEAT_ENV = Object.freeze({ CLAUDECODE: '1' })

function fakeGitHub() {
  const issues = new Map()
  return {
    store: issues,
    async createIssue(_repo, { title, body }) {
      const number = issues.size + 1
      issues.set(number, {
        number,
        title,
        body,
        state: 'open',
        html_url: `https://example.test/issues/${number}`,
        updated_at: AT,
      })
      return structuredClone(issues.get(number))
    },
    async issue(_repo, number) {
      return structuredClone(issues.get(number))
    },
    async updateIssue(_repo, number, { body }) {
      issues.get(number).body = body
      return structuredClone(issues.get(number))
    },
    async issueComments() {
      return []
    },
  }
}

const GOAL_BODY = 'Ship it.'

async function item(kind) {
  if (kind === 'filesystem') {
    const root = mkdtempSync(join(tmpdir(), 'subject-binding-'))
    await createFilesystemMedium({ root }).createGoal({
      title: 'A goal',
      body: GOAL_BODY,
      kind: 'goal',
    })
    const path = join(root, 'goal.json')
    const edit = (change) =>
      writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), ...change }))
    return {
      args: ['--medium', 'filesystem', '--root', root],
      medium: () => createFilesystemMedium({ root }),
      editTitle: (title) => edit({ title }),
      editBody: (body) => edit({ body }),
    }
  }
  const client = fakeGitHub()
  const created = await createGitHubMedium({ repo: 'o/r', client }).createGoal({
    title: 'A goal',
    body: GOAL_BODY,
    kind: 'goal',
  })
  const issue = () => client.store.get(created.number)
  return {
    args: ['--medium', 'github', '--repo', 'o/r', '--issue', String(created.number)],
    client,
    medium: () => createGitHubMedium({ repo: 'o/r', number: created.number, client }),
    editTitle(title) {
      issue().title = title
    },
    // The person edits the goal text. The gate block and the work marker stay as they were.
    editBody(body) {
      issue().body = issue().body.replace(GOAL_BODY, body)
    },
  }
}

async function run(target, argv, env = SEAT_ENV) {
  let text = ''
  await main([argv[0], ...target.args, ...argv.slice(1)], {
    client: target.client,
    stdout: { write: (chunk) => (text += chunk) },
    env,
    now: () => AT,
  })
  return JSON.parse(text)
}

function messageFile(text) {
  const path = join(mkdtempSync(join(tmpdir(), 'subject-binding-message-')), 'message.txt')
  writeFileSync(path, text)
  return path
}

const openGoalGate = (target) =>
  run(target, ['open', '--class', 'adequacy-of-intent', '--role', 'person'], {})
const openAdmission = (target) =>
  run(target, ['open', '--change-class', 'high-assurance', '--role', 'person'], {})
const file = (target, line) =>
  run(target, [
    'file',
    '--line',
    line,
    '--message-file',
    messageFile(line),
    '--seat',
    'dev.build-sr',
  ])
const view = async (target) => (await target.medium().readGoal()).gates
const subject = async (target) => (await target.medium().readGoal()).goalSubject
const storedLog = async (target) => JSON.stringify(await target.medium().readGateLog())
const lineFor = (digest, word = 'agree') => `${word} ${digest.slice(0, 12)} as Sam`

describe.each(['filesystem', 'github'])('a confirmation line on the %s medium', (kind) => {
  it('answers the one waiting gate it names and leaves the other gate waiting', async () => {
    const target = await item(kind)
    const { gate: goalGate } = await openGoalGate(target)
    const { gate: admission } = await openAdmission(target)
    expect(goalGate.digest).not.toBe(admission.digest)

    await file(target, lineFor(admission.digest))

    const { gates, validation } = await view(target)
    expect(validation).toEqual({ ok: true, findings: [] })
    expect(gates).toHaveLength(2)
    const byDigest = Object.fromEntries(gates.map((gate) => [gate.gateDigest, gate]))
    expect(byDigest[admission.digest]).toMatchObject({ status: 'agreed', satisfied: true })
    expect(byDigest[admission.digest].answer.line).toBe(lineFor(admission.digest))
    expect(byDigest[goalGate.digest]).toMatchObject({
      status: 'waiting',
      satisfied: false,
      answer: null,
    })

    // The line that named the admission is spent. Sending it again does not reach the goal gate.
    const before = await storedLog(target)
    await expect(file(target, lineFor(admission.digest))).rejects.toThrow(/no-waiting-gate/)
    expect(await storedLog(target)).toBe(before)
    expect((await view(target)).gates.find((g) => g.gateDigest === goalGate.digest).status).toBe(
      'waiting',
    )
  })

  it('does not move the subject when the line is filed', async () => {
    const target = await item(kind)
    const { gate } = await openGoalGate(target)
    const before = await subject(target)
    expect(gate.subjectDigest).toBe(before)

    await file(target, lineFor(gate.digest))

    expect(await subject(target)).toBe(before)
    const { gates, validation } = await view(target)
    expect(validation).toEqual({ ok: true, findings: [] })
    // No gate was derived for a new subject: filing changed nothing the subject covers.
    expect(gates).toEqual([
      expect.objectContaining({ gateDigest: gate.digest, status: 'agreed', subjectDigest: before }),
    ])
  })

  it.each([
    ['title', (target) => target.editTitle('A different goal')],
    ['body', (target) => target.editBody('Ship something else.')],
  ])(
    'leaves the answer stale after a %s change and does not rebind the same line',
    async (_part, change) => {
      const target = await item(kind)
      const { gate } = await openGoalGate(target)
      const line = lineFor(gate.digest)
      await file(target, line)
      const agreedOn = await subject(target)

      change(target)

      const moved = await subject(target)
      expect(moved).not.toBe(agreedOn)
      const { gates } = await view(target)
      const old = gates.find((g) => g.gateDigest === gate.digest)
      const owed = gates.find((g) => g.gateDigest !== gate.digest)
      expect(old).toMatchObject({ status: 'stale', satisfied: false })
      expect(old.answer).toMatchObject({ subjectDigest: agreedOn, line })
      expect(owed).toMatchObject({
        status: 'waiting',
        satisfied: false,
        subjectDigest: moved,
        derived: true,
        answer: null,
      })

      // The same line, sent again, names the old gate only. It is refused and nothing is written.
      const before = await storedLog(target)
      await expect(file(target, line)).rejects.toThrow(/no-waiting-gate/)
      expect(await storedLog(target)).toBe(before)
      const after = (await view(target)).gates
      expect(after.find((g) => g.gateDigest === gate.digest).status).toBe('stale')
      expect(after.find((g) => g.gateDigest === owed.gateDigest)).toMatchObject({
        status: 'waiting',
        answer: null,
      })
    },
  )
})

describe('rebinding an old answer below the seat', () => {
  it('refuses the old answer on the old gate or on the gate for the new subject', async () => {
    const target = await item('filesystem')
    const { gate } = await openGoalGate(target)
    await file(target, lineFor(gate.digest))
    const agreedOn = await subject(target)
    target.editTitle('A different goal')
    const moved = await subject(target)
    const owed = (await view(target)).gates.find((g) => g.gateDigest !== gate.digest)
    const log = await target.medium().readGateLog()
    const subjects = { goalRevision: moved }
    const attestation = (reviewedDigest) =>
      createReviewAttestation({
        subject: 'adequacy-of-intent goalRevision',
        reviewedDigest,
        reviewer: { platform: 'human', executor: 'Sam', independence: 'human-gate' },
        decision: 'agree',
        timestamp: AT,
      })
    const answer = (gateDigest, reviewedDigest) => ({
      kind: 'answer',
      gateDigest,
      attestation: attestation(reviewedDigest),
      recordedAt: AT,
      filing: { line: lineFor(gateDigest), filedBy: { seat: 'dev.build-sr' } },
    })

    // Sent again to the gate it named: that gate's subject is no longer current.
    expect(() => admitGateEntry(log, answer(gate.digest, agreedOn), { subjects })).toThrow(
      /stale-subject/,
    )
    // Carried onto the gate for the new subject: the answer reviewed the old subject.
    expect(() => admitGateEntry(log, answer(owed.gateDigest, agreedOn), { subjects })).toThrow(
      /stale-subject/,
    )

    // Written into the stored log by hand, the carried answer still does not satisfy the new gate.
    const owedGate = (await target.medium().readGoal()).gates.gates.find(
      (g) => g.gateDigest === owed.gateDigest,
    )
    const forged = [
      ...log,
      gateEntry(
        {
          type: 'gate',
          version: 1,
          gateClass: owedGate.gateClass,
          subjectKind: owedGate.subjectKind,
          subjectDigest: owedGate.subjectDigest,
          requiredRole: 'person',
          hints: [],
          digest: owedGate.gateDigest,
        },
        { openedAt: AT },
      ),
      answerEntry(owed.gateDigest, attestation(agreedOn), { recordedAt: AT }),
    ]
    const projected = projectGates(forged, { subjects }).gates
    expect(projected.find((g) => g.gateDigest === owed.gateDigest)).toMatchObject({
      status: 'waiting',
      satisfied: false,
      answer: null,
    })
  })
})
