import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import { DORMANT_SEATS } from '../../adapters/openrig/continuity-policy.mjs'
import { BUILDER_SEATS } from '../core/decision-policy.mjs'
import { PHASES } from '../core/phase-graph.mjs'
import { AUTHORIZED_UNFREEZE_ACTORS } from '../core/role-collaboration.mjs'
import {
  canonicalSeat,
  checkPathOwnershipAgainstTable,
  checkPolicyTextSeats,
  checkRigSpecSeats,
  checkSeatKeys,
  rigSpecSeats,
  seatIds,
  validateSeatTable,
} from '../core/seat-table.mjs'
import { loadSeatTable } from '../seat-table-io.mjs'
import { STEERING_SEATS, IN_RIG_EXECUTION_SEATS } from '../providers/decider-port.mjs'
import { DEFAULT_KNOWN_SEATS, loadPathOwnership } from '../../scripts/validate-path-ownership.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const table = loadSeatTable(root)
const SEAT_SHAPED = /^[a-z]+\.[a-z][a-z0-9-]*$/

describe('seat table', () => {
  it('is a valid table of the eleven canonical seats', () => {
    expect(validateSeatTable(table)).toEqual({ ok: true, errors: [] })
    expect(seatIds(table, { aliases: false }).sort()).toEqual(
      [
        'dev.build',
        'dev.build-jr',
        'dev.build-sr',
        'dev.qa',
        'dev.test-eng',
        'eval.tester',
        'orch.arch',
        'pm.analyst',
        'pm.manager',
        'rev.review',
        'steer.lead',
      ].sort(),
    )
  })

  it('rejects duplicate ids, dangling aliases, alias collisions and bad pod.member ids', () => {
    const seat = table.seats[0]
    const bad = {
      ...table,
      seats: [...table.seats, seat, { ...seat, id: 'pm.other' }],
      aliases: [
        { id: 'x.gone', canonical: 'no.such', status: 'legacy' },
        { id: 'dev.qa', canonical: 'dev.build', status: 'legacy' },
      ],
    }
    const { ok, errors } = validateSeatTable(bad)
    expect(ok).toBe(false)
    expect(errors).toContain(`seat id is duplicated: ${seat.id}`)
    expect(errors).toContain('pm.other: id must equal pod.member')
    expect(errors.join('\n')).toMatch(/x\.gone names a canonical seat that does not exist/)
    expect(errors).toContain('alias dev.qa collides with a canonical seat')
  })

  it('resolves aliases to canonical seats and unknown names to null', () => {
    expect(canonicalSeat(table, 'rev.gate')).toBe('rev.review')
    expect(canonicalSeat(table, 'arch.lead')).toBe('orch.arch')
    expect(canonicalSeat(table, 'orch.lead')).toBe('orch.arch')
    expect(canonicalSeat(table, 'pm.lead')).toBe('pm.manager')
    expect(canonicalSeat(table, 'steer.po')).toBe('steer.lead')
    expect(canonicalSeat(table, 'dev.build')).toBe('dev.build')
    expect(canonicalSeat(table, 'dev.nobody')).toBeNull()
  })

  it('rejects a rig spec that provisions an alias or unknown seat, naming file and seat', () => {
    const rig = { pods: [{ id: 'rev', members: [{ id: 'gate' }, { id: 'review' }] }] }
    const errors = checkRigSpecSeats(
      table,
      { pods: [{ id: 'pm', members: [{ id: 'lead' }] }] },
      'a/rig.yaml',
    )
    expect(errors).toEqual(['a/rig.yaml: seat pm.lead is a legacy alias, use pm.manager'])
    expect(checkRigSpecSeats(table, rig, 'b/rig.yaml')).toEqual([
      'b/rig.yaml: seat rev.gate is a legacy alias, use rev.review',
    ])
    expect(
      checkRigSpecSeats(table, { pods: [{ id: 'qa', members: [{ id: 'x' }] }] }, 'c/rig.yaml'),
    ).toEqual(['c/rig.yaml: seat qa.x is not in manifests/seats.json'])
  })

  it('rejects an edge that names a member the pod does not have', () => {
    const rig = {
      pods: [
        {
          id: 'pm',
          members: [{ id: 'manager' }],
          edges: [{ kind: 'delegates_to', from: 'manager', to: 'analyst' }],
        },
      ],
    }
    expect(checkRigSpecSeats(table, rig, 'r.yaml')[0]).toMatch(/unknown member analyst/)
  })

  it('allows aliases in policy and distribution keys only when asked', () => {
    expect(checkSeatKeys(table, ['rev.gate'], 'd.json', { allowAliases: true })).toEqual([])
    expect(checkSeatKeys(table, ['rev.gate'], 'd.json')).toHaveLength(1)
    expect(
      checkPolicyTextSeats(table, 'Use `rev.gate` and `pm.*` and `dev.build*`.', 'p.md'),
    ).toEqual([])
  })

  it('fails policy text that names an unknown seat, with file and line', () => {
    const text = 'ok `dev.build`\nbad `dev.nobody` and `pm.nobody` and again `dev.nobody`\n'
    expect(checkPolicyTextSeats(table, text, 'AGENTS.md')).toEqual([
      'AGENTS.md:2: seat dev.nobody is not in manifests/seats.json',
      'AGENTS.md:2: seat pm.nobody is not in manifests/seats.json',
    ])
  })
})

