import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

import {
  ROLE_CONTINUITY_CLASSES,
  DEFAULT_PHASE_BUDGETS,
  REQUIRED_RESTORE_PACKET_FIELDS,
  evaluatePrePhaseHeadroom,
  validateRestorePacket,
  consultRetiredPredecessor,
  resolveLineageLedgerPath,
  appendLineageLedgerEntry,
  writeProofLogArtifact,
} from '../../adapters/openrig/continuity-policy.mjs'

describe('OpenRig Continuity Policy (#513)', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openrig-continuity-test-'))
  })

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('constants export contracts', () => {
    it('defines role continuity classes matching framework specs', () => {
      expect(ROLE_CONTINUITY_CLASSES['dev.build-jr']).toBe('ephemeral-slice')
      expect(ROLE_CONTINUITY_CLASSES['dev.build']).toBe('ephemeral-slice')
      expect(ROLE_CONTINUITY_CLASSES['dev.build-sr']).toBe('ephemeral-slice')
      expect(ROLE_CONTINUITY_CLASSES['dev.qa']).toBe('ephemeral-slice')
      expect(ROLE_CONTINUITY_CLASSES['dev.test-eng']).toBe('ephemeral-slice')
      expect(ROLE_CONTINUITY_CLASSES['rev.review']).toBe('isolated-review')
      expect(ROLE_CONTINUITY_CLASSES['orch.arch']).toBe('stateful-lead')
      expect(ROLE_CONTINUITY_CLASSES['pm.manager']).toBe('stateful-lead')
      expect(ROLE_CONTINUITY_CLASSES['pm.analyst']).toBe('stateful-lead')
      expect(Object.isFrozen(ROLE_CONTINUITY_CLASSES)).toBe(true)
    })

    it('defines default phase budgets', () => {
      expect(DEFAULT_PHASE_BUDGETS[0]).toBe(15000)
      expect(DEFAULT_PHASE_BUDGETS[1]).toBe(20000)
      expect(DEFAULT_PHASE_BUDGETS[2]).toBe(25000)
      expect(DEFAULT_PHASE_BUDGETS[3]).toBe(35000)
      expect(DEFAULT_PHASE_BUDGETS[4]).toBe(45000)
      expect(DEFAULT_PHASE_BUDGETS[5]).toBe(30000)
      expect(DEFAULT_PHASE_BUDGETS[6]).toBe(25000)
      expect(DEFAULT_PHASE_BUDGETS[8]).toBe(20000)
      expect(Object.isFrozen(DEFAULT_PHASE_BUDGETS)).toBe(true)
    })

    it('defines the 16 required restore-packet fields', () => {
      expect(REQUIRED_RESTORE_PACKET_FIELDS).toHaveLength(16)
      expect(REQUIRED_RESTORE_PACKET_FIELDS).toEqual([
        'goalUri',
        'activeSlices',
        'phasePositions',
        'unmergedAcceptedBranches',
        'oracleDigestsByGoal',
        'touchSurfaceLocks',
        'minimumEpochByGoal',
        'reworkCountsByGoal',
        'supervisorHealthState',
        'lastHeartbeatAt',
        'activePlatformBindings',
        'pendingHandoffOutbox',
        'architecturalInvariants',
        'openFollowUps',
        'predecessorSessionId',
        'createdAt',
      ])
      expect(Object.isFrozen(REQUIRED_RESTORE_PACKET_FIELDS)).toBe(true)
    })
  })

  describe('evaluatePrePhaseHeadroom', () => {
    it('allows continuing session when headroom is sufficient for ephemeral builder', () => {
      const decision = evaluatePrePhaseHeadroom({
        seat: 'dev.build-jr',
        nextPhase: 4,
        remainingTokens: 100000,
        reworkRounds: 0,
        currentSlicePhase: 3,
      })
      expect(decision).toEqual({
        action: 'CONTINUE_SESSION',
        continuityClass: 'ephemeral-slice',
        seat: 'dev.build-jr',
        requiredHeadroom: 67500, // 1.5 * 45000
        remainingTokens: 100000,
      })
    })

    it('triggers REBUILD_AT_PHASE_BOUNDARY when remaining tokens < 1.5 * budget (AC-6)', () => {
      const decision = evaluatePrePhaseHeadroom({
        seat: 'dev.build',
        nextPhase: 4, // budget 45000, required 67500
        remainingTokens: 50000,
        reworkRounds: 0,
      })
      expect(decision).toEqual({
        action: 'REBUILD_AT_PHASE_BOUNDARY',
        continuityClass: 'ephemeral-slice',
        seat: 'dev.build',
        reason: 'insufficient-phase-headroom',
        requiredHeadroom: 67500,
        remainingTokens: 50000,
      })
    })

    it('triggers REBUILD_AT_PHASE_BOUNDARY when rework rounds >= 1', () => {
      const decision = evaluatePrePhaseHeadroom({
        seat: 'dev.test-eng',
        nextPhase: 5, // budget 30000, required 45000
        remainingTokens: 120000,
        reworkRounds: 1,
      })
      expect(decision).toEqual({
        action: 'REBUILD_AT_PHASE_BOUNDARY',
        continuityClass: 'ephemeral-slice',
        seat: 'dev.test-eng',
        reason: 'rework-residue',
        requiredHeadroom: 45000,
        remainingTokens: 120000,
      })
    })

    it('triggers REBUILD_EPHEMERAL_SEAT for builders once a slice reaches Phase 6+', () => {
      const decision = evaluatePrePhaseHeadroom({
        seat: 'dev.build-jr',
        nextPhase: 6,
        remainingTokens: 150000,
        reworkRounds: 0,
        currentSlicePhase: 6,
      })
      expect(decision).toEqual({
        action: 'REBUILD_EPHEMERAL_SEAT',
        continuityClass: 'ephemeral-slice',
        seat: 'dev.build-jr',
        reason: 'slice-completed-phase-6-plus',
        requiredHeadroom: 37500, // 1.5 * 25000
        remainingTokens: 150000,
      })
    })

    it('always returns ISOLATED_REVIEW_SESSION for rev.review seat', () => {
      const decision = evaluatePrePhaseHeadroom({
        seat: 'rev.review',
        nextPhase: 6,
        remainingTokens: 190000,
        reworkRounds: 0,
      })
      expect(decision).toEqual({
        action: 'ISOLATED_REVIEW_SESSION',
        continuityClass: 'isolated-review',
        seat: 'rev.review',
        reason: 'zero-confirmation-bias-per-review',
        requiredHeadroom: 37500,
        remainingTokens: 190000,
      })
    })

    it('handles Class C stateful leads with PLANNED_HANDOVER_RESTORE_PACKET on low headroom', () => {
      const decision = evaluatePrePhaseHeadroom({
        seat: 'orch.arch',
        nextPhase: 3, // budget 35000, required 52500
        remainingTokens: 30000,
        reworkRounds: 0,
      })
      expect(decision).toEqual({
        action: 'PLANNED_HANDOVER_RESTORE_PACKET',
        continuityClass: 'stateful-lead',
        seat: 'orch.arch',
        reason: 'insufficient-phase-headroom',
        requiredHeadroom: 52500,
        remainingTokens: 30000,
      })
    })

    it('handles Class C stateful leads with PLANNED_HANDOVER_RESTORE_PACKET on rework residue', () => {
      const decision = evaluatePrePhaseHeadroom({
        seat: 'pm.manager',
        nextPhase: 1, // budget 20000, required 30000
        remainingTokens: 80000,
        reworkRounds: 2,
      })
      expect(decision).toEqual({
        action: 'PLANNED_HANDOVER_RESTORE_PACKET',
        continuityClass: 'stateful-lead',
        seat: 'pm.manager',
        reason: 'rework-residue',
        requiredHeadroom: 30000,
        remainingTokens: 80000,
      })
    })

    it('allows Class C stateful leads to continue session when healthy', () => {
      const decision = evaluatePrePhaseHeadroom({
        seat: 'pm.analyst',
        nextPhase: 2, // budget 25000, required 37500
        remainingTokens: 90000,
        reworkRounds: 0,
      })
      expect(decision).toEqual({
        action: 'CONTINUE_SESSION',
        continuityClass: 'stateful-lead',
        seat: 'pm.analyst',
        requiredHeadroom: 37500,
        remainingTokens: 90000,
      })
    })

    it('falls back to default 30000 budget for unspecified phases', () => {
      const decision = evaluatePrePhaseHeadroom({
        seat: 'dev.build',
        nextPhase: 99,
        remainingTokens: 20000,
      })
      expect(decision.requiredHeadroom).toBe(45000) // 1.5 * 30000
      expect(decision.action).toBe('REBUILD_AT_PHASE_BOUNDARY')
    })
  })

  describe('validateRestorePacket', () => {
    const validPacket = {
      goalUri: 'goal://42',
      activeSlices: ['slice-1'],
      phasePositions: { 0: 'done', 1: 'active' },
      unmergedAcceptedBranches: ['feature/x'],
      oracleDigestsByGoal: { 42: 'sha256-abc' },
      touchSurfaceLocks: ['lib/core.mjs'],
      minimumEpochByGoal: { 42: 1 },
      reworkCountsByGoal: { 42: 0 },
      supervisorHealthState: 'healthy',
      lastHeartbeatAt: '2026-10-15T00:00:00Z',
      activePlatformBindings: { rig: 'test' },
      pendingHandoffOutbox: [],
      architecturalInvariants: ['no circular deps'],
      openFollowUps: [],
      predecessorSessionId: 'sess-prev',
      createdAt: '2026-10-15T00:00:00Z',
    }

    it('validates a complete 16-field restore packet (AC-6)', () => {
      const result = validateRestorePacket(validPacket)
      expect(result).toEqual({
        ok: true,
        missingFields: [],
        fieldCount: 16,
      })
    })

    it('reports missing fields when incomplete', () => {
      const incomplete = { ...validPacket }
      delete incomplete.supervisorHealthState
      delete incomplete.architecturalInvariants

      const result = validateRestorePacket(incomplete)
      expect(result.ok).toBe(false)
      expect(result.missingFields).toEqual(['supervisorHealthState', 'architecturalInvariants'])
      expect(result.fieldCount).toBe(14)
    })

    it('treats null or undefined fields as missing', () => {
      const withNulls = { ...validPacket, lastHeartbeatAt: null, goalUri: undefined }
      const result = validateRestorePacket(withNulls)
      expect(result.ok).toBe(false)
      expect(result.missingFields).toContain('lastHeartbeatAt')
      expect(result.missingFields).toContain('goalUri')
      expect(result.fieldCount).toBe(14)
    })

    it('handles empty or undefined packet', () => {
      const result = validateRestorePacket()
      expect(result.ok).toBe(false)
      expect(result.missingFields).toHaveLength(16)
      expect(result.fieldCount).toBe(0)
    })
  })

  describe('consultRetiredPredecessor', () => {
    it('throws RETIRED_SEAT_WRITE_DENIED when wakeRequested is true (BLOCKER-4, AC-6)', () => {
      expect(() =>
        consultRetiredPredecessor({
          predecessorSessionId: 'sess-old',
          transcriptPath: '/tmp/transcript.jsonl',
          wakeRequested: true,
        }),
      ).toThrowError(
        'RETIRED_SEAT_WRITE_DENIED: waking a retired predecessor with write or tool permissions is forbidden; use read-only transcript lookup',
      )
    })

    it('throws RETIRED_SEAT_WRITE_DENIED when mode is wake', () => {
      expect(() =>
        consultRetiredPredecessor({
          predecessorSessionId: 'sess-old',
          transcriptPath: '/tmp/transcript.jsonl',
          mode: 'wake',
        }),
      ).toThrowError(
        'RETIRED_SEAT_WRITE_DENIED: waking a retired predecessor with write or tool permissions is forbidden; use read-only transcript lookup',
      )
    })

    it('throws RETIRED_SEAT_WRITE_DENIED when mode is write', () => {
      expect(() =>
        consultRetiredPredecessor({
          predecessorSessionId: 'sess-old',
          transcriptPath: '/tmp/transcript.jsonl',
          mode: 'write',
        }),
      ).toThrowError(
        'RETIRED_SEAT_WRITE_DENIED: waking a retired predecessor with write or tool permissions is forbidden; use read-only transcript lookup',
      )
    })

    it('returns TRANSCRIPT_NOT_FOUND if transcript does not exist', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.jsonl')
      const result = consultRetiredPredecessor({
        predecessorSessionId: 'sess-old',
        transcriptPath: nonExistentPath,
      })
      expect(result).toEqual({
        ok: false,
        status: 'TRANSCRIPT_NOT_FOUND',
        predecessorSessionId: 'sess-old',
        mode: 'read-only-transcript',
      })
    })

    it('reads transcript in read-only mode and returns excerpt and byteLength', () => {
      const transcriptPath = path.join(tempDir, 'transcript.jsonl')
      const longContent = 'A'.repeat(3000) + 'TRANSCRIPT_TAIL_DATA'
      fs.writeFileSync(transcriptPath, longContent, 'utf8')

      const result = consultRetiredPredecessor({
        predecessorSessionId: 'sess-1234',
        transcriptPath,
        mode: 'read-transcript',
      })

      expect(result.ok).toBe(true)
      expect(result.status).toBe('TRANSCRIPT_READ_ONLY')
      expect(result.predecessorSessionId).toBe('sess-1234')
      expect(result.mode).toBe('read-only-transcript')
      expect(result.byteLength).toBe(Buffer.byteLength(longContent, 'utf8'))
      expect(result.excerpt).toBe(longContent.slice(-2048))
      expect(result.excerpt).toContain('TRANSCRIPT_TAIL_DATA')
    })
  })

  describe('resolveLineageLedgerPath & appendLineageLedgerEntry', () => {
    it('resolves host-side path outside worktrees (STRUCTURAL-2)', () => {
      const hostHome = '/home/engineer'
      const ledgerPath = resolveLineageLedgerPath({
        homeDir: hostHome,
        rigName: 'core-rig',
        seat: 'orch.arch',
      })
      expect(ledgerPath).toBe(
        path.join(
          '/home/engineer',
          '.openrig',
          'state',
          'agentflow-lineage',
          'core-rig',
          'orch.arch.jsonl',
        ),
      )
      expect(ledgerPath).not.toContain('.worktrees')
    })

    it('throws LINEAGE_WORKTREE_VIOLATION if homeDir is inside .worktrees/*', () => {
      expect(() =>
        appendLineageLedgerEntry({
          homeDir: '/home/engineer/project/.worktrees/feature-1',
          rigName: 'core-rig',
          seat: 'orch.arch',
          entry: { event: 'handover' },
        }),
      ).toThrowError(
        'LINEAGE_WORKTREE_VIOLATION: lineage ledger must reside in host-side ~/.openrig/state/agentflow-lineage/, never inside .worktrees/*',
      )
    })

    it('throws LINEAGE_WORKTREE_VIOLATION when worktreeDir is provided with worktree-based homeDir', () => {
      expect(() =>
        appendLineageLedgerEntry({
          homeDir: '/tmp/repo/.worktrees/subagent-1',
          worktreeDir: '/tmp/repo/.worktrees/subagent-1',
          rigName: 'core-rig',
          seat: 'orch.arch',
          entry: { event: 'handover' },
        }),
      ).toThrowError(
        'LINEAGE_WORKTREE_VIOLATION: lineage ledger must reside in host-side ~/.openrig/state/agentflow-lineage/, never inside .worktrees/*',
      )
    })

    it('successfully appends lineage ledger entries to host-side path and survives worktree deletion', () => {
      const hostHome = tempDir
      const worktreeDir = path.join(tempDir, '.worktrees', 'subagent-temp')
      fs.mkdirSync(worktreeDir, { recursive: true })

      const res1 = appendLineageLedgerEntry({
        homeDir: hostHome,
        rigName: 'team-rig',
        seat: 'orch.arch',
        worktreeDir,
        entry: { event: 'handover-init', generation: 1 },
      })

      expect(res1.ok).toBe(true)
      expect(fs.existsSync(res1.ledgerPath)).toBe(true)

      const res2 = appendLineageLedgerEntry({
        homeDir: hostHome,
        rigName: 'team-rig',
        seat: 'orch.arch',
        worktreeDir,
        entry: { event: 'handover-complete', generation: 2 },
      })

      expect(res2.ok).toBe(true)
      expect(res2.ledgerPath).toBe(res1.ledgerPath)

      // Simulate worktree deletion
      fs.rmSync(worktreeDir, { recursive: true, force: true })
      expect(fs.existsSync(worktreeDir)).toBe(false)

      // Ledger must survive worktree deletion
      expect(fs.existsSync(res1.ledgerPath)).toBe(true)

      const lines = fs
        .readFileSync(res1.ledgerPath, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))

      expect(lines).toHaveLength(2)
      expect(lines[0].event).toBe('handover-init')
      expect(lines[0].seat).toBe('orch.arch')
      expect(lines[0].rigName).toBe('team-rig')
      expect(lines[0].recordedAt).toBeDefined()
      expect(lines[1].event).toBe('handover-complete')
      expect(lines[1].generation).toBe(2)
    })
  })

  describe('writeProofLogArtifact', () => {
    it('writes raw log to ~/.openrig/state/proofs/<goal>-phase-5.log and returns compact summary pointer', () => {
      const homeDir = tempDir
      const rawLog = Array.from({ length: 40 }, (_, i) => `log line ${i + 1}`).join('\n')
      const goal = 'feature/auth-provider#102'

      const result = writeProofLogArtifact({
        homeDir,
        goal,
        phase: 5,
        rawLog,
        passCount: 24,
        failCount: 0,
        command: 'cargo test',
        exitCode: 0,
      })

      const expectedSha256 = crypto.createHash('sha256').update(rawLog).digest('hex')
      const expectedFileName = 'feature_auth-provider_102-phase-5.log'
      const expectedPath = path.join(homeDir, '.openrig', 'state', 'proofs', expectedFileName)

      expect(result.artifactPath).toBe(expectedPath)
      expect(result.sha256).toBe(expectedSha256)
      expect(result.command).toBe('cargo test')
      expect(result.exitCode).toBe(0)
      expect(result.passCount).toBe(24)
      expect(result.failCount).toBe(0)

      // Must be compact: <= 15 lines
      expect(result.summaryLines.length).toBeLessThanOrEqual(15)
      expect(result.summaryLines).toHaveLength(15)
      expect(result.summaryLines[result.summaryLines.length - 1]).toBe('log line 40')

      // Verify file written to disk
      expect(fs.existsSync(expectedPath)).toBe(true)
      expect(fs.readFileSync(expectedPath, 'utf8')).toBe(rawLog)
    })

    it('handles empty rawLog and default parameters', () => {
      const homeDir = tempDir
      const result = writeProofLogArtifact({
        homeDir,
        goal: 'test-goal',
      })

      expect(result.sha256).toBe(crypto.createHash('sha256').update('').digest('hex'))
      expect(result.summaryLines).toEqual([])
      expect(result.summaryLines.length).toBeLessThanOrEqual(15)
      expect(result.exitCode).toBe(0)
      expect(result.command).toBe('cargo test')
    })
  })
})
