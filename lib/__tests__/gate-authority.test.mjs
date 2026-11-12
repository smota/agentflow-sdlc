// Gate authority (#585): who may answer a gate. Writer identity comes from the source log entry
// (the adapter's writer) through the adapter's resolve-humans capability, never from comment text.
// Uses the real filesystem source adapter in a temp dir; no network, no rig.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'
import {
  admitGateDecision,
  authorizeWriter,
  botWritersFromBridge,
  formatGateDecision,
  gateDecisionState,
  highAssuranceGateState,
  parseGateDecision,
} from '../roster/authority.mjs'
import { createFilesystemSourceAdapter } from '../sources/filesystem-source.mjs'
import { sampleRoster } from './fixtures/team-roster-fixtures.mjs'

const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function adapter(writer = 'agentflow-bot') {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-authority-'))
  dirs.push(root)
  return createFilesystemSourceAdapter({ root, writer, trustedWriters: [writer] })
}

const GATE = {
  id: 'filesystem:local#item-1:release:abc123',
  type: 'release-of-candidate',
  paths: ['lib/roster/authority.mjs'],
  tier: 'standard',
}
const HA_GATE = {
  ...GATE,
  id: 'filesystem:local#item-1:ha:abc123',
  type: 'merge',
  tier: 'high-assurance',
}
let seq = 0
const entry = (writer, body) => ({ writer, body, uri: `filesystem:local#item-1/log/${(seq += 1)}` })
const agree = (gate, review) => formatGateDecision({ gate: gate.id, decision: 'agree', review })

describe('gate decision marker', () => {
  it('round-trips and rejects any extra field, such as a claimed person', () => {
    const line = formatGateDecision({ gate: GATE.id, decision: 'agree' })
    expect(parseGateDecision(`${line}\nLooks good.`)).toEqual({
      gate: GATE.id,
      decision: 'agree',
      review: null,
    })
    const forged = `<!-- agentflow-gate-decision:${JSON.stringify({ v: 1, gate: GATE.id, decision: 'agree', by: 'sam' })} -->`
    expect(parseGateDecision(forged)).toBeNull()
    expect(parseGateDecision(`text first\n${line}`)).toBeNull()
    expect(parseGateDecision('agree as sam')).toBeNull()
    expect(() => formatGateDecision({ gate: GATE.id, decision: 'approve' })).toThrow()
  })
})

describe('authorizeWriter', () => {
  it('authorizes an in-scope roster person resolved from the source writer', async () => {
    const result = await authorizeWriter({
      writer: 'sam-writer',
      roster: sampleRoster(),
      adapter: adapter(),
      gate: GATE,
    })
    expect(result).toEqual({ authorized: true, personId: 'sam', reason: 'in-scope' })
  })

  it('never authorizes the bridge or bot writer, even when a roster handle names it', async () => {
    const roster = sampleRoster()
    roster.people[0].handles.filesystem = 'agentflow-bot'
    const source = adapter('agentflow-bot')
    for (const botWriters of [[], ['agentflow-bot']]) {
      const result = await authorizeWriter({
        writer: 'agentflow-bot',
        roster,
        adapter: source,
        gate: GATE,
        botWriters,
      })
      expect(result).toMatchObject({ authorized: false, reason: 'bot-writer' })
    }
    const configured = await authorizeWriter({
      writer: 'claim-bot',
      roster: {
        ...roster,
        people: [{ ...roster.people[0], handles: { filesystem: 'claim-bot' } }, roster.people[1]],
      },
      adapter: source,
      gate: GATE,
      botWriters: ['Claim-Bot'],
    })
    expect(configured).toMatchObject({ authorized: false, reason: 'bot-writer' })
  })

  it('fails closed without resolve-humans, without a writer, with an invalid roster, or with no roster', async () => {
    const source = adapter()
    const withoutCapability = {
      ...source,
      capabilities: source.capabilities.filter((item) => item !== 'resolve-humans'),
    }
    const cases = [
      [{ adapter: withoutCapability }, 'resolve-humans-absent'],
      [{ writer: '' }, 'no-writer'],
      [{ roster: { version: 1, people: [] } }, 'invalid-roster'],
      [{ roster: null }, 'no-roster'],
    ]
    for (const [override, reason] of cases) {
      const result = await authorizeWriter({
        writer: 'sam-writer',
        roster: sampleRoster(),
        adapter: source,
        gate: GATE,
        ...override,
      })
      expect(result).toMatchObject({ authorized: false, reason })
    }
  })

  it('a source failure in resolve-humans propagates and is never read as absence', async () => {
    const source = adapter()
    const failing = {
      ...source,
      resolveHumans: async () => Promise.reject(new Error('source down')),
    }
    await expect(
      authorizeWriter({
        writer: 'sam-writer',
        roster: sampleRoster(),
        adapter: failing,
        gate: GATE,
      }),
    ).rejects.toThrow('source down')
  })
})

