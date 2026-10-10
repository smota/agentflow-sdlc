import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectAgentRuntime } from '../agent-caller.mjs'
import { GATE_CLASSES, createGate, satisfyGate } from '../core/gate.mjs'
import {
  REJECTIONS,
  admitGateEntry,
  answerEntry,
  gateEntry,
  judgeAnswer,
  onBehalfEntry,
  projectGates,
  validateGateLog,
} from '../core/person-gates.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
import { createFilesystemMedium } from '../sources/filesystem-medium.mjs'
import { GATE_BLOCK_START } from '../sources/gate-block.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'
import { main } from '../../scripts/person-gates.mjs'

const PERSON_ENV = Object.freeze({})
const AT = '2026-10-10T05:00:00.000Z'
const SUBJECT_A = 'a'.repeat(64)
const SUBJECT_B = 'b'.repeat(64)
const CANDIDATE = 'c'.repeat(64)

function fakeGitHub() {
  const issues = new Map()
  const comments = new Map()
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
      comments.set(number, [])
      return structuredClone(issues.get(number))
    },
    async issue(_repo, number) {
      return structuredClone(issues.get(number))
    },
    async issues(_repo, { page = 1 } = {}) {
      return page === 1 ? [...issues.values()].map((issue) => structuredClone(issue)) : []
    },
    async updateIssue(_repo, number, { body }) {
      issues.get(number).body = body
      return structuredClone(issues.get(number))
    },
    async issueComments(_repo, number) {
      return comments.get(number)
    },
    async createIssueComment(_repo, number, body) {
      const comment = { body, html_url: `https://example.test/issues/${number}#c` }
      comments.get(number).push(comment)
      return comment
    },
  }
}

function captured() {
  let text = ''
  return { write: (chunk) => (text += chunk), text: () => text }
}

// One work item on either medium, driven only through the product CLI.
async function item(kind) {
  if (kind === 'filesystem') {
    const root = mkdtempSync(join(tmpdir(), 'person-gates-'))
    await createFilesystemMedium({ root }).createGoal({ title: 'A goal' })
    return {
      args: ['--medium', 'filesystem', '--root', root],
      root,
      medium: () => createFilesystemMedium({ root }),
    }
  }
  const client = fakeGitHub()
  const created = await createGitHubMedium({ repo: 'o/r', client }).createGoal({ title: 'A goal' })
  const args = ['--medium', 'github', '--repo', 'o/r', '--issue', String(created.number)]
  return {
    args,
    client,
    medium: () => createGitHubMedium({ repo: 'o/r', number: created.number, client }),
  }
}

async function run(target, argv, env = PERSON_ENV) {
  const out = captured()
  await main([argv[0], ...target.args, ...argv.slice(1)], {
    client: target.client,
    stdout: out,
    env,
    now: () => AT,
  })
  return JSON.parse(out.text())
}

const open = (target, extra = []) =>
  run(target, [
    'open',
    '--class',
    'adequacy-of-intent',
    '--role',
    'analyst',
    '--subject',
    SUBJECT_A,
    ...extra,
  ])
const answer = (target, gate, decision, extra = []) =>
  run(target, ['answer', '--gate', gate, '--decision', decision, '--person', 'Sam', ...extra])

function humanAnswer(subject, decision = 'agree') {
  return createReviewAttestation({
    subject: 'goal revision',
    reviewedDigest: subject,
    reviewer: { platform: 'human', executor: 'Sam', independence: 'human-gate' },
    decision,
    timestamp: AT,
  })
}

