import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv from 'ajv'
import {
  issueGrant,
  grantRequestDigest,
  operationDigest,
  resolveGrant,
  validateDelegationPolicy,
} from '../core/delegation-grant.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import { createRunEvent, reduceRun } from '../core/run-state.mjs'
import { createRunService } from '../application/run-service.mjs'
import { createLocalCooperativeIssuer } from '../application/local-cooperative-issuer.mjs'

const time = '2026-09-25T12:00:00.000Z'
const expiry = '2026-09-26T12:00:00.000Z'
const candidate = 'c'.repeat(64)
const policy = () => ({
  version: 1,
  issuers: [
    {
      id: 'local',
      origin: 'desktop:approval',
      authorityRef: 'host:approval',
      mode: 'local-cooperative',
      allowedActions: ['edit', 'commit', 'push', 'pr:create', 'merge'],
      allowThroughMerge: true,
    },
  ],
  requiredChecks: ['test'],
  reviewPolicy: 'automated',
  materiality: 'fixed-scope-v1',
  allowSubdelegation: true,
  safetyReserve: 2,
})
const request = (p, overrides = {}) => ({
  planDigest: 'a'.repeat(64),
  policyDigest: recordDigest(p),
  repository: 'test/repo',
  base: 'development',
  delegate: 'codex',
  allowedPaths: ['src/*'],
  allowedActions: ['push', 'merge'],
  capabilities: ['push', 'merge'],
  requiredChecks: ['test'],
  reviewPolicy: 'automated',
  materiality: 'fixed-scope-v1',
  allowSubdelegation: true,
  maxAttempts: 3,
  maxExternalEffects: 3,
  expiry,
  issuerMode: 'local-cooperative',
  ...overrides,
})
const bind = (r, p) => ({
  ...r,
  issuerBinding: {
    type: 'delegation-issuance',
    issuerId: p.issuers[0].id,
    mode: p.issuers[0].mode,
    origin: p.issuers[0].origin,
    authorityRef: p.issuers[0].authorityRef,
    policyDigest: recordDigest(p),
    requestDigest: grantRequestDigest(r),
    decisionRef: 'approval:1',
  },
})
const operation = (p, overrides = {}) => ({
  id: 'op1',
  planDigest: 'a'.repeat(64),
  policyDigest: recordDigest(p),
  repository: 'test/repo',
  base: 'development',
  delegate: 'codex',
  action: 'push',
  paths: ['src/file.js'],
  capabilities: ['push'],
  candidateDigest: candidate,
  workspaceDigest: 'd'.repeat(64),
  checks: [{ name: 'test', outcome: 'pass', candidateDigest: candidate }],
  review: { policy: 'automated', outcome: 'pass', candidateDigest: candidate },
  arguments: { remote: 'origin', branch: 'feature' },
  ...overrides,
})
function fixture(overrides = {}, policyOverrides = {}) {
  const p = { ...policy(), ...policyOverrides }
  const events = []
  let sequence = 0
  const add = (kind, payload, at = time) => {
    const state = reduceRun(events)
    const e = createRunEvent({
      runId: 'run',
      id: `event-${++sequence}`,
      kind,
      payload,
      timestamp: at,
      previousDigest: state?.revision ?? null,
      generation: state?.generation ?? 0,
    })
    reduceRun([...events, e])
    events.push(e)
    return e
  }
  add('started', {
    goalRef: 'issue:263',
    owner: 'writer',
    profile: 'standard',
    boundary: 'external-action',
    delegationPolicy: p,
  })
  add('candidate', { digest: candidate })
  const grant = issueGrant(bind(request(p, overrides), p), 'local', null, {
    atTime: time,
    policy: p,
    id: 'grant',
  })
  add('grant-issued', { grant })
  const admission = (op = operation(p), grantId = 'grant', mutate = {}) => {
    const s = reduceRun(events),
      g = s.grants[grantId]
    return {
      authorization: {
        ...g.envelope.binding.issuerBinding,
        type: 'delegation-resolution',
        grantId,
        grantRevision: g.revision,
        operationDigest: operationDigest(op),
        delegate: op.delegate,
      },
      grantId,
      grantRevision: g.revision,
      grantEpoch: g.revocationEpoch,
      writer: s.owner,
      runRevision: s.revision,
      generation: s.generation,
      operation: op,
      operationDigest: operationDigest(op),
      ...mutate,
    }
  }
  return { p, events, add, grant, admission, state: () => reduceRun(events) }
}

