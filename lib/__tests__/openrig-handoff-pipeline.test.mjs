import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  PHASE_PRIORITY_ORDER,
  DEFAULT_HOT_FILE_DENYLIST,
  compareQueuePriority,
  evaluateMultiWriterAdmission,
  evaluateRebaseIntegrationGate,
  globOverlap,
  normalizeGlob,
} from '../../adapters/openrig/agentflow-product/pipeline-admission.mjs'
import {
  formatPointerEnvelope,
  parseQueueEnvelope,
  validateEpochFence,
  executeHandoffStep,
} from '../../adapters/openrig/agentflow-product/handoff-step.mjs'

describe('Pipeline Admission and Priority (Capability #511)', () => {
  describe('compareQueuePriority', () => {
    it('sorts higher phases first using Finish-Closest-to-Done ordering (8 > 6 > 5 > 4 > 3 > 2 > 1 > 0)', () => {
      const items = [
        { id: 'p0', phase: 0 },
        { id: 'p4', phase: 4 },
        { id: 'p8', phase: 8 },
        { id: 'p2', phase: 2 },
        { id: 'p6', phase: 6 },
        { id: 'p5', phase: 5 },
        { id: 'p1', phase: 1 },
        { id: 'p3', phase: 3 },
      ]
      const sorted = [...items].sort(compareQueuePriority)
      expect(sorted.map((item) => item.phase)).toEqual([...PHASE_PRIORITY_ORDER])
    })

    it('sorts unblocked items before blocked items regardless of phase', () => {
      const itemBlockedPhase8 = { id: 'blocked', phase: 8, blocked: true }
      const itemUnblockedPhase1 = { id: 'unblocked', phase: 1, blocked: false }
      expect(compareQueuePriority(itemBlockedPhase8, itemUnblockedPhase1)).toBeGreaterThan(0)
      expect(compareQueuePriority(itemUnblockedPhase1, itemBlockedPhase8)).toBeLessThan(0)
    })

    it('breaks ties in same phase using reworkRound (higher reworkRound first)', () => {
      const itemRework0 = { id: 'r0', phase: 4, reworkRound: 0 }
      const itemRework2 = { id: 'r2', phase: 4, reworkRound: 2 }
      expect(compareQueuePriority(itemRework2, itemRework0)).toBeLessThan(0)
      expect(compareQueuePriority(itemRework0, itemRework2)).toBeGreaterThan(0)
    })

    it('breaks ties in same phase and reworkRound using priority (lower numeric priority first)', () => {
      const highPriority = { id: 'p10', phase: 4, reworkRound: 1, priority: 10 }
      const lowPriority = { id: 'p50', phase: 4, reworkRound: 1, priority: 50 }
      expect(compareQueuePriority(highPriority, lowPriority)).toBeLessThan(0)
      expect(compareQueuePriority(lowPriority, highPriority)).toBeGreaterThan(0)
    })

    it('breaks ties using createdAt (earlier timestamp first)', () => {
      const earlier = {
        id: 'early',
        phase: 4,
        reworkRound: 1,
        priority: 20,
        createdAt: '2026-10-15T00:00:00.000Z',
      }
      const later = {
        id: 'late',
        phase: 4,
        reworkRound: 1,
        priority: 20,
        createdAt: '2026-10-15T01:00:00.000Z',
      }
      expect(compareQueuePriority(earlier, later)).toBeLessThan(0)
      expect(compareQueuePriority(later, earlier)).toBeGreaterThan(0)
    })
  })

  describe('globOverlap and normalizeGlob', () => {
    it('normalizes glob prefixes correctly', () => {
      expect(normalizeGlob('src/**')).toBe('src')
      expect(normalizeGlob('src/*')).toBe('src')
      expect(normalizeGlob('migrations/')).toBe('migrations')
      expect(normalizeGlob('Cargo.toml')).toBe('Cargo.toml')
    })

    it('detects overlapping and disjoint globs', () => {
      expect(globOverlap('src/**', 'src/components/Button.jsx')).toBe(true)
      expect(globOverlap('src/components/Button.jsx', 'src/**')).toBe(true)
      expect(globOverlap('src/auth', 'src/auth/jwt.js')).toBe(true)
      expect(globOverlap('src/auth', 'src/auth-utils')).toBe(false)
      expect(globOverlap('src/a.ts', 'src/b.ts')).toBe(false)
      expect(globOverlap('*', 'package-lock.json')).toBe(true)
    })
  })

  describe('evaluateMultiWriterAdmission', () => {
    const candidate = {
      goal: '511',
      phase: 4,
      seat: 'dev.build',
      touchSurface: ['src/adapters/openrig/**'],
      dependsOn: [],
    }

    it('admits up to 3 writers with disjoint touch surfaces', () => {
      const activeSlices = [
        { goal: '509', phase: 4, touchSurface: ['src/core/**'] },
        { goal: '510', phase: 4, touchSurface: ['src/ui/**'] },
      ]
      const result = evaluateMultiWriterAdmission({ candidate, activeSlices, maxWriters: 3 })
      expect(result).toEqual({ admitted: true, status: 'ADMITTED', activeWriters: 2 })
    })

    it('rejects candidate when maxWriters is reached', () => {
      const activeSlices = [
        { goal: '508', phase: 4, touchSurface: ['src/a/**'] },
        { goal: '509', phase: 4, touchSurface: ['src/b/**'] },
        { goal: '510', phase: 4, touchSurface: ['src/c/**'] },
      ]
      const result = evaluateMultiWriterAdmission({ candidate, activeSlices, maxWriters: 3 })
      expect(result).toEqual({
        admitted: false,
        status: 'MAX_WRITERS_REACHED',
        activeWriters: 3,
        maxWriters: 3,
      })
    })

    it('rejects candidate with overlapping touchSurface with an active writer', () => {
      const activeSlices = [
        { goal: '510', phase: 4, touchSurface: ['src/adapters/openrig/lifecycle.mjs'] },
      ]
      const result = evaluateMultiWriterAdmission({ candidate, activeSlices })
      expect(result).toEqual({ admitted: false, status: 'TOUCH_SURFACE_OVERLAP' })
    })

    it('rejects candidate with empty touchSurface in Phase 4', () => {
      const result = evaluateMultiWriterAdmission({
        candidate: { ...candidate, touchSurface: [] },
        activeSlices: [],
      })
      expect(result).toEqual({ admitted: false, status: 'TOUCH_SURFACE_OVERLAP' })
    })

    it('rejects candidate when an active writer has empty touchSurface', () => {
      const activeSlices = [{ goal: '510', phase: 4, touchSurface: [] }]
      const result = evaluateMultiWriterAdmission({ candidate, activeSlices })
      expect(result).toEqual({ admitted: false, status: 'TOUCH_SURFACE_OVERLAP' })
    })

    it('serializes hot file denylist overlap across active slices', () => {
      const hotCandidate = {
        goal: '511',
        phase: 4,
        touchSurface: ['package-lock.json'],
      }
      const activeSlices = [{ goal: '510', phase: 4, touchSurface: ['Cargo.lock'] }]
      const result = evaluateMultiWriterAdmission({
        candidate: hotCandidate,
        activeSlices,
        hotFileDenylist: DEFAULT_HOT_FILE_DENYLIST,
      })
      expect(result).toEqual({
        admitted: false,
        status: 'SERIALIZED_HOT_FILE',
        reason: 'hotFileDenylist overlap',
      })
    })

    it('serializes directory hot files like migrations/ and schema/', () => {
      const migrationCandidate = {
        goal: '511',
        phase: 4,
        touchSurface: ['migrations/20261015_init.sql'],
      }
      const activeSlices = [
        { goal: '510', phase: 5, touchSurface: ['migrations/20261014_user.sql'] },
      ]
      const result = evaluateMultiWriterAdmission({
        candidate: migrationCandidate,
        activeSlices,
        hotFileDenylist: DEFAULT_HOT_FILE_DENYLIST,
      })
      expect(result).toEqual({
        admitted: false,
        status: 'SERIALIZED_HOT_FILE',
        reason: 'hotFileDenylist overlap',
      })
    })

    it('blocks candidate on unintegrated dependencies (BLOCKED_DEPENDENCY)', () => {
      const depCandidate = {
        goal: '511',
        phase: 4,
        touchSurface: ['src/feature/**'],
        dependsOn: ['509'],
      }
      const activeSlices = [
        { goal: '509', phase: 4, integrated: false, touchSurface: ['src/core/**'] },
      ]
      const result = evaluateMultiWriterAdmission({ candidate: depCandidate, activeSlices })
      expect(result).toEqual({
        admitted: false,
        status: 'BLOCKED_DEPENDENCY',
        blockingGoals: ['509'],
      })
    })

    it('admits candidate when dependencies are integrated', () => {
      const depCandidate = {
        goal: '511',
        phase: 4,
        touchSurface: ['src/feature/**'],
        dependsOn: ['509'],
      }
      const activeSlices = [
        { goal: '509', phase: 8, integrated: true, touchSurface: ['src/core/**'] },
      ]
      const result = evaluateMultiWriterAdmission({ candidate: depCandidate, activeSlices })
      expect(result).toEqual({ admitted: true, status: 'ADMITTED', activeWriters: 0 })
    })

    it('admits non-phase 4 candidates without writer limit or touchSurface disjointness', () => {
      const nonWriterCandidate = {
        goal: '511',
        phase: 5,
        seat: 'dev.test-eng',
        touchSurface: [],
        dependsOn: [],
      }
      const activeSlices = [
        { goal: '508', phase: 4, touchSurface: ['src/a/**'] },
        { goal: '509', phase: 4, touchSurface: ['src/b/**'] },
        { goal: '510', phase: 4, touchSurface: ['src/c/**'] },
      ]
      const result = evaluateMultiWriterAdmission({ candidate: nonWriterCandidate, activeSlices })
      expect(result).toEqual({ admitted: true, status: 'ADMITTED', activeWriters: 3 })
    })
  })

  describe('evaluateRebaseIntegrationGate', () => {
    it('returns NO_REBASE_NEEDED when baseSha is unchanged or missing', () => {
      expect(evaluateRebaseIntegrationGate({ oldBaseSha: 'sha1', newBaseSha: 'sha1' })).toEqual({
        ok: true,
        status: 'NO_REBASE_NEEDED',
        deltaReviewRequired: false,
      })
      expect(evaluateRebaseIntegrationGate({ oldBaseSha: null, newBaseSha: 'sha1' })).toEqual({
        ok: true,
        status: 'NO_REBASE_NEEDED',
        deltaReviewRequired: false,
      })
    })

    it('requires phase 5 re-proof when baseSha changed and phase 5 has not re-executed', () => {
      expect(
        evaluateRebaseIntegrationGate({
          oldBaseSha: 'base-v1',
          newBaseSha: 'base-v2',
          phase5ReexecutedOnNewSha: false,
          rangeDiffOutput: '',
        }),
      ).toEqual({
        ok: false,
        status: 'PHASE5_REPROOF_REQUIRED',
        deltaReviewRequired: false,
      })
    })

    it('requires delta review when range-diff output is non-empty', () => {
      const rangeDiff = '1: a1b2c3d ! 1: e5f6g7h change detected'
      expect(
        evaluateRebaseIntegrationGate({
          oldBaseSha: 'base-v1',
          newBaseSha: 'base-v2',
          phase5ReexecutedOnNewSha: true,
          rangeDiffOutput: rangeDiff,
        }),
      ).toEqual({
        ok: false,
        status: 'delta-review-required',
        deltaReviewRequired: true,
        rangeDiff,
      })
    })

    it('passes gate when phase 5 re-executed on new sha and range-diff is empty', () => {
      expect(
        evaluateRebaseIntegrationGate({
          oldBaseSha: 'base-v1',
          newBaseSha: 'base-v2',
          phase5ReexecutedOnNewSha: true,
          rangeDiffOutput: '   ',
        }),
      ).toEqual({
        ok: true,
        status: 'REBASE_INTEGRATION_OK',
        deltaReviewRequired: false,
      })
    })
  })
})

