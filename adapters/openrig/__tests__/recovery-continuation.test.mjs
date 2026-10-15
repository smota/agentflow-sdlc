import { describe, it, expect } from 'vitest'
import { recoverExecution } from '../recovery.mjs'
import { fixture, renewCustody } from './recovery-continuation.fixture.mjs'

describe('source-owned custody renewal and crash continuation (#522)', () => {
  it('renews actual canonical custody after transfer then reinspects before one lawful admission', async () => {
    const f = await fixture()
    let inspections = 0
    const inspect = f.args.inspectRecoveryContext
    f.args.inspectRecoveryContext = async (ctx) => {
      inspections++
      return inspect(ctx)
    }
    f.args.renewOracleCustody = (ctx) => renewCustody(f.service, ctx)
    const result = await recoverExecution(f.args)
    expect(result.status).toBe('recovered')
    const after = await f.service.read()
    expect(after.state.generation).toBe(1)
    expect(after.state.oracleCustody.author.generation).toBe(1)
    expect(after.events.filter((e) => e.kind === 'resumed')).toHaveLength(1)
    expect(f.dispatches()).toBe(1)
    expect(inspections).toBeGreaterThanOrEqual(2)
  })
  it('ignores renewal return booleans without an actual new source receipt', async () => {
    const f = await fixture()
    f.args.renewOracleCustody = async () => ({ verified: true, custodyVerified: true })
    const result = await recoverExecution(f.args)
    expect(result.status).toBe('held')
    expect(f.dispatches()).toBe(0)
    expect((await f.service.read()).state.admissions).toEqual({})
  })
  it('holds changed post-transfer artifact evidence even with renewed custody', async () => {
    const f = await fixture()
    f.args.renewOracleCustody = (ctx) => renewCustody(f.service, ctx)
    const inspect = f.args.inspectRecoveryContext
    f.args.inspectRecoveryContext = async (ctx) => {
      const receipt = await inspect(ctx)
      if (ctx.state.generation === 1) receipt.artifactDigests.oracle = 'f'.repeat(64)
      return receipt
    }
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(f.dispatches()).toBe(0)
  })
  it('continues the same acknowledged transfer after pre-admission crash without charging or resuming again', async () => {
    const f = await fixture()
    f.args.renewOracleCustody = (ctx) => renewCustody(f.service, ctx)
    const execute = f.service.executeDelegatedOperation
    let crashes = 0
    f.service.executeDelegatedOperation = async () => {
      crashes++
      throw new Error('fixture crash before admission')
    }
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(crashes).toBe(1)
    const snapshot = await f.service.read()
    expect(snapshot.state.generation).toBe(1)
    expect(snapshot.state.oracleCustody.author.generation).toBe(1)
    expect(snapshot.state.admissions).toEqual({})
    f.service.executeDelegatedOperation = execute
    const authority = { owner: 'replacement', generation: 1 }
    f.args.operationOptions = {
      ...f.args.operationOptions,
      expectedRevision: snapshot.revision,
      authority,
    }
    f.args.recovery = {
      ...f.args.recovery,
      checkpointAuthority: authority,
      reconciliationAuthority: authority,
      authority,
    }
    expect((await recoverExecution(f.args)).status).toBe('recovered')
    const after = await f.service.read()
    expect(after.state.generation).toBe(1)
    expect(after.events.filter((e) => e.kind === 'resumed')).toHaveLength(1)
    expect(
      after.events.filter((e) => e.kind === 'checkpoint' && e.payload.recoveryIncident),
    ).toHaveLength(1)
    expect(f.dispatches()).toBe(1)
  })
  it('rejects source state projection custody claims that disagree with original source events', async () => {
    const f = await fixture()
    const read = f.service.read
    f.service.read = async () => {
      const snapshot = await read()
      if (snapshot.state.generation === 1) {
        snapshot.state.oracleCustody = { author: { generation: 1, verified: true } }
      }
      return snapshot
    }
    f.args.renewOracleCustody = async () => ({ verified: true })
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect(f.dispatches()).toBe(0)
  })
  it('holds pinned work without initial source custody before ownership transfer', async () => {
    const f = await fixture({ initialCustody: false })
    expect((await recoverExecution(f.args)).status).toBe('held')
    expect((await f.service.read()).state.generation).toBe(0)
    expect(f.dispatches()).toBe(0)
  })
})
