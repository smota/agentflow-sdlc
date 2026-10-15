import { expect, it } from 'vitest'
import { parseQueueEnvelope } from '../../adapters/openrig/agentflow-product/handoff-step.mjs'
it.each(['NaN', 'Infinity', '1.5', '-1', '9', 'not-a-number'])(
  'rejects malformed pointer phase %s',
  (value) => {
    expect(() => parseQueueEnvelope(`Envelope-Version: pointer-v1\nPhase: ${value}`)).toThrow()
  },
)
it.each(['NaN', 'Infinity', '1.5', '-1', '0', '9007199254740993'])(
  'rejects malformed legacy pointer epoch %s',
  (value) => {
    expect(() => parseQueueEnvelope(`Envelope-Version: pointer-v1\nEpoch: ${value}`)).toThrow()
  },
)
it('preserves valid zero phase, positive legacy epoch and absent unknown metadata', () => {
  expect(parseQueueEnvelope('Envelope-Version: pointer-v1\nPhase: 0\nEpoch: 1')).toMatchObject({
    phase: 0,
    epoch: 1,
  })
  expect(parseQueueEnvelope('Envelope-Version: pointer-v1')).toMatchObject({
    phase: null,
    epoch: null,
  })
})