describe('path ownership against the table', () => {
  const manifest = loadPathOwnership(root)

  it('matches the shipped manifest', () => {
    expect(checkPathOwnershipAgainstTable(table, manifest)).toEqual({ ok: true, errors: [] })
  })

  it('reads DEFAULT_KNOWN_SEATS from the table', () => {
    expect([...DEFAULT_KNOWN_SEATS].sort()).toEqual(seatIds(table).sort())
  })

  it('every seat in the shipped rig specs has a non-governance rule equal to its writes', () => {
    const shipped = ['agentflow', 'agentflow-product', 'agentflow-steer', 'agentflow-eval'].flatMap(
      (dir) =>
        rigSpecSeats(YAML.parse(readFileSync(`${root}adapters/openrig/${dir}/rig.yaml`, 'utf8'))),
    )
    expect(shipped.length).toBeGreaterThan(0)
    for (const id of shipped) {
      const seat = table.seats.find((item) => item.id === id)
      expect(seat, id).toBeDefined()
      const rule = manifest.rules.find((item) => item.id === seat.writes.rule)
      expect(rule?.id, id).not.toBe('governance-files-guard')
      expect(rule.seats, id).toContain(id)
      expect(rule.allow ?? [], id).toEqual(seat.writes.allow ?? [])
      expect(rule.deny ?? [], id).toEqual(seat.writes.deny ?? [])
      expect(rule.defaultDeny ?? false, id).toBe(seat.writes.defaultDeny ?? false)
    }
  })

  it('reports drift: missing seat, wrong allow, uncovered alias, foreign seat in a rule', () => {
    const drifted = structuredClone(manifest)
    drifted.knownSeats = drifted.knownSeats.filter((id) => id !== 'eval.tester')
    drifted.rules.find((r) => r.id === 'eval-write-guard').allow = ['**']
    drifted.rules.find((r) => r.id === 'review-readonly-guard').seats = ['dev.qa', 'rev.review']
    drifted.rules.find((r) => r.id === 'builder-oracle-guard').seats.push('rev.review')
    const { ok, errors } = checkPathOwnershipAgainstTable(table, drifted)
    expect(ok).toBe(false)
    const text = errors.join('\n')
    expect(text).toMatch(/knownSeats must equal.*missing eval\.tester/)
    expect(text).toMatch(/eval\.tester: rule eval-write-guard allow differs/)
    expect(text).toMatch(/rev\.gate: rule review-readonly-guard does not name it/)
    expect(text).toMatch(
      /rule builder-oracle-guard names rev\.review but the table assigns it review-readonly-guard/,
    )
  })
})

describe('code constants are in the table', () => {
  const known = new Set(seatIds(table))
  const seatShaped = (list) => list.filter((item) => SEAT_SHAPED.test(item))

  it.each([
    ['BUILDER_SEATS', BUILDER_SEATS],
    ['AUTHORIZED_UNFREEZE_ACTORS', AUTHORIZED_UNFREEZE_ACTORS],
    ['STEERING_SEATS', STEERING_SEATS],
    ['DORMANT_SEATS', DORMANT_SEATS],
  ])('%s', (_name, list) => {
    expect(seatShaped(list).length).toBeGreaterThan(0)
    for (const seat of seatShaped(list)) expect(known.has(seat), seat).toBe(true)
  })

  it('IN_RIG_EXECUTION_SEATS names only table seats except the known orch.pm drift', () => {
    // orch.pm is a fail-closed deny-list entry no rig provisions; retire it in a follow-up issue.
    const unknown = IN_RIG_EXECUTION_SEATS.filter((seat) => !known.has(seat))
    expect(unknown).toEqual(['orch.pm'])
  })

  it('PHASES seats exist in the table and own the phase there', () => {
    for (const spec of PHASES) {
      for (const id of spec.seats ?? [spec.seat]) {
        const seat = table.seats.find((item) => item.id === id)
        expect(seat, id).toBeDefined()
        expect(seat.phases, id).toContain(spec.phase)
        expect(seat.roles, id).toContain(spec.role)
      }
    }
  })
})
