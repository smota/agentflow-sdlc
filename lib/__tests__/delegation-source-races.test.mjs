import { describe, it, expect } from 'vitest'
import { createGitHubRunStore, planGitHubCoordination } from '../sources/github-run-store.mjs'
import { createRunService } from '../application/run-service.mjs'
import { createLocalCooperativeIssuer } from '../application/local-cooperative-issuer.mjs'
import { createRunEvent, reduceRun } from '../core/run-state.mjs'
import { issueGrant, grantRequestDigest, operationDigest } from '../core/delegation-grant.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import { fakeGitHub, patchBarrier, awaitPatchBarrier } from './github-run-store.fixture.mjs'

const now = '2026-09-25T10:00:00.000Z'
const candidateDigest = 'c'.repeat(64)
const policy = {
  version: 1,
  issuers: [
    {
      id: 'operator',
      origin: 'local:test',
      authorityRef: 'local:approval',
      mode: 'local-cooperative',
      allowedActions: ['push'],
      allowThroughMerge: false,
    },
  ],
  requiredChecks: ['tests'],
  reviewPolicy: 'automated',
  materiality: 'fixed-scope-v1',
  allowSubdelegation: false,
  safetyReserve: 2,
}
const eventFor = (state, kind, payload, id) =>
  createRunEvent({
    runId: 'demo',
    id,
    kind,
    payload,
    previousDigest: state?.revision ?? null,
    generation: state?.generation ?? 0,
    timestamp: now,
  })
const operation = (id) => ({
  id,
  planDigest: 'a'.repeat(64),
  policyDigest: recordDigest(policy),
  repository: 'test/repo',
  base: 'main',
  delegate: 'delegate',
  action: 'push',
  paths: ['src/main.js'],
  capabilities: ['push'],
  candidateDigest,
  workspaceDigest: 'd'.repeat(64),
  checks: [{ name: 'tests', outcome: 'pass', candidateDigest }],
  review: { outcome: 'pass', policy: 'automated', candidateDigest },
  arguments: { remote: 'origin' },
})
async function fixture() {
  const fake = fakeGitHub()
  const setupConfirm = (await planGitHubCoordination({ repo: 'test/repo', client: fake.client }))
    .digest
  const store = () =>
    createGitHubRunStore({
      repo: 'test/repo',
      runId: 'demo',
      client: fake.client,
      boundary: 'external-action',
      setupConfirm,
    })
  let state = null
  const append = async (kind, payload, id) => {
    const result = await store().append(eventFor(state, kind, payload, id), state?.revision ?? null)
    state = reduceRun(result.events)
  }
  await append(
    'started',
    {
      goalRef: 'issue:1',
      owner: 'writer',
      profile: 'standard',
      boundary: 'external-action',
      delegationPolicy: policy,
    },
    'start',
  )
  await append('candidate', { digest: candidateDigest }, 'candidate')
  const request = {
    planDigest: 'a'.repeat(64),
    policyDigest: recordDigest(policy),
    repository: 'test/repo',
    base: 'main',
    delegate: 'delegate',
    allowedPaths: ['src/*'],
    allowedActions: ['push'],
    capabilities: ['push'],
    maxAttempts: 1,
    maxExternalEffects: 1,
    expiry: '2026-09-26T10:00:00.000Z',
    issuerMode: 'local-cooperative',
    requiredChecks: ['tests'],
    reviewPolicy: 'automated',
    materiality: 'fixed-scope-v1',
    allowSubdelegation: false,
  }
  request.issuerBinding = {
    type: 'delegation-issuance',
    issuerId: 'operator',
    mode: 'local-cooperative',
    origin: 'local:test',
    authorityRef: 'local:approval',
    policyDigest: request.policyDigest,
    requestDigest: grantRequestDigest(request),
    decisionRef: 'approval:1',
  }
  const grant = issueGrant(request, 'operator', null, { atTime: now, policy, id: 'grant' })
  await append('grant-issued', { grant }, 'grant-issued')
  return { fake, store, state, grant }
}
function admission(state, id) {
  const op = operation(id)
  const g = state.grants.grant
  return eventFor(
    state,
    'operation-admitted',
    {
      grantId: 'grant',
      grantRevision: g.revision,
      grantEpoch: g.revocationEpoch,
      runRevision: state.revision,
      generation: state.generation,
      writer: state.owner,
      operation: op,
      operationDigest: operationDigest(op),
      authorization: {
        type: 'delegation-resolution',
        grantId: 'grant',
        grantRevision: g.revision,
        issuerId: g.envelope.binding.issuerBinding.issuerId,
        mode: g.envelope.binding.issuerBinding.mode,
        origin: g.envelope.binding.issuerBinding.origin,
        authorityRef: g.envelope.binding.issuerBinding.authorityRef,
        policyDigest: g.envelope.binding.policyDigest,
        decisionRef: 'approval:resolve',
        operationDigest: operationDigest(op),
        delegate: op.delegate,
      },
    },
    id,
  )
}
function assertDivergentParents(fake, barrier, base) {
  expect(barrier.writes).toHaveLength(2)
  expect(barrier.writes.map(({ body }) => fake.objects.get(body.sha).parents)).toEqual([
    [base],
    [base],
  ])
  expect(barrier.writes.every(({ body }) => body.force === false)).toBe(true)
  expect(new Set(barrier.writes.map(({ body }) => body.sha)).size).toBe(2)
}

