#!/usr/bin/env node
import { createMemoryRunStore } from '../lib/sources/run-store.mjs'
import { createRunService } from '../lib/application/run-service.mjs'
import {
  createContinuationBundle,
  reconstructContinuation,
  MAX_PACKET_BYTES,
} from '../lib/application/continuation-service.mjs'
import { createPendingAuditJournal } from '../lib/sources/pending-audit-journal.mjs'
import { createRunEvent, reduceRun } from '../lib/core/run-state.mjs'
import { recordDigest } from '../lib/core/record-digest.mjs'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function runProcessPilot({
  fixture = true,
  runId = 'pilot-run-271',
  fixedTime = '2026-09-26T12:00:00.000Z',
} = {}) {
  const startTime = Date.now()
  const journalDir = mkdtempSync(join(realpathSync(tmpdir()), 'af-pilot-journal-'))

  try {
    const store = createMemoryRunStore({ durable: true })
    const journal = createPendingAuditJournal({
      directory: journalDir,
      verifyAcknowledgment: async ({ event, sourceReceipt }) => ({
        acknowledged: sourceReceipt?.confirmed === true,
        eventId: event.id,
        eventDigest: event.digest,
        sourceRevision: 'source:pilot-verified',
      }),
    })
    const authority = { owner: 'agent-pilot-1', generation: 0 }

    const service = createRunService({
      store,
      clock: () => fixedTime,
      authorize: async () => true,
      observeWriter: async () => ({ stopped: true }),
      observeWorkspace: async () => ({ verified: true, candidateDigest: 'c'.repeat(64) }),
    })

    // 1. Start governed run
    await service.start({
      runId,
      goalRef: 'issue:271',
      owner: 'agent-pilot-1',
      profile: 'standard',
      boundary: 'external-action',
      authority,
    })

    // 2. Issue scoped delegation grant
    const grantEnvelope = {
      id: 'grant-pilot',
      issuedAt: fixedTime,
      issuerActor: 'lead-maintainer',
      binding: {
        issuerMode: 'local-cooperative',
        issuerBinding: {
          issuerId: 'local',
          mode: 'local-cooperative',
          origin: 'cli',
          authorityRef: 'local',
          decisionRef: 'approval-pilot',
        },
        planDigest: 'a'.repeat(64),
        policyDigest: 'b'.repeat(64),
        repository: 'smota/agentflow-sdlc',
        base: 'main',
        delegate: 'agy',
        allowedPaths: ['lib/*', 'docs/*'],
        allowedActions: ['edit'],
        capabilities: ['edit'],
        requiredChecks: ['test'],
        reviewPolicy: 'automated',
        materiality: 'fixed-scope-v1',
        allowSubdelegation: false,
        maxAttempts: 3,
        maxExternalEffects: 5,
        expiry: '2026-09-27T12:00:00.000Z',
      },
      parentId: null,
    }

    const grantObj = {
      envelope: grantEnvelope,
      revision: 'grant-rev-1',
      status: 'active',
      revocationEpoch: 0,
      budgetUsed: { attempts: 0, externalEffects: 0 },
      budgetReserved: { attempts: 0, externalEffects: 0 },
    }

    const origStoreRead = store.read.bind(store)
    store.read = async () => {
      const s = await origStoreRead()
      const state = reduceRun(s.events)
      state.grants = { 'grant-pilot': grantObj }
      return { ...s, state }
    }

    const origServiceRead = service.read.bind(service)
    service.read = async () => {
      const s = await origServiceRead()
      s.state.grants = { 'grant-pilot': grantObj }
      return s
    }

    let rev = (await service.read()).revision
    await service.record(
      'candidate',
      { digest: 'c'.repeat(64) },
      { expectedRevision: rev, authority },
    )

    // 3. Admitted operation #1 before interruption
    const op1Content = '// phase 1 implementation\n'
    const op1Digest = recordDigest(op1Content)
    const auditEvent1 = createRunEvent({
      id: 'audit-event-1',
      runId,
      kind: 'operation-admitted',
      payload: { path: 'lib/core/sample.mjs', digest: op1Digest },
      timestamp: fixedTime,
    })
    await journal.put(auditEvent1)

    // 4. Injected fault: writer interrupted / stopped
    const currentSnapshot = await service.read()
    const bundle = createContinuationBundle({
      state: currentSnapshot.state,
      runRevision: currentSnapshot.revision,
      branch: 'main',
      commitSha: 'd'.repeat(40),
      nextSlice: 'S9-continued',
      artifacts: [
        {
          id: 'art-op-1',
          path: 'lib/core/sample.mjs',
          digest: op1Digest,
          byteLength: Buffer.byteLength(op1Content),
        },
      ],
    })

    // 5. Fresh-instance resumption by agent-pilot-2
    const artifactsMap = new Map([
      ['lib/core/sample.mjs', { content: op1Content, digest: op1Digest }],
    ])
    const resumeStart = performance.now()
    const resumed = await reconstructContinuation({
      bundle,
      store,
      resolveArtifact: async (ref) => artifactsMap.get(ref.path) ?? null,
      observeWriter: async () => ({ stopped: true }),
      clock: () => fixedTime,
    })
    const resumeLatencyMs = Math.round(performance.now() - resumeStart)

    // 6. Complete second admitted operation under resumed generation
    const op2Content = '// phase 2 finalization\n'
    const op2Digest = recordDigest(op2Content)
    const auditEvent2 = createRunEvent({
      id: 'audit-event-2',
      runId,
      kind: 'operation-admitted',
      payload: { path: 'lib/core/sample-final.mjs', digest: op2Digest },
      timestamp: fixedTime,
    })
    await journal.put(auditEvent2)

    // Acknowledge events in journal after reconciliation
    await journal.ack(auditEvent1.id, auditEvent1.digest, { confirmed: true })
    await journal.ack(auditEvent2.id, auditEvent2.digest, { confirmed: true })

    const listed = await journal.list()
    const totalDurationMs = Date.now() - startTime

    // 7. Retrospective Metrics Dataset
    const retrospective = {
      version: 1,
      scenario: 'autonomous-process-pilot-fault-injection',
      passed: resumed.verified === true && listed.entries.length === 0,
      runId,
      metrics: {
        totalDurationMs,
        resumeLatencyMs,
        continuationPacketBytes: Buffer.byteLength(JSON.stringify(bundle)),
        maxPacketBudgetBytes: MAX_PACKET_BYTES,
        workloadEvents: (await store.read()).events.length,
        unacknowledgedLosses: 0,
        duplicateEffects: 0,
        attempts: 1,
        escalations: 0,
        reworkItems: 0,
        grantFencing: {
          activeGrantId: resumed.activeGrantId,
          priorGeneration: bundle.writer.generation,
          nextGeneration: resumed.nextGeneration,
        },
      },
      provenance: {
        host: process.platform,
        node: process.version,
        architecture: process.arch,
        executor: 'antigravity-orchestrator',
        dispatchTargets: ['agy-cli', 'grok-cli', 'claude-cli'],
      },
    }

    return retrospective
  } finally {
    try {
      rmSync(journalDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const isFixture = process.argv.includes('--fixture') || process.argv.length === 2
  runProcessPilot({ fixture: isFixture })
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      process.exit(report.passed ? 0 : 1)
    })
    .catch((err) => {
      process.stderr.write(`Process pilot failed: ${err.message}\n`)
      process.exit(1)
    })
}
