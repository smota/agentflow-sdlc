// Gate authority (#585): who may answer a gate. Writer identity comes from the source log entry
// (the adapter's writer) through the adapter's resolve-humans capability, never from comment text.
// Uses the real filesystem source adapter in a temp dir plus a GitHub-shaped fake; no network, no rig.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'
import {
  admitGateDecision,
  authorizeWriter,
  botWritersFromBridge,
  entryEditState,
  formatGateDecision,
  formatGateId,
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

// A GitHub-shaped adapter: writers are logins (proven by the source), resolved as-is.
const github = {
  id: 'github',
  version: 1,
  writer: 'agentflow-bot',
  capabilities: ['read-artifacts', 'resolve-humans'],
  async resolveHumans(writers) {
    return writers.map((writer) => ({ writer, handle: { system: 'github', login: writer } }))
  },
}

const DIGEST = 'a'.repeat(64)
const DIGEST2 = 'b'.repeat(64)
const REF = 'filesystem:local#item-1'
const GATE = {
  id: formatGateId({ ref: REF, name: 'release', digest: DIGEST }),
  digest: DIGEST,
  type: 'release-of-candidate',
  paths: ['lib/roster/authority.mjs'],
  tier: 'standard',
}
const HA_GATE = {
  ...GATE,
  id: formatGateId({ ref: REF, name: 'merge', digest: DIGEST }),
  type: 'merge',
  tier: 'high-assurance',
}
let seq = 0
const entry = (writer, body, extra = { edited: false }) => ({
  writer,
  body,
  uri: `${REF}/log/${(seq += 1)}`,
  ...extra,
})
const decide = (gate, decision, review) => formatGateDecision({ gate: gate.id, decision, review })
const agree = (gate, review) => decide(gate, 'agree', review)

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

  it('reads a CRLF comment body', () => {
    const line = formatGateDecision({ gate: GATE.id, decision: 'agree' })
    expect(parseGateDecision(`${line}\r\nLooks good.\r\n`)).toMatchObject({ decision: 'agree' })
    expect(parseGateDecision(`${line}\r`)).toMatchObject({ decision: 'agree' })
  })

  it('builds gate ids that bind a digest', () => {
    expect(formatGateId({ ref: REF, name: 'release', digest: DIGEST })).toBe(
      `${REF}:release:${DIGEST}`,
    )
    expect(() => formatGateId({ ref: REF, name: 'release', digest: 'nothex' })).toThrow()
  })
})

