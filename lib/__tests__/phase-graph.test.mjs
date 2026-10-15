import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOT_FILE_DENYLIST,
  allowedNext,
  resolveRoleAndSeat,
  validateTransition,
} from '../core/phase-graph.mjs'

const pass = (phase) => ({ phase, status: 'pass' })
const skip = (phase, reason) => ({ phase, status: 'skipped', reason })
const planned = [pass(0), pass(1), pass(2), pass(3)]
const defect = skip(4, 'Planning defect: unwired. Return to phase 3.')

describe('allowedNext', () => {
  it('offers only the planner after a phase 4 skip that returns to phase 3', () => {
    expect(allowedNext([...planned, defect])).toEqual([3])
  })

  it('still offers the tester after a phase 4 skip that names no return', () => {
    expect(allowedNext([...planned, skip(4, 'No code change.')])).toContain(5)
  })

  it('still offers phase 1 after a phase 0 skip', () => {
    expect(allowedNext([skip(0, 'Bug.')])).toEqual([1])
  })

  it('offers the tester only after a real phase 4 delivery follows the return', () => {
    const returned = [...planned, defect, pass(3)]
    expect(allowedNext(returned)).toContain(4)
    expect(allowedNext([...returned, pass(4)])).toContain(5)
  })

  it('withholds the technical writer after a review skip that returns to phase 4', () => {
    const reviewed = [...planned, pass(4), pass(5), skip(6, 'Return to phase 4.')]
    expect(allowedNext(reviewed)).toEqual([4])
  })

  it('offers the analyst after an architect skip that returns to phase 1', () => {
    const archDefect = skip(2, 'Requirement infeasibility detected. Return to phase 1.')
    expect(allowedNext([pass(0), pass(1), archDefect])).toEqual([1])
  })

  it('offers the product manager after an analyst skip that returns to phase 0', () => {
    const analystDefect = skip(1, 'Problem ambiguity detected. Return to phase 0.')
    expect(allowedNext([pass(0), analystDefect])).toEqual([0])
  })

  it('offers the analyst after an implementation planner skip that returns to phase 1', () => {
    const plannerDefect = skip(3, 'Capability map boundary conflict. Return to phase 1.')
    expect(allowedNext([...planned.slice(0, 3), plannerDefect])).toEqual([1])
  })

  it('offers the analyst after a developer skip that returns to phase 1', () => {
    const devContractDefect = skip(4, 'Acceptance criteria untestable. Return to phase 1.')
    expect(allowedNext([...planned, devContractDefect])).toEqual([1])
  })

  it('halts with empty allowedNext when return cycle limit is exceeded to prevent deadlocks', () => {
    const loop1 = [
      pass(0),
      pass(1),
      skip(2, 'Infeasibility 1. Return to phase 1.'),
      pass(1),
      skip(2, 'Infeasibility 2. Return to phase 1.'),
      pass(1),
      skip(2, 'Infeasibility 3. Return to phase 1.'),
    ]
    expect(allowedNext(loop1)).toEqual([])
  })

  it('offers phase 3 after a phase 4 skip that matches oracle:correction', () => {
    const oracleCorrection = skip(4, 'defect: oracle:correction in test assertions')
    expect(allowedNext([...planned, oracleCorrection])).toEqual([3])
  })
})

