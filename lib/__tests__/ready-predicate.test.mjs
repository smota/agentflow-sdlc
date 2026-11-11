import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  evaluateReadyPredicate,
  predicateKinds,
  readyPredicateProblems,
} from '../core/ready-predicate.mjs'

const schema = JSON.parse(
  readFileSync(new URL('../../schemas/ready-predicate.schema.json', import.meta.url), 'utf8'),
)
const validateSchema = new Ajv2020({ strict: false }).compile(schema)

const item = (fields = {}) => ({
  labels: ['agentflow:ready', 'kind:capability'],
  lifecycle: 'open',
  status: 'todo',
  ...fields,
})

const ready = {
  all: [
    { kind: 'label', has: 'agentflow:ready' },
    { kind: 'lifecycle', state: 'open' },
  ],
}

describe('ready predicate', () => {
  it('accepts the documented predicate and the schema agrees', () => {
    expect(readyPredicateProblems(ready)).toEqual([])
    expect(validateSchema(ready)).toBe(true)
    expect(predicateKinds(ready)).toEqual(new Set(['label', 'lifecycle']))
  })

  it('reports structural problems and the schema rejects them too', () => {
    const bad = [
      [{ kind: 'label' }, 'label leaf needs exactly one of has or lacks'],
      [{ kind: 'label', has: 'a', lacks: 'b' }, 'label leaf needs exactly one of has or lacks'],
      [{ kind: 'status', in: [] }, 'status leaf needs a non-empty in list'],
      [{ kind: 'lifecycle', state: 'done' }, 'lifecycle state must be one of open|closed|merged'],
      [{ kind: 'milestone', is: 'x' }, 'unknown predicate kind: milestone'],
      [{ all: [] }, 'all needs at least one predicate'],
      [{ all: [ready], any: [ready] }, 'a combinator has exactly one of all or any'],
      [{ kind: 'label', has: 'a', extra: 1 }, 'unexpected key extra in label leaf'],
      [null, 'predicate must be an object'],
    ]
    for (const [predicate, problem] of bad) {
      expect(readyPredicateProblems(predicate)).toContain(problem)
      expect(validateSchema(predicate)).toBe(false)
    }
  })

  it('treats inherited property names as unknown kinds, not as leaves', () => {
    for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(readyPredicateProblems({ kind })).toEqual([`unknown predicate kind: ${kind}`])
      expect(() => evaluateReadyPredicate({ kind }, item())).toThrow('invalid ready predicate')
    }
  })

  it('limits nesting to four combinators', () => {
    const leaf = { kind: 'lifecycle', state: 'open' }
    const four = { all: [{ any: [{ all: [{ any: [leaf] }] }] }] }
    expect(readyPredicateProblems(four)).toEqual([])
    expect(readyPredicateProblems({ all: [four] })).toContain('predicate nesting exceeds depth 4')
  })

  it('evaluates each kind with reasons', () => {
    expect(evaluateReadyPredicate(ready, item())).toEqual({ status: 'ready' })
    expect(evaluateReadyPredicate(ready, item({ labels: [] }))).toEqual({
      status: 'not-ready',
      reasons: ['label agentflow:ready missing'],
    })
    expect(
      evaluateReadyPredicate({ kind: 'label', lacks: 'blocked' }, item({ labels: ['blocked'] })),
    ).toEqual({ status: 'not-ready', reasons: ['label blocked present'] })
    expect(evaluateReadyPredicate({ kind: 'status', in: ['todo', 'ready'] }, item())).toEqual({
      status: 'ready',
    })
    expect(
      evaluateReadyPredicate({ kind: 'status', in: ['ready'] }, item({ status: null })),
    ).toEqual({ status: 'not-ready', reasons: ['status none not in [ready]'] })
    expect(evaluateReadyPredicate(ready, item({ lifecycle: 'closed' }))).toEqual({
      status: 'not-ready',
      reasons: ['lifecycle closed is not open'],
    })
  })

  it('combines with any and reports every failed alternative', () => {
    const either = {
      any: [
        { kind: 'label', has: 'agentflow:ready' },
        { kind: 'status', in: ['ready'] },
      ],
    }
    expect(evaluateReadyPredicate(either, item({ labels: [], status: 'ready' }))).toEqual({
      status: 'ready',
    })
    expect(evaluateReadyPredicate(either, item({ labels: [], status: 'todo' }))).toEqual({
      status: 'not-ready',
      reasons: ['label agentflow:ready missing', 'status todo not in [ready]'],
    })
  })

  it('reports unsupported kinds before evaluating anything', () => {
    const mixed = {
      all: [
        { kind: 'status', in: ['x'] },
        { kind: 'label', has: 'missing' },
      ],
    }
    expect(evaluateReadyPredicate(mixed, item(), { supportedKinds: ['label'] })).toEqual({
      status: 'unsupported',
      unsupportedKinds: ['status'],
    })
  })

  it('throws on an invalid predicate', () => {
    expect(() => evaluateReadyPredicate({ kind: 'nope' }, item())).toThrow(
      'invalid ready predicate',
    )
  })
})