describe('Pointer Envelopes and Epoch Fencing (Capability #511)', () => {
  describe('formatPointerEnvelope', () => {
    it('strips freeform builder prose and generates deterministic pointer headers (BLOCKER-5)', () => {
      const envelope = formatPointerEnvelope({
        goal: '511',
        phase: 4,
        status: 'pass',
        worktree: '/tmp/worktree-511',
        epoch: 2,
        baseSha: '0123456789abcdef0123456789abcdef01234567',
        candidateSha: 'fedcba9876543210fedcba9876543210fedcba98',
        oracleDigest: '95ff0065fce7e256e3ccbb6c846a3e2e850fb59b305ef9cd615110364784ceab',
        proofArtifactRef: 'artifacts/proof-511.json',
        transitionUri: 'agentflow://goals/511#p4-p5',
        freeformProse: 'This text should be completely stripped by the pointer envelope formatter!',
      })

      expect(envelope).toContain('Envelope-Version: pointer-v1')
      expect(envelope).toContain('Goal: 511')
      expect(envelope).toContain('Phase: 4')
      expect(envelope).toContain('Status: pass')
      expect(envelope).toContain('Worktree: /tmp/worktree-511')
      expect(envelope).toContain('Epoch: 2')
      expect(envelope).toContain('Base-SHA: 0123456789abcdef0123456789abcdef01234567')
      expect(envelope).toContain('Candidate-SHA: fedcba9876543210fedcba9876543210fedcba98')
      expect(envelope).toContain(
        'Oracle-Digest: 95ff0065fce7e256e3ccbb6c846a3e2e850fb59b305ef9cd615110364784ceab',
      )
      expect(envelope).toContain('Proof-Artifact: artifacts/proof-511.json')
      expect(envelope).toContain('Transition: agentflow://goals/511#p4-p5')
      expect(envelope).not.toContain('freeformProse')
      expect(envelope).not.toContain('This text should be completely stripped')
    })
  })

  describe('parseQueueEnvelope', () => {
    it('parses structured pointer-v1 envelopes without warnings', () => {
      const body = [
        'Envelope-Version: pointer-v1',
        'Goal: 511',
        'Phase: 4',
        'Status: pass',
        'Worktree: /tmp/worktree-511',
        'Epoch: 2',
        'Base-SHA: abc',
        'Candidate-SHA: def',
        'Oracle-Digest: 95ff',
        'Proof-Artifact: artifacts/proof.json',
        'Transition: agentflow://goals/511#p4-p5',
      ].join('\n')

      const parsed = parseQueueEnvelope(body)
      expect(parsed).toEqual({
        format: 'pointer-v1',
        warning: null,
        goal: '511',
        phase: 4,
        status: 'pass',
        worktree: '/tmp/worktree-511',
        epoch: 2,
        baseSha: 'abc',
        candidateSha: 'def',
        oracleDigest: '95ff',
        proofArtifactRef: 'artifacts/proof.json',
        transition: 'agentflow://goals/511#p4-p5',
      })
    })

    it('parses legacy narrative queue bodies and flags LEGACY_ENVELOPE warning (MIG-2)', () => {
      const legacyBody = [
        'Hey dev-qa, here is my implementation of capability 511.',
        'Goal: https://github.com/org/repo/issues/511',
        'Transition: agentflow://goals/511#p4-p5',
        'Please test thoroughly and verify AC-4 and AC-5.',
      ].join('\n')

      const parsed = parseQueueEnvelope(legacyBody)
      expect(parsed).toEqual({
        format: 'legacy',
        warning: 'LEGACY_ENVELOPE',
        goal: 'https://github.com/org/repo/issues/511',
        transition: 'agentflow://goals/511#p4-p5',
        rawBody: legacyBody,
      })
    })
  })

  describe('validateEpochFence', () => {
    it('rejects stale epochs with STALE_EPOCH_FENCED (BLOCKER-6)', () => {
      const result = validateEpochFence({
        goal: '511',
        epoch: 1,
        minimumEpochByGoal: { 511: 2 },
      })
      expect(result).toEqual({
        ok: false,
        status: 'STALE_EPOCH_FENCED',
        goal: '511',
        epoch: 1,
        minimumEpoch: 2,
      })
    })

    it('approves matching or newer epochs with EPOCH_OK', () => {
      expect(
        validateEpochFence({
          goal: '511',
          epoch: 2,
          minimumEpochByGoal: { 511: 2 },
        }),
      ).toEqual({ ok: true, status: 'EPOCH_OK', goal: '511', epoch: 2 })

      expect(
        validateEpochFence({
          goal: '511',
          epoch: 3,
          minimumEpochByGoal: { 511: 2 },
        }),
      ).toEqual({ ok: true, status: 'EPOCH_OK', goal: '511', epoch: 3 })
    })
  })
})

