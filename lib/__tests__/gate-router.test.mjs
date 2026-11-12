// Gate router (#585): scope match, capacity, backup after timeout, no-roster fallback. Delivery runs
// through the in-memory queue port; no rig, no network.
import { describe, expect, it } from 'vitest'
import { resolveHumanDestination } from '../../adapters/openrig/human-channel.mjs'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'
import {
  createQueueNotifier,
  deliverGate,
  globMatches,
  nextRecipient,
  routeGate,
  routeGateOrSinglePerson,
  scopeCovers,
} from '../roster/gate-router.mjs'
import { overlayFor, sampleRoster } from './fixtures/team-roster-fixtures.mjs'

const T0 = new Date('2026-11-12T10:00:00.000Z')
const minutes = (n) => new Date(T0.getTime() + n * 60_000)
const gate = (fields = {}) => ({
  id: 'github:org/repo#12:release',
  type: 'release-of-candidate',
  paths: ['lib/roster/authority.mjs'],
  tier: 'standard',
  ...fields,
})

function recordingNotifier() {
  const calls = []
  return { calls, deliver: async (input) => (calls.push(input), { qitemId: 'x' }) }
}

describe('globMatches', () => {
  it.each([
    ['lib/**', 'lib/a.mjs', true],
    ['lib/**', 'lib/x/y/z.mjs', true],
    ['lib/**', 'lib', true],
    ['lib/**', 'libx/a.mjs', false],
    ['lib/*.mjs', 'lib/a.mjs', true],
    ['lib/*.mjs', 'lib/x/a.mjs', false],
    ['**/*.md', 'docs/a/b.md', true],
    ['**/*.md', 'a.md', true],
    ['docs/index.md', 'docs/index.md', true],
    ['docs/index.md', 'docs/indexXmd', false],
    ['lib/**', '../lib/a.mjs', false],
    ['lib/**', '/lib/a.mjs', false],
    ['lib/**', 'lib/../manifests/path-ownership.json', false],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(globMatches(pattern, path)).toBe(expected)
  })
})

describe('scopeCovers', () => {
  const [sam, ana] = sampleRoster().people

  it('needs the gate type, the tier and every gate path', () => {
    expect(scopeCovers(sam, gate())).toBe(true)
    expect(scopeCovers(sam, gate({ type: 'merge' }))).toBe(false)
    expect(scopeCovers(sam, gate({ tier: 'bounded' }))).toBe(false)
    expect(scopeCovers(sam, gate({ paths: ['lib/a.mjs', 'docs/a.md'] }))).toBe(false)
    expect(scopeCovers(sam, gate({ paths: ['lib/a.mjs', 'scripts/b.mjs'] }))).toBe(true)
  })

  it('covers a gate without paths only with a scope that has no path restriction', () => {
    expect(scopeCovers(sam, gate({ paths: [] }))).toBe(false)
    expect(scopeCovers(ana, gate({ paths: [] }))).toBe(true)
    expect(scopeCovers(ana, gate({ paths: ['anything/at/all.txt'] }))).toBe(true)
  })

  it('unions paths over the scopes that match the type and tier', () => {
    const person = {
      id: 'kim',
      handles: { github: 'kim' },
      scopes: [
        { gates: ['merge'], paths: ['lib/**'], tiers: ['standard'] },
        { gates: ['merge'], paths: ['docs/**'], tiers: ['standard'] },
        { gates: ['security-review'], paths: ['scripts/**'], tiers: ['standard'] },
      ],
    }
    expect(scopeCovers(person, gate({ type: 'merge', paths: ['lib/a', 'docs/b'] }))).toBe(true)
    expect(scopeCovers(person, gate({ type: 'merge', paths: ['lib/a', 'scripts/c'] }))).toBe(false)
  })
})