describe.each(['filesystem', 'github'])('person gates on the %s medium', (kind) => {
  it('shows a waiting gate with who and subject, and needs no notifier (AC1, AC2)', async () => {
    const target = await item(kind)
    const opened = await open(target)
    expect(opened.notified).toBe(false)
    const goal = await target.medium().readGoal()
    expect(goal.gates.gates).toEqual([
      expect.objectContaining({
        status: 'waiting',
        gateClass: 'adequacy-of-intent',
        who: { role: 'analyst', platform: 'human', person: null },
        subjectKind: 'goalRevision',
        subjectDigest: SUBJECT_A,
      }),
    ])
    const named = await run(target, [
      'open',
      '--class',
      'release-of-candidate',
      '--role',
      'reviewer',
      '--subject',
      CANDIDATE,
      '--person',
      'Sam',
    ])
    expect(named.gates.gates[1].who).toEqual({ role: 'reviewer', platform: 'human', person: 'Sam' })
    await expect(open(target, ['--person', 'claude'])).rejects.toThrow(/agent is never the who/)
  })

  it('satisfies a gate only with the person’s agree, and drops it from the wait list (AC4)', async () => {
    const target = await item(kind)
    const { gate } = await open(target)
    const result = await answer(target, gate.digest, 'agree')
    expect(result.gates.gates[0]).toMatchObject({
      status: 'agreed',
      satisfied: true,
      answer: { decision: 'agree', person: 'Sam', at: AT, subjectDigest: SUBJECT_A },
    })
    expect(satisfyGate(gate, result.attestation).ok).toBe(true)
    expect(result.gates.verdicts).toEqual([
      { gateDigest: gate.digest, decision: 'agree', ok: true, reasons: [] },
    ])
  })

  it('records a refusal that does not satisfy (AC5)', async () => {
    const target = await item(kind)
    const { gate } = await open(target)
    const result = await answer(target, gate.digest, 'changes-requested', [
      '--finding',
      'Scope too wide',
    ])
    expect(result.gates.gates[0]).toMatchObject({
      status: 'refused',
      satisfied: false,
      answer: { decision: 'changes-requested', findings: ['Scope too wide'] },
    })
  })

  it('makes an earlier answer stale when the subject changes (AC6)', async () => {
    const target = await item(kind)
    const { gate } = await open(target)
    await answer(target, gate.digest, 'agree')
    const reopened = await run(target, [
      'open',
      '--class',
      'adequacy-of-intent',
      '--role',
      'analyst',
      '--subject',
      SUBJECT_B,
    ])
    expect(reopened.gates.gates.map((entry) => [entry.subjectDigest, entry.status])).toEqual([
      [SUBJECT_A, 'stale'],
      [SUBJECT_B, 'waiting'],
    ])
    await expect(answer(target, gate.digest, 'agree')).rejects.toThrow(REJECTIONS.staleSubject)
  })

  it('records an on-behalf action as the agent’s, and the gate stays waiting (AC8)', async () => {
    const target = await item(kind)
    await open(target)
    const result = await run(target, [
      'on-behalf',
      '--principal',
      'Sam',
      '--actor-platform',
      'claude',
      '--actor-executor',
      'claude-cli',
      '--grant',
      'grant-7',
      '--action',
      'merge',
      '--subject-kind',
      'goalRevision',
      '--subject',
      SUBJECT_A,
    ])
    expect(result.gates.onBehalf).toEqual([
      expect.objectContaining({
        label: 'agent action on behalf of the person',
        principal: 'Sam',
        actor: { platform: 'claude', executor: 'claude-cli' },
        grantRef: 'grant-7',
        action: 'merge',
        subjectDigest: SUBJECT_A,
      }),
    ])
    expect(result.gates.gates[0].status).toBe('waiting')
    await expect(
      run(target, [
        'on-behalf',
        '--principal',
        'Sam',
        '--actor-platform',
        'human',
        '--actor-executor',
        'Sam',
        '--grant',
        'g',
        '--action',
        'merge',
        '--subject-kind',
        'goalRevision',
        '--subject',
        SUBJECT_A,
      ]),
    ).rejects.toThrow(/agent runtime platform/)
  })

  it('refuses an answer from an agent runtime, or with a caller platform, and writes nothing', async () => {
    const target = await item(kind)
    const { gate } = await open(target)
    const before = JSON.stringify(await target.medium().readGateLog())
    const agree = ['answer', '--gate', gate.digest, '--decision', 'agree', '--person', 'Sam']
    for (const env of [
      { CLAUDECODE: '1' },
      { AI_AGENT: 'codex' },
      { OPENRIG_SESSION_NAME: 'dev-build@rig' },
    ]) {
      await expect(run(target, agree, env)).rejects.toThrow(/refuses to run under/)
    }
    await expect(run(target, [...agree, '--platform', 'human'])).rejects.toThrow(
      /does not accept --platform/,
    )
    expect(JSON.stringify(await target.medium().readGateLog())).toBe(before)
    expect((await target.medium().readGoal()).gates.gates[0].status).toBe('waiting')
  })
})

