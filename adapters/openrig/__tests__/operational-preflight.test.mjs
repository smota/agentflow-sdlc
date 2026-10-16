import { describe, expect, it } from 'vitest'
import { evaluateOperationalPreflight } from '../operational-preflight.mjs'

const now = '2026-10-15T12:00:00.000Z'
const tuple = {
  seat: 'dev.build',
  runtime: 'pi',
  providerRoute: 'munito',
  model: 'qwen/qwen3.8-27b',
  effort: 'medium',
  profile: 'builder-pi',
}
function fixture() {
  return {
    contracts: [{ ...tuple }],
    installedContracts: [{ ...tuple }],
    daemon: { state: 'running' },
    now,
    maxAgeMs: 60000,
    observations: {
      rigName: 'fixture-dev',
      complete: true,
      entries: [
        {
          ...tuple,
          generation: 'generation-2',
          sessionId: 'session-2',
          eventAt: now,
          sourceVerified: true,
          processReady: true,
          catchupVerified: true,
          occupantVerified: true,
          authorized: true,
          bindingVerified: true,
        },
      ],
    },
    task: {
      rigName: 'fixture-dev',
      owner: 'fixture-owner',
      requiredSeats: ['dev.build'],
      bindings: { 'dev.build': { generation: 'generation-2', sessionId: 'session-2' } },
    },
  }
}
function held(input) {
  const result = evaluateOperationalPreflight(input)
  expect(result.admitted).toBe(false)
  expect(result.effects).toEqual([])
  const seat = result.seats.find((item) => item.seat === 'dev.build')
  expect(seat.status).not.toBe('admitted')
  expect(seat.nextAction).toMatchObject({ owner: 'fixture-owner' })
  expect(seat.nextAction.action).toBeTruthy()
  expect(Number.isFinite(seat.nextAction.checkAfterMs)).toBe(true)
  return { result, seat }
}

describe('operational preflight admission evidence (#518)', () => {
  it('admits a fully bound fresh verified fixture without mutations', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = evaluateOperationalPreflight(input)
    expect(result).toMatchObject({ admitted: true, effects: [] })
    expect(result.seats).toHaveLength(1)
    expect(result.seats[0]).toMatchObject({
      seat: 'dev.build',
      configured: true,
      observed: true,
      usable: true,
      authorized: true,
      status: 'admitted',
    })
    expect(input).toEqual(before)
  })

  it('never treats an installed pinned model as observed execution', () => {
    const input = fixture()
    input.observations.entries = []
    const { seat } = held(input)
    expect(seat.configured).toBe(true)
    expect(seat.observed).toBe(false)
    expect(seat.usable).toBe(false)
  })

  it('holds READY with failed catch-up without claiming the process is dead', () => {
    const input = fixture()
    input.observations.entries[0].catchupVerified = false
    const { seat, result } = held(input)
    expect(seat.usable).toBe(false)
    expect(seat.reasons.length).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toMatch(/process_dead|process_stopped/)
  })

  it.each(['generation', 'sessionId'])(
    'rejects another occupant %s despite fresh matching model',
    (field) => {
      const input = fixture()
      input.observations.entries[0][field] = 'predecessor'
      const { seat } = held(input)
      expect(seat.observed).toBe(false)
      expect(seat.usable).toBe(false)
    },
  )

  it('does not rejuvenate an old event using a fresh collection timestamp', () => {
    const input = fixture()
    input.observations.entries[0].eventAt = '2026-10-15T11:58:00.000Z'
    input.observations.entries[0].sampledAt = now
    expect(held(input).seat.observed).toBe(false)
  })

  it('holds a stopped daemon without producing service effects', () => {
    const input = fixture()
    input.daemon.state = 'stopped'
    expect(held(input).seat.usable).toBe(false)
  })

  it('holds execution that is usable but unauthorized for the task', () => {
    const input = fixture()
    input.observations.entries[0].authorized = false
    expect(held(input).seat.authorized).toBe(false)
  })

  it.each(['incomplete', 'wrong-rig'])('rejects %s observation envelopes', (failure) => {
    const input = fixture()
    if (failure === 'incomplete') input.observations.complete = false
    else input.observations.rigName = 'another-rig'
    expect(held(input).seat.observed).toBe(false)
  })

  it('requires trusted source provenance even for an otherwise matching tuple', () => {
    const input = fixture()
    delete input.observations.entries[0].sourceVerified
    expect(held(input).seat.observed).toBe(false)
  })

  it.each(['model', 'effort', 'profile'])('holds installed %s drift', (field) => {
    const input = fixture()
    input.installedContracts[0][field] = 'different'
    expect(held(input).seat.configured).toBe(false)
  })

  it('holds unavailable required seats with an accountable next action', () => {
    const input = fixture()
    input.task.requiredSeats.push('dev.test-eng')
    const result = evaluateOperationalPreflight(input)
    expect(result.admitted).toBe(false)
    expect(result.effects).toEqual([])
    expect(result.seats.find((item) => item.seat === 'dev.test-eng')).toMatchObject({
      status: 'held',
      nextAction: { owner: 'fixture-owner' },
    })
  })

  it('does not classify quota usage metadata as an execution failure', () => {
    const input = fixture()
    const baseline = evaluateOperationalPreflight(input)
    input.observations.entries[0].rate_limits = {
      rate_limit_reached_type: 'weekly',
      used_percent: 5,
    }
    expect(evaluateOperationalPreflight(input)).toEqual(baseline)
  })

  it('drops arbitrary raw error, token and transcript text from reports', () => {
    const input = fixture()
    const marker = 'PRIVATE_RAW_FIXTURE_DO_NOT_ECHO'
    input.observations.entries[0].error = marker
    input.observations.entries[0].resumeToken = marker
    input.observations.entries[0].evidence = marker
    input.observations.entries[0].catchupVerified = false
    expect(JSON.stringify(held(input).result)).not.toContain(marker)
  })
})
