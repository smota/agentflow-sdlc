import { describe, it, expect } from 'vitest'
import { recoverExecution } from '../recovery.mjs'
import { recordDigest } from '../../../lib/core/record-digest.mjs'
import { fixture, renewCustody } from './recovery-continuation.fixture.mjs'
describe('atomic source attempt and continuation anchor (#522 advisory)', () => {
  it('continues after checkpoint persisted but acknowledgment was lost without a stranded or twice-charged attempt', async () => {
    const f = await fixture()
    f.args.policy.maxAttempts = 1
    f.args.operation.arguments.recoveryPolicyDigest = recordDigest(f.args.policy)
    f.args.renewOracleCustody = (ctx) => renewCustody(f.service, ctx)
    const record = f.service.record
    let dropped = false
    f.service.record = async (...args) => {
      const result = await record(...args)
      if (!dropped && args[0] === 'checkpoint' && args[1].recoveryIncident) {
        dropped = true
        throw new Error('lost checkpoint acknowledgment')
      }
      return result
    }
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(dropped).toBe(true)
    const snapshot = await f.service.read()
    expect(snapshot.state.generation).toBe(0)
    f.service.record = record
    f.args.operationOptions.expectedRevision = snapshot.revision
    expect((await recoverExecution(f.args)).status).toBe('recovered')
    const after = await f.service.read()
    expect(after.events.filter((e) => e.payload.recoveryIncident)).toHaveLength(1)
    expect(after.events.filter((e) => e.kind === 'resumed')).toHaveLength(1)
    expect(f.dispatches()).toBe(1)
  })
  it('cannot change source action boundary as part of a model route recovery', async () => {
    const f = await fixture()
    f.args.renewOracleCustody = (ctx) => renewCustody(f.service, ctx)
    f.args.recovery.boundary = 'mutate-worktree'
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect((await f.service.read()).state.generation).toBe(0)
    expect(f.dispatches()).toBe(0)
  })
})