describe('delegated admission source linearization', () => {
  it('allows exactly one of two concurrent admissions from the same grant/run revision', async () => {
    const { fake, store, state } = await fixture()
    const base = fake.refs.get('agentflow-state')
    const barrier = patchBarrier(fake)
    const events = [admission(state, 'left'), admission(state, 'right')]
    const attempts = events.map((event) => store().append(event, state.revision))
    const settled = Promise.allSettled(attempts)
    await awaitPatchBarrier(barrier, attempts)
    assertDivergentParents(fake, barrier, base)
    barrier.writes[1].release.resolve()
    await attempts[1]
    barrier.writes[0].release.resolve()
    const outcomes = await settled
    expect(outcomes.map((result) => result.status)).toEqual(['rejected', 'fulfilled'])
    const snapshot = await store().read()
    expect(snapshot.events.filter((event) => event.kind === 'operation-admitted')).toEqual([
      events[1],
    ])
    expect(reduceRun(snapshot.events).grants.grant.budgetUsed).toEqual({
      attempts: 1,
      externalEffects: 1,
    })
  })

  it.each(['revoke', 'admit'])(
    'serializes concurrent revoke/admit with %s winning',
    async (winner) => {
      const { fake, store, state } = await fixture()
      const base = fake.refs.get('agentflow-state')
      const barrier = patchBarrier(fake)
      const events = [
        eventFor(state, 'grant-revoked', { id: 'grant', reason: 'operator stop' }, 'revoke'),
        admission(state, 'admit'),
      ]
      const attempts = events.map((event) => store().append(event, state.revision))
      const settled = Promise.allSettled(attempts)
      await awaitPatchBarrier(barrier, attempts)
      assertDivergentParents(fake, barrier, base)
      const index = winner === 'revoke' ? 0 : 1
      barrier.writes[index].release.resolve()
      await attempts[index]
      barrier.writes[1 - index].release.resolve()
      const outcomes = await settled
      expect(outcomes[index].status).toBe('fulfilled')
      expect(outcomes[1 - index].status).toBe('rejected')
      fake.hooks.beforePatch = null
      let latest = reduceRun((await store().read()).events)
      if (winner === 'admit') {
        const revoke = eventFor(
          latest,
          'grant-revoked',
          { id: 'grant', reason: 'operator stop' },
          'revoke-replanned',
        )
        latest = reduceRun((await store().append(revoke, latest.revision)).events)
      }
      expect(latest.grants.grant.status).toBe('revoked')
      expect(latest.grants.grant.budgetUsed.externalEffects).toBe(winner === 'admit' ? 1 : 0)
      const writesBefore = fake.requests.filter((request) => request.method).length
      await expect(
        store().append(admission(latest, 'after-revocation'), latest.revision),
      ).rejects.toThrow(/REVOKED|revoked/)
      expect(fake.requests.filter((request) => request.method)).toHaveLength(writesBefore)
    },
  )

  it.each(['writer', 'generation', 'runRevision', 'grantRevision', 'grantEpoch'])(
    'rejects stale %s expectations before source mutation',
    async (field) => {
      const { fake, store, state } = await fixture()
      const good = admission(state, 'stale')
      const payload = {
        ...good.payload,
        [field]: ['generation', 'grantEpoch'].includes(field) ? 99 : 'stale',
      }
      const writesBefore = fake.requests.filter((request) => request.method).length
      await expect(
        store().append(eventFor(state, 'operation-admitted', payload, 'stale'), state.revision),
      ).rejects.toThrow()
      expect(fake.requests.filter((request) => request.method)).toHaveLength(writesBefore)
    },
  )
})

