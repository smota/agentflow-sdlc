import { describe, expect, it } from 'vitest'
import { writeCockpitAction } from '../cockpit-actions.mjs'
import {
  COORDINATOR_UNREACHABLE,
  answerThenTell,
  devCoordinatorFor,
  gateAnswerEvent,
  sendCoordinatorEvent,
  startOrResumeEvent,
  startThenTell,
} from '../cockpit-coordinator.mjs'
import { issueGates } from '../cockpit-gate-answer.mjs'
import { projectBinding, projectRecord } from '../cockpit-projects.mjs'
import { allowedNext, currentPhase } from '../core/phase-graph.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'
import { fileCockpitAnswer, main } from '../../scripts/person-gates.mjs'

// #421: the cockpit tells a project's own DEV coordinator two things, a start or resume and the
// person's gate answer. Only a project whose record names OpenRig and a DEV coordinator sends. The
// coordinator's reply is coordinator status, never the phase or the gate status, and it moves no
// gate. An unreachable coordinator loses no gate answer. The tests use a fake coordinator.

const AT = '2026-10-11T21:00:00.000Z'
const DEV = 'dev-coord@agentflow-dev'
const PM = 'pm-coord@agentflow-pm'

function fakeGitHub() {
  const issues = new Map()
  const comments = new Map()
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
  return client
}

// A goal at phase 3 with one goal gate waiting for the person.
async function waitingGoal() {
  const client = fakeGitHub()
  const created = await createGitHubMedium({ repo: 'o/r', client }).createGoal({
    title: 'A goal',
    body: 'Ship it.',
    kind: 'goal',
  })
  const medium = () => createGitHubMedium({ repo: 'o/r', number: created.number, client })
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
    client,
    stdout: { write() {} },
    env: {},
    now: () => AT,
  })
  return {
    client,
    number: created.number,
    medium,
    issue: () => client.store.get(created.number),
    gates: () => issueGates(client.store.get(created.number)),
  }
}

// A fake coordinator. It records every send and replies with `reply`, or throws when it is down.
function fakeCoordinator({ reply = { status: 'received' }, down = false } = {}) {
  const sent = []
  return {
    sent,
    async send(address, message) {
      sent.push({ address, message })
      if (down) throw new Error('connect ECONNREFUSED')
      return typeof reply === 'function' ? reply(address, message) : reply
    },
  }
}

const store = (record) => ({
  get: (repository) => (record?.repository === repository ? record : null),
})
const bindingWith = (input) =>
  projectBinding('o/r', {
    store: store(input ? projectRecord({ repository: 'o/r', ...input }) : null),
    configured: ['o/r'],
  })
const OPENRIG = bindingWith({ executionLayer: 'openrig', coordinators: { pm: PM, dev: DEV } })
const NO_LAYER = bindingWith({ executionLayer: 'none' })

const fileLine = (target, line) => () =>
  fileCockpitAnswer({
    repo: 'o/r',
    issue: target.number,
    text: line,
    client: target.client,
    env: {},
    now: () => AT,
  })
const writeStart = (target, executionLayer) => () =>
  writeCockpitAction({
    intent: { type: 'start-next-phase', issue: target.number, body: 'Start phase 4.' },
    client: target.client,
    repo: 'o/r',
    executionLayer,
  })
const lineFor = (gate, word = 'agree') => `${word} ${gate.gateDigest.slice(0, 12)} as Sam`
const parse = (message) => JSON.parse(message.replace(/^agentflow-cockpit /, ''))

async function phaseRecord(target) {
  const { transitions } = await target.medium().readGoal()
  return {
    transitions,
    currentPhase: currentPhase(transitions),
    allowedNext: allowedNext(transitions),
  }
}

describe('which coordinator a project sends to', () => {
  it('is the DEV coordinator on a record that names OpenRig, and no one otherwise', () => {
    expect(devCoordinatorFor(OPENRIG)).toBe(DEV)
    expect(
      devCoordinatorFor(bindingWith({ executionLayer: 'openrig', coordinators: { pm: PM } })),
    ).toBeNull()
    expect(devCoordinatorFor(bindingWith({ executionLayer: 'openrig' }))).toBeNull()
    expect(devCoordinatorFor(NO_LAYER)).toBeNull()
    // A record carried in by hand that names a coordinator but no layer still sends nothing.
    expect(
      devCoordinatorFor({
        ...NO_LAYER,
        record: { ...NO_LAYER.record, coordinators: { dev: DEV } },
      }),
    ).toBeNull()
    expect(devCoordinatorFor(bindingWith(null))).toBeNull()
    expect(devCoordinatorFor(null)).toBeNull()
    // An unsupported adapter has no execution layer, whatever its record names.
    expect(
      devCoordinatorFor(
        bindingWith({
          sourceAdapter: 'gitlab',
          executionLayer: 'openrig',
          coordinators: { dev: DEV },
        }),
      ),
    ).toBeNull()
  })
})

