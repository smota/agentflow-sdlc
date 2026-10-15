import { describe, it, expect } from 'vitest'
import { recoverExecution } from '../recovery.mjs'
import { fixture, renewCustody } from './recovery-continuation.fixture.mjs'
describe('recovery final source fence (#522)', () => {
  it('holds if ownership changes while final readback is in flight', async () => {
    const f = await fixture()
    f.args.renewOracleCustody = (ctx) => renewCustody(f.service, ctx)
    const readback = f.args.readback
    f.args.readback = async (ctx) => {
      const proof = await readback(ctx)
      const plan = await f.service.recoveryPlan({
        owner: 'third-writer',
        boundary: 'external-action',
        writer: { host: 'test', pid: 456, instance: 'third-instance' },
      })
      await f.service.resume({ plan, authority: { owner: 'third-writer', generation: 1 } })
      return proof
    }
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect((await f.service.read()).state.generation).toBe(2)
  })
  it('rejects replacing the original grant on pre-admission continuation before invoking host inspection', async () => {
    const f = await fixture()
    f.args.renewOracleCustody = (ctx) => renewCustody(f.service, ctx)
    const execute = f.service.executeDelegatedOperation
    f.service.executeDelegatedOperation = async () => {
      throw new Error('fixture crash')
    }
    await recoverExecution(f.args)
    f.service.executeDelegatedOperation = execute
    const snapshot = await f.service.read()
    f.args.operationOptions = {
      ...f.args.operationOptions,
      expectedRevision: snapshot.revision,
      authority: { owner: 'replacement', generation: 1 },
      grantId: 'different-grant',
    }
    let inspections = 0
    const inspect = f.args.inspectRecoveryContext
    f.args.inspectRecoveryContext = (ctx) => {
      inspections++
      return inspect(ctx)
    }
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(inspections).toBe(0)
    expect(f.dispatches()).toBe(0)
  })
})