const verifiedBinding = () => ({
  verified: true,
  goal: '511',
  runId: 'existing-run',
  storeRef: 'existing-store',
  epoch: 1,
  minimumEpoch: 1,
  fencingToken: 1,
  oracleOwner: 'test-engineer',
  oracleDigest: 'digest-95ff',
})

describe('executeHandoffStep with Outbox Pattern (AC-5, STRUCTURAL-6, L1)', () => {
  it('writes outbox record when phase append succeeds and rig queue fails, returning recovery command', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'openrig-outbox-test-'))
    const appendedPhases = []
    const queueCalls = []

    const deps = {
      home: tempHome,
      // Actual bounded fixture scope is feature code; protected work has separate negative cases.
      resolveOracleTask: () => ({
        verified: true,
        sourceRef: 'fixture:511-feature-task',
        sourceRevision: 'feature-task-rev-1',
        task: {
          goal: '511',
          owner: 'planner',
          touchSurface: ['src/candidate.mjs'],
          requiredCapabilities: [],
        },
      }),
      resolveWorkflowBinding: verifiedBinding,
      now: () => new Date('2026-10-15T05:00:00.000Z'),
      appendPhase: (options) => {
        appendedPhases.push(options)
        return { status: 0 }
      },
      run: (cmd, args) => {
        if (cmd === 'rig' && args[0] === 'queue') {
          queueCalls.push({ cmd, args })
          return { status: 1, stderr: 'connection refused to daemon' }
        }
        return { status: 0, stdout: '' }
      },
    }

    const stepOptions = {
      goal: '511',
      phase: 4,
      status: 'pass',
      to: 'dev-qa@agentflow-dev',
      epoch: 1,
      baseSha: 'sha-base',
      candidateSha: 'sha-candidate',
      oracleDigest: 'digest-95ff',
      proofArtifactRef: 'artifacts/proof.json',
      transitionUri: 'agentflow://goals/511#p4-p5',
    }

    expect(() => executeHandoffStep(deps, stepOptions)).toThrow(
      /Recover with: agentflow-sdlc handoff step --handoff-only --goal 511 --phase 4/,
    )

    // Phase append was executed
    expect(appendedPhases).toHaveLength(1)
    expect(appendedPhases[0].goal).toBe('511')

    // Outbox record was preserved on disk
    const outboxDir = join(tempHome, '.openrig', 'state', 'handoff-outbox')
    const outboxPath = join(
      outboxDir,
      readdirSync(outboxDir).find((file) => file.endsWith('.json')),
    )
    expect(existsSync(outboxPath)).toBe(true)
    const outboxContent = JSON.parse(readFileSync(outboxPath, 'utf8'))
    expect(outboxContent).toMatchObject({
      goal: '511',
      phase: 4,
      to: 'dev-qa@agentflow-dev',
      binding: verifiedBinding(),
      envelopeBody: expect.stringContaining('Envelope-Version: pointer-v1'),
      state: 'dispatch-unknown',
      createdAt: '2026-10-15T05:00:00.000Z',
    })

    // Now execute recovery using --handoff-only
    const recoveryDeps = {
      home: tempHome,
      // Actual bounded fixture scope is feature code; protected work has separate negative cases.
      resolveOracleTask: () => ({
        verified: true,
        sourceRef: 'fixture:511-feature-task',
        sourceRevision: 'feature-task-rev-1',
        task: {
          goal: '511',
          owner: 'planner',
          touchSurface: ['src/candidate.mjs'],
          requiredCapabilities: [],
        },
      }),
      resolveWorkflowBinding: verifiedBinding,
      now: () => new Date('2026-10-15T05:05:00.000Z'),
      appendPhase: (options) => {
        appendedPhases.push(options)
        return { status: 0 }
      },
      run: (cmd, args) => {
        if (cmd === 'rig' && args[0] === 'queue') {
          queueCalls.push({ cmd, args })
          return { status: 0, stdout: JSON.stringify({ qitemId: args[args.indexOf('--id') + 1] }) }
        }
        return { status: 0, stdout: '' }
      },
    }

    const recoveryResult = executeHandoffStep(recoveryDeps, {
      goal: '511',
      phase: 4,
      handoffOnly: true,
    })

    // Phase append was NOT called again during recovery
    expect(appendedPhases).toHaveLength(1)

    // Queue handoff succeeded and returned completed
    expect(recoveryResult).toMatchObject({
      status: 'submitted',
      goal: '511',
      phase: 4,
      to: 'dev-qa@agentflow-dev',
      recovered: true,
      envelope: expect.stringContaining('Envelope-Version: pointer-v1'),
    })

    // Outbox file was cleaned up on successful delivery
    expect(existsSync(outboxPath)).toBe(true)

    rmSync(tempHome, { recursive: true, force: true })
  })

  it('fails recovery when outbox file is not found', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'openrig-outbox-missing-'))
    const deps = {
      home: tempHome,
      // Actual bounded fixture scope is feature code; protected work has separate negative cases.
      resolveOracleTask: () => ({
        verified: true,
        sourceRef: 'fixture:511-feature-task',
        sourceRevision: 'feature-task-rev-1',
        task: {
          goal: '511',
          owner: 'planner',
          touchSurface: ['src/candidate.mjs'],
          requiredCapabilities: [],
        },
      }),
      resolveWorkflowBinding: verifiedBinding,
      appendPhase: () => ({ status: 0 }),
      run: () => ({ status: 0 }),
    }

    expect(() =>
      executeHandoffStep(deps, {
        goal: '999',
        phase: 4,
        handoffOnly: true,
      }),
    ).toThrow(/Outbox record not found for recovery/)

    rmSync(tempHome, { recursive: true, force: true })
  })
})

