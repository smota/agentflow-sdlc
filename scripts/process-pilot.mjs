#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMemoryRunStore } from '../lib/sources/run-store.mjs'
import { createRunService } from '../lib/application/run-service.mjs'
import { createLocalCooperativeIssuer } from '../lib/application/local-cooperative-issuer.mjs'
import {
  createContinuationBundle,
  reconstructContinuation,
  MAX_PACKET_BYTES,
} from '../lib/application/continuation-service.mjs'
import { createPendingAuditJournal } from '../lib/sources/pending-audit-journal.mjs'
import { reduceRun } from '../lib/core/run-state.mjs'
import { recordDigest } from '../lib/core/record-digest.mjs'
import { CONDITIONAL_ADMISSION } from '../lib/core/delegation-grant.mjs'

export async function runProcessPilot({
  fixture = true,
  runId = 'pilot-run-295',
  fixedTime = '2026-09-26T12:00:00.000Z',
} = {}) {
  if (!fixture)
    throw new Error(
      'Only the single-process fixture is supported; live qualification is unavailable',
    )
  const started = performance.now()
  const tempRoot = realpathSync(tmpdir())
  const directory = mkdtempSync(join(tempRoot, 'af-pilot-journal-'))
  try {
    // The memory store performs revision comparison and append synchronously, before yielding.
    // This capability is valid only inside this single-process fixture, not across hosts.
    const store = { ...createMemoryRunStore(), conditionalAdmission: CONDITIONAL_ADMISSION }
    const acknowledgments = []
    const journal = createPendingAuditJournal({
      directory,
      verifyAcknowledgment: async ({ event }) => {
        const snapshot = await store.read()
        const found = snapshot.events.find(
          (e) => e.runId === event.runId && e.id === event.id && e.digest === event.digest,
        )
        if (!found) return { acknowledged: false }
        acknowledgments.push({
          eventId: found.id,
          eventDigest: found.digest,
          sourceRevision: snapshot.revision,
        })
        return {
          acknowledged: true,
          eventId: found.id,
          eventDigest: found.digest,
          sourceRevision: snapshot.revision,
        }
      },
    })
    const policy = {
      version: 1,
      issuers: [
        {
          id: 'fixture',
          origin: 'fixture:approval',
          authorityRef: 'fixture:host',
          mode: 'local-cooperative',
          allowedActions: ['edit'],
          allowThroughMerge: false,
        },
      ],
      requiredChecks: ['fixture-check'],
      reviewPolicy: 'automated',
      materiality: 'fixed-scope-v1',
      allowSubdelegation: false,
      safetyReserve: 4,
    }
    const issuer = createLocalCooperativeIssuer({
      policy,
      issuerId: 'fixture',
      approve: async () => ({ approved: true, decisionRef: 'fixture:bounded-decision' }),
    })
    const effects = []
    const outcomes = new Map()
    const artifacts = new Map()
    let stopped = false
    const candidate = recordDigest({ fixture: 'candidate' })
    const createService = () =>
      createRunService({
        store,
        delegationPolicy: policy,
        clock: () => fixedTime,
        authorize: (ctx) =>
          ['issue-grant', 'resolve-grant', 'revoke-grant'].includes(ctx.kind) ? issuer(ctx) : true,
        observeWriter: async () => ({ stopped }),
        observeWorkspace: async () => ({ verified: true, candidateDigest: candidate }),
        reconcileOperation: async (op) =>
          outcomes.get(op.id) ?? { verified: false, state: 'unknown' },
      })
    let service = createService()
    const priorAuthority = { owner: 'fixture-writer-1', generation: 0 }
    let authority = priorAuthority
    const options = async () => ({ expectedRevision: (await service.read()).revision, authority })
    await service.start({
      runId,
      goalRef: 'issue:295',
      owner: authority.owner,
      boundary: 'external-action',
      authority,
    })
    await service.record('candidate', { digest: candidate }, await options())
    const common = {
      planDigest: recordDigest({ fixture: 'plan' }),
      policyDigest: recordDigest(policy),
      repository: 'fixture/repository',
      base: 'fixture-base',
      delegate: 'fixture-runtime',
    }
    const grant = await service.issueGrant(
      {
        ...common,
        allowedPaths: ['src/*'],
        allowedActions: ['edit'],
        capabilities: ['edit'],
        requiredChecks: policy.requiredChecks,
        reviewPolicy: policy.reviewPolicy,
        materiality: policy.materiality,
        allowSubdelegation: false,
        maxAttempts: 3,
        maxExternalEffects: 3,
        expiry: new Date(Date.parse(fixedTime) + 86400000).toISOString(),
        issuerMode: 'local-cooperative',
      },
      await options(),
    )
    const operation = (id) => ({
      ...common,
      id,
      action: 'edit',
      paths: [`src/${id}.txt`],
      capabilities: ['edit'],
      candidateDigest: candidate,
      workspaceDigest: candidate,
      checks: [{ name: 'fixture-check', outcome: 'pass', candidateDigest: candidate }],
      review: { policy: 'automated', outcome: 'pass', candidateDigest: candidate },
      arguments: { content: `${id}\n` },
    })
    const dispatch = async (op, receipt) => {
      effects.push(op.id)
      artifacts.set(op.paths[0], Buffer.from(op.arguments.content))
      outcomes.set(op.id, {
        verified: true,
        state: 'confirmed',
        operationId: op.id,
        payloadDigest: receipt.operationDigest,
        candidateDigest: op.candidateDigest,
        sourceRevision: `fixture-effect:${effects.length}`,
      })
    }
    const execute = async (op) =>
      service.executeDelegatedOperation(
        op,
        { ...(await options()), grantId: grant.grantId },
        dispatch,
      )
    const first = operation('first')
    await execute(first)
    await service.reconcileDelegatedOperation({ operationId: first.id, authority })
    const admission = (await store.read()).events.find((e) => e.kind === 'operation-admitted')
    await journal.put(admission)
    await service.record(
      'paused',
      { reason: 'Fixture writer stopped between operations' },
      await options(),
    )
    stopped = true
    const checkpoint = await service.read()
    const bytes = artifacts.get(first.paths[0])
    const bundle = createContinuationBundle({
      state: checkpoint.state,
      runRevision: checkpoint.revision,
      branch: 'fixture-base',
      commitSha: 'd'.repeat(40),
      nextSlice: 'fixture-second-operation',
      artifacts: [
        {
          id: 'first-artifact',
          path: first.paths[0],
          digest: createHash('sha256').update(bytes).digest('hex'),
          byteLength: bytes.length,
        },
      ],
    })
    service = createService()
    const resumeStarted = performance.now()
    const reconstruction = await reconstructContinuation({
      bundle,
      store,
      resolveArtifact: async (ref) => ({ content: artifacts.get(ref.path) }),
      observeWriter: async () => ({ stopped }),
      clock: () => fixedTime,
    })
    const plan = await service.recoveryPlan({
      owner: 'fixture-writer-2',
      boundary: 'external-action',
      writer: { instance: 'fixture-service-2', host: 'single-process-fixture', pid: process.pid },
    })
    await service.resume({
      plan,
      authority: { owner: plan.owner, generation: priorAuthority.generation },
    })
    authority = { owner: plan.owner, generation: (await service.read()).state.generation }
    const resumeLatencyMs = performance.now() - resumeStarted
    const denial = async (fn) => {
      try {
        await fn()
        return null
      } catch (error) {
        return error.message
      }
    }
    const beforeReplay = effects.length
    const replay = await execute(first)
    const afterReplay = effects.length
    const staleWriter = await denial(async () =>
      service.executeDelegatedOperation(
        operation('stale'),
        { ...(await options()), authority: priorAuthority, grantId: grant.grantId },
        dispatch,
      ),
    )
    const second = operation('second')
    await execute(second)
    await service.reconcileDelegatedOperation({ operationId: second.id, authority })
    await service.revokeGrant(grant.grantId, 'Fixture revocation scenario', await options())
    const beforeRevocationAttempt = effects.length
    const revoked = await denial(() => execute(operation('revoked')))
    const afterRevocationAttempt = effects.length
    await journal.ack(admission.id, admission.digest, {})
    const pending = await journal.list()
    const snapshot = await store.read()
    const state = reduceRun(snapshot.events)
    const checks = {
      grantInEventChain:
        snapshot.events.some((e) => e.kind === 'grant-issued') &&
        state.grants[grant.grantId]?.status === 'revoked',
      twoReconciledAdmissions:
        Object.keys(state.admissions).length === 2 &&
        [first.id, second.id].every((id) => state.operations[id]?.state === 'confirmed'),
      reconstruction: reconstruction.verified === true,
      resumedWriterInEventChain:
        snapshot.events.some((e) => e.kind === 'resumed') &&
        state.generation === 1 &&
        state.owner === authority.owner,
      replayNoDispatch: replay.replayed === true && afterReplay === beforeReplay,
      staleWriterDenied: /Obsolete writer/.test(staleWriter ?? ''),
      revocationNoDispatch:
        /REVOKED/.test(revoked ?? '') && beforeRevocationAttempt === afterRevocationAttempt,
      exactSourceAcknowledgment:
        acknowledgments.length === 1 &&
        acknowledgments[0].eventId === admission.id &&
        acknowledgments[0].eventDigest === admission.digest &&
        pending.entries.length === 0,
      observedDispatches: effects.length === 2 && new Set(effects).size === 2,
    }
    return {
      version: 2,
      scenario: 'production-service-single-process-fixture',
      passed: Object.values(checks).every(Boolean),
      runId,
      assurance: {
        source: 'non-durable-memory',
        issuer: 'local-cooperative-fixture',
        writerObservation: 'fixture-controlled',
        qualification: 'fixture-only',
      },
      unqualified: [
        'live GitHub durability',
        'process crash recovery',
        'OS writer liveness',
        'CLI/provider harness execution',
        'full S0-S9 delivery qualification',
      ],
      checks,
      evidence: {
        eventKinds: snapshot.events.map((e) => e.kind),
        dispatches: effects,
        acknowledgments,
        staleWriterDenial: staleWriter,
        revocationDenial: revoked,
      },
      metrics: {
        totalDurationMs: performance.now() - started,
        resumeLatencyMs,
        continuationPacketBytes: Buffer.byteLength(JSON.stringify(bundle)),
        maxPacketBudgetBytes: MAX_PACKET_BYTES,
        workloadEvents: snapshot.events.length,
        dispatchCount: effects.length,
        duplicateEffects: effects.length - new Set(effects).size,
        pendingJournalEntries: pending.entries.length,
        beforeReplay,
        afterReplay,
        beforeRevocationAttempt,
        afterRevocationAttempt,
        grantFencing: {
          activeGrantId: grant.grantId,
          priorGeneration: bundle.writer.generation,
          nextGeneration: state.generation,
        },
      },
      provenance: {
        host: process.platform,
        node: process.version,
        architecture: process.arch,
        executor: 'node-single-process-fixture',
        dispatchTargets: ['in-memory-artifact-adapter'],
      },
    }
  } finally {
    const cleanupTarget = realpathSync(directory)
    if (dirname(cleanupTarget) !== tempRoot || !basename(cleanupTarget).startsWith('af-pilot-journal-'))
      throw new Error('Refusing cleanup outside the pilot temporary directory')
    rmSync(cleanupTarget, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProcessPilot({
    fixture:
      process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--fixture'),
  })
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      process.exitCode = report.passed ? 0 : 1
    })
    .catch((error) => {
      process.stderr.write(`Process pilot failed: ${error.message}\n`)
      process.exitCode = 1
    })
}