describe('production delegation contract and authoritative reducer', () => {
  it('publishes a valid structural schema for actual issued envelopes', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../schemas/delegation-grant.schema.json', import.meta.url), 'utf8'),
    )
    const validate = new Ajv().compile(schema)
    const f = fixture()
    expect(validate(f.grant), JSON.stringify(validate.errors)).toBe(true)
    expect(validate({ ...f.grant, expiry: expiry })).toBe(false)
  })
  it('requires persisted typed origin resolution at the reducer boundary', () => {
    const f = fixture(),
      p = f.admission()
    delete p.authorization
    expect(() => f.add('operation-admitted', p)).toThrow(/Typed/)
    p.authorization = { ...f.admission().authorization, origin: 'agent-forged' }
    expect(() => f.add('operation-admitted', p)).toThrow(/Typed/)
  })
  it('admits cooperative through-merge under explicit policy and replays historical expiry deterministically', () => {
    const f = fixture()
    f.add(
      'operation-admitted',
      f.admission(operation(f.p, { action: 'merge', capabilities: ['merge'] })),
    )
    expect(f.state().grants.grant.budgetUsed).toEqual({ attempts: 1, externalEffects: 1 })
    expect(reduceRun(JSON.parse(JSON.stringify(f.events)))).toEqual(f.state())
  })
  it.each(['origin', 'authorityRef', 'issuerId', 'requestDigest', 'policyDigest'])(
    'rejects forged issuer %s in reducer',
    (field) => {
      const f = fixture()
      const grant = structuredClone(f.grant)
      grant.id = 'forged'
      grant.binding.issuerBinding[field] = 'forged'
      expect(() => f.add('grant-issued', { grant })).toThrow()
    },
  )
  it.each(['trusted-host', 'not-available'])('refuses unsupported assurance %s', (issuerMode) => {
    const p = policy()
    expect(() =>
      issueGrant(bind(request(p, { issuerMode }), p), 'local', null, { atTime: time, policy: p }),
    ).toThrow(/UNSUPPORTED/)
  })
  it.each([0, 100, null, {}, { provider: 'claimed', enforced: true }])(
    'rejects unqualified hard ceiling %j at issuance',
    (hardCeiling) => {
      const p = policy()
      expect(() =>
        issueGrant(bind(request(p, { hardCeiling }), p), 'local', null, {
          atTime: time,
          policy: p,
        }),
      ).toThrow(/UNSUPPORTED/)
    },
  )
  it('denies merge without configured cooperative permission', () => {
    const p = policy()
    p.issuers[0].allowThroughMerge = false
    expect(() =>
      issueGrant(bind(request(p), p), 'local', null, { atTime: time, policy: p }),
    ).toThrow(/Through-merge/)
  })
  it.each(['planDigest', 'policyDigest', 'repository', 'base', 'delegate', 'candidateDigest'])(
    'rejects operation %s mismatch at authoritative admission',
    (field) => {
      const f = fixture()
      const value = field.endsWith('Digest') ? 'e'.repeat(64) : 'other'
      expect(() =>
        f.add('operation-admitted', f.admission(operation(f.p, { [field]: value }))),
      ).toThrow()
    },
  )
  it.each([
    '../secret',
    '/root/file',
    'src/../secret',
    'src//file',
    'src/./file',
    'C:/file',
    '\\\\host\\share',
    'src/file.',
    'src/file ',
    'src/file\0',
  ])('rejects path %s', (path) => {
    const f = fixture()
    expect(() =>
      f.add('operation-admitted', f.admission(operation(f.p, { paths: [path] }))),
    ).toThrow()
  })
  it('rejects duplicate expiry envelope instead of reading a weaker copy', () => {
    const f = fixture()
    const grant = { ...f.grant, id: 'other', expiry: '2099-01-01T00:00:00.000Z' }
    expect(() => f.add('grant-issued', { grant })).toThrow(/Unknown grant/)
  })
  it('rejects presented grant tampering', () => {
    const f = fixture(),
      forged = structuredClone(f.grant)
    forged.binding.expiry = '2099-01-01T00:00:00.000Z'
    expect(resolveGrant(forged, f.state(), operation(f.p), time).admitted).toBe(false)
  })
  it('rejects expired and revoked admissions', () => {
    const f = fixture()
    expect(() => f.add('operation-admitted', f.admission(), expiry)).toThrow(/EXPIRED/)
    f.add('grant-revoked', { id: 'grant', reason: 'operator stop' })
    expect(() => f.add('operation-admitted', f.admission())).toThrow(/REVOKED/)
  })
  it.each([
    'grantRevision',
    'grantEpoch',
    'runRevision',
    'generation',
    'writer',
    'operationDigest',
  ])('rejects forged transaction %s', (field) => {
    const f = fixture()
    expect(() =>
      f.add('operation-admitted', f.admission(undefined, 'grant', { [field]: 'wrong' })),
    ).toThrow()
  })
  it('derives external effect classification despite caller-supplied false', () => {
    const f = fixture({ maxExternalEffects: 1 })
    f.add('operation-admitted', f.admission(undefined, 'grant', { isExternalEffect: false }))
    expect(f.state().grants.grant.budgetUsed.externalEffects).toBe(1)
    expect(() => f.add('operation-admitted', f.admission(operation(f.p, { id: 'op2' })))).toThrow(
      /BUDGET/,
    )
  })
  it('binds full arguments, candidate, workspace, and review in operation digest', () => {
    const p = policy(),
      op = operation(p),
      original = operationDigest(op)
    for (const patch of [
      { arguments: { remote: 'evil' } },
      { candidateDigest: 'b'.repeat(64) },
      { workspaceDigest: 'e'.repeat(64) },
      { review: { ...op.review, outcome: 'fail' } },
    ])
      expect(operationDigest({ ...op, ...patch })).not.toBe(original)
  })
  it('rejects unknown operation fields and nonfinite payloads', () => {
    const p = policy()
    expect(() => operationDigest(operation(p, { isExternalEffect: false }))).toThrow(/Unknown/)
    expect(() => operationDigest(operation(p, { arguments: { number: Infinity } }))).toThrow(
      /finite/,
    )
  })
  it.each([
    { checks: [] },
    { review: { policy: 'automated', outcome: 'pass', candidateDigest: 'a'.repeat(64) } },
    { capabilities: [] },
    { capabilities: ['push', 'admin'] },
  ])('rejects missing checks, stale review, and capability widening %j', (patch) => {
    const f = fixture()
    expect(() => f.add('operation-admitted', f.admission(operation(f.p, patch)))).toThrow()
  })
  it('cannot mint children against revoked grandparent and conserves sibling reservations', () => {
    const f = fixture({ maxAttempts: 3, maxExternalEffects: 3 })
    const child = issueGrant(
      bind(
        request(f.p, { allowedPaths: ['src/sub/*'], maxAttempts: 2, maxExternalEffects: 2 }),
        f.p,
      ),
      'local',
      f.grant,
      { atTime: time, policy: f.p, id: 'child' },
    )
    f.add('grant-issued', { grant: child })
    expect(f.state().grants.grant.budgetReserved).toEqual({ attempts: 2, externalEffects: 2 })
    const sibling = { ...child, id: 'sibling' }
    expect(() => f.add('grant-issued', { grant: sibling })).toThrow(/remaining parent budget/)
    f.add('operation-admitted', f.admission())
    expect(() => f.add('operation-admitted', f.admission(operation(f.p, { id: 'op2' })))).toThrow(
      /BUDGET/,
    )
    f.add(
      'operation-admitted',
      f.admission(operation(f.p, { id: 'child-op', paths: ['src/sub/file'] }), 'child'),
    )
    f.add('grant-revoked', { id: 'grant', reason: 'stop' })
    const grandchild = issueGrant(
      bind(
        request(f.p, { allowedPaths: ['src/sub/file'], maxAttempts: 1, maxExternalEffects: 1 }),
        f.p,
      ),
      'local',
      child,
      { atTime: time, policy: f.p, id: 'grandchild' },
    )
    expect(() => f.add('grant-issued', { grant: grandchild })).toThrow(/REVOKED/)
    expect(() =>
      f.add(
        'operation-admitted',
        f.admission(operation(f.p, { id: 'child-op2', paths: ['src/sub/file'] }), 'child'),
      ),
    ).toThrow(/REVOKED/)
  })
  it.each([
    { allowedPaths: ['other/*'] },
    { maxAttempts: 4 },
    { expiry: '2099-01-01T00:00:00.000Z' },
    { delegate: 'other' },
    { requiredChecks: [] },
  ])('rejects narrowed child violations %j', (patch) => {
    const f = fixture()
    expect(() =>
      issueGrant(bind(request(f.p, patch), f.p), 'local', f.grant, {
        atTime: time,
        policy: f.p,
        id: 'child',
      }),
    ).toThrow()
  })
  it('rejects missing/cyclic ancestry and unsafe map IDs', () => {
    const f = fixture()
    const s = f.state()
    s.grants.grant.envelope.parentId = 'missing'
    expect(resolveGrant(s.grants.grant.envelope, s, operation(f.p), time).reason).toMatch(/Missing/)
    s.grants.grant.envelope.parentId = 'grant'
    expect(resolveGrant(s.grants.grant.envelope, s, operation(f.p), time).reason).toMatch(/cyclic/)
    expect(() => f.add('grant-issued', { grant: { ...f.grant, id: '__proto__' } })).toThrow()
  })
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed budget %s',
    (maxAttempts) => {
      const p = policy()
      expect(() =>
        issueGrant(bind(request(p, { maxAttempts }), p), 'local', null, {
          atTime: time,
          policy: p,
        }),
      ).toThrow()
    },
  )
  it('keeps bounded safety capacity after business exhaustion without widening authority', () => {
    const f = fixture({ maxAttempts: 1 })
    f.add('operation-admitted', f.admission())
    f.add('delegation-safety', { id: 'safe-1', kind: 'checkpoint', reason: 'budget exhausted' })
    f.add('delegation-safety', {
      id: 'safe-2',
      kind: 'reconcile',
      reason: 'check prior',
      operationId: 'op1',
    })
    expect(() => f.add('operation-admitted', f.admission(operation(f.p, { id: 'op2' })))).toThrow(
      /BUDGET/,
    )
    expect(() =>
      f.add('delegation-safety', { id: 'safe-3', kind: 'checkpoint', reason: 'again' }),
    ).toThrow(/reserve/)
    const g = fixture()
    expect(() =>
      g.add('delegation-safety', {
        id: 'evil',
        kind: 'checkpoint',
        reason: 'spoof',
        maxAttempts: 100,
      }),
    ).toThrow(/Invalid safety/)
  })
  it('denies duplicate operation ID even with changed payload', () => {
    const f = fixture()
    f.add('operation-admitted', f.admission())
    expect(() =>
      f.add('operation-admitted', f.admission(operation(f.p, { arguments: { remote: 'other' } }))),
    ).toThrow(/already admitted/)
  })
})