describe('the wait list (AC3)', () => {
  it.each(['filesystem', 'github'])(
    'lists only waiting gates on %s, filtered and as JSON',
    async (kind) => {
      let base
      const targets = []
      if (kind === 'filesystem') {
        base = mkdtempSync(join(tmpdir(), 'person-gates-list-'))
        for (const name of ['one', 'two', 'three']) {
          const root = join(base, name)
          mkdirSync(root)
          await createFilesystemMedium({ root }).createGoal({ title: name })
          targets.push({
            args: ['--medium', 'filesystem', '--root', root],
            medium: () => createFilesystemMedium({ root }),
          })
        }
      } else {
        const client = fakeGitHub()
        for (const name of ['one', 'two', 'three']) {
          const created = await createGitHubMedium({ repo: 'o/r', client }).createGoal({
            title: name,
          })
          targets.push({
            client,
            args: ['--medium', 'github', '--repo', 'o/r', '--issue', String(created.number)],
          })
        }
        base = client
      }
      const first = await open(targets[0])
      await answer(targets[0], first.gate.digest, 'agree')
      await open(targets[1], ['--person', 'Sam'])
      await run(targets[2], [
        'open',
        '--class',
        'release-of-candidate',
        '--role',
        'reviewer',
        '--subject',
        CANDIDATE,
      ])
      const list = async (extra = []) => {
        const out = captured()
        const where = kind === 'filesystem' ? ['--root', base] : ['--repo', 'o/r']
        await main(['waiting', '--medium', kind, ...where, '--json', ...extra], {
          client: kind === 'github' ? base : undefined,
          stdout: out,
        })
        return JSON.parse(out.text())
      }
      const all = await list()
      expect(all.map((row) => [row.gateClass, row.who.role, row.who.person]).sort()).toEqual([
        ['adequacy-of-intent', 'analyst', 'Sam'],
        ['release-of-candidate', 'reviewer', null],
      ])
      expect(all.find((row) => row.gateClass === 'adequacy-of-intent')).toEqual(
        expect.objectContaining({
          who: { role: 'analyst', platform: 'human', person: 'Sam' },
          subjectDigest: SUBJECT_A,
        }),
      )
      expect((await list(['--role', 'reviewer'])).map((row) => row.gateClass)).toEqual([
        'release-of-candidate',
      ])
      expect((await list(['--person', 'Sam'])).map((row) => row.gateClass)).toEqual([
        'adequacy-of-intent',
      ])
      const text = captured()
      const where = kind === 'filesystem' ? ['--root', base] : ['--repo', 'o/r']
      await main(['waiting', '--medium', kind, ...where], {
        client: kind === 'github' ? base : undefined,
        stdout: text,
      })
      expect(text.text().trim().split('\n')).toHaveLength(2)
    },
  )
})

describe('phase passes are not answers (AC7)', () => {
  it('leaves every gate waiting after all phases pass', async () => {
    const root = mkdtempSync(join(tmpdir(), 'person-gates-phases-'))
    const medium = createFilesystemMedium({ root })
    await medium.createGoal({ title: 'all phases' })
    const target = { args: ['--medium', 'filesystem', '--root', root], medium: () => medium }
    await open(target)
    const seats = [
      'pm.manager',
      'pm.analyst',
      'orch.arch',
      'orch.arch',
      'dev.build',
      'dev.qa',
      'rev.review',
      'orch.arch',
      'orch.arch',
    ]
    for (const [phase, seat] of seats.entries()) {
      await medium.appendTransition({ phase, status: 'pass', seat, idempotencyKey: `p${phase}` })
    }
    const goal = await medium.readGoal()
    expect(goal.transitions).toHaveLength(9)
    expect(goal.gates.gates.map((gate) => gate.status)).toEqual(['waiting'])
    expect(goal.gates.verdicts).toEqual([])
    expect(
      JSON.parse(readFileSync(join(root, 'gates.json'), 'utf8')).entries.map((e) => e.kind),
    ).toEqual(['gate'])
  })
})