describe('routeGate', () => {
  it('routes to the first person whose scope matches, with the declared backup', () => {
    const routing = routeGate({ gate: gate(), roster: sampleRoster(), now: T0 })
    expect(routing).toMatchObject({
      status: 'routed',
      gateId: gate().id,
      primary: 'sam',
      backup: 'ana',
      escalateAt: minutes(240).toISOString(),
    })
  })

  it('skips a person at capacity and explains it by roster id', () => {
    const routing = routeGate({ gate: gate(), roster: sampleRoster(), load: { sam: 3 }, now: T0 })
    expect(routing.primary).toBe('ana')
    expect(routing.considered).toEqual([
      { personId: 'sam', outcome: 'at-capacity' },
      { personId: 'ana', outcome: 'primary' },
    ])
  })

  it('says no-capacity when every matching person is full, and no-match when nobody matches', () => {
    const full = routeGate({
      gate: gate(),
      roster: sampleRoster(),
      load: { sam: 3, ana: 3 },
      now: T0,
    })
    expect(full).toMatchObject({ status: 'no-capacity', matching: ['sam', 'ana'] })
    const none = routeGate({ gate: gate({ type: 'merge' }), roster: sampleRoster(), now: T0 })
    expect(none).toMatchObject({ status: 'no-match' })
  })

  it('falls back to the next matching person when the declared backup is out of scope', () => {
    const roster = sampleRoster()
    roster.people.push({
      id: 'lee',
      handles: { github: 'lee' },
      scopes: [{ gates: ['acceptance-review'], tiers: ['high-assurance'] }],
    })
    const routing = routeGate({
      gate: gate({ type: 'acceptance-review', tier: 'high-assurance' }),
      roster,
      now: T0,
    })
    expect(routing).toMatchObject({ primary: 'sam', backup: 'lee' })
  })

  it('can exclude a person, so a second high-assurance review goes to someone else', () => {
    const routing = routeGate({
      gate: gate({ type: 'security-review' }),
      roster: sampleRoster(),
      exclude: ['sam'],
      now: T0,
    })
    expect(routing).toMatchObject({ primary: 'ana', backup: null })
  })

  it('throws on a gate it cannot type-check', () => {
    expect(() => routeGate({ gate: gate({ type: 'whatever' }), roster: sampleRoster() })).toThrow()
    expect(() => routeGate({ gate: gate({ tier: undefined }), roster: sampleRoster() })).toThrow()
  })
})

describe('nextRecipient', () => {
  const routing = routeGate({ gate: gate(), roster: sampleRoster(), now: T0 })

  it('is the primary until the timeout, then the backup, and nobody once decided', () => {
    expect(nextRecipient({ routing, now: minutes(239), decided: false })).toBe('sam')
    expect(nextRecipient({ routing, now: minutes(240), decided: false })).toBe('ana')
    expect(nextRecipient({ routing, now: minutes(500), decided: true })).toBeNull()
  })
})

