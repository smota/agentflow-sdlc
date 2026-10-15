import { readFileSync } from 'node:fs'
import { phaseZeroCollaboration } from '../../../lib/__tests__/phase-zero-bootstrap.mjs'
import { sealDeliveryRecord } from '../../../lib/core/delivery-record.mjs'
import { createHostIntentConsent } from '../../../lib/core/intent-consent.mjs'
import { describe, expect, it } from 'vitest'
import { executeNativeHandoff } from '../native-handoff.mjs'
import { createRunService } from '../../../lib/application/run-service.mjs'
import { createMemoryRunStore } from '../../../lib/sources/run-store.mjs'
import { createLocalCooperativeIssuer } from '../../../lib/application/local-cooperative-issuer.mjs'
import { createRunEvent } from '../../../lib/core/run-state.mjs'
import { createOracleCustodyReceipt } from '../../../lib/core/oracle-custody.mjs'
import { recordDigest } from '../../../lib/core/record-digest.mjs'
import { loadSdlcConfig } from '../../../lib/sdlc-state.mjs'
const now = '2026-10-15T12:00:00.000Z',
  candidate = 'c'.repeat(64),
  oracle = 'a'.repeat(64)
const evidenceBinding = (snapshot, operation) => ({
  runId: snapshot.state.runId,
  runRevision: snapshot.revision,
  sourceRevision: snapshot.sourceRevision ?? snapshot.revision,
  generation: snapshot.state.generation,
  revocationEpoch: snapshot.state.revocationEpoch,
  operationDigest: recordDigest({ operation }),
})
const ref = (uri) => ({
  kind: 'validation',
  system: 'github',
  uri: `https://example.invalid/${uri}`,
  authority: 'authoritative',
  relationship: 'verifies',
  revision: 'one',
  digest: 'b'.repeat(64),
})
async function fixture({
  withOracle = true,
  nativeAdvanceOnly = false,
  boundary = 'external-action',
} = {}) {
  const policy = {
    version: 1,
    issuers: [
      {
        id: 'host',
        origin: 'test:host',
        authorityRef: 'test:approval',
        mode: 'local-cooperative',
        allowedActions: ['queue:create'],
        allowThroughMerge: false,
      },
    ],
    requiredChecks: [],
    reviewPolicy: 'automated',
    materiality: 'fixed-scope-v1',
    allowSubdelegation: false,
    safetyReserve: 4,
  }
  const memory = createMemoryRunStore({ durable: true })
  memory.conditionalAdmission = 'single-parent-run-chain-v1'
  const issuer = createLocalCooperativeIssuer({
    policy,
    issuerId: 'host',
    approve: async () => ({ approved: true, decisionRef: 'fixture:explicit' }),
  })
  const config = structuredClone(loadSdlcConfig())
  config.actionPolicy.profileMaximums.standard = 'external-action'
  let queueState = 'unknown',
    dispatches = 0,
    accepted = false
  const records = phaseZeroCollaboration({
    subject: 'issue:521',
    candidateDigest: candidate,
    criterionId: 'check',
  })
  const criterion = { id: 'check', definitionDigest: 'b'.repeat(64), assertions: ['works'] }
  const frozen = {
    version: 2,
    goalRevision: 'goal:one',
    criteria: [criterion],
    ownerRole: records.contract.ownerRole,
    collaborationContractDigest: records.contract.digest,
  }
  const service = createRunService({
    intentScope: {
      repository: null,
      coordinationBranch: null,
      businessBoundary: boundary,
      destinations: ['fixture'],
      checks: [{ name: 'check', digest: criterion.definitionDigest }],
      expiry: { effectGrant: 'typed-grant-required' },
      budget: null,
      assurance: 'agent-observed-local-cooperative',
    },
    resolveContract: async () => ({ verified: true, sourceRevision: 'goal:one', value: frozen }),
    resolveCollaboration: async () => ({
      verified: true,
      sources: {
        handoff: records.handoff,
        contract: records.contract,
        delivery: records.delivery,
        decision: records.decision,
      },
    }),
    resolveObservation: async (observation) => ({ verified: true, observation }),
    resolveHostIntentConsent: async (request) =>
      createHostIntentConsent({
        request,
        decision: 'agree',
        observerRuntime: 'codex',
        sessionDigest: '1'.repeat(64),
        turnDigest: '2'.repeat(64),
        evidenceDigest: '3'.repeat(64),
        decisionRef: '4'.repeat(64),
        observedAt: now,
        expiresAt: '2026-10-15T12:01:00.000Z',
      }),
    store: memory,
    delegationPolicy: policy,
    sdlcConfig: config,
    posture: 'autonomous',
    clock: () => now,
    authorize: (context) =>
      ['issue-grant', 'resolve-grant'].includes(context.kind) ? issuer(context) : true,
    resolveOracleCustody: async (request) => ({
      verified: true,
      receipt: createOracleCustodyReceipt({ request, verifier: 'fixture:source', verifiedAt: now }),
    }),
    reconcileOperation: async (op, admitted) =>
      queueState === 'unknown'
        ? { state: 'unknown' }
        : {
            verified: true,
            state: 'confirmed',
            operationId: op.id,
            payloadDigest: admitted.operationDigest,
            candidateDigest: candidate,
            sourceRevision: 'provider:one',
          },
  })
  const authority = { owner: 'writer', generation: 0 }
  await service.start({
    runId: 'native',
    goalRef: 'issue:521',
    owner: 'writer',
    boundary,
    authority,
  })
  await service.freezeContract({ expectedRevision: (await service.read()).revision, authority })
  await service.record(
    'candidate',
    { digest: candidate },
    { expectedRevision: (await service.read()).revision, authority },
  )
  const observation = sealDeliveryRecord('verification-observation', {
    id: 'check',
    invocationId: 'check',
    producer: 'fixture',
    criterionId: 'check',
    candidateDigest: candidate,
    definitionDigest: criterion.definitionDigest,
    origin: 'collector-observed',
    isolation: 'cooperative',
    outcome: 'pass',
    assertions: [{ id: 'works', outcome: 'pass' }],
    startedAt: now,
    completedAt: now,
  })
  await service.record(
    'observation',
    { observation },
    { expectedRevision: (await service.read()).revision, authority },
  )
  await service.advance({
    contract: {
      candidateDigest: candidate,
      runRevision: (await service.read()).revision,
      criteria: [{ ...criterion, observationDigest: observation.digest }],
    },
    authority,
  })
  // Remaining pre-existing source phases are explicit fixture records. Native
  // phase zero above exercises the actual governed advance and intent gate.
  for (let phase = 1; phase < (nativeAdvanceOnly ? 1 : 3); phase++) {
    const snap = await service.read()
    await memory.append(
      createRunEvent({
        runId: 'native',
        id: `source-advance-${phase}`,
        kind: 'advanced',
        previousDigest: snap.revision,
        generation: 0,
        timestamp: now,
        payload: {
          from: phase,
          to: phase + 1,
          candidateDigest: candidate,
          acceptanceDigest: 'd'.repeat(64),
        },
      }),
      snap.revision,
    )
  }
  await service.record(
    'candidate',
    { digest: candidate },
    { expectedRevision: (await service.read()).revision, authority },
  )
  if (withOracle) {
    await service.pinOracle({ digest: oracle, authority })
    await service.recordOracleCustody({
      proposal: {
        mode: 'prospective-assignment',
        oracleDigest: oracle,
        identity: 'test-engineer',
        assignmentRef: ref('assignment'),
        manifestRef: ref('manifest'),
        evidenceRefs: [ref('proof')],
        provenance: { platform: 'codex', executor: 'codex-cli' },
      },
      authority,
    })
  }
  const grant = await service.issueGrant(
    {
      issuerMode: 'local-cooperative',
      planDigest: 'e'.repeat(64),
      policyDigest: recordDigest(policy),
      repository: 'fixture/repo',
      base: 'main',
      delegate: 'test-engineer',
      allowedPaths: ['tests/*', 'tests/oracles/*'],
      allowedActions: ['queue:create'],
      capabilities: ['queue:create'],
      requiredChecks: [],
      reviewPolicy: 'automated',
      materiality: 'fixed-scope-v1',
      allowSubdelegation: false,
      maxAttempts: 2,
      maxExternalEffects: 2,
      expiry: '2026-10-15T12:10:00.000Z',
    },
    { expectedRevision: (await service.read()).revision, authority },
  )
  const snapshot = await service.read(),
    event = nativeAdvanceOnly
      ? snapshot.events.find((e) => e.kind === 'advanced')
      : snapshot.events.find((e) => e.id === 'source-advance-2'),
    body = 'Native source handoff',
    destination = 'dev-test-eng@fixture'
  const operation = {
    id: 'handoff-native-1',
    action: 'queue:create',
    planDigest: 'e'.repeat(64),
    policyDigest: recordDigest(policy),
    repository: 'fixture/repo',
    base: 'main',
    delegate: 'test-engineer',
    paths: ['tests/schema.json'],
    capabilities: ['queue:create'],
    candidateDigest: candidate,
    workspaceDigest: 'f'.repeat(64),
    checks: [],
    review: { outcome: 'pass', policy: 'automated', candidateDigest: candidate },
    arguments: {
      protocol: 'native-handoff-v1',
      runId: 'native',
      goalRef: 'issue:521',
      generation: 0,
      revocationEpoch: 0,
      transitionId: event.id,
      transitionDigest: event.digest,
      fromPhase: event.payload.from,
      toPhase: event.payload.to,
      destination,
      bodyDigest: recordDigest({ body }),
      oracleDigest: withOracle ? oracle : null,
      custodyDigests: withOracle ? [snapshot.state.oracleCustody.assignment.digest] : [],
    },
  }
  const args = {
    service,
    operation,
    body,
    authority,
    grantId: grant.grantId,
    nowMs: Date.parse(now),
    clock: () => Date.parse(now),
    host: {
      resolveTask: async ({ snapshot }) => ({
        verified: true,
        sourceRef: 'fixture:task',
        sourceRevision: snapshot.sourceRevision ?? snapshot.revision,
        task: {
          protocol: 'run-v1',
          goal: 'issue:521',
          runId: 'native',
          runRevision: snapshot.revision,
          sourceRevision: snapshot.sourceRevision ?? snapshot.revision,
          owner: snapshot.state.owner,
          destination,
          generation: 0,
          revocationEpoch: 0,
          touchSurface: [...operation.paths],
        },
      }),
      resolveOperationalPreflightInput: async ({ snapshot, operation }) => {
        const tuple = {
          seat: 'dev-test-eng',
          runtime: 'codex',
          providerRoute: 'openai-codex',
          model: 'gpt-6.1-sol',
          effort: 'medium',
          profile: 'test-engineer',
        }
        const input = {
          contracts: [tuple],
          installedContracts: [tuple],
          daemon: { state: 'running' },
          task: {
            rigName: 'fixture',
            owner: 'writer',
            requiredSeats: ['dev-test-eng'],
            bindings: { 'dev-test-eng': { generation: 'occupant-one', sessionId: 'session-one' } },
          },
          observations: {
            rigName: 'fixture',
            complete: true,
            entries: [
              {
                ...tuple,
                generation: 'occupant-one',
                sessionId: 'session-one',
                eventAt: now,
                sourceVerified: true,
                processReady: true,
                catchupVerified: true,
                occupantVerified: true,
                authorized: true,
                bindingVerified: true,
              },
            ],
          },
        }
        return {
          sourceRef: 'fixture:actual-runtime',
          binding: evidenceBinding(snapshot, operation),
          input,
        }
      },
      dispatchQueue: async () => {
        dispatches++
        return { qitemId: operation.id, destinationSession: destination }
      },
      verifySuccessorAcceptance: async ({ snapshot, operation }) =>
        accepted
          ? {
              verified: true,
              accepted: true,
              qitemId: operation.id,
              binding: evidenceBinding(snapshot, operation),
              operationId: operation.id,
              operationDigest: recordDigest({ operation }),
              destination,
              runId: 'native',
              generation: 0,
              revocationEpoch: 0,
              oracleDigest: withOracle ? oracle : null,
              custodyDigests: operation.arguments.custodyDigests,
              observedAt: now,
            }
          : null,
    },
  }
  return {
    args,
    service,
    memory,
    counts: () => dispatches,
    confirm: () => {
      queueState = 'confirmed'
    },
    accept: () => {
      accepted = true
    },
  }
}
describe('native source handoff bridge #521', () => {
  it('preserves native zero counters and typed oracle custody without claiming queue acceptance', async () => {
    const f = await fixture()
    const r = await executeNativeHandoff(f.args)
    expect(r).toMatchObject({ status: 'submitted', accepted: false })
    expect(f.counts()).toBe(1)
    const s = await f.service.read()
    expect(s.state.generation).toBe(0)
    expect(s.state.revocationEpoch).toBe(0)
    expect(s.state.oracleCustody.assignment.oracleDigest).toBe(oracle)
    expect(s.state).not.toHaveProperty('epoch')
  })
  it('holds missing host task identity without checkpoint or queue writes', async () => {
    const f = await fixture()
    delete f.args.host.resolveTask
    const before = (await f.service.read()).revision
    expect((await executeNativeHandoff(f.args)).status).toBe('held')
    expect((await f.service.read()).revision).toBe(before)
    expect(f.counts()).toBe(0)
  })
  it('holds missing grant before queue dispatch', async () => {
    const f = await fixture()
    f.args.grantId = 'absent'
    expect((await executeNativeHandoff(f.args)).status).toBe('held')
    expect(f.counts()).toBe(0)
  })
  it('never redispatches unknown admission or queue outcome on replay', async () => {
    const f = await fixture()
    f.args.host.dispatchQueue = async () => {
      throw new Error('PRIVATE_FIXTURE')
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('unknown')
    const replay = await executeNativeHandoff(f.args)
    expect(replay).toMatchObject({ status: 'unknown', accepted: false })
    expect(JSON.stringify(replay)).not.toContain('PRIVATE_FIXTURE')
  })
  it('separates provider persistence from successor custody and records acceptance in same source', async () => {
    const f = await fixture()
    await executeNativeHandoff(f.args)
    f.confirm()
    expect((await executeNativeHandoff(f.args)).status).toBe('submitted')
    f.accept()
    expect((await executeNativeHandoff(f.args)).status).toBe('accepted')
    expect(f.counts()).toBe(1)
    expect((await f.service.read()).events.at(-1).kind).toBe('checkpoint')
  })
  it.each(['destination', 'generation', 'oracleDigest', 'transitionDigest'])(
    'holds mismatched %s against source facts',
    async (key) => {
      const f = await fixture()
      f.args.operation.arguments[key] = key === 'generation' ? 1 : 'wrong'
      expect((await executeNativeHandoff(f.args)).status).toBe('held')
      expect(f.counts()).toBe(0)
    },
  )
  it('replays checkpoint crash before admission using the same operation', async () => {
    const f = await fixture(),
      original = f.service.executeDelegatedOperation
    f.service.executeDelegatedOperation = async () => {
      throw new Error('crash before admission')
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('unknown')
    f.service.executeDelegatedOperation = original
    expect((await executeNativeHandoff(f.args)).status).toBe('submitted')
    expect(f.counts()).toBe(1)
    const checkpoints = (await f.service.read()).events.filter(
      (e) => e.kind === 'checkpoint' && e.payload.kind === 'native-handoff-intent',
    )
    expect(checkpoints).toHaveLength(1)
  })
  it('requires raw operational admission evidence from a trusted host reader', async () => {
    const f = await fixture()
    delete f.args.host.resolveOperationalPreflightInput
    expect((await executeNativeHandoff(f.args)).status).toBe('held')
    expect(f.counts()).toBe(0)
  })
  it('holds stale source native generation and leaves all source records unchanged', async () => {
    const f = await fixture(),
      original = f.args.host.resolveTask,
      before = (await f.service.read()).revision
    f.args.host.resolveTask = async (input) => {
      const source = await original(input)
      source.task.generation = 1
      return source
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('held')
    expect((await f.service.read()).revision).toBe(before)
    expect(f.counts()).toBe(0)
  })
  it('reconciles a lost admission acknowledgement without dispatching it on replay', async () => {
    const f = await fixture(),
      append = f.memory.append
    let once = true
    f.memory.append = async function (event, revision) {
      const result = await append.call(this, event, revision)
      if (event.kind === 'operation-admitted' && once) {
        once = false
        throw new Error('lost ack')
      }
      return result
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('unknown')
    expect((await executeNativeHandoff(f.args)).status).toBe('unknown')
    expect(f.counts()).toBe(0)
  })
  it('keeps malformed queue acknowledgements unknown and never retries them blindly', async () => {
    const f = await fixture(),
      dispatch = f.args.host.dispatchQueue
    f.args.host.dispatchQueue = async (input) => {
      await dispatch(input)
      return { qitemId: 'wrong' }
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('unknown')
    expect((await executeNativeHandoff(f.args)).status).toBe('unknown')
    expect(f.counts()).toBe(1)
  })
  it('does not let an existing edit capability stand in for typed queue authority', async () => {
    const f = await fixture()
    f.args.operation.action = 'edit'
    f.args.operation.capabilities = ['edit']
    expect((await executeNativeHandoff(f.args)).status).toBe('held')
    expect(f.counts()).toBe(0)
  })
  it('refuses an unconfirmed provider outcome even when a successor claims acceptance', async () => {
    const f = await fixture()
    await executeNativeHandoff(f.args)
    f.accept()
    expect((await executeNativeHandoff(f.args)).status).toBe('unknown')
    expect(f.counts()).toBe(1)
  })
  it('delivers a transition actually advanced by governed service.advance at native generation zero', async () => {
    const f = await fixture({ withOracle: false, nativeAdvanceOnly: true })
    const before = await f.service.read(),
      transition = before.events.find((e) => e.kind === 'advanced')
    expect(transition.payload.intentConsent.decision).toBe('agree')
    expect(f.args.operation.arguments.transitionDigest).toBe(transition.digest)
    expect((await executeNativeHandoff(f.args)).status).toBe('submitted')
    expect((await f.service.read()).state.phase).toBe(1)
    expect(f.counts()).toBe(1)
  })
  it('does not widen mutate-worktree business authority to allow queue creation', async () => {
    await expect(fixture({ boundary: 'mutate-worktree' })).rejects.toThrow(/business authority/)
  })
  it('charges a real external effect in the existing typed grant budget', async () => {
    const f = await fixture()
    await executeNativeHandoff(f.args)
    const grant = (await f.service.read()).state.grants[f.args.grantId]
    expect(grant.budgetUsed.externalEffects).toBe(1)
    expect(grant.budgetUsed.attempts).toBe(1)
  })
  it.each([true, false])(
    'requires protected native assignment to match typed current custody: %s',
    async (matches) => {
      const f = await fixture(),
        original = f.args.host.resolveTask
      f.args.operation.paths = ['tests/oracles/schema.json']
      let resolved
      f.args.host.resolveTask = async (input) => {
        resolved = await original(input)
        Object.assign(resolved.task, {
          worktree: '.worktrees/oracle',
          builderIdentity: 'feature-builder',
          reviewerIdentity: 'independent-reviewer',
        })
        resolved.assignment = {
          id: 'source-assignment',
          role: 'test-engineer',
          policySeat: 'dev.test-eng',
          mode: 'temporary',
          identity: 'test-engineer',
          authorityRef: 'fixture:assignment',
          target: f.args.operation.arguments.destination,
          allowedPaths: ['tests/oracles/**'],
          worktree: resolved.task.worktree,
          expiresAt: '2026-10-15T12:10:00.000Z',
          scope: structuredClone(resolved.task),
          custody: { owner: 'test-engineer', oracleDigest: matches ? oracle : 'b'.repeat(64) },
        }
        return resolved
      }
      f.args.host.resolveOracleAuthority = () => ({
        verified: true,
        sourceRef: resolved.sourceRef,
        sourceRevision: resolved.sourceRevision,
        task: structuredClone(resolved.task),
        assignment: structuredClone(resolved.assignment),
        ownershipManifest: JSON.parse(readFileSync('manifests/path-ownership.json', 'utf8')),
      })
      expect((await executeNativeHandoff(f.args)).status).toBe(matches ? 'submitted' : 'held')
      expect(f.counts()).toBe(matches ? 1 : 0)
    },
  )
  it('reports unknown when an existing anchor later dispatches and loses its acknowledgement', async () => {
    const f = await fixture(),
      execute = f.service.executeDelegatedOperation
    f.service.executeDelegatedOperation = async () => {
      throw new Error('before admission')
    }
    await executeNativeHandoff(f.args)
    f.service.executeDelegatedOperation = execute
    const dispatch = f.args.host.dispatchQueue
    f.args.host.dispatchQueue = async (input) => {
      await dispatch(input)
      throw new Error('after actual submit')
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('unknown')
    expect(f.counts()).toBe(1)
  })
  it('snapshots verified successor receipts before host-owned references can mutate', async () => {
    const f = await fixture()
    await executeNativeHandoff(f.args)
    f.confirm()
    f.accept()
    const verify = f.args.host.verifySuccessorAcceptance,
      read = f.service.read
    let live,
      mutate = false
    f.args.host.verifySuccessorAcceptance = async (input) => {
      live = await verify(input)
      mutate = true
      return live
    }
    f.service.read = async () => {
      if (mutate) {
        mutate = false
        live.destination = 'unauthorized@other'
      }
      return read()
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('accepted')
    expect((await read()).events.at(-1).payload.receipt.destination).toBe('dev-test-eng@fixture')
  })
  it('holds runtime evidence for a different native run even when seat and rig match', async () => {
    const f = await fixture(),
      read = f.args.host.resolveOperationalPreflightInput
    f.args.host.resolveOperationalPreflightInput = async (input) => {
      const evidence = await read(input)
      evidence.binding.runId = 'other-run'
      return evidence
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('held')
    expect(f.counts()).toBe(0)
  })
  it('requires destination acknowledgement after a real submit, retaining unknown on omission', async () => {
    const f = await fixture(),
      dispatch = f.args.host.dispatchQueue
    f.args.host.dispatchQueue = async (input) => {
      const ack = await dispatch(input)
      delete ack.destinationSession
      return ack
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('unknown')
    expect(f.counts()).toBe(1)
  })
  it('does not accept a successor receipt bound to an older source revision', async () => {
    const f = await fixture()
    await executeNativeHandoff(f.args)
    f.confirm()
    f.accept()
    const verify = f.args.host.verifySuccessorAcceptance
    f.args.host.verifySuccessorAcceptance = async (input) => {
      const receipt = await verify(input)
      receipt.binding.runRevision = '0'.repeat(64)
      return receipt
    }
    expect((await executeNativeHandoff(f.args)).status).toBe('submitted')
    expect(
      (await f.service.read()).events.some((e) => e.payload.kind === 'native-handoff-accepted'),
    ).toBe(false)
  })
  it('accepts a fresh successor observation after invocation start using the current clock', async () => {
    const f = await fixture()
    await executeNativeHandoff(f.args)
    f.confirm()
    f.accept()
    const verify = f.args.host.verifySuccessorAcceptance
    f.args.clock = () => Date.parse(now) + 1000
    f.args.host.verifySuccessorAcceptance = async (input) => ({
      ...(await verify(input)),
      observedAt: new Date(Date.parse(now) + 1000).toISOString(),
    })
    expect((await executeNativeHandoff(f.args)).status).toBe('accepted')
    expect((await executeNativeHandoff(f.args)).status).toBe('accepted')
    expect(f.counts()).toBe(1)
  })
})