describe('admitGateDecision', () => {
  it('records a comment from a writer not on the roster and opens no gate', async () => {
    const result = await admitGateDecision({
      entry: entry('mallory', `${agree(GATE)}\nApproved as sam.`),
      gate: GATE,
      roster: sampleRoster(),
      adapter: adapter(),
    })
    expect(result).toMatchObject({
      recorded: true,
      opensGate: false,
      satisfies: [],
      personId: null,
      reason: 'writer-not-on-roster',
    })
  })

  it('records an out-of-scope roster person and opens no gate', async () => {
    const outOfTier = await admitGateDecision({
      entry: entry('sam-writer', agree({ ...GATE, tier: 'bounded' })),
      gate: { ...GATE, tier: 'bounded' },
      roster: sampleRoster(),
      adapter: adapter(),
    })
    expect(outOfTier).toMatchObject({
      recorded: true,
      opensGate: false,
      personId: 'sam',
      reason: 'out-of-scope',
    })
    const outOfPath = await admitGateDecision({
      entry: entry('sam-writer', agree(GATE)),
      gate: { ...GATE, paths: ['lib/a.mjs', 'docs/a.md'] },
      roster: sampleRoster(),
      adapter: adapter(),
    })
    expect(outOfPath).toMatchObject({ opensGate: false, reason: 'out-of-scope' })
  })

  it('an in-scope agreement opens the gate; a refusal is recorded and opens nothing', async () => {
    const source = adapter()
    const yes = await admitGateDecision({
      entry: entry('sam-writer', agree(GATE)),
      gate: GATE,
      roster: sampleRoster(),
      adapter: source,
    })
    expect(yes).toMatchObject({
      recorded: true,
      opensGate: true,
      satisfies: ['release-of-candidate'],
      personId: 'sam',
      decision: 'agree',
    })
    const no = await admitGateDecision({
      entry: entry(
        'sam-writer',
        formatGateDecision({ gate: GATE.id, decision: 'changes-requested' }),
      ),
      gate: GATE,
      roster: sampleRoster(),
      adapter: source,
    })
    expect(no).toMatchObject({ recorded: true, opensGate: false, reason: 'refused' })
  })

  it('a decision for another gate, or a plain comment, opens nothing', async () => {
    const source = adapter()
    const other = await admitGateDecision({
      entry: entry('sam-writer', agree({ id: 'other' })),
      gate: GATE,
      roster: sampleRoster(),
      adapter: source,
    })
    expect(other).toMatchObject({ recorded: true, opensGate: false, reason: 'other-gate' })
    const plain = await admitGateDecision({
      entry: entry('sam-writer', 'LGTM, approved'),
      gate: GATE,
      roster: sampleRoster(),
      adapter: source,
    })
    expect(plain).toMatchObject({ recorded: true, opensGate: false, reason: 'not-a-decision' })
  })

  it('a decision given in chat (no source writer or address) is not accepted', async () => {
    for (const chat of [
      { decision: 'agree', via: 'queue-resolve' },
      { body: agree(GATE), via: 'chat' },
      { body: agree(GATE), writer: 'sam-writer' },
      null,
    ]) {
      const result = await admitGateDecision({
        entry: chat,
        gate: GATE,
        roster: sampleRoster(),
        adapter: adapter(),
      })
      expect(result).toMatchObject({
        recorded: false,
        opensGate: false,
        reason: 'not-recorded-in-source',
      })
    }
  })

  it('a high-assurance gate needs the review named, and the person in scope for that review', async () => {
    const source = adapter()
    const missing = await admitGateDecision({
      entry: entry('sam-writer', agree(HA_GATE)),
      gate: HA_GATE,
      roster: sampleRoster(),
      adapter: source,
    })
    expect(missing).toMatchObject({ opensGate: false, reason: 'review-required' })
    const security = await admitGateDecision({
      entry: entry('sam-writer', agree(HA_GATE, 'security-review')),
      gate: HA_GATE,
      roster: sampleRoster(),
      adapter: source,
    })
    expect(security).toMatchObject({
      opensGate: true,
      satisfies: ['security-review'],
      personId: 'sam',
    })
    const stray = await admitGateDecision({
      entry: entry('sam-writer', agree(GATE, 'security-review')),
      gate: GATE,
      roster: sampleRoster(),
      adapter: source,
    })
    expect(stray).toMatchObject({ opensGate: false, reason: 'unexpected-review' })
  })
})

