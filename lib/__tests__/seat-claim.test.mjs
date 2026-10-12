import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callerSeat } from '../core/seat-claim.mjs'
import { createFilesystemMedium } from '../sources/filesystem-medium.mjs'
import { createGitHubMedium, parseTransition } from '../sources/github-medium.mjs'
import { main } from '../../scripts/phase-handoff.mjs'

const RIG = 'agentflow-dev'
const as = (logical, rig = RIG) => `${logical}@${rig}`

// The seats that move a standard goal to the tester, each appending as itself.
const DELIVERY = [
  [0, 'pass', 'pm.manager', 'pm-manager'],
  [1, 'pass', 'pm.analyst', 'pm-analyst'],
  [2, 'pass', 'orch.arch', 'orch-arch'],
  [3, 'pass', 'orch.arch', 'orch-arch'],
  [4, 'pass', 'dev.build-sr', 'dev-build-sr'],
]

function filesystemHarness() {
  const root = mkdtempSync(join(tmpdir(), 'seat-claim-'))
  const medium = createFilesystemMedium({ root })
  return {
    medium,
    create: () => medium.createGoal({ title: 'Seat claim', body: 'Refuse another seat.' }),
    written: () => readdirSync(join(root, 'transitions')).length,
  }
}

function githubHarness() {
  let stored = null
  const comments = []
  const client = {
    async createIssue(_repo, { title, body }) {
      stored = { title, body, number: 424, html_url: 'https://example.test/issues/424' }
      return stored
    },
    async issue() {
      return stored
    },
    async issueComments() {
      return comments
    },
    async createIssueComment(_repo, _number, body) {
      const comment = { body, html_url: `${stored.html_url}#c${comments.length}` }
      comments.push(comment)
      return comment
    },
  }
  let medium = createGitHubMedium({ repo: 'o/r', client })
  return {
    get medium() {
      return medium
    },
    comments,
    async create() {
      await medium.createGoal({ title: 'Seat claim', body: 'Refuse another seat.' })
      medium = createGitHubMedium({ repo: 'o/r', number: 424, client })
    },
    written: () => comments.length,
  }
}

async function deliver(harness, rows = DELIVERY) {
  for (const [phase, status, seat, logical] of rows) {
    await harness.medium.appendTransition({
      phase,
      status,
      seat,
      reason: status === 'skipped' ? 'not needed' : null,
      idempotencyKey: `p${phase}`,
      callerSession: as(logical),
    })
  }
}

describe('caller seat', () => {
  it('maps a session to its phase seat and rig', () => {
    expect(callerSeat('orch-arch@agentflow-dev')).toEqual({
      session: 'orch-arch@agentflow-dev',
      seat: 'orch.arch',
      rig: 'agentflow-dev',
    })
    expect(callerSeat('dev-build-sr@agentflow-dev')).toMatchObject({ seat: 'dev.build-sr' })
    expect(callerSeat('pm-analyst@agentflow-pm')).toMatchObject({
      seat: 'pm.analyst',
      rig: 'agentflow-pm',
    })
  })

  it('is no identity when the session is missing, empty, or not one session', () => {
    for (const value of [undefined, null, '', '   ', 'orch-arch', '@rig', 'a@', 'a@b@c', 'a b@c']) {
      expect(callerSeat(value)).toBeNull()
    }
  })
})