describe('the gate answer event', () => {
  it('sends one request naming the answer, the gate, and the subject, after the answer is filed', async () => {
    const target = await waitingGoal()
    const [gate] = target.gates()
    const coordinator = fakeCoordinator()

    const { filed, coordinator: shown } = await answerThenTell({
      binding: OPENRIG,
      project: 'o/r',
      goal: target.number,
      file: fileLine(target, lineFor(gate)),
      transport: coordinator,
    })

    expect(coordinator.sent).toHaveLength(1)
    expect(coordinator.sent[0].address).toBe(DEV)
    expect(parse(coordinator.sent[0].message)).toEqual({
      type: 'gate-answer',
      project: 'o/r',
      goal: target.number,
      answer: 'agree',
      gate: gate.gateDigest,
      subject: gate.subjectDigest,
    })
    expect(coordinator.sent[0].message.split('\n')).toHaveLength(1)
    // The coordinator status is its own field, apart from the answer and the gate status.
    expect(shown).toEqual({ label: 'coordinator status', to: DEV, status: 'received' })
    expect(filed.attestation.decision).toBe('agree')
    expect(target.gates()[0]).toMatchObject({ status: 'agreed', satisfied: true })
  })

  it.each([
    ['changes', 'changes-requested'],
    ['block', 'blocked'],
  ])('names a %s answer as the decision the line records', async (word, decision) => {
    const target = await waitingGoal()
    const [gate] = target.gates()
    const coordinator = fakeCoordinator()
    await answerThenTell({
      binding: OPENRIG,
      project: 'o/r',
      goal: target.number,
      file: fileLine(target, lineFor(gate, word)),
      transport: coordinator,
    })
    expect(parse(coordinator.sent[0].message)).toMatchObject({
      answer: decision,
      gate: gate.gateDigest,
    })
    expect(target.gates()[0].status).toBe('refused')
  })

  it('sends nothing when the line is refused, so nothing was filed', async () => {
    const target = await waitingGoal()
    const coordinator = fakeCoordinator()
    const body = target.issue().body
    await expect(
      answerThenTell({
        binding: OPENRIG,
        project: 'o/r',
        goal: target.number,
        file: fileLine(target, 'Approved, LGTM'),
        transport: coordinator,
      }),
    ).rejects.toThrow(/Nothing was filed/)
    expect(coordinator.sent).toEqual([])
    expect(target.issue().body).toBe(body)
  })

  it.each([
    ['refuses the connection', { down: true }],
    ['returns no status', { reply: {} }],
    ['returns a blank status', { reply: { status: '  ' } }],
  ])(
    'keeps the gate answer and shows coordinator unreachable when the coordinator %s',
    async (_case, fake) => {
      const target = await waitingGoal()
      const [gate] = target.gates()
      const coordinator = fakeCoordinator(fake)

      const { coordinator: shown } = await answerThenTell({
        binding: OPENRIG,
        project: 'o/r',
        goal: target.number,
        file: fileLine(target, lineFor(gate)),
        transport: coordinator,
      })

      expect(shown).toEqual({
        label: 'coordinator status',
        to: DEV,
        status: COORDINATOR_UNREACHABLE,
      })
      expect(target.gates()[0]).toMatchObject({
        status: 'agreed',
        satisfied: true,
        answer: { line: lineFor(gate) },
      })
      const log = await target.medium().readGateLog()
      expect(log.map((entry) => entry.kind)).toEqual(['gate', 'answer'])
    },
  )

  it('files the answer and sends nothing for a project with no execution layer', async () => {
    for (const binding of [NO_LAYER, bindingWith(null), null]) {
      const target = await waitingGoal()
      const [gate] = target.gates()
      const coordinator = fakeCoordinator()
      const result = await answerThenTell({
        binding,
        project: 'o/r',
        goal: target.number,
        file: fileLine(target, lineFor(gate)),
        transport: coordinator,
      })
      expect(result.coordinator).toBeNull()
      expect(coordinator.sent).toEqual([])
      expect(target.gates()[0].status).toBe('agreed')
    }
  })
})

