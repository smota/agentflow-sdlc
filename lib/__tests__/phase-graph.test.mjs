import { describe, expect, it } from 'vitest'
import { allowedNext } from '../core/phase-graph.mjs'

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
    expect(allowedNext(returned)).toEqual([4])
    expect(allowedNext([...returned, pass(4)])).toContain(5)
  })

  it('withholds the technical writer after a review skip that returns to phase 4', () => {
    const reviewed = [...planned, pass(4), pass(5), skip(6, 'Return to phase 4.')]
    expect(allowedNext(reviewed)).toEqual([4])
  })
})