describe('resolveRoleAndSeat and validateTransition (#509)', () => {
  it('resolves legacy seats and assigns builder qualifiers', () => {
    expect(resolveRoleAndSeat(4, { seat: 'dev.build-jr' })).toEqual({
      role: 'developer',
      seat: 'dev.build-jr',
      qualifier: 'junior',
    })
    expect(resolveRoleAndSeat(4, { seat: 'dev.build-sr' })).toEqual({
      role: 'developer',
      seat: 'dev.build-sr',
      qualifier: 'senior',
    })
    expect(resolveRoleAndSeat(4, { seat: 'dev.build' })).toEqual({
      role: 'developer',
      seat: 'dev.build',
      qualifier: 'standard',
    })
  })

  it('resolves canonical role when passed instead of seat', () => {
    expect(resolveRoleAndSeat(4, { role: 'developer' })).toEqual({
      role: 'developer',
      seat: 'dev.build-jr',
      qualifier: null,
    })
    expect(resolveRoleAndSeat(4, { seat: 'developer' })).toEqual({
      role: 'developer',
      seat: 'dev.build-jr',
      qualifier: null,
    })
    expect(resolveRoleAndSeat(1, { role: 'analyst' })).toEqual({
      role: 'analyst',
      seat: 'pm.analyst',
      qualifier: null,
    })
  })

  it('rejects seats that do not own the phase', () => {
    expect(() => resolveRoleAndSeat(4, { seat: 'pm.manager' })).toThrow(
      'Seat pm.manager does not own phase 4 (developer)',
    )
  })

  it('validates transitions with canonical role or legacy seat', () => {
    const resRole = validateTransition({
      transitions: planned,
      phase: 4,
      status: 'pass',
      role: 'developer',
    })
    expect(resRole).toEqual({
      phase: 4,
      role: 'developer',
      seat: 'dev.build-jr',
      status: 'pass',
      reason: null,
    })

    const resSeat = validateTransition({
      transitions: planned,
      phase: 4,
      status: 'pass',
      seat: 'dev.build-jr',
      role: 'developer',
    })
    expect(resSeat).toEqual({
      phase: 4,
      role: 'developer',
      seat: 'dev.build-jr',
      status: 'pass',
      reason: null,
      qualifier: 'junior',
    })

    const legacyCall = validateTransition({
      transitions: planned,
      phase: 4,
      status: 'pass',
      seat: 'dev.build-jr',
    })
    expect(legacyCall).toEqual({
      phase: 4,
      role: 'developer',
      seat: 'dev.build-jr',
      status: 'pass',
      reason: null,
    })
  })

  it('supports oracle:correction 1-hop return from Phase 4 to Phase 3', () => {
    const res = validateTransition({
      transitions: planned,
      phase: 4,
      status: 'skipped',
      seat: 'dev.build',
      reason: 'defect: oracle:correction needed',
    })
    expect(res.oracleCorrection).toBe(true)
    expect(res.status).toBe('skipped')

    const next = allowedNext([...planned, res])
    expect(next).toEqual([3])
  })

  it('rejects developer modifications to oracle files under tests/oracles/**', () => {
    expect(() =>
      validateTransition({
        transitions: planned,
        phase: 4,
        status: 'pass',
        seat: 'dev.build',
        touchedFiles: ['tests/oracles/foo.json'],
      }),
    ).toThrow('Developer role cannot modify oracle files under tests/oracles/**')

    expect(() =>
      validateTransition({
        transitions: planned,
        phase: 4,
        status: 'pass',
        seat: 'dev.build',
        touchedFiles: ['lib/app.mjs', 'src/tests/nested/oracles/schema.json'],
      }),
    ).toThrow('Developer role cannot modify oracle files under tests/oracles/**')

    expect(() =>
      validateTransition({
        transitions: planned,
        phase: 4,
        status: 'pass',
        seat: 'dev.build',
        touchedFiles: ['lib/app.mjs', 'tests/app.test.mjs'],
      }),
    ).not.toThrow()
  })

  it('enforces expectedPreviousTransitionId optimistic concurrency', () => {
    expect(() =>
      validateTransition({
        transitions: [],
        phase: 0,
        status: 'pass',
        seat: 'pm.manager',
        expectedPreviousTransitionId: 'none',
      }),
    ).not.toThrow()

    expect(() =>
      validateTransition({
        transitions: [],
        phase: 0,
        status: 'pass',
        seat: 'pm.manager',
        expectedPreviousTransitionId: 'tx-prev',
      }),
    ).toThrow('Transition monotonicity violation: expected previousTransitionId tx-prev, got none')

    const withKeys = [
      { phase: 0, status: 'pass', idempotencyKey: 'tx-0' },
      { phase: 1, status: 'pass', idempotencyKey: 'tx-1' },
    ]

    expect(() =>
      validateTransition({
        transitions: withKeys,
        phase: 2,
        status: 'pass',
        seat: 'orch.arch',
        expectedPreviousTransitionId: 'tx-1',
      }),
    ).not.toThrow()

    expect(() =>
      validateTransition({
        transitions: withKeys,
        phase: 2,
        status: 'pass',
        seat: 'orch.arch',
        expectedPreviousTransitionId: 'tx-0',
      }),
    ).toThrow('Transition monotonicity violation: expected previousTransitionId tx-0, got tx-1')
  })

  it('computes serializationStatus based on hot file denylist and active overlap', () => {
    const resSerialized = validateTransition({
      transitions: planned,
      phase: 4,
      status: 'pass',
      seat: 'dev.build',
      touchedFiles: ['package-lock.json', 'lib/index.mjs'],
      activeHotFiles: ['package-lock.json'],
    })
    expect(resSerialized.serializationStatus).toBe('SERIALIZED')

    const resParallelOk = validateTransition({
      transitions: planned,
      phase: 4,
      status: 'pass',
      seat: 'dev.build',
      touchedFiles: ['package-lock.json'],
      activeHotFiles: [],
    })
    expect(resParallelOk.serializationStatus).toBe('PARALLEL_OK')

    const resNoHot = validateTransition({
      transitions: planned,
      phase: 4,
      status: 'pass',
      seat: 'dev.build',
      touchedFiles: ['lib/index.mjs'],
      activeHotFiles: ['package-lock.json'],
    })
    expect(resNoHot.serializationStatus).toBe('PARALLEL_OK')
  })
})