async function serviceFixture({
  boolean = false,
  capable = true,
  reconcileOperation,
  approve = async () => ({ approved: true, decisionRef: 'approval:1' }),
} = {}) {
  const p = policy()
  let events = []
  const store = {
    durable: true,
    ...(capable ? { conditionalAdmission: 'single-parent-run-chain-v1' } : {}),
    async read() {
      return { events: structuredClone(events), revision: reduceRun(events)?.revision ?? null }
    },
    async append(e, expected) {
      if ((reduceRun(events)?.revision ?? null) !== expected) throw new Error('conflict')
      reduceRun([...events, e])
      events.push(e)
    },
  }
  const issuer = createLocalCooperativeIssuer({
    policy: p,
    issuerId: 'local',
    approve,
  })
  const service = createRunService({
    store,
    reconcileOperation,
    delegationPolicy: p,
    clock: () => time,
    authorize: (ctx) =>
      ['issue-grant', 'resolve-grant', 'revoke-grant'].includes(ctx.kind) && !boolean
        ? issuer(ctx)
        : true,
  })
  const authority = { owner: 'writer', generation: 0 }
  await service.start({
    runId: 'run',
    goalRef: 'issue:263',
    owner: 'writer',
    boundary: 'external-action',
    authority,
  })
  await service.record(
    'candidate',
    { digest: candidate },
    { expectedRevision: (await service.read()).revision, authority },
  )
  const opts = async (extra) => ({
    expectedRevision: (await service.read()).revision,
    authority,
    ...extra,
  })
  return { p, service, authority, opts }
}
describe('typed host delegation application boundary', () => {
  it('reconciles exact provider evidence with safety capacity after business budget exhaustion', async () => {
    let outcome
    const f = await serviceFixture({ reconcileOperation: async () => outcome })
    const req = { ...request(f.p), maxAttempts: 1, maxExternalEffects: 1 }
    const g = await f.service.issueGrant(req, await f.opts())
    const op = operation(f.p)
    let dispatches = 0
    await f.service.executeDelegatedOperation(
      op,
      await f.opts({ grantId: g.grantId }),
      async () => {
        dispatches++
      },
    )
    expect(
      (await f.service.reconcileDelegatedOperation({ operationId: op.id, authority: f.authority }))
        .state,
    ).toBe('unknown')
    const admitted = (await f.service.read()).state.admissions[op.id]
    outcome = {
      verified: true,
      state: 'confirmed',
      operationId: op.id,
      payloadDigest: admitted.operationDigest,
      candidateDigest: op.candidateDigest,
      sourceRevision: 'provider:observed-revision',
    }
    await expect(
      f.service.safetyCheckpoint(
        { id: 'forged', kind: 'reconcile', reason: 'claimed', operationId: op.id, outcome },
        await f.opts(),
      ),
    ).rejects.toThrow('source reconciliation')
    const before = (await f.service.read()).state.safetyUsed
    expect(
      (await f.service.reconcileDelegatedOperation({ operationId: op.id, authority: f.authority }))
        .state,
    ).toBe('confirmed')
    expect((await f.service.read()).state.safetyUsed).toBe(before + 1)
    expect(
      (await f.service.reconcileDelegatedOperation({ operationId: op.id, authority: f.authority }))
        .replayed,
    ).toBe(true)
    expect((await f.service.read()).state.safetyUsed).toBe(before + 1)
    await expect(
      f.service.admitOperation({ ...op, id: 'next' }, await f.opts({ grantId: g.grantId })),
    ).rejects.toThrow('BUDGET')
    expect(dispatches).toBe(1)
  })

  it('refuses reconciliation for another operation or candidate without spending safety reserve', async () => {
    let outcome
    const f = await serviceFixture({ reconcileOperation: async () => outcome })
    const g = await f.service.issueGrant(request(f.p), await f.opts())
    const op = operation(f.p)
    await f.service.executeDelegatedOperation(
      op,
      await f.opts({ grantId: g.grantId }),
      async () => {},
    )
    const state = (await f.service.read()).state
    for (const replacement of [
      { operationId: 'other' },
      { candidateDigest: 'f'.repeat(64) },
      { payloadDigest: 'f'.repeat(64) },
    ]) {
      outcome = {
        verified: true,
        state: 'confirmed',
        operationId: op.id,
        candidateDigest: op.candidateDigest,
        payloadDigest: state.admissions[op.id].operationDigest,
        sourceRevision: 'provider:revision',
        ...replacement,
      }
      await expect(
        f.service.reconcileDelegatedOperation({ operationId: op.id, authority: f.authority }),
      ).rejects.toThrow('exact authoritative')
    }
    expect((await f.service.read()).state.safetyUsed).toBe(state.safetyUsed)
    expect((await f.service.read()).state.operations[op.id].state).toBe('submitted')
  })
  it('dispatches only the persisted operation when caller mutates input and authority during approval', async () => {
    let entered, release
    const arrived = new Promise((resolve) => {
      entered = resolve
    })
    const held = new Promise((resolve) => {
      release = resolve
    })
    const f = await serviceFixture({
      approve: async (context) => {
        if (context.kind === 'resolve-grant') {
          entered()
          await held
          // Even the approval callback receives a separate object, not live intent.
          context.operation.paths[0] = 'outside/callback.txt'
        }
        return { approved: true, decisionRef: 'approval:stable' }
      },
    })
    const g = await f.service.issueGrant(request(f.p), await f.opts())
    const op = operation(f.p),
      original = structuredClone(op)
    const options = await f.opts({ grantId: g.grantId })
    const callbacks = []
    const executing = f.service.executeDelegatedOperation(op, options, async (actual) => {
      callbacks.push(actual)
    })
    await arrived
    op.paths[0] = 'outside/secret.txt'
    op.arguments.remote = 'attacker'
    op.id = 'different-operation'
    options.grantId = 'different-grant'
    options.authority.owner = 'different-writer'
    release()
    await executing
    const state = (await f.service.read()).state
    expect(callbacks).toEqual([original])
    expect(state.admissions.op1.operation).toEqual(original)
    expect(state.operations.op1.payloadDigest).toBe(state.admissions.op1.operationDigest)
  })
  it('binds grant scope before asynchronous approval and ignores caller/UI mutations', async () => {
    let entered, release
    const arrived = new Promise((resolve) => {
      entered = resolve
    })
    const held = new Promise((resolve) => {
      release = resolve
    })
    const f = await serviceFixture({
      approve: async (context) => {
        if (context.kind === 'issue-grant') {
          entered()
          await held
          context.request.allowedPaths = ['outside/*']
        }
        return { approved: true, decisionRef: 'approval:stable' }
      },
    })
    const req = request(f.p),
      options = await f.opts()
    const issuing = f.service.issueGrant(req, options)
    // Mutate immediately, before even the first store read has resolved.
    req.maxExternalEffects = 999
    await arrived
    req.allowedPaths[0] = 'outside/*'
    options.authority.owner = 'other'
    release()
    const issued = await issuing
    const stored = await f.service.resolveGrant(issued.grantId)
    expect(stored.envelope.binding.allowedPaths).toEqual(['src/*'])
    expect(stored.envelope.binding.maxExternalEffects).toBe(3)
  })
  it('direct issuer binds the pre-approval request and configured policy snapshot', async () => {
    const p = policy(),
      req = request(p)
    let release, entered
    const held = new Promise((resolve) => {
      release = resolve
    })
    const arrived = new Promise((resolve) => {
      entered = resolve
    })
    const issuer = createLocalCooperativeIssuer({
      policy: p,
      issuerId: 'local',
      approve: async (context) => {
        entered()
        await held
        context.request.allowedPaths = ['outside/*']
        return { approved: true, decisionRef: 'approval:stable' }
      },
    })
    const expected = grantRequestDigest(req),
      expectedPolicy = recordDigest(p)
    const pending = issuer({ kind: 'issue-grant', request: req })
    await arrived
    req.allowedPaths[0] = 'outside/*'
    p.issuers[0].origin = 'forged'
    release()
    const decision = await pending
    expect(decision.requestDigest).toBe(expected)
    expect(decision.policyDigest).toBe(expectedPolicy)
    expect(decision.origin).toBe('desktop:approval')
  })
  it('issues, resolves, narrows, revokes and denies child after parent revoke', async () => {
    const f = await serviceFixture()
    const issued = await f.service.issueGrant(request(f.p), await f.opts())
    const child = await f.service.issueGrant(
      request(f.p, { maxAttempts: 1, maxExternalEffects: 1, allowedPaths: ['src/sub/*'] }),
      await f.opts({ parentId: issued.grantId }),
    )
    expect((await f.service.resolveGrant(child.grantId)).envelope.parentId).toBe(issued.grantId)
    await f.service.revokeGrant(issued.grantId, 'stop', await f.opts())
    await expect(
      f.service.admitOperation(
        operation(f.p, { paths: ['src/sub/file'] }),
        await f.opts({ grantId: child.grantId }),
      ),
    ).rejects.toThrow(/REVOKED/)
  })
  it('boolean compatibility cannot issue a delegated grant', async () => {
    const f = await serviceFixture({ boolean: true })
    await expect(f.service.issueGrant(request(f.p), await f.opts())).rejects.toThrow(/Typed/)
  })
  it('fails unsupported conditional source before issuance', async () => {
    const f = await serviceFixture({ capable: false })
    await expect(f.service.issueGrant(request(f.p), await f.opts())).rejects.toThrow(/conditional/)
  })
  it('rejects unknown parent and stale writer without spending budget', async () => {
    const f = await serviceFixture()
    await expect(
      f.service.issueGrant(request(f.p), await f.opts({ parentId: 'missing' })),
    ).rejects.toThrow(/Unknown parent/)
    const g = await f.service.issueGrant(request(f.p), await f.opts())
    await expect(
      f.service.admitOperation(
        operation(f.p),
        await f.opts({ grantId: g.grantId, authority: { owner: 'old', generation: 0 } }),
      ),
    ).rejects.toThrow(/Obsolete/)
    expect((await f.service.resolveGrant(g.grantId)).budgetUsed.attempts).toBe(0)
  })
  it('reconciles stable operation replay without duplicate reservation and conflicts changed intent', async () => {
    const f = await serviceFixture(),
      g = await f.service.issueGrant(request(f.p), await f.opts())
    const first = await f.service.admitOperation(
      operation(f.p),
      await f.opts({ grantId: g.grantId }),
    )
    const replay = await f.service.admitOperation(
      operation(f.p),
      await f.opts({ grantId: g.grantId }),
    )
    expect(replay.replayed).toBe(true)
    expect(replay.receipt.eventDigest).toBe(first.receipt.eventDigest)
    expect((await f.service.resolveGrant(g.grantId)).budgetUsed.attempts).toBe(1)
    await expect(
      f.service.admitOperation(
        operation(f.p, { arguments: { branch: 'different' } }),
        await f.opts({ grantId: g.grantId }),
      ),
    ).rejects.toThrow(/Conflicting/)
  })
})
