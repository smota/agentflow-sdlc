import { describe, expect, it } from 'vitest'
import { resolveHumanDestination } from '../human-channel.mjs'

const NO_PERSON =
  'No person is registered. Run `rig gateway human add <entityId>`. Do not post a queue row.'

function participantsRecord(participants, defaultId, reason = 'test') {
  return {
    ok: true,
    participants,
    default: { id: defaultId, reason },
  }
}

function person(id, { isDefault = false } = {}) {
  return { id, address: `${id}@external`, kind: 'person', default: isDefault }
}

describe('resolveHumanDestination', () => {
  it('rejects a missing record and an ok:false record', () => {
    const notReady = {
      ok: false,
      reason: 'Human channel is not ready. Run `rig gateway participants --json`.',
    }
    expect(resolveHumanDestination(undefined)).toEqual(notReady)
    expect(resolveHumanDestination(null)).toEqual(notReady)
    expect(
      resolveHumanDestination({
        ok: false,
        participants: [person('sam')],
        default: { id: 'sam', reason: 'unavailable' },
      }),
    ).toEqual(notReady)
  })

  it('stops when no participants are registered', () => {
    expect(resolveHumanDestination(participantsRecord([], null, 'empty'))).toEqual({
      ok: false,
      reason: NO_PERSON,
    })
  })

  it('returns the only person when the default id is null', () => {
    expect(resolveHumanDestination(participantsRecord([person('sam')], null, 'sole'))).toEqual({
      ok: true,
      address: 'sam@external',
      entityId: 'sam',
    })
  })

  it('returns the default person when several people are registered', () => {
    expect(
      resolveHumanDestination(
        participantsRecord([person('sam'), person('ada', { isDefault: true })], 'ada', 'configured'),
      ),
    ).toEqual({
      ok: true,
      address: 'ada@external',
      entityId: 'ada',
    })
  })

  it('stops when several people are registered and the default id is null', () => {
    expect(
      resolveHumanDestination(participantsRecord([person('sam'), person('ada')], null, 'unset')),
    ).toEqual({
      ok: false,
      reason: 'Several people are registered and no default is set. Run `rig gateway default <id>`.',
    })
  })

  it('ignores a shared channel and does not invent a person', () => {
    expect(
      resolveHumanDestination(
        participantsRecord(
          [{ id: 'ops', address: 'ops@external', kind: 'shared-channel', default: true }],
          'ops',
          'shared',
        ),
      ),
    ).toEqual({ ok: false, reason: NO_PERSON })
  })

  it('rejects a default id that is not a person', () => {
    const decision = resolveHumanDestination(
      participantsRecord([person('sam')], 'ops', 'missing-person'),
    )
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('ops')
  })
})