describe('one validator (AC10, AC11)', () => {
  const gate = createGate({
    gateClass: GATE_CLASSES.adequacyOfIntent,
    subjectDigest: SUBJECT_A,
    subjectKind: 'goalRevision',
    requiredRole: 'analyst',
  })

  it('accepts a person’s agree on the current subject', () => {
    expect(judgeAnswer(gate, humanAnswer(SUBJECT_A))).toEqual({
      ok: true,
      reasons: [],
      messages: [],
    })
  })

  it('rejects each forgery with its own reason', () => {
    const agent = {
      ...humanAnswer(SUBJECT_A),
      reviewer: { platform: 'claude', executor: 'claude-cli', independence: 'independent' },
    }
    const notGate = {
      ...humanAnswer(SUBJECT_A),
      reviewer: { platform: 'human', executor: 'Sam', independence: 'independent' },
    }
    const altered = { ...gate, subjectDigest: SUBJECT_B }
    const grant = onBehalfEntry({
      principal: 'Sam',
      actor: { platform: 'claude', executor: 'claude-cli' },
      grantRef: 'grant-7',
      action: 'agree',
      subjectKind: 'goalRevision',
      subjectDigest: SUBJECT_A,
      recordedAt: AT,
    })
    const issued = {
      id: 'grant-7',
      issuedAt: AT,
      issuerActor: 'Sam',
      binding: {},
      ...humanAnswer(SUBJECT_A),
    }
    const cases = [
      [judgeAnswer(gate, agent), REJECTIONS.agentSignature],
      [judgeAnswer(gate, notGate), REJECTIONS.agentSignature],
      [judgeAnswer(gate, humanAnswer(SUBJECT_B)), REJECTIONS.staleSubject],
      [
        judgeAnswer(gate, humanAnswer(SUBJECT_A), { currentSubjectDigest: SUBJECT_B }),
        REJECTIONS.staleSubject,
      ],
      [judgeAnswer(altered, { ...humanAnswer(SUBJECT_B) }), REJECTIONS.alteredGate],
      [judgeAnswer(gate, grant), REJECTIONS.grantAsAgreement],
      [judgeAnswer(gate, issued), REJECTIONS.grantAsAgreement],
      [judgeAnswer(gate, humanAnswer(SUBJECT_A, 'blocked')), REJECTIONS.refusalAsSatisfaction],
    ]
    for (const [result, reason] of cases) {
      expect(result.ok).toBe(false)
      expect(result.reasons).toEqual([reason])
    }
    expect(new Set(cases.map(([, reason]) => reason)).size).toBe(5)
  })

  it('rejects forged records in a stored log and refuses to append them', () => {
    const opened = gateEntry(gate, { openedAt: AT })
    const forged = answerEntry(
      gate.digest,
      {
        ...humanAnswer(SUBJECT_A),
        reviewer: { platform: 'codex', executor: 'codex-cli', independence: 'human-gate' },
      },
      { recordedAt: AT },
    )
    const log = [opened, forged]
    expect(validateGateLog(log).findings).toEqual([
      { gateDigest: gate.digest, reason: REJECTIONS.agentSignature },
    ])
    expect(projectGates(log).gates[0].status).toBe('waiting')
    expect(() => admitGateEntry([opened], forged)).toThrow(REJECTIONS.agentSignature)
    const tampered = [{ ...opened, gate: { ...gate, requiredRole: 'nobody' } }]
    expect(validateGateLog(tampered).findings).toEqual([
      { index: 0, reason: REJECTIONS.alteredGate },
    ])
    expect(
      validateGateLog([
        opened,
        answerEntry(gate.digest, humanAnswer(SUBJECT_A), { recordedAt: AT }),
      ]).ok,
    ).toBe(true)
  })

  it('applies the same rules to a record from an outside signer, trusting no producer', () => {
    // A fixture "external signer" fills the same answer fields. Nothing about its origin is trusted.
    const externalSigner = ({ digest, decision, platform, independence }) => ({
      version: 1,
      subject: 'goal revision',
      reviewedDigest: digest,
      reviewer: { platform, executor: 'external-signer:Sam', independence },
      decision,
      timestamp: AT,
      findings: [],
    })
    expect(
      judgeAnswer(
        gate,
        externalSigner({
          digest: SUBJECT_A,
          decision: 'agree',
          platform: 'human',
          independence: 'human-gate',
        }),
      ).ok,
    ).toBe(true)
    expect(
      judgeAnswer(
        gate,
        externalSigner({
          digest: SUBJECT_A,
          decision: 'agree',
          platform: 'grok',
          independence: 'human-gate',
        }),
      ).reasons,
    ).toEqual([REJECTIONS.agentSignature])
    expect(
      judgeAnswer(
        gate,
        externalSigner({
          digest: SUBJECT_B,
          decision: 'agree',
          platform: 'human',
          independence: 'human-gate',
        }),
      ).reasons,
    ).toEqual([REJECTIONS.staleSubject])
    expect(
      judgeAnswer(
        gate,
        externalSigner({
          digest: SUBJECT_A,
          decision: 'blocked',
          platform: 'human',
          independence: 'human-gate',
        }),
      ).reasons,
    ).toEqual([REJECTIONS.refusalAsSatisfaction])
  })
})