for (const [name, makeHarness] of [
  ['filesystem', filesystemHarness],
  ['github', githubHarness],
]) {
  describe(`seat claim on the ${name} medium`, () => {
    let harness
    beforeEach(async () => {
      harness = makeHarness()
      await harness.create()
    })

    it('refuses a known seat appending as another seat and writes nothing', async () => {
      await deliver(harness, DELIVERY.slice(0, 1))
      const before = (await harness.medium.readGoal()).transitions
      await expect(
        harness.medium.appendTransition({
          phase: 1,
          status: 'skipped',
          seat: 'pm.analyst',
          reason: 'framed elsewhere',
          idempotencyKey: 'p1',
          callerSession: as('orch-arch'),
        }),
      ).rejects.toThrow(
        'Session orch-arch@agentflow-dev holds seat orch.arch and cannot append a transition as seat pm.analyst',
      )
      expect(harness.written()).toBe(1)
      expect((await harness.medium.readGoal()).transitions).toEqual(before)
    })

    it('accepts the seat appending its own pass and skipped, including a legal return', async () => {
      await deliver(harness, [...DELIVERY, [5, 'pass', 'dev.qa', 'dev-qa']])
      const back = await harness.medium.appendTransition({
        phase: 6,
        status: 'skipped',
        seat: 'rev.review',
        reason: 'changes requested (return to phase 4)',
        idempotencyKey: 'p6-return',
        callerSession: as('rev-review'),
      })
      expect(back.transition).toMatchObject({ seatVerified: true, seatRig: RIG })
      const again = await harness.medium.appendTransition({
        phase: 4,
        status: 'pass',
        seat: 'dev.build-sr',
        idempotencyKey: 'p4-fix',
        callerSession: as('dev-build-sr'),
      })
      expect(again.duplicate).toBe(false)
      const read = await harness.medium.readGoal()
      expect(read.transitions.map((item) => [item.phase, item.seat, item.seatVerified])).toEqual([
        [0, 'pm.manager', true],
        [1, 'pm.analyst', true],
        [2, 'orch.arch', true],
        [3, 'orch.arch', true],
        [4, 'dev.build-sr', true],
        [5, 'dev.qa', true],
        [6, 'rev.review', true],
        [4, 'dev.build-sr', true],
      ])
      expect(read.transitions.every((item) => item.seatRig === RIG)).toBe(true)
    })

    it('returns the existing transition for the same caller and refuses another seat on that key', async () => {
      await deliver(harness, DELIVERY.slice(0, 1))
      const retry = await harness.medium.appendTransition({
        phase: 0,
        status: 'pass',
        seat: 'pm.manager',
        idempotencyKey: 'p0',
        callerSession: as('pm-manager'),
      })
      expect(retry.duplicate).toBe(true)
      for (const callerSession of [as('pm-analyst'), as('pm-manager', 'agentflow-other')]) {
        const seat = callerSeat(callerSession).seat
        await expect(
          harness.medium.appendTransition({
            phase: 0,
            status: 'pass',
            seat,
            idempotencyKey: 'p0',
            callerSession,
          }),
        ).rejects.toThrow(`cannot reuse key p0, which seat pm.manager recorded`)
      }
      expect(harness.written()).toBe(1)
    })

    it('appends with no identity and marks the transition unverified', async () => {
      for (const callerSession of [undefined, '', 'not a session']) {
        const harnessCase = makeHarness()
        await harnessCase.create()
        const result = await harnessCase.medium.appendTransition({
          phase: 0,
          status: 'pass',
          seat: 'pm.manager',
          idempotencyKey: 'p0',
          callerSession,
        })
        expect(result.transition).toMatchObject({ seatVerified: false, seatRig: null })
        const [read] = (await harnessCase.medium.readGoal()).transitions
        expect(read).toMatchObject({ seat: 'pm.manager', seatVerified: false, seatRig: null })
      }
    })

    it('records the caller rig, which the caller cannot set to another rig', async () => {
      const result = await harness.medium.appendTransition({
        phase: 0,
        status: 'pass',
        seat: 'pm.manager',
        idempotencyKey: 'p0',
        callerSession: as('pm-manager', 'agentflow-other'),
        seatRig: RIG,
        seatVerified: true,
      })
      expect(result.transition).toMatchObject({ seatVerified: true, seatRig: 'agentflow-other' })
      const [read] = (await harness.medium.readGoal()).transitions
      expect(read.seatRig).toBe('agentflow-other')
    })
  })
}

describe('seat claim on a GitHub comment', () => {
  it('puts the claim after the seat line', async () => {
    const harness = githubHarness()
    await harness.create()
    await deliver(harness, DELIVERY.slice(0, 1))
    await harness.medium.appendTransition({
      phase: 1,
      status: 'pass',
      seat: 'pm.analyst',
      idempotencyKey: 'p1',
    })
    expect(harness.comments[0].body.split('\n').slice(4, 7)).toEqual([
      'seat: pm.manager',
      'seatVerified: true',
      `seatRig: ${RIG}`,
    ])
    expect(harness.comments[1].body.split('\n').slice(4, 7)).toEqual([
      'seat: pm.analyst',
      'seatVerified: false',
      'seatRig: ',
    ])
  })

  it('leaves an old transition without a claim, even when its body says verified', () => {
    const old = parseTransition({
      body: [
        '<!-- agentflow-transition:p1 -->',
        'phase: 1',
        'role: analyst',
        'status: skipped',
        'seat: pm.analyst',
        'reason: framed',
        'body:',
        'seatVerified: true',
        'seatRig: agentflow-pm',
      ].join('\n'),
      html_url: 'https://example.test/issues/402#c1',
    })
    expect(old).toMatchObject({ seat: 'pm.analyst', status: 'skipped' })
    expect(old).not.toHaveProperty('seatVerified')
    expect(old).not.toHaveProperty('seatRig')
  })
})

describe('phase append command', () => {
  const session = process.env.OPENRIG_SESSION_NAME
  afterEach(() => {
    if (session === undefined) delete process.env.OPENRIG_SESSION_NAME
    else process.env.OPENRIG_SESSION_NAME = session
  })

  const append = (root, seat, key) =>
    main([
      'append',
      '--medium',
      'filesystem',
      '--root',
      root,
      '--title',
      'Seat claim',
      '--phase',
      '0',
      '--status',
      'pass',
      '--seat',
      seat,
      '--key',
      key,
    ])

  it('passes the session, so another seat is refused and the own seat is verified', async () => {
    const root = mkdtempSync(join(tmpdir(), 'seat-claim-cli-'))
    const out = []
    const write = process.stdout.write
    process.stdout.write = (chunk) => out.push(String(chunk))
    try {
      process.env.OPENRIG_SESSION_NAME = as('orch-arch')
      await expect(append(root, 'pm.manager', 'p0')).rejects.toThrow(
        'Session orch-arch@agentflow-dev holds seat orch.arch',
      )
      expect(readdirSync(join(root, 'transitions'))).toEqual([])
      process.env.OPENRIG_SESSION_NAME = as('pm-manager')
      expect(await append(root, 'pm.manager', 'p0')).toBe(0)
      out.length = 0
      expect(await main(['read', '--medium', 'filesystem', '--root', root])).toBe(0)
    } finally {
      process.stdout.write = write
    }
    const [read] = JSON.parse(out.join('')).goal.transitions
    expect(read).toMatchObject({ seat: 'pm.manager', seatVerified: true, seatRig: RIG })
  })
})