describe('the start or resume event', () => {
  it('sends one request naming the project and the goal, after the cockpit write', async () => {
    const target = await waitingGoal()
    const coordinator = fakeCoordinator({ reply: { status: 'resumed at phase 4' } })

    const { written, coordinator: shown } = await startThenTell({
      binding: OPENRIG,
      project: 'o/r',
      goal: target.number,
      write: writeStart(target, 'openrig'),
      transport: coordinator,
    })

    expect(written.ok).toBe(true)
    expect(coordinator.sent).toEqual([
      {
        address: DEV,
        message: `agentflow-cockpit ${JSON.stringify({ type: 'start-or-resume', project: 'o/r', goal: target.number })}`,
      },
    ])
    expect(shown).toEqual({ label: 'coordinator status', to: DEV, status: 'resumed at phase 4' })
  })

  it('shows the returned status as coordinator status, not as the phase or the gate status', async () => {
    const target = await waitingGoal()
    const [gate] = target.gates()
    const before = await phaseRecord(target)
    const log = JSON.stringify(await target.medium().readGateLog())
    // A coordinator that claims the gate is agreed and the phase moved, and even sends the line.
    for (const status of ['agreed', 'phase 5 pass', lineFor(gate)]) {
      const { coordinator: shown } = await startThenTell({
        binding: OPENRIG,
        project: 'o/r',
        goal: target.number,
        write: writeStart(target, 'openrig'),
        transport: fakeCoordinator({ reply: { status } }),
      })
      expect(shown).toEqual({ label: 'coordinator status', to: DEV, status })
    }
    // Nothing the coordinator said reached the gate or the phase record.
    expect(target.gates()).toEqual([
      expect.objectContaining({
        gateDigest: gate.gateDigest,
        status: 'waiting',
        satisfied: false,
        answer: null,
      }),
    ])
    expect(JSON.stringify(await target.medium().readGateLog())).toBe(log)
    expect(await phaseRecord(target)).toEqual(before)
  })

  it('shows coordinator unreachable when the start cannot be sent', async () => {
    const target = await waitingGoal()
    const { written, coordinator: shown } = await startThenTell({
      binding: OPENRIG,
      project: 'o/r',
      goal: target.number,
      write: writeStart(target, 'openrig'),
      transport: fakeCoordinator({ down: true }),
    })
    expect(written.ok).toBe(true)
    expect(shown.status).toBe(COORDINATOR_UNREACHABLE)
  })

  it('sends nothing for a project with no execution layer', async () => {
    const target = await waitingGoal()
    const coordinator = fakeCoordinator()
    const result = await startThenTell({
      binding: NO_LAYER,
      project: 'o/r',
      goal: target.number,
      write: writeStart(target, null),
      transport: coordinator,
    })
    expect(result.written).toEqual({ ok: false, errors: ['no-execution-layer'] })
    expect(result.coordinator).toBeNull()
    expect(coordinator.sent).toEqual([])
  })
})

describe('addressing', () => {
  it('sends only to the DEV coordinator, never to the PM coordinator or another seat', async () => {
    const target = await waitingGoal()
    const [gate] = target.gates()
    const coordinator = fakeCoordinator()
    await startThenTell({
      binding: OPENRIG,
      project: 'o/r',
      goal: target.number,
      write: writeStart(target, 'openrig'),
      transport: coordinator,
    })
    await answerThenTell({
      binding: OPENRIG,
      project: 'o/r',
      goal: target.number,
      file: fileLine(target, lineFor(gate)),
      transport: coordinator,
    })
    expect(coordinator.sent.map((call) => call.address)).toEqual([DEV, DEV])
  })

  it('does not hand an address that reads as an option to the transport', async () => {
    const binding = { ...OPENRIG, record: { ...OPENRIG.record, coordinators: { dev: '--all' } } }
    const coordinator = fakeCoordinator()
    const shown = await sendCoordinatorEvent({
      binding,
      event: startOrResumeEvent({ project: 'o/r', goal: 1 }),
      transport: coordinator,
    })
    expect(shown.status).toBe(COORDINATOR_UNREACHABLE)
    expect(coordinator.sent).toEqual([])
  })

  it('builds no event without the project, the goal, the gate, and the subject', () => {
    const digest = 'a'.repeat(64)
    expect(() => startOrResumeEvent({ goal: 1 })).toThrow(/project/)
    expect(() => startOrResumeEvent({ project: 'o/r', goal: 0 })).toThrow(/goal/)
    expect(() =>
      gateAnswerEvent({ project: 'o/r', goal: 1, answer: 'agree', subject: digest }),
    ).toThrow(/gate/)
    expect(() =>
      gateAnswerEvent({ project: 'o/r', goal: 1, answer: 'agree', gate: digest }),
    ).toThrow(/subject/)
  })
})
