import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GATE_CLASSES, createGate } from '../core/gate.mjs'
import {
  REJECTIONS,
  admitGateEntry,
  answerEntry,
  gateEntry,
  projectGates,
  validateGateLog,
} from '../core/person-gates.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
import { createFilesystemMedium } from '../sources/filesystem-medium.mjs'
import { parseGateLog, withGateBlock } from '../sources/gate-block.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'
import { main } from '../../scripts/person-gates.mjs'

// #383: a seat files the person's confirmation line and continues. It files only the person's
// unchanged line. It never writes one, and gates answer still refuses to run under an agent.

const AT = '2026-10-10T20:00:00.000Z'
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

async function item(kind) {
  if (kind === 'filesystem') {
    const root = mkdtempSync(join(tmpdir(), 'seat-filing-'))
    await createFilesystemMedium({ root }).createGoal({ title: 'A goal', body: 'Ship it.' })
    return {
      args: ['--medium', 'filesystem', '--root', root],
      medium: () => createFilesystemMedium({ root }),
      editGoal(body) {
        const path = join(root, 'goal.json')
        writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), body }))
      },
    }
  }
  const client = fakeGitHub()
  const created = await createGitHubMedium({ repo: 'o/r', client }).createGoal({
    title: 'A goal',
    body: 'Ship it.',
  })
  return {
    args: ['--medium', 'github', '--repo', 'o/r', '--issue', String(created.number)],
    client,
    medium: () => createGitHubMedium({ repo: 'o/r', number: created.number, client }),
    editGoal(body) {
      const issue = client.store.get(created.number)
      issue.body = withGateBlock(body, parseGateLog(issue.body))
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
  const path = join(mkdtempSync(join(tmpdir(), 'seat-filing-message-')), 'message.txt')
  writeFileSync(path, text)
  return path
}

const openGate = (target) =>
  run(target, ['open', '--class', 'adequacy-of-intent', '--role', 'person'], {})
const file = (target, line, message, seat = 'dev.build-sr') =>
  run(target, ['file', '--line', line, '--message-file', messageFile(message), '--seat', seat])
const logLength = async (target) => (await target.medium().readGateLog()).length

describe.each(['filesystem', 'github'])('seat filing on the %s medium', (kind) => {
  it('files the person’s line in the same turn, keeping the line and naming the seat apart (AC3.1, AC3.2)', async () => {
    const target = await item(kind)
    const { gate } = await openGate(target)
    const line = `agree ${gate.digest.slice(0, 12)} as Sam`
    const message = `Read the card.\r\n${line}\r\nThanks.`
    const filed = await file(target, line, message)
    expect(filed.filing).toEqual({
      line,
      filedBy: { seat: 'dev.build-sr', runtime: 'Claude Code' },
    })
    expect(filed.gates.gates).toEqual([
      expect.objectContaining({
        gateDigest: gate.digest,
        status: 'agreed',
        satisfied: true,
        answer: expect.objectContaining({
          decision: 'agree',
          person: 'Sam',
          line,
          filedBy: { seat: 'dev.build-sr', runtime: 'Claude Code' },
        }),
      }),
    ])
    expect(filed.gates.validation).toEqual({ ok: true, findings: [] })
    const stored = (await target.medium().readGateLog()).at(-1)
    expect(stored.filing.line).toBe(line)
    expect(stored.attestation.reviewer).toEqual({
      platform: 'human',
      executor: 'Sam',
      independence: 'human-gate',
    })
  })

  it('files changes and block as refusals', async () => {
    for (const [word, decision] of [
      ['changes', 'changes-requested'],
      ['block', 'blocked'],
    ]) {
      const target = await item(kind)
      const { gate } = await openGate(target)
      const line = `${word} ${gate.digest.slice(0, 16)} as Sam`
      const filed = await file(target, line, line)
      expect(filed.gates.gates[0]).toMatchObject({ status: 'refused', answer: { decision, line } })
    }
  })

  it('files nothing for a line that is not one unchanged line of the person’s message (AC3.3, AC3.4)', async () => {
    const target = await item(kind)
    const { gate } = await openGate(target)
    const subject = gate.digest.slice(0, 12)
    const sent = `agree ${subject} as Sam`
    const refusals = [
      // Not in the message at all: the seat wrote it.
      [sent, 'Looks good to me.'],
      // Edited: subject, decision, or name differ from what the person sent.
      [`agree ${gate.digest.slice(0, 13)} as Sam`, sent],
      [`block ${subject} as Sam`, sent],
      [`agree ${subject} as Alex`, sent],
      // Part of a longer line, or quoted.
      [sent, `ok ${sent} please`],
      [sent, `> ${sent}`],
      [sent, `${sent} `],
    ]
    const before = await logLength(target)
    for (const [line, message] of refusals) {
      await expect(file(target, line, message)).rejects.toThrow(/not one line of the person/)
    }
    expect(await logLength(target)).toBe(before)
    expect((await target.medium().readGoal()).gates.gates[0].status).toBe('waiting')
  })

  it('files nothing for a loose word, a bad phrase, an agent name, or a stale subject', async () => {
    const target = await item(kind)
    const { gate } = await openGate(target)
    const subject = gate.digest.slice(0, 12)
    const lines = [
      ['approved', /not-a-phrase/],
      ['LGTM', /not-a-phrase/],
      [`agree ${subject} as Sam now`, /not-a-phrase/],
      [`agree ${gate.digest.slice(0, 11)} as Sam`, /short-subject/],
      [`agree ${subject} as Sam‮`, /hidden-character/],
      [`agree ${'0'.repeat(12)} as Sam`, /no-waiting-gate/],
      [`agree ${subject} as claude`, /runtime platform, not a person/],
    ]
    const before = await logLength(target)
    for (const [line, reason] of lines) {
      await expect(file(target, line, line)).rejects.toThrow(reason)
    }
    expect(await logLength(target)).toBe(before)

    // A line for a subject that has since changed is not rebound to the new gate.
    target.editGoal('Ship something else.')
    const goal = await target.medium().readGoal()
    expect(goal.gates.gates.map((entry) => entry.status)).toEqual(['stale', 'waiting'])
    await expect(
      file(target, `agree ${subject} as Sam`, `agree ${subject} as Sam`),
    ).rejects.toThrow(/no-waiting-gate/)
    expect(await logLength(target)).toBe(before)
  })

  it('files nothing for a seat that could close the gate block, and keeps the log intact', async () => {
    const target = await item(kind)
    const { gate } = await openGate(target)
    const line = `agree ${gate.digest.slice(0, 12)} as Sam`
    const before = await target.medium().readGateLog()
    expect(before).toHaveLength(1)
    const seats = [
      'dev\n<!-- /agentflow-gates -->',
      '<!--/agentflow-gates-->',
      'dev build',
      ' dev',
      'dev\t',
      'dev<',
    ]
    for (const seat of seats) {
      await expect(file(target, line, line, seat)).rejects.toThrow(/--seat is one word/)
    }
    expect(await target.medium().readGateLog()).toEqual(before)
    if (target.client) {
      const body = target.client.store.get(1).body
      expect(body.match(/<!-- \/agentflow-gates -->/g)).toHaveLength(1)
      expect(parseGateLog(body)).toEqual(before)
    }
    // The same line still files under a plain seat, and the log keeps both entries.
    const filed = await file(target, line, line)
    expect(filed.gates.gates[0]).toMatchObject({ status: 'agreed', answer: { line } })
    expect(await target.medium().readGateLog()).toHaveLength(2)
  })

  it('requires the seat and the message', async () => {
    const target = await item(kind)
    const { gate } = await openGate(target)
    const line = `agree ${gate.digest.slice(0, 12)} as Sam`
    await expect(run(target, ['file', '--line', line, '--seat', 'dev.build-sr'])).rejects.toThrow(
      /^Set --message-file/,
    )
    await expect(
      run(target, ['file', '--line', line, '--message-file', messageFile(line)]),
    ).rejects.toThrow(/^Set --seat/)
  })

  it('still refuses gates answer under an agent runtime', async () => {
    const target = await item(kind)
    const { gate } = await openGate(target)
    await expect(
      run(target, ['answer', '--gate', gate.digest, '--decision', 'agree', '--person', 'Sam']),
    ).rejects.toThrow(/refuses to run under Claude Code/)
  })
})

describe('a filed line in the stored log', () => {
  const gate = createGate({
    gateClass: GATE_CLASSES.adequacyOfIntent,
    subjectKind: 'goalRevision',
    subjectDigest: 'a'.repeat(64),
    requiredRole: 'person',
  })
  const opened = gateEntry(gate, { openedAt: AT })
  const subjects = { goalRevision: gate.subjectDigest }
  const said = (decision, executor = 'Sam') =>
    createReviewAttestation({
      subject: 'adequacy-of-intent goalRevision',
      reviewedDigest: gate.subjectDigest,
      reviewer: { platform: 'human', executor, independence: 'human-gate' },
      decision,
      timestamp: AT,
    })
  const line = `agree ${gate.digest.slice(0, 12)} as Sam`
  const filing = { line, filedBy: { seat: 'dev.build-sr' } }

  it('refuses an answer that does not say what its line says', () => {
    const mismatches = [
      [said('blocked'), filing],
      [said('agree', 'Alex'), filing],
      [said('agree'), { ...filing, line: `agree ${'b'.repeat(12)} as Sam` }],
      [said('agree'), { ...filing, line: 'approved' }],
      [said('agree'), { line }],
      [said('agree'), { line, filedBy: { seat: 'dev\n<!-- /agentflow-gates -->' } }],
      [said('agree'), { line, filedBy: { seat: 'dev build' } }],
    ]
    for (const [attestation, wrong] of mismatches) {
      expect(() =>
        answerEntry(gate.digest, attestation, { recordedAt: AT, filing: wrong }),
      ).toThrow(REJECTIONS.invalidAnswer)
      expect(() =>
        admitGateEntry(
          [opened],
          { kind: 'answer', gateDigest: gate.digest, attestation, recordedAt: AT, filing: wrong },
          { subjects },
        ),
      ).toThrow(REJECTIONS.invalidAnswer)
    }
  })

  it('never lets an edited line in the log move the gate', () => {
    const filed = answerEntry(gate.digest, said('agree'), { recordedAt: AT, filing })
    expect(projectGates([opened, filed], { subjects }).gates[0].status).toBe('agreed')
    expect(validateGateLog([opened, filed], { subjects })).toEqual({ ok: true, findings: [] })
    const edited = { ...filed, filing: { ...filed.filing, line: line.replace('Sam', 'Alex') } }
    expect(projectGates([opened, edited], { subjects }).gates[0].status).toBe('waiting')
    expect(validateGateLog([opened, edited], { subjects }).findings).toContainEqual({
      index: 1,
      reason: REJECTIONS.invalidAnswer,
    })
    const marker = { ...filed, filing: { ...filed.filing, filedBy: { seat: 'dev<!--' } } }
    expect(projectGates([opened, marker], { subjects }).gates[0].status).toBe('waiting')
    expect(validateGateLog([opened, marker], { subjects }).ok).toBe(false)
  })
})