describe('delegated admission ambiguous source outcomes', () => {
  it('reconciles the exact admission after successful PATCH loses its response', async () => {
    const { fake, store, state } = await fixture()
    const event = admission(state, 'lost-response')
    fake.uncertain = true
    const result = await store().append(event, state.revision)
    expect(result.events.filter((item) => item.id === event.id)).toEqual([event])
    expect(fake.requests.filter((request) => request.method === 'PATCH')).toHaveLength(3)
    await store().append(event, state.revision)
    expect(fake.requests.filter((request) => request.method === 'PATCH')).toHaveLength(3)
    const different = eventFor(
      state,
      'operation-admitted',
      { ...event.payload, writer: 'different' },
      event.id,
    )
    await expect(store().append(different, state.revision)).rejects.toThrow(/Conflicting event/)
  })

  it.each([false, true])(
    'keeps admission unacknowledged when PATCH success=%s and the subsequent read fails',
    async (succeed) => {
      const { fake, store, state } = await fixture()
      const event = admission(state, 'uncertain')
      const original = fake.client.request.bind(fake.client)
      let patchAttempted = false
      let failedReads = 0
      fake.client.request = async (path, options = {}) => {
        if (options.method === 'PATCH') {
          patchAttempted = true
          if (succeed) return original(path, options)
          throw new Error('PATCH unavailable')
        }
        if (patchAttempted && !options.method && path.endsWith('/git/ref/heads/agentflow-state')) {
          failedReads++
          throw new Error('Confirmation unavailable')
        }
        return original(path, options)
      }
      await expect(store().append(event, state.revision)).rejects.toThrow()
      expect(patchAttempted).toBe(true)
      expect(failedReads).toBeGreaterThan(0)
      fake.client.request = original
      const later = await store().read()
      expect(later.events.some((item) => item.digest === event.digest)).toBe(succeed)
      if (succeed) {
        const writes = fake.requests.filter((request) => request.method).length
        expect((await store().append(event, state.revision)).events.at(-1)).toEqual(event)
        expect(fake.requests.filter((request) => request.method)).toHaveLength(writes)
      }
    },
  )
})

const authority = { owner: 'writer', generation: 0 }
function serviceFor(store, approve = async () => ({ approved: true, decisionRef: 'approval:1' })) {
  const issuer = createLocalCooperativeIssuer({
    policy,
    issuerId: 'operator',
    approve,
  })
  return createRunService({
    store,
    delegationPolicy: policy,
    clock: () => now,
    authorize: (context) =>
      ['issue-grant', 'resolve-grant', 'revoke-grant'].includes(context.kind)
        ? issuer(context)
        : true,
  })
}

