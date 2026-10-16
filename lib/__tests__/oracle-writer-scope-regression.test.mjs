import { describe, expect, it } from 'vitest'
import { resolveOracleDispatch } from '../../adapters/openrig/agentflow-product/oracle-admission.mjs'

describe('oracle scope fail-closed regression addendum #519', () => {
  it.each([
    '**',
    '*',
    '.',
    'tests',
    'tests/',
    './tests',
    './**',
    '**/*',
    '*/**',
    'tests/**/*',
    'tests/orac*',
    '**/oracles/**',
  ])('does not disguise protected work behind broad scope %s', (path) => {
    const task = { goal: 'fixture', owner: 'planner', touchSurface: [path] }
    const result = resolveOracleDispatch({
      deps: {
        resolveOracleTask: () => ({
          verified: true,
          task,
          sourceRef: 'fixture://task',
          sourceRevision: 'one',
        }),
      },
      request: { goal: task.goal },
    })
    expect(result.admitted).toBe(false)
  })
  it('rejects malformed required-capability metadata as unresolved instead of throwing', () => {
    const task = { goal: 'fixture', touchSurface: ['src/file.mjs'], requiredCapabilities: 42 }
    expect(() =>
      resolveOracleDispatch({
        deps: {
          resolveOracleTask: () => ({
            verified: true,
            task,
            sourceRef: 'fixture://task',
            sourceRevision: 'one',
          }),
        },
        request: { goal: task.goal },
      }),
    ).not.toThrow()
  })
})
