import { describe, it, expect } from 'vitest'
import { recoverExecution } from '../recovery.mjs'
import { recordDigest } from '../../../lib/core/record-digest.mjs'
import { fixture, renewCustody } from './recovery-continuation.fixture.mjs'
async function crashed({ beforeTransfer = false, maxAttempts = 2 } = {}) {
  const f = await fixture()
  f.args.policy.maxAttempts = maxAttempts
  f.args.operation.arguments.recoveryPolicyDigest = recordDigest(f.args.policy)
  f.args.renewOracleCustody = (ctx) => renewCustody(f.service, ctx)
  const method = beforeTransfer ? 'resume' : 'executeDelegatedOperation',
    original = f.service[method]
  f.service[method] = async () => {
    throw new Error('fixture crash')
  }
  await recoverExecution(f.args)
  f.service[method] = original
  const snapshot = await f.service.read()
  const authority = { owner: snapshot.state.owner, generation: snapshot.state.generation }
  f.args.operationOptions.expectedRevision = snapshot.revision
  if (!beforeTransfer) f.args.operationOptions.authority = authority
  f.args.recovery.checkpointAuthority = authority
  f.args.recovery.reconciliationAuthority = authority
  f.args.recovery.authority = beforeTransfer ? { owner: 'replacement', generation: 0 } : authority
  return f
}
describe('recovery continuation immutable identity (#522)', () => {
  it('can continue the single already-charged attempt at its maximum budget', async () => {
    const f = await crashed({ maxAttempts: 1 })
    expect((await recoverExecution(f.args)).status).toBe('recovered')
    expect(f.dispatches()).toBe(1)
    expect((await f.service.read()).events.filter((e) => e.payload.recoveryIncident)).toHaveLength(
      1,
    )
  })
  it('resumes exactly once after a crash before transfer, keeping the original charged attempt', async () => {
    const f = await crashed({ beforeTransfer: true })
    expect((await f.service.read()).state.generation).toBe(0)
    expect((await recoverExecution(f.args)).status).toBe('recovered')
    const after = await f.service.read()
    expect(after.state.generation).toBe(1)
    expect(after.events.filter((e) => e.payload.recoveryIncident)).toHaveLength(1)
    expect(f.dispatches()).toBe(1)
  })
  it.each(['writer', 'operation', 'new-operation'])(
    'holds reentry with changed %s without another transfer',
    async (kind) => {
      const f = await crashed()
      if (kind === 'writer') f.args.recovery.writer.instance = 'another-instance'
      if (kind === 'operation') f.args.operation.workspaceDigest = 'f'.repeat(64)
      if (kind === 'new-operation') f.args.operation.id = 'different-operation'
      expect((await recoverExecution(f.args)).status).toBe('held')
      expect((await f.service.read()).state.generation).toBe(1)
      expect(f.dispatches()).toBe(0)
    },
  )
  it('cannot switch failure class to charge the same anchored recovery operation again', async () => {
    const f = await crashed()
    f.args.failure.structuredError = { status: 429 }
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect((await f.service.read()).events.filter((e) => e.payload.recoveryIncident)).toHaveLength(
      1,
    )
    expect(f.dispatches()).toBe(0)
  })
  it('holds a renewal that changes candidate scope instead of only recording custody', async () => {
    const f = await fixture()
    f.args.renewOracleCustody = async (ctx) => {
      await f.service.record(
        'candidate',
        { digest: 'f'.repeat(64) },
        { expectedRevision: (await f.service.read()).revision, authority: ctx.authority },
      )
      await renewCustody(f.service, ctx)
    }
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(f.dispatches()).toBe(0)
  })
})
