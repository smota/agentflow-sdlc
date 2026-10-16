import { describe, expect, it } from 'vitest'
import { evaluateSteeringBinding } from '../core/steering-binding.mjs'

const nowMs = 1000000
function fixture() {
  const binding = {
    authorityId: 'external-owner',
    replyRoute: 'external:operator',
    goal: 'goal-516',
    task: 'task-520',
    powers: ['observe'],
    issuedAt: nowMs - 1,
    expiresAt: nowMs + 120000,
  }
  const request = {
    goal: 'goal-516',
    task: 'task-520',
    power: 'observe',
    challenge: 'challenge-unique-12345678901234567890',
    deadlineAt: nowMs + 90000,
  }
  const receipt = {
    authenticated: true,
    reachable: true,
    authorityId: binding.authorityId,
    replyRoute: binding.replyRoute,
    goal: request.goal,
    task: request.task,
    challenge: request.challenge,
    power: request.power,
    expiresAt: nowMs + 60000,
    observedAt: nowMs,
    deadlineAt: request.deadlineAt,
  }
  return { binding, request, nowMs, verifyEndpoint: () => ({ ...receipt }), receipt }
}
function evaluate(input) {
  const { receipt, ...args } = input
  return evaluateSteeringBinding(args)
}
function held(input) {
  const result = evaluate(input)
  expect(result.authorized).toBe(false)
  expect(result.effects).toEqual([])
  expect(result.obligation).toMatchObject({
    owner: 'human/operator',
    action: 'verify-steering-authority',
  })
  expect(Number.isFinite(result.obligation.deadlineAt)).toBe(true)
  expect(result.obligation.deadlineAt).toBeLessThanOrEqual(nowMs + 15 * 60000)
  return result
}

describe('external authenticated steering binding (#520)', () => {
  it('accepts verified external authority without a local seat and changes nothing', () => {
    const input = fixture(),
      before = structuredClone({ binding: input.binding, request: input.request })
    expect(evaluate(input)).toMatchObject({ authorized: true, reachable: true, effects: [] })
    expect({ binding: input.binding, request: input.request }).toEqual(before)
  })
  it('does not equate a named owner and fresh heartbeat with authenticated reachability', () => {
    const input = fixture()
    delete input.verifyEndpoint
    input.binding.lastHeartbeatMs = nowMs
    held(input)
  })
  it.each(['authorityId', 'replyRoute', 'goal', 'task', 'challenge', 'power', 'deadlineAt'])(
    'rejects verifier receipt with wrong %s',
    (field) => {
      const input = fixture()
      input.receipt[field] = 'other'
      held(input)
    },
  )
  it.each(['goal', 'task'])('rejects binding/request %s scope mismatch', (field) => {
    const input = fixture()
    input.request[field] = 'other'
    held(input)
  })
  it('rejects a power outside the explicitly delegated powers', () => {
    const input = fixture()
    input.binding.powers = ['unfreeze']
    held(input)
  })
  it.each(['authenticated', 'reachable'])('holds a receipt lacking %s', (field) => {
    const input = fixture()
    input.receipt[field] = false
    held(input)
  })
  it.each(['binding', 'receipt', 'deadline'])('holds expired %s', (field) => {
    const input = fixture()
    if (field === 'binding') input.binding.expiresAt = nowMs
    if (field === 'receipt') input.receipt.expiresAt = nowMs
    if (field === 'deadline') input.request.deadlineAt = nowMs
    held(input)
  })
  it('rejects a verifier receipt that extends binding authority expiry', () => {
    const input = fixture()
    input.receipt.expiresAt = input.binding.expiresAt + 1
    held(input)
  })
  it.each(['future-receipt', 'stale-receipt', 'missing-receipt-time', 'future-binding'])(
    'holds %s',
    (mode) => {
      const input = fixture()
      if (mode === 'future-receipt') input.receipt.observedAt = nowMs + 1
      if (mode === 'stale-receipt') input.receipt.observedAt = nowMs - 60001
      if (mode === 'missing-receipt-time') delete input.receipt.observedAt
      if (mode === 'future-binding') input.binding.issuedAt = nowMs + 1
      held(input)
    },
  )
  it.each(['throws', 'promise', 'null'])('holds when trusted verifier %s', (mode) => {
    const input = fixture()
    input.verifyEndpoint = () => {
      if (mode === 'throws') throw new Error('PRIVATE_FIXTURE_RAW_ERROR')
      if (mode === 'promise') return Promise.resolve(input.receipt)
      return null
    }
    expect(JSON.stringify(held(input))).not.toContain('PRIVATE_FIXTURE')
  })
  it('checks every supplied response correlation field before authorizing', () => {
    for (const field of [
      'authorityId',
      'replyRoute',
      'goal',
      'task',
      'challenge',
      'power',
      'deadlineAt',
    ]) {
      const input = fixture()
      input.response = Object.fromEntries(
        ['authorityId', 'replyRoute', 'goal', 'task', 'challenge', 'power', 'deadlineAt'].map(
          (key) => [key, input.receipt[key]],
        ),
      )
      input.response[field] = 'wrong'
      held(input)
    }
  })
  it('passes the exact response to the trusted verifier', () => {
    const input = fixture()
    input.response = Object.fromEntries(
      ['authorityId', 'replyRoute', 'goal', 'task', 'challenge', 'power', 'deadlineAt'].map(
        (key) => [key, input.receipt[key]],
      ),
    )
    let captured
    input.verifyEndpoint = (args) => {
      captured = args
      return input.receipt
    }
    expect(evaluate(input).authorized).toBe(true)
    expect(captured).toEqual({
      binding: input.binding,
      request: input.request,
      response: input.response,
    })
  })
  it('bounds the hold obligation even when the requested deadline is far away', () => {
    const input = fixture()
    input.request.deadlineAt = nowMs + 86400000
    delete input.verifyEndpoint
    expect(held(input).obligation.deadlineAt).toBe(nowMs + 15 * 60000)
  })
  it('does not leak arbitrary response, binding or verifier payloads', () => {
    const input = fixture()
    input.receipt.authenticated = false
    input.binding.secret = 'PRIVATE_FIXTURE_BINDING'
    input.receipt.error = 'PRIVATE_FIXTURE_RECEIPT'
    expect(JSON.stringify(held(input))).not.toContain('PRIVATE_FIXTURE')
  })
  it('rejects an invalid clock without fabricating a deadline', () => {
    const input = fixture()
    input.nowMs = NaN
    expect(evaluate(input)).toMatchObject({
      authorized: false,
      effects: [],
      obligation: { deadlineAt: null },
    })
  })
})