describe('the same facts on every medium (AC9, AC12, AC13)', () => {
  async function script(target) {
    const { gate } = await open(target)
    await answer(target, gate.digest, 'agree')
    await run(target, [
      'open',
      '--class',
      'release-of-candidate',
      '--role',
      'reviewer',
      '--subject',
      CANDIDATE,
    ])
    await run(target, [
      'on-behalf',
      '--principal',
      'Sam',
      '--actor-platform',
      'claude',
      '--actor-executor',
      'claude-cli',
      '--grant',
      'grant-7',
      '--action',
      'merge',
      '--subject-kind',
      'candidateDigest',
      '--subject',
      CANDIDATE,
    ])
    return (await target.medium().readGoal()).gates
  }

  it('gives GitHub and the filesystem the same gates, people, subjects, and verdicts', async () => {
    const filesystem = await script(await item('filesystem'))
    const github = await script(await item('github'))
    expect(github).toEqual(filesystem)
    expect(filesystem.gates.map((gate) => gate.status)).toEqual(['agreed', 'waiting'])
  })

  it('shows the wait and the answer on the GitHub issue body, never calling anything a signature', async () => {
    const target = await item('github')
    const { gate } = await open(target)
    const issue = () => target.client.store.get(1)
    expect(issue().body).toContain(GATE_BLOCK_START)
    expect(issue().body).toMatch(
      /\| adequacy-of-intent \| waiting \| analyst role on the human platform \| goalRevision `aaaaaaaaaaaa` \| none yet \|/,
    )
    await answer(target, gate.digest, 'agree')
    expect(issue().body).toMatch(
      /\| adequacy-of-intent \| agreed \|.*\| agree by Sam at 2026-10-10T05:00:00.000Z \|/,
    )
    expect(issue().body).toContain(
      'An agent must not run it. This record is not proof of identity.',
    )
    const views = [issue().body, JSON.stringify((await target.medium().readGoal()).gates)]
    for (const view of views) expect(view).not.toMatch(/signature/i)
    // The block is the record. An ordinary comment that says agree is not an answer.
    await target.client.createIssueComment('o/r', 1, 'agree, Sam')
    expect((await target.medium().readGoal()).body).toBe('')
  })

  it('reads no answer from an ordinary comment and keeps the goal body outside the block', async () => {
    const client = fakeGitHub()
    const medium = createGitHubMedium({ repo: 'o/r', client })
    const created = await medium.createGoal({ title: 'body', body: 'The request.' })
    const target = {
      client,
      args: ['--medium', 'github', '--repo', 'o/r', '--issue', String(created.number)],
      medium: () => createGitHubMedium({ repo: 'o/r', number: created.number, client }),
    }
    await open(target)
    await client.createIssueComment(
      'o/r',
      created.number,
      `${GATE_BLOCK_START}\n| adequacy-of-intent | agreed |`,
    )
    const goal = await target.medium().readGoal()
    expect(goal.body).toBe('The request.')
    expect(goal.gates.gates[0].status).toBe('waiting')
  })
})

describe('agent caller detection', () => {
  it('names the runtime for each marker and nothing for a person’s shell', () => {
    expect(detectAgentRuntime({ CLAUDECODE: '1' })).toMatchObject({ name: 'CLAUDECODE' })
    expect(detectAgentRuntime({ CODEX_SANDBOX: 'seatbelt' })).toMatchObject({ runtime: 'Codex' })
    expect(detectAgentRuntime({ OPENRIG_NODE_ID: 'x' })).toMatchObject({
      runtime: 'an OpenRig seat',
    })
    expect(
      detectAgentRuntime({ HOME: '/home/sam', CODEX_HOME: '/home/sam/.codex', CLAUDECODE: '' }),
    ).toBeNull()
  })
})