describe('actual delegated dispatch waits for source acknowledgement', () => {
  it('keeps admitted identity stable across caller changes during asynchronous approval', async () => {
    const { store, state } = await fixture()
    let arrived, release
    const entered = new Promise((resolve) => {
      arrived = resolve
    })
    const held = new Promise((resolve) => {
      release = resolve
    })
    const service = serviceFor(store(), async () => {
      arrived()
      await held
      return { approved: true, decisionRef: 'approval:stable' }
    })
    const op = operation('stable')
    const expected = structuredClone(op)
    let dispatched
    const executing = service.executeDelegatedOperation(
      op,
      {
        expectedRevision: state.revision,
        authority,
        grantId: 'grant',
      },
      async (value) => {
        dispatched = value
      },
    )
    await entered
    op.paths = ['other-directory/file.txt']
    op.arguments.remote = 'changed-remote'
    release()
    await executing
    const persisted = reduceRun((await store().read()).events)
    expect(dispatched).toEqual(expected)
    expect(persisted.admissions.stable.operation).toEqual(expected)
    expect(persisted.operations.stable.payloadDigest).toBe(operationDigest(dispatched))
  })
  it.each(['admit/admit', 'revoke-first', 'admit-first'])(
    'counts dispatch across concurrent service %s operations',
    async (scenario) => {
      const { fake, store, state } = await fixture()
      const first = serviceFor(store()),
        second = serviceFor(store())
      const barrier = patchBarrier(fake)
      const base = fake.refs.get('agentflow-state')
      let dispatches = 0
      const dispatch = async () => {
        dispatches++
      }
      const options = { expectedRevision: state.revision, authority, grantId: 'grant' }
      const attempts =
        scenario === 'admit/admit'
          ? [
              first.executeDelegatedOperation(operation('left'), options, dispatch),
              second.executeDelegatedOperation(operation('right'), options, dispatch),
            ]
          : [
              first.revokeGrant('grant', 'operator stop', options),
              second.executeDelegatedOperation(operation('right'), options, dispatch),
            ]
      const settled = Promise.allSettled(attempts)
      await awaitPatchBarrier(barrier, attempts)
      assertDivergentParents(fake, barrier, base)
      expect(dispatches).toBe(0)
      // Release one existing waiter; subsequent planned/submitted writes may proceed.
      fake.hooks.beforePatch = null
      const winner = scenario === 'revoke-first' ? 0 : 1
      barrier.writes[winner].release.resolve()
      await attempts[winner]
      barrier.writes[1 - winner].release.resolve()
      const outcomes = await settled
      expect(outcomes[winner].status).toBe('fulfilled')
      expect(outcomes[1 - winner].status).toBe('rejected')
      expect(dispatches).toBe(scenario === 'revoke-first' ? 0 : 1)
      if (scenario === 'revoke-first') {
        const latest = (await store().read()).revision
        await expect(
          second.executeDelegatedOperation(
            operation('after-stop'),
            { ...options, expectedRevision: latest },
            dispatch,
          ),
        ).rejects.toThrow(/REVOKED|revoked/)
        expect(dispatches).toBe(0)
      }
    },
  )

  it('dispatches only after admitted/planned/submitted records are acknowledged, and never redispatches replay', async () => {
    const { fake, store, state } = await fixture()
    const service = serviceFor(store())
    const barrier = patchBarrier(fake, 1)
    let dispatches = 0
    const op = operation('execute')
    const dispatch = async (actual, receipt) => {
      dispatches++
      expect(actual).toEqual(op)
      const current = reduceRun((await store().read()).events)
      expect(current.admissions[op.id].eventDigest).toBe(receipt.eventDigest)
      expect(current.operations[op.id].state).toBe('submitted')
      return { result: 'sent' }
    }
    const attempt = service.executeDelegatedOperation(
      op,
      { expectedRevision: state.revision, authority, grantId: 'grant' },
      dispatch,
    )
    const settled = Promise.allSettled([attempt])
    await awaitPatchBarrier(barrier, [attempt])
    expect(dispatches).toBe(0)
    expect(reduceRun((await store().read()).events).admissions[op.id]).toBeUndefined()
    fake.hooks.beforePatch = null
    barrier.writes[0].release.resolve()
    expect((await attempt).admitted).toBe(true)
    expect(dispatches).toBe(1)
    expect(
      (
        await service.executeDelegatedOperation(
          op,
          { expectedRevision: state.revision, authority, grantId: 'grant' },
          dispatch,
        )
      ).replayed,
    ).toBe(true)
    expect(dispatches).toBe(1)
    await expect(
      service.executeDelegatedOperation(
        { ...op, arguments: { remote: 'different' } },
        { expectedRevision: state.revision, authority, grantId: 'grant' },
        dispatch,
      ),
    ).rejects.toThrow(/Conflicting operation ID/)
    expect(dispatches).toBe(1)
  })

  it('dispatches once after a lost successful PATCH response is reconciled to the exact event', async () => {
    const { fake, store, state } = await fixture()
    const service = serviceFor(store())
    let dispatches = 0
    fake.uncertain = true
    const result = await service.executeDelegatedOperation(
      operation('lost'),
      { expectedRevision: state.revision, authority, grantId: 'grant' },
      async (_operation, receipt) => {
        dispatches++
        const snapshot = await store().read()
        expect(
          snapshot.events.some(
            (event) => event.id === receipt.eventId && event.digest === receipt.eventDigest,
          ),
        ).toBe(true)
      },
    )
    expect(result.admitted).toBe(true)
    expect(dispatches).toBe(1)
    expect(
      (await store().read()).events.filter((event) => event.kind === 'operation-admitted'),
    ).toHaveLength(1)
  })

  it.each([false, true])(
    'leaves dispatch at zero while PATCH success=%s has unavailable confirmation/reconciliation',
    async (succeed) => {
      const { fake, store, state } = await fixture()
      const service = serviceFor(store())
      const original = fake.client.request.bind(fake.client)
      let patchAttempted = false
      let failedReads = 0
      let dispatches = 0
      fake.client.request = async (path, options = {}) => {
        if (options.method === 'PATCH') {
          patchAttempted = true
          if (succeed) return original(path, options)
          throw new Error('PATCH unavailable')
        }
        if (patchAttempted && !options.method && path.endsWith('/git/ref/heads/agentflow-state')) {
          failedReads++
          throw new Error('Confirmation unavailable')
        }
        return original(path, options)
      }
      const op = operation('pending')
      const options = { expectedRevision: state.revision, authority, grantId: 'grant' }
      const dispatch = async () => {
        dispatches++
      }
      const error = await service.executeDelegatedOperation(op, options, dispatch).then(
        () => null,
        (error) => error,
      )
      expect(error).toBeInstanceOf(Error)
      expect(error.pendingEvent.kind).toBe('operation-admitted')
      expect(patchAttempted).toBe(true)
      expect(failedReads).toBeGreaterThan(0)
      expect(dispatches).toBe(0)
      fake.client.request = original
      const outcome = await service.reconcileAdmission(error.pendingEvent)
      expect(outcome.state).toBe(succeed ? 'acknowledged' : 'unknown')
      expect(dispatches).toBe(0)
      if (succeed) {
        expect(outcome.event.digest).toBe(error.pendingEvent.digest)
        expect(outcome.requiresOperationReconciliation).toBe(true)
        expect((await service.executeDelegatedOperation(op, options, dispatch)).replayed).toBe(true)
        expect(dispatches).toBe(0)
        const conflict = eventFor(
          state,
          'operation-admitted',
          { ...error.pendingEvent.payload, writer: 'other' },
          error.pendingEvent.id,
        )
        await expect(service.reconcileAdmission(conflict)).rejects.toThrow(
          /Conflicting admission identity/,
        )
      }
    },
  )
})

