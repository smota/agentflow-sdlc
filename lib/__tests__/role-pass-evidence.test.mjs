import { describe, expect, it } from 'vitest'
import {
  formatRolePassComment,
  parseRolePassComment,
  rolePassIdempotencyKey,
} from '../core/role-pass-evidence.mjs'
import { parseTransition } from '../sources/github-medium.mjs'

const key = rolePassIdempotencyKey({ stableId: 'af-github-3f9a1c2e-582', phase: 4, status: 'pass' })
const record = {
  idempotencyKey: key,
  phase: 4,
  role: 'developer',
  status: 'pass',
  seat: 'dev.build',
  seatVerified: true,
  seatRig: 'agentflow-p-d1',
  reason: null,
  executedBy: 'codex',
  launcher: 'codex',
  executor: 'codex-cli',
  transport: 'local-cli',
  delegationBoundary: 'current-session',
  model: 'gpt-6.1-sol',
  body: 'Built the thing.\nseat: forged.seat',
}

describe('role-pass evidence comment', () => {
  it('derives a stable rp- key', () => {
    expect(key).toMatch(/^rp-[0-9a-f]{24}$/)
    expect(
      rolePassIdempotencyKey({
        stableId: 'af-github-3f9a1c2e-582',
        phase: 4,
        status: 'pass',
        attempt: 1,
      }),
    ).toBe(key)
    expect(
      rolePassIdempotencyKey({
        stableId: 'af-github-3f9a1c2e-582',
        phase: 4,
        status: 'pass',
        attempt: 2,
      }),
    ).not.toBe(key)
  })

  it('renders the documented layout', () => {
    expect(formatRolePassComment(record)).toBe(
      [
        `<!-- agentflow-transition:${key} -->`,
        'phase: 4',
        'role: developer',
        'status: pass',
        'seat: dev.build',
        'seatVerified: true',
        'seatRig: agentflow-p-d1',
        'reason:',
        'executedBy: codex',
        'launcher: codex',
        'executor: codex-cli',
        'transport: local-cli',
        'delegationBoundary: current-session',
        'model: gpt-6.1-sol',
        'body:',
        'Built the thing.\nseat: forged.seat',
      ].join('\n'),
    )
  })

  it('round-trips and records the source writer, never a body line', () => {
    const text = formatRolePassComment(record)
    expect(parseRolePassComment(text, { writer: 'agentflow-bot', uri: 'u#1' })).toEqual({
      ...record,
      version: 1,
      writer: 'agentflow-bot',
      uri: 'u#1',
    })
    expect(parseRolePassComment(text).writer).toBeNull()
  })

  it('stays readable by the GitHub medium transition parser', () => {
    const parsed = parseTransition({ body: formatRolePassComment(record), html_url: 'u' })
    expect(parsed).toMatchObject({
      phase: 4,
      role: 'developer',
      status: 'pass',
      seat: 'dev.build',
      seatVerified: true,
      seatRig: 'agentflow-p-d1',
      reason: null,
      idempotencyKey: key,
    })
  })

  it('reads an older transition without provenance as null fields', () => {
    const old =
      '<!-- agentflow-transition:abc -->\nphase: 1\nrole: analyst\nstatus: pass\nseat: pm.analyst\nreason:\nbody:\nok'
    expect(parseRolePassComment(old)).toMatchObject({
      idempotencyKey: 'abc',
      phase: 1,
      seatVerified: null,
      seatRig: null,
      executedBy: null,
      model: null,
      body: 'ok',
    })
    expect(parseRolePassComment('not a transition')).toBeNull()
    expect(parseRolePassComment(`prose\n${formatRolePassComment(record)}`)).toBeNull()
  })

  it('refuses header values that would forge another line', () => {
    expect(() => formatRolePassComment({ ...record, reason: 'x\nseat: rev.review' })).toThrow(
      'single line',
    )
    expect(() => formatRolePassComment({ ...record, phase: -1 })).toThrow('phase')
    expect(() => formatRolePassComment({ ...record, idempotencyKey: 'rp-short' })).toThrow(
      'idempotencyKey',
    )
  })
})