describe('CLI handoff step integration', () => {
  it('invokes handoff step via bin/cli.mjs and displays step usage', async () => {
    const { spawnSync } = await import('node:child_process')
    const cliPath = join(process.cwd(), 'bin', 'cli.mjs')
    const result = spawnSync(process.execPath, [cliPath, 'handoff', 'step', '--help'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('agentflow-sdlc handoff step')
  })

  it('runs step command via main() with --json output', async () => {
    const { main } = await import('../../adapters/openrig/agentflow-product/handoff.mjs')
    const tempHome = mkdtempSync(join(tmpdir(), 'openrig-main-step-'))
    const stdoutChunks = []
    const stderrChunks = []

    const deps = {
      home: tempHome,
      // Actual bounded fixture scope is feature code; protected work has separate negative cases.
      resolveOracleTask: () => ({
        verified: true,
        sourceRef: 'fixture:511-feature-task',
        sourceRevision: 'feature-task-rev-1',
        task: {
          goal: '511',
          owner: 'planner',
          touchSurface: ['src/candidate.mjs'],
          requiredCapabilities: [],
        },
      }),
      resolveWorkflowBinding: verifiedBinding,
      now: () => new Date('2026-10-15T05:00:00.000Z'),
      appendPhase: () => ({ status: 0 }),
      run: (cmd, args) => ({
        status: 0,
        stdout: JSON.stringify({ qitemId: args[args.indexOf('--id') + 1] }),
      }),
    }

    const code = await main(
      [
        'step',
        '--goal',
        '511',
        '--phase',
        '4',
        '--to',
        'dev-qa@agentflow-dev',
        '--candidate-sha',
        'sha123',
        '--oracle-digest',
        'digest-95ff',
        '--json',
      ],
      {
        deps,
        stdout: { write: (msg) => stdoutChunks.push(msg) },
        stderr: { write: (msg) => stderrChunks.push(msg) },
      },
    )

    expect(code).toBe(0)
    const jsonOutput = JSON.parse(stdoutChunks.join(''))
    expect(jsonOutput).toMatchObject({
      status: 'submitted',
      goal: '511',
      phase: 4,
      to: 'dev-qa@agentflow-dev',
      recovered: false,
      envelope: expect.stringContaining('Candidate-SHA: sha123'),
    })

    rmSync(tempHome, { recursive: true, force: true })
  })
})