describe('source capacity reserved for safety records', () => {
  it('denies business writes at the reserved boundary while two safety checkpoints still fit', async () => {
    const { fake, store, state } = await fixture()
    const source = store()
    const snapshot = await source.read()
    const businessLimit = 1024 * 1024 - 2 * 4096
    const empty = eventFor(state, 'checkpoint', { note: '' }, 'fill')
    const overhead = Buffer.byteLength(JSON.stringify([...snapshot.events, empty]))
    const fill = eventFor(
      state,
      'checkpoint',
      { note: 'x'.repeat(businessLimit - overhead) },
      'fill',
    )
    let result = await source.append(fill, state.revision)
    expect(Buffer.byteLength(JSON.stringify(result.events))).toBe(businessLimit)
    let latest = reduceRun(result.events)
    let writesBefore = fake.requests.filter((request) => request.method).length
    await expect(
      source.append(
        eventFor(latest, 'checkpoint', { note: 'business' }, 'overflow'),
        latest.revision,
      ),
    ).rejects.toThrow(/bounded record size/)
    expect(fake.requests.filter((request) => request.method)).toHaveLength(writesBefore)
    for (const id of ['safety-one', 'safety-two']) {
      const event = eventFor(
        latest,
        'delegation-safety',
        { id, kind: 'checkpoint', reason: 's'.repeat(1800) },
        id,
      )
      result = await source.append(event, latest.revision)
      latest = reduceRun(result.events)
      expect(Buffer.byteLength(JSON.stringify(result.events))).toBeGreaterThan(businessLimit)
      expect(Buffer.byteLength(JSON.stringify(result.events))).toBeLessThan(1024 * 1024)
    }
    expect(latest.safetyUsed).toBe(2)
    writesBefore = fake.requests.filter((request) => request.method).length
    await expect(
      source.append(
        eventFor(
          latest,
          'delegation-safety',
          { id: 'third', kind: 'checkpoint', reason: 'stop' },
          'third',
        ),
        latest.revision,
      ),
    ).rejects.toThrow(/Safety reserve exhausted/)
    expect(fake.requests.filter((request) => request.method)).toHaveLength(writesBefore)
  })
})
