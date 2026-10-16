import { expect, it } from 'vitest'
import { resolveOracleDispatch } from '../../adapters/openrig/agentflow-product/oracle-admission.mjs'
const resolve = (path) => {
  const task = { goal: 'fixture', owner: 'planner', touchSurface: [path] }
  return resolveOracleDispatch({
    deps: {
      resolveOracleTask: () => ({
        verified: true,
        task,
        sourceRef: 'fixture://task',
        sourceRevision: 'one',
      }),
    },
    request: { goal: 'fixture' },
  })
}
it.each([
  'TESTS/ORACLES/data.json',
  'Tests/**/Oracles/*.json',
  './TESTS/',
  'Tests\\Oracles\\data.json',
])(
  'cannot bypass oracle authority through case aliases on a case-insensitive filesystem: %s',
  (path) => {
    expect(resolve(path)).toMatchObject({ admitted: false, status: 'ORACLE_WRITER_MISSING' })
  },
)
it('keeps a narrowly bounded source path outside the protected roots', () => {
  expect(resolve('SRC/component.mjs').admitted).toBe(true)
})