describe('highAssuranceGateState', () => {
  const d = (personId, review, decision = 'agree') => ({ personId, review, decision })

  it('records security and acceptance separately and needs both', () => {
    expect(highAssuranceGateState([d('sam', 'security-review')])).toMatchObject({
      security: 'sam',
      acceptance: null,
      satisfied: false,
    })
    expect(
      highAssuranceGateState([d('sam', 'security-review'), d('ana', 'acceptance-review')]),
    ).toMatchObject({
      security: 'sam',
      acceptance: 'ana',
      satisfied: true,
    })
  })

  it('one person may meet both, unless the roster requires two people', () => {
    const both = [d('sam', 'security-review'), d('sam', 'acceptance-review')]
    expect(highAssuranceGateState(both).satisfied).toBe(true)
    expect(highAssuranceGateState(both, { distinctReviewers: true })).toMatchObject({
      satisfied: false,
      reason: 'same-person',
    })
    expect(
      highAssuranceGateState([...both, d('ana', 'acceptance-review')], { distinctReviewers: true })
        .satisfied,
    ).toBe(true)
  })

  it('a later refusal in a slot empties it', () => {
    const state = highAssuranceGateState([
      d('sam', 'security-review'),
      d('ana', 'acceptance-review'),
      d('sam', 'security-review', 'blocked'),
    ])
    expect(state).toMatchObject({ security: null, satisfied: false })
  })
})

describe('gateDecisionState over the source log', () => {
  function haRoster(distinctReviewers) {
    const roster = sampleRoster()
    roster.people[1].handles.filesystem = 'ana-writer'
    roster.people[1].scopes.push({ gates: ['acceptance-review'], tiers: ['high-assurance'] })
    if (distinctReviewers !== undefined) roster.highAssurance = { distinctReviewers }
    return roster
  }

  it('a high-assurance gate is satisfied by two people, and ignores non-roster and bot entries', async () => {
    const state = await gateDecisionState({
      entries: [
        entry('mallory', agree(HA_GATE, 'acceptance-review')),
        entry('agentflow-bot', agree(HA_GATE, 'acceptance-review')),
        entry('sam-writer', agree(HA_GATE, 'security-review')),
        entry('ana-writer', agree(HA_GATE, 'acceptance-review')),
      ],
      gate: HA_GATE,
      roster: haRoster(true),
      adapter: adapter('agentflow-bot'),
    })
    expect(state.satisfied).toBe(true)
    expect(state.highAssurance).toMatchObject({ security: 'sam', acceptance: 'ana' })
    expect(state.ignored.map((item) => item.reason)).toEqual(['writer-not-on-roster', 'bot-writer'])
  })

  it('the same person cannot satisfy both reviews when the roster requires two', async () => {
    const state = await gateDecisionState({
      entries: [
        entry('sam-writer', agree(HA_GATE, 'security-review')),
        entry('sam-writer', agree(HA_GATE, 'acceptance-review')),
      ],
      gate: HA_GATE,
      roster: haRoster(true),
      adapter: adapter(),
    })
    expect(state).toMatchObject({ satisfied: false, highAssurance: { reason: 'same-person' } })
  })

  it('a queue resolve with a decision in chat does not satisfy the gate; only the source entry does', async () => {
    const queue = createMemoryQueuePort()
    await queue.create({
      id: 'gate-row',
      destination: 'human@rig',
      source: 'agentflow-bridge@rig',
      summary: 's',
    })
    await queue.block('gate-row', { on: 'external:gate:abc' })
    await queue.resolve('gate-row', { decision: 'agree as sam (said in chat)' })
    const roster = sampleRoster()
    const before = await gateDecisionState({ entries: [], gate: GATE, roster, adapter: adapter() })
    expect(before.satisfied).toBe(false)
    const after = await gateDecisionState({
      entries: [entry('sam-writer', agree(GATE))],
      gate: GATE,
      roster,
      adapter: adapter(),
    })
    expect(after).toMatchObject({ satisfied: true, approvedBy: 'sam' })
  })

  it('without a roster nothing is admitted here and the single-person path stays in charge', async () => {
    const state = await gateDecisionState({
      entries: [entry('sam-writer', agree(GATE))],
      gate: GATE,
      roster: null,
      adapter: adapter(),
    })
    expect(state).toEqual({
      gateId: GATE.id,
      satisfied: false,
      reason: 'no-roster',
      fallback: 'single-person',
    })
  })
})

describe('botWritersFromBridge', () => {
  it('collects claim writers, evidence writers and the assignee mirror', () => {
    expect(
      botWritersFromBridge({
        source: {
          claimWriters: ['bot-a'],
          evidenceWriters: ['bot-b', 'bot-a'],
          mirrorAssignee: 'bot-c',
        },
      }),
    ).toEqual(['bot-a', 'bot-b', 'bot-c'])
    expect(botWritersFromBridge(null)).toEqual([])
  })
})
