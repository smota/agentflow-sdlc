import { existsSync, mkdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanupGitLocks,
  compressContextPayload,
  normalizePathToPosix,
  scrubSecretsAndPii,
} from '../runtime/context-sanitizer.mjs'
import {
  createHandoffPacket,
  HANDOVER_REASONS,
  parseHandoffPacket,
  resumeHandoff,
} from '../runtime/handover-protocol.mjs'
import {
  acquireLease,
  assertLeaseValid,
  createLease,
  LEASE_ERROR_CODES,
} from '../runtime/lease-fencing.mjs'

describe('Durable Agent Handoff Protocol (#280)', () => {
  it('1. Normalizes Windows and workstation paths to POSIX (NFR-01)', () => {
    const winPath = 'C:\\Users\\samue\\code\\agentflow-sdlc\\lib\\runtime.mjs'
    const normalized = normalizePathToPosix(winPath)
    expect(normalized).not.toContain('\\')
    expect(normalized).toContain('~/code/agentflow-sdlc/lib/runtime.mjs')
  })

  it('2. Scrubs credentials, tokens, and PII before remote sync (NFR-03)', () => {
    const textWithSecrets = [
      'Failed with GitHub Token: ghp_1234567890abcdef1234567890abcdef1234',
      'OpenAI API Key: sk-abcdefghijklmnopqrstuvwxyz1234567890',
      'AWS Key: AKIAIOSFODNN7EXAMPLE',
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ae7H8UZZwCr4L2I',
    ].join('\n')

    const scrubbed = scrubSecretsAndPii(textWithSecrets)
    expect(scrubbed).not.toContain('ghp_')
    expect(scrubbed).not.toContain('sk-')
    expect(scrubbed).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(scrubbed).toContain('[REDACTED_GH_TOKEN]')
    expect(scrubbed).toContain('[REDACTED_API_KEY]')
    expect(scrubbed).toContain('[REDACTED_AWS_KEY]')
  })

  it('3. Token-budgeted context compression limits packet to budget', () => {
    const hugePayload = {
      taskId: 'task-budget-test',
      uncommittedChanges: Array.from({ length: 100 }, (_, i) => ({
        file: `C:\\code\\file-${i}.txt`,
        diff: 'A'.repeat(1000),
      })),
      debugLogs: 'D'.repeat(20000),
    }

    const maxChars = 10000
    const result = compressContextPayload(hugePayload, { maxChars })
    expect(result.compressed).toBe(true)
    expect(result.charCount).toBeLessThanOrEqual(maxChars + 500)
    expect(result.estimatedTokens).toBeLessThan(4000)
  })

  it('4. Fencing lease manager increments tokens monotonically and rejects stale machines', () => {
    const now = 1700000000000
    const lease1 = createLease({
      taskId: 'task-280',
      machineId: 'macbook-pro-office',
      agentId: 'claude-cli',
      now,
    })

    expect(lease1.fencingToken).toBe(1)
    expect(lease1.machineId).toBe('macbook-pro-office')

    // Machine switch: windows-desktop-home acquires lease
    const lease2 = acquireLease({
      currentLease: lease1,
      taskId: 'task-280',
      machineId: 'windows-desktop-home',
      agentId: 'agy-cli',
      now: now + 5000,
    })

    expect(lease2.fencingToken).toBe(2)
    expect(lease2.previousOwner).toBe('macbook-pro-office')
    expect(lease2.machineId).toBe('windows-desktop-home')

    // Stale machine attempt using token 1 against lease 2 should fail
    expect(() =>
      assertLeaseValid({
        activeLease: lease2,
        candidateToken: 1,
        candidateMachineId: 'macbook-pro-office',
        now: now + 6000,
      }),
    ).toThrowError(/Candidate fencing token 1 is stale/)

    // Valid attempt with active token succeeds
    expect(
      assertLeaseValid({
        activeLease: lease2,
        candidateToken: 2,
        candidateMachineId: 'windows-desktop-home',
        now: now + 6000,
      }),
    ).toBe(true)

    // Expired lease check
    expect(() =>
      assertLeaseValid({
        activeLease: lease2,
        candidateToken: 2,
        candidateMachineId: 'windows-desktop-home',
        now: new Date(lease2.expiresAt).getTime() + 1000,
      }),
    ).toThrowError(/expired/)
  })

  it('5. Cleans stale .git/index.lock files automatically (NFR-02)', () => {
    const tempDir = join(process.cwd(), '.agent-runs', 'scratch', 'test-git-repo')
    const gitDir = join(tempDir, '.git')
    mkdirSync(gitDir, { recursive: true })

    const lockFile = join(gitDir, 'index.lock')
    writeFileSync(lockFile, 'dummy lock')

    // Initial check: if lock is brand new and maxAgeMs is high, don't delete
    const freshCheck = cleanupGitLocks({ repoDir: tempDir, maxAgeMs: 100000 })
    expect(freshCheck.cleaned).toBe(false)
    expect(existsSync(lockFile)).toBe(true)

    // Stale check: maxAgeMs 0 treats any existing lock as stale
    const staleCheck = cleanupGitLocks({ repoDir: tempDir, maxAgeMs: 0 })
    expect(staleCheck.cleaned).toBe(true)
    expect(existsSync(lockFile)).toBe(false)

    // Clean up test dir
    try {
      rmdirSync(gitDir)
      rmdirSync(tempDir)
    } catch {}
  })

  it('6. Round-trip creation, parsing, and resumption of handoff packet', () => {
    const originalPacket = createHandoffPacket({
      taskId: '280',
      issueId: '280',
      fromAgent: 'claude-cli',
      toAgent: 'agy-cli',
      currentBranch: 'work/smart-transition-boundaries',
      reason: HANDOVER_REASONS.RATE_LIMIT_429,
      fencingToken: 3,
      statusSummary: 'Completed #275, #276, #277, #278, #279. Ready for #280 closeout.',
      uncommittedChanges: [
        { file: 'C:\\Users\\samue\\code\\agentflow\\lib\\test.mjs', status: 'modified' },
      ],
    })

    expect(originalPacket.markdown).toContain('<!-- agentflow:handover-packet -->')
    expect(originalPacket.markdown).toContain('claude-cli')
    expect(originalPacket.markdown).toContain('agy-cli')

    // Parse packet back
    const parsed = parseHandoffPacket(originalPacket.markdown)
    expect(parsed).not.toBeNull()
    expect(parsed.taskId).toBe('280')
    expect(parsed.reason).toBe(HANDOVER_REASONS.RATE_LIMIT_429)
    expect(parsed.fencingToken).toBe(3)
    expect(parsed.uncommittedChanges[0].file).toContain('~/code/agentflow/lib/test.mjs')

    // Resume execution
    const currentLease = {
      taskId: '280',
      machineId: 'machine-a',
      fencingToken: 3,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    }

    const resumed = resumeHandoff({
      packet: parsed,
      currentLease,
      targetAgent: 'agy-cli',
      machineId: 'machine-b',
    })

    expect(resumed.resumed).toBe(true)
    expect(resumed.resumedBy).toBe('agy-cli')
    expect(resumed.newLease.fencingToken).toBe(4)
    expect(resumed.newLease.previousOwner).toBe('machine-a')
  })
})