describe('deliverGate and the queue notifier', () => {
  it('delivers to the matching person, then to the backup after the timeout, through the notifier', async () => {
    const roster = sampleRoster()
    const overlay = overlayFor(roster)
    const queue = createMemoryQueuePort()
    const notifier = createQueueNotifier({ queue, source: 'agentflow-bridge@rig-a' })
    const routing = routeGate({ gate: gate(), roster, now: T0 })
    const summary = `Gate ${gate().type} waits for a decision on github:org/repo#12`

    const first = await deliverGate({
      routing,
      personId: nextRecipient({ routing, now: minutes(1), decided: false }),
      roster,
      overlay,
      notifier,
      summary,
      evidenceRef: 'github:org/repo#12',
    })
    expect(first).toEqual({ delivered: 'sam', gateId: gate().id })

    const second = await deliverGate({
      routing,
      personId: nextRecipient({ routing, now: minutes(241), decided: false }),
      roster,
      overlay,
      notifier,
      summary,
      evidenceRef: 'github:org/repo#12',
    })
    expect(second).toEqual({ delivered: 'ana', gateId: gate().id })

    const rows = queue.rows()
    expect(rows.map((row) => row.destination)).toEqual([
      overlay.channels.sam.openrig,
      overlay.channels.ana.openrig,
    ])
    // The timeout is a rig timer on the parked row, not a poll.
    expect(rows.map((row) => [row.state, row.wakeAfter])).toEqual([
      ['blocked', '240m'],
      ['blocked', '240m'],
    ])
    for (const row of rows) {
      expect(row.humanIntent).toBe('decision')
      expect(row.body).toMatch(/^agentflow-gate\/v1\n/)
      expect(row.body).not.toContain('@')
    }
  })

  it('re-delivery to the same person is one row', async () => {
    const roster = sampleRoster()
    const overlay = overlayFor(roster)
    const queue = createMemoryQueuePort()
    const notifier = createQueueNotifier({ queue, source: 'agentflow-bridge@rig-a' })
    const routing = routeGate({ gate: gate(), roster, now: T0 })
    const input = { routing, personId: 'sam', roster, overlay, notifier, summary: 's' }
    await deliverGate(input)
    await deliverGate(input)
    expect(queue.rows()).toHaveLength(1)
  })

  it('does not deliver to someone the routing did not pick, or who has no channel', async () => {
    const roster = sampleRoster()
    roster.people.push({
      id: 'zed',
      handles: { github: 'zed' },
      scopes: sampleRoster().people[1].scopes,
    })
    const overlay = overlayFor(sampleRoster())
    const notifier = recordingNotifier()
    const routing = routeGate({ gate: gate(), roster, now: T0 })
    await expect(
      deliverGate({ routing, personId: 'zed', roster, overlay, notifier, summary: 's' }),
    ).rejects.toThrow(/not routed/)
    const noChannel = await deliverGate({
      routing,
      personId: 'sam',
      roster,
      overlay: { version: 1, channels: {} },
      notifier,
      summary: 's',
    })
    expect(noChannel).toEqual({
      delivered: null,
      personId: 'sam',
      gateId: gate().id,
      reason: 'no-channel',
    })
    expect(notifier.calls).toHaveLength(0)
  })

  it('refuses a summary or evidence reference that carries a private address', async () => {
    const roster = sampleRoster()
    const overlay = overlayFor(roster)
    const notifier = recordingNotifier()
    const routing = routeGate({ gate: gate(), roster, now: T0 })
    for (const leak of [
      { summary: `ask ${overlay.channels.ana.openrig}` },
      { evidenceRef: overlay.channels.sam.openrig },
    ]) {
      let message = ''
      try {
        await deliverGate({
          routing,
          personId: 'sam',
          roster,
          overlay,
          notifier,
          summary: 's',
          ...leak,
        })
      } catch (error) {
        message = error.message
      }
      expect(message).toMatch(/private address/)
      expect(message).not.toContain('@')
    }
    expect(notifier.calls).toHaveLength(0)
  })
})

describe('no roster: today’s single-person path', () => {
  const participants = {
    ok: true,
    participants: [{ kind: 'person', id: 'operator', address: ['operator', 'external'].join('@') }],
  }

  it('uses resolveHumanDestination over rig gateway participants', () => {
    const result = routeGateOrSinglePerson({
      team: null,
      gate: gate(),
      now: T0,
      singlePerson: () => resolveHumanDestination(participants),
    })
    expect(result).toEqual({
      status: 'single-person',
      destination: resolveHumanDestination(participants),
    })
  })

  it('routes through the roster when there is one', () => {
    const result = routeGateOrSinglePerson({
      team: { roster: sampleRoster(), overlay: null },
      gate: gate(),
      now: T0,
      singlePerson: () => {
        throw new Error('must not be called')
      },
    })
    expect(result).toMatchObject({ status: 'routed', primary: 'sam' })
  })
})
