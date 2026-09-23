import { describe, expect, it } from 'vitest'
import { deriveDependencyCascade } from '../core/gate-ledger.mjs'

describe('gate-ledger (D5 — permission cascades, consent never does)', () => {
  it('a unit with no parent is never blocked', () => {
    const [unit] = deriveDependencyCascade([{ ref: 1, parentRef: null, closed: false }])
    expect(unit.blockedByParent).toBe(false)
  })

  it('a unit is blocked while its parent is open, and unblocked the instant the parent closes', () => {
    const openParent = deriveDependencyCascade([
      { ref: 1, parentRef: null, closed: false },
      { ref: 2, parentRef: 1, closed: false },
    ])
    expect(openParent.find((unit) => unit.ref === 2).blockedByParent).toBe(true)

    const closedParent = deriveDependencyCascade([
      { ref: 1, parentRef: null, closed: true },
      { ref: 2, parentRef: 1, closed: false },
    ])
    const child = closedParent.find((unit) => unit.ref === 2)
    expect(child.blockedByParent).toBe(false)
    // Permission cascaded (the child is unblocked); consent did not (the child's own `closed`
    // field, which nothing here ever touches, is exactly what the caller passed in).
    expect(child.closed).toBe(false)
  })

  it('unblocking one dependent never touches a sibling with a different, still-open parent', () => {
    const units = deriveDependencyCascade([
      { ref: 1, parentRef: null, closed: true },
      { ref: 2, parentRef: null, closed: false },
      { ref: 3, parentRef: 1, closed: false },
      { ref: 4, parentRef: 2, closed: false },
    ])
    expect(units.find((unit) => unit.ref === 3).blockedByParent).toBe(false)
    expect(units.find((unit) => unit.ref === 4).blockedByParent).toBe(true)
  })

  it('a missing/unknown parent reference is treated as still-blocking, never silently unblocked', () => {
    const [child] = deriveDependencyCascade([{ ref: 2, parentRef: 999, closed: false }])
    expect(child.blockedByParent).toBe(true)
  })
})