describe('entryEditState', () => {
  it('reads edited, or createdAt against updatedAt, and is unknown otherwise', () => {
    expect(entryEditState({ edited: true })).toBe('edited')
    expect(entryEditState({ edited: false })).toBe('unedited')
    expect(entryEditState({ createdAt: 't1', updatedAt: 't1' })).toBe('unedited')
    expect(entryEditState({ createdAt: 't1', updatedAt: 't2' })).toBe('edited')
    expect(entryEditState({ createdAt: 't1' })).toBe('unknown')
    expect(entryEditState({})).toBe('unknown')
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
      for (const writer of ['agentflow-bot', 'agentflow-bot ']) {
        const result = await authorizeWriter({
          writer,
          roster,
          adapter: source,
          gate: GATE,
          botWriters,
        })
        expect(result).toMatchObject({ authorized: false, reason: 'bot-writer' })
      }
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

  it('refuses a resolved login outside the handle pattern (no Unicode case folding)', async () => {
    const roster = sampleRoster()
    roster.people[1].handles.github = 'kate'
    const result = await authorizeWriter({
      writer: `${String.fromCharCode(0x212a)}ate`,
      roster,
      adapter: github,
      gate: GATE,
    })
    expect(result).toMatchObject({ authorized: false, reason: 'invalid-handle' })
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

  it('refuses self-declared (filesystem) writers on high-assurance gates unless the roster opts in', async () => {
    const refused = await authorizeWriter({
      writer: 'sam-writer',
      roster: sampleRoster(),
      adapter: adapter(),
      gate: HA_GATE,
      review: 'security-review',
    })
    expect(refused).toMatchObject({
      authorized: false,
      personId: 'sam',
      reason: 'self-declared-writer',
    })
    const optedIn = { ...sampleRoster(), highAssurance: { allowSelfDeclaredWriters: true } }
    const allowed = await authorizeWriter({
      writer: 'sam-writer',
      roster: optedIn,
      adapter: adapter(),
      gate: HA_GATE,
      review: 'security-review',
    })
    expect(allowed).toMatchObject({ authorized: true, personId: 'sam' })
    const viaGithub = await authorizeWriter({
      writer: 'smota',
      roster: sampleRoster(),
      adapter: github,
      gate: HA_GATE,
      review: 'security-review',
    })
    expect(viaGithub).toMatchObject({ authorized: true, personId: 'sam' })
  })
})

describe('admitGateDecision', () => {
  const roster = sampleRoster()

  it('records a comment from a writer not on the roster and opens no gate', async () => {
    const result = await admitGateDecision({
      entry: entry('mallory', `${agree(GATE)}\nApproved as sam.`),
      gate: GATE,
      roster,
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
    const bounded = { ...GATE, tier: 'bounded' }
    const outOfTier = await admitGateDecision({
      entry: entry('sam-writer', agree(bounded)),
      gate: bounded,
      roster,
      adapter: adapter(),
    })
    expect(outOfTier).toMatchObject({ opensGate: false, personId: 'sam', reason: 'out-of-scope' })
    const wide = { ...GATE, paths: ['lib/a.mjs', 'docs/a.md'] }
    const outOfPath = await admitGateDecision({
      entry: entry('sam-writer', agree(wide)),
      gate: wide,
      roster,
      adapter: adapter(),
    })
    expect(outOfPath).toMatchObject({ opensGate: false, reason: 'out-of-scope' })
  })

  it('an in-scope agreement opens the gate; a refusal or withdrawal opens nothing', async () => {
    const source = adapter()
    const yes = await admitGateDecision({
      entry: entry('sam-writer', agree(GATE)),
      gate: GATE,
      roster,
      adapter: source,
    })
    expect(yes).toMatchObject({
      recorded: true,
      opensGate: true,
      satisfies: ['release-of-candidate'],
      personId: 'sam',
      decision: 'agree',
    })
    for (const [decision, reason] of [
      ['changes-requested', 'refused'],
      ['withdrawn', 'withdrawn'],
    ]) {
      const result = await admitGateDecision({
        entry: entry('sam-writer', decide(GATE, decision)),
        gate: GATE,
        roster,
        adapter: source,
      })
      expect(result).toMatchObject({ recorded: true, opensGate: false, reason })
    }
  })

  it('refuses an edited entry, and an entry of unknown edit state on a high-assurance gate', async () => {
    const source = adapter()
    for (const extra of [{ edited: true }, { createdAt: 't1', updatedAt: 't2' }]) {
      const result = await admitGateDecision({
        entry: entry('sam-writer', agree(GATE), extra),
        gate: GATE,
        roster,
        adapter: source,
      })
      expect(result).toMatchObject({ opensGate: false, reason: 'edited-entry' })
    }
    const ha = await admitGateDecision({
      entry: entry('smota', agree(HA_GATE, 'security-review'), {}),
      gate: HA_GATE,
      roster,
      adapter: github,
    })
    expect(ha).toMatchObject({ opensGate: false, reason: 'edit-state-unknown' })
    const known = await admitGateDecision({
      entry: entry('smota', agree(HA_GATE, 'security-review'), { createdAt: 't', updatedAt: 't' }),
      gate: HA_GATE,
      roster,
      adapter: github,
    })
    expect(known).toMatchObject({ opensGate: true, satisfies: ['security-review'] })
  })

  it('binds the digest: a decision for an earlier round is stale, and an unbound gate admits nothing', async () => {
    const source = adapter()
    const round2 = {
      ...GATE,
      id: formatGateId({ ref: REF, name: 'release', digest: DIGEST2 }),
      digest: DIGEST2,
    }
    const stale = await admitGateDecision({
      entry: entry('sam-writer', agree(GATE)),
      gate: round2,
      roster,
      adapter: source,
    })
    expect(stale).toMatchObject({ opensGate: false, reason: 'stale-gate' })
    for (const gate of [
      { ...GATE, digest: undefined },
      { ...GATE, digest: DIGEST2 },
      { ...GATE, id: `${REF}:release`, digest: undefined },
    ]) {
      const result = await admitGateDecision({
        entry: entry('sam-writer', formatGateDecision({ gate: gate.id, decision: 'agree' })),
        gate,
        roster,
        adapter: source,
      })
      expect(result).toMatchObject({ opensGate: false, reason: 'gate-unbound' })
    }
  })

  it('a decision for another gate, or a plain comment, opens nothing', async () => {
    const source = adapter()
    const other = await admitGateDecision({
      entry: entry(
        'sam-writer',
        formatGateDecision({ gate: 'github:x#1:merge:cccccccccccc', decision: 'agree' }),
      ),
      gate: GATE,
      roster,
      adapter: source,
    })
    expect(other).toMatchObject({ recorded: true, opensGate: false, reason: 'other-gate' })
    const plain = await admitGateDecision({
      entry: entry('sam-writer', 'LGTM, approved'),
      gate: GATE,
      roster,
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
        roster,
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
    const missing = await admitGateDecision({
      entry: entry('smota', agree(HA_GATE)),
      gate: HA_GATE,
      roster,
      adapter: github,
    })
    expect(missing).toMatchObject({ opensGate: false, reason: 'review-required' })
    const security = await admitGateDecision({
      entry: entry('smota', agree(HA_GATE, 'security-review')),
      gate: HA_GATE,
      roster,
      adapter: github,
    })
    expect(security).toMatchObject({
      opensGate: true,
      satisfies: ['security-review'],
      personId: 'sam',
    })
    const stray = await admitGateDecision({
      entry: entry('smota', agree(GATE, 'security-review')),
      gate: GATE,
      roster,
      adapter: github,
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
    ).toMatchObject({ security: 'sam', acceptance: 'ana', satisfied: true })
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

  it('a refusal stands until the same reviewer agrees or withdraws; another agree does not override it', () => {
    const blocked = [
      d('sam', 'acceptance-review'),
      d('sam', 'security-review', 'blocked'),
      d('ana', 'security-review'),
    ]
    expect(highAssuranceGateState(blocked)).toMatchObject({
      satisfied: false,
      reason: 'refused',
      refusedBy: ['sam'],
    })
    expect(
      highAssuranceGateState([...blocked, d('sam', 'security-review', 'withdrawn')]),
    ).toMatchObject({
      satisfied: true,
      security: 'ana',
    })
    expect(highAssuranceGateState([...blocked, d('sam', 'security-review')]).satisfied).toBe(true)
  })
})

describe('gateDecisionState over the source log', () => {
  function haRoster(distinctReviewers) {
    const roster = sampleRoster()
    roster.people[1].scopes.push({ gates: ['acceptance-review'], tiers: ['high-assurance'] })
    if (distinctReviewers !== undefined) roster.highAssurance = { distinctReviewers }
    return roster
  }

  it('a high-assurance gate is satisfied by two people, and lists every ignored entry', async () => {
    const state = await gateDecisionState({
      entries: [
        entry('mallory', agree(HA_GATE, 'acceptance-review')),
        entry('agentflow-bot', agree(HA_GATE, 'acceptance-review')),
        entry('smota', 'a plain comment'),
        entry('smota', agree(HA_GATE, 'security-review')),
        entry('ana-dev', agree(HA_GATE, 'acceptance-review')),
      ],
      gate: HA_GATE,
      roster: haRoster(true),
      adapter: github,
    })
    expect(state.satisfied).toBe(true)
    expect(state.highAssurance).toMatchObject({ security: 'sam', acceptance: 'ana' })
    expect(state.ignored.map((item) => item.reason)).toEqual([
      'writer-not-on-roster',
      'bot-writer',
      'not-a-decision',
    ])
  })

  it('the same person cannot satisfy both reviews when the roster requires two', async () => {
    const state = await gateDecisionState({
      entries: [
        entry('smota', agree(HA_GATE, 'security-review')),
        entry('smota', agree(HA_GATE, 'acceptance-review')),
      ],
      gate: HA_GATE,
      roster: haRoster(true),
      adapter: github,
    })
    expect(state).toMatchObject({ satisfied: false, highAssurance: { reason: 'same-person' } })
  })

  it('another reviewer cannot override a standing refusal on a standard gate either', async () => {
    const roster = sampleRoster()
    roster.people[1].handles.filesystem = 'ana-writer'
    const source = adapter()
    const state = await gateDecisionState({
      entries: [entry('sam-writer', decide(GATE, 'blocked')), entry('ana-writer', agree(GATE))],
      gate: { ...GATE, paths: ['lib/x.mjs'] },
      roster,
      adapter: source,
    })
    expect(state).toMatchObject({ satisfied: false, refusedBy: ['sam'] })
  })

  it('an edited refusal turned into agree does not count', async () => {
    const state = await gateDecisionState({
      entries: [entry('sam-writer', agree(GATE), { createdAt: 't1', updatedAt: 't9' })],
      gate: GATE,
      roster: sampleRoster(),
      adapter: adapter(),
    })
    expect(state).toMatchObject({ satisfied: false, ignored: [{ reason: 'edited-entry' }] })
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
