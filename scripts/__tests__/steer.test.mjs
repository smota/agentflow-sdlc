import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  validateSteerDestination,
  steerAssign,
  steerUnfreeze,
  steerTriage,
  verifyMergeGates,
  steerMergeCheck,
  SUPERVISOR_STALE_TIMEOUT_MS,
  evaluateSupervisorLiveness,
  steerBtwQuery,
} from '../steer.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
import { tripLedgerBreaker } from '../../lib/core/role-collaboration.mjs'

const CLI_PATH = join(process.cwd(), 'bin', 'cli.mjs')

function verifiedSteering(ledger, resolution, rationale, humanApproval = null) {
  const nowMs = Date.now()
  const steeringBinding = {
    authorityId: 'steer.lead',
    replyRoute: 'external:operator',
    goal: 'fixture-goal',
    task: 'fixture-task',
    powers: ['unfreeze'],
    issuedAt: nowMs - 1,
    expiresAt: nowMs + 120000,
  }
  const steeringRequest = {
    goal: 'fixture-goal',
    task: 'fixture-task',
    power: 'unfreeze',
    challenge: 'fixture-challenge-12345678901234567890',
    deadlineAt: nowMs + 60000,
    subjectDigest: recordDigest(ledger),
    subjectId: 'ledger:fixture',
  }
  steeringRequest.actionDigest = recordDigest({
    resolution,
    rationale,
    humanApproval,
    actor: 'steer.lead',
    subjectDigest: steeringRequest.subjectDigest,
    subjectId: steeringRequest.subjectId,
    goal: steeringRequest.goal,
    task: steeringRequest.task,
    nextToken: ledger.fencingToken + 1,
  })
  return {
    nowMs,
    clock: () => nowMs,
    steeringBinding,
    steeringRequest,
    resolveSteeringSubject: () => ({
      verified: true,
      subjectId: steeringRequest.subjectId,
      subjectDigest: recordDigest(ledger),
      goal: steeringRequest.goal,
      task: steeringRequest.task,
    }),
    verifySteeringEndpoint: ({ binding, request }) => ({
      ...request,
      authorityId: binding.authorityId,
      replyRoute: binding.replyRoute,
      authenticated: true,
      decision: 'approve',
      nonceConsumed: true,
      reachable: true,
      observedAt: nowMs,
      expiresAt: nowMs + 60000,
    }),
  }
}

describe('scripts/steer.mjs - supervisory steering verbs', () => {
  describe('validateSteerDestination', () => {
    it('accepts authorized entry seats and human', () => {
      expect(validateSteerDestination('pm.manager')).toBe('pm.manager')
      expect(validateSteerDestination('pm-manager')).toBe('pm-manager')
      expect(validateSteerDestination('pm-manager@myproject-product')).toBe(
        'pm-manager@myproject-product',
      )
      expect(validateSteerDestination('manager@myproject-product')).toBe(
        'manager@myproject-product',
      )
      expect(validateSteerDestination('orch.arch')).toBe('orch.arch')
      expect(validateSteerDestination('orch-arch')).toBe('orch-arch')
      expect(validateSteerDestination('orch-arch@myproject-dev')).toBe('orch-arch@myproject-dev')
      expect(validateSteerDestination('architect@myproject-dev')).toBe('architect@myproject-dev')
      expect(validateSteerDestination('human')).toBe('human')
    })

    it('rejects prohibited in-rig execution seats', () => {
      const prohibited = [
        'dev.build',
        'dev-build',
        'dev.build-jr',
        'dev-build-sr',
        'builder@myproject-dev',
        'builder-jr@myproject-dev',
        'dev.qa',
        'dev-qa',
        'qa@myproject-dev',
        'dev.test-eng',
        'dev-test-eng',
        'test-eng@myproject-dev',
        'rev.review',
        'rev-review',
        'reviewer@myproject-dev',
        'pm.analyst',
        'pm-analyst',
        'analyst@myproject-product',
      ]
      for (const dest of prohibited) {
        expect(() => validateSteerDestination(dest)).toThrow(/prohibited/i)
      }
    })

    it('rejects unknown or empty targets', () => {
      expect(() => validateSteerDestination('')).toThrow(/required/i)
      expect(() => validateSteerDestination('random-target')).toThrow(
        /not an authorized steering target/i,
      )
    })
  })

  describe('steerAssign', () => {
    it('generates dry-run preview command without executing', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-assign-'))
      try {
        const briefPath = join(tempDir, 'brief.md')
        writeFileSync(briefPath, '# Feature Goal\nImplement new capability.')

        const result = await steerAssign({
          destination: 'pm.manager',
          briefFile: 'brief.md',
          targetDir: tempDir,
          dryRun: true,
        })

        expect(result.ok).toBe(true)
        expect(result.dryRun).toBe(true)
        expect(result.destination).toBe('pm.manager')
        expect(result.summary).toBe('Task brief: Feature Goal')
        expect(result.command).toEqual([
          'rig',
          'queue',
          'create',
          '--destination',
          'pm.manager',
          '--body-file',
          briefPath,
          '--summary',
          'Task brief: Feature Goal',
        ])
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('dispatches queue brief via rig CLI mock', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-assign-'))
      try {
        const briefPath = join(tempDir, 'brief.md')
        writeFileSync(briefPath, 'Raw description without header.')

        const mockSpawn = vi.fn().mockReturnValue({ status: 0, stdout: 'qitem-123\n' })

        const result = await steerAssign({
          destination: 'pm-manager@project-product',
          briefFile: 'brief.md',
          summary: 'Explicit summary',
          goal: 'goal://477',
          transition: 'trans://0-1',
          targetDir: tempDir,
          spawnFn: mockSpawn,
        })

        expect(result.ok).toBe(true)
        expect(result.dispatched).toBe(true)
        expect(mockSpawn).toHaveBeenCalledTimes(2)
        expect(mockSpawn).toHaveBeenNthCalledWith(
          1,
          'rig',
          [
            'queue',
            'create',
            '--destination',
            'pm-manager@project-product',
            '--body-file',
            briefPath,
            '--summary',
            'Explicit summary',
          ],
          { encoding: 'utf8' },
        )
        expect(mockSpawn).toHaveBeenNthCalledWith(
          2,
          'rig',
          [
            'send',
            'pm-manager@project-product',
            `Goal: goal://477 | Transition: trans://0-1 | Brief: ${briefPath}`,
          ],
          { encoding: 'utf8' },
        )
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('falls back to local queue storage when rig CLI is not installed', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-assign-'))
      try {
        const briefPath = join(tempDir, 'brief.md')
        writeFileSync(briefPath, '# Another Task\nDetails.')

        const mockSpawn = vi.fn().mockReturnValue({
          error: { code: 'ENOENT' },
          status: null,
        })

        const result = await steerAssign({
          destination: 'orch.arch',
          briefFile: 'brief.md',
          targetDir: tempDir,
          spawnFn: mockSpawn,
        })

        expect(result.ok).toBe(true)
        expect(result.source).toBe('local-queue-fallback')
        expect(result.queueFile).toBeDefined()
        const saved = JSON.parse(readFileSync(result.queueFile, 'utf8'))
        expect(saved.destination).toBe('orch.arch')
        expect(saved.summary).toBe('Task brief: Another Task')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('fails closed when brief file is missing or destination is prohibited', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-assign-'))
      try {
        await expect(
          steerAssign({
            destination: 'dev.build',
            briefFile: 'none.md',
            targetDir: tempDir,
          }),
        ).rejects.toThrow(/prohibited/i)

        await expect(
          steerAssign({
            destination: 'pm.manager',
            briefFile: 'missing.md',
            targetDir: tempDir,
          }),
        ).rejects.toThrow(/Brief file not found/i)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('dispatches queue brief with --no-nudge suppressing mid-phase notification (AC-8)', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-assign-nonudge-'))
      try {
        const briefPath = join(tempDir, 'brief.md')
        writeFileSync(briefPath, '# Background Task\nEnqueued for next boundary.')

        const mockSpawn = vi.fn().mockReturnValue({ status: 0, stdout: 'qitem-456\n' })

        const result = await steerAssign({
          destination: 'pm.manager',
          briefFile: 'brief.md',
          goal: 'goal://477',
          transition: 'trans://0-1',
          noNudge: true,
          targetDir: tempDir,
          spawnFn: mockSpawn,
        })

        expect(result.ok).toBe(true)
        expect(result.dispatched).toBe(true)
        expect(result.noNudge).toBe(true)
        // Only 1 call to rig queue create with --no-nudge; rig send notification is suppressed!
        expect(mockSpawn).toHaveBeenCalledTimes(1)
        expect(mockSpawn).toHaveBeenNthCalledWith(
          1,
          'rig',
          [
            'queue',
            'create',
            '--destination',
            'pm.manager',
            '--body-file',
            briefPath,
            '--summary',
            'Task brief: Background Task',
            '--no-nudge',
          ],
          { encoding: 'utf8' },
        )
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('persists noNudge flag in local queue fallback when rig CLI is not installed', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-assign-fallback-nonudge-'))
      try {
        const briefPath = join(tempDir, 'brief.md')
        writeFileSync(briefPath, '# Groomed Task\nDetails.')

        const mockSpawn = vi.fn().mockReturnValue({
          error: { code: 'ENOENT' },
          status: null,
        })

        const result = await steerAssign({
          destination: 'pm.manager',
          briefFile: 'brief.md',
          noNudge: true,
          targetDir: tempDir,
          spawnFn: mockSpawn,
        })

        expect(result.ok).toBe(true)
        expect(result.source).toBe('local-queue-fallback')
        expect(result.noNudge).toBe(true)
        const saved = JSON.parse(readFileSync(result.queueFile, 'utf8'))
        expect(saved.noNudge).toBe(true)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('steerUnfreeze', () => {
    it('unfreezes a frozen ledger and increments the fencing token', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-unfreeze-'))
      try {
        const { ledger: frozenLedger } = tripLedgerBreaker({
          fencingToken: 1,
          criteria: [{ id: 'test', round: 3 }],
        })
        expect(frozenLedger.frozen).toBe(true)
        expect(frozenLedger.fencingToken).toBe(2)

        const ledgerPath = join(tempDir, 'ledger.json')
        writeFileSync(ledgerPath, JSON.stringify(frozenLedger, null, 2))

        const result = await steerUnfreeze({
          ledgerFile: 'ledger.json',
          resolution: 'slice-split',
          rationale: 'Slice split into two smaller vertical capabilities to avoid timeout.',
          actor: 'steer.lead',
          ...verifiedSteering(
            frozenLedger,
            'slice-split',
            'Slice split into two smaller vertical capabilities to avoid timeout.',
          ),
          targetDir: tempDir,
        })

        expect(result.ok).toBe(true)
        expect(result.applied).toBe(true)
        expect(result.fencingToken).toBe(3)
        expect(result.resolution.resolution).toBe('slice-split')
        expect(result.resolution.actor).toBe('steer.lead')
        expect(result.ledger.frozen).toBe(false)
        expect(result.ledger.fencingToken).toBe(3)

        const onDisk = JSON.parse(readFileSync(ledgerPath, 'utf8'))
        expect(onDisk.frozen).toBe(false)
        expect(onDisk.fencingToken).toBe(3)
        expect(onDisk.unfreezeResolutionDigest).toBe(result.resolution.digest)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('requires human approval reference for person-waiver or abandonment', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-unfreeze-'))
      try {
        const { ledger: frozenLedger } = tripLedgerBreaker({ fencingToken: 0 })
        const ledgerPath = join(tempDir, 'ledger.json')
        writeFileSync(ledgerPath, JSON.stringify(frozenLedger, null, 2))

        await expect(
          steerUnfreeze({
            ledgerFile: 'ledger.json',
            resolution: 'person-waiver',
            rationale: 'Waived due to environment blocker.',
            actor: 'steer.lead',
            targetDir: tempDir,
          }),
        ).rejects.toThrow(/requires an explicit human authorization reference/i)

        // Passes with explicit human approval reference
        const okResult = await steerUnfreeze({
          ledgerFile: 'ledger.json',
          resolution: 'person-waiver',
          rationale: 'Waived due to environment blocker.',
          actor: 'steer.lead',
          humanApproval: 'human:alice#waiver-123',
          ...verifiedSteering(
            frozenLedger,
            'person-waiver',
            'Waived due to environment blocker.',
            'human:alice#waiver-123',
          ),
          targetDir: tempDir,
        })
        expect(okResult.ok).toBe(true)
        expect(okResult.resolution.resolution).toBe('person-waiver')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('rejects unfreeze attempts by in-rig execution seats', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-unfreeze-'))
      try {
        const { ledger: frozenLedger } = tripLedgerBreaker({ fencingToken: 0 })
        const ledgerPath = join(tempDir, 'ledger.json')
        writeFileSync(ledgerPath, JSON.stringify(frozenLedger, null, 2))

        await expect(
          steerUnfreeze({
            ledgerFile: 'ledger.json',
            resolution: 're-scope',
            rationale: 'Self unfreeze.',
            actor: 'dev.build',
            targetDir: tempDir,
          }),
        ).rejects.toThrow(/in-rig execution seat/i)

        await expect(
          steerUnfreeze({
            ledgerFile: 'ledger.json',
            resolution: 're-scope',
            rationale: 'Self unfreeze.',
            actor: 'orch.arch',
            targetDir: tempDir,
          }),
        ).rejects.toThrow(/in-rig execution seat/i)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('fails closed when ledger is not frozen', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-unfreeze-'))
      try {
        const ledgerPath = join(tempDir, 'ledger.json')
        writeFileSync(ledgerPath, JSON.stringify({ frozen: false, fencingToken: 1 }, null, 2))

        await expect(
          steerUnfreeze({
            ledgerFile: 'ledger.json',
            resolution: 're-scope',
            rationale: 'Not frozen.',
            actor: 'steer.lead',
            targetDir: tempDir,
          }),
        ).rejects.toThrow(/not frozen/i)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('steerTriage', () => {
    it('executes queue-ordering triage with deterministic fallback', async () => {
      const tasks = [
        { id: 'task-low', reworkRound: 0, failures: [] },
        { id: 'task-high', reworkRound: 3, failures: ['fail-1', 'fail-2'] },
      ]

      const res = await steerTriage({
        task: 'queue-ordering',
        payload: { tasks },
        options: { timeoutMs: 100 }, // short timeout triggers deterministic fallback if offline
      })

      expect(res.ok).toBe(true)
      expect(res.orderedTasks).toBeDefined()
      expect(res.orderedTasks[0].id).toBe('task-high')
    })

    it('executes issue-dedupe triage', async () => {
      const res = await steerTriage({
        task: 'issue-dedupe',
        payload: {
          candidate: { title: 'Broken parser in compiler', criterionId: 'crit-parse' },
          existingIssues: [
            { id: '101', title: 'Broken parser in compiler', criterionId: 'crit-parse' },
            { id: '102', title: 'Unrelated CSS bug' },
          ],
        },
      })

      expect(res.ok).toBe(true)
      expect(res.isDuplicate).toBe(true)
      expect(res.duplicateOf).toBe('101')
    })

    it('executes nudge-level triage', async () => {
      const res = await steerTriage({
        task: 'nudge-level',
        payload: {
          seatTarget: 'dev.build',
          idleSeconds: 400,
          reworkRound: 2,
        },
        options: { timeoutMs: 100 },
      })

      expect(res.ok).toBe(true)
      expect(res.level).toBe('interrupt')
    })

    it('rejects in-rig seats calling decider port', async () => {
      await expect(
        steerTriage({
          task: 'queue-ordering',
          payload: { tasks: [] },
          seat: 'dev.build',
        }),
      ).rejects.toThrow(/In-rig execution seats/i)
    })
  })

  describe('verifyMergeGates & steerMergeCheck', () => {
    const head = 'a'.repeat(40)
    function source(overrides = {}) {
      return {
        number: 105,
        state: 'OPEN',
        isDraft: false,
        mergeable: 'MERGEABLE',
        headRefOid: head,
        author: { login: 'author' },
        reviews: [
          {
            state: 'APPROVED',
            authorPermission: 'WRITE',
            submittedAt: '2026-10-15T12:00:00Z',
            commit: { oid: head },
            author: { login: 'reviewer', is_bot: false },
          },
        ],
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' },
        ],
        ...overrides,
      }
    }
    it('holds closed or conflicting source state', () => {
      expect(verifyMergeGates(source({ state: 'MERGED' })).ready).toBe(false)
      expect(verifyMergeGates(source({ mergeable: 'CONFLICTING' })).ready).toBe(false)
    })
    it('holds author review and failed CI', () => {
      const pr = source()
      pr.reviews[0].author.login = 'author'
      expect(verifyMergeGates(pr).gates.review.pass).toBe(false)
      expect(
        verifyMergeGates(
          source({ statusCheckRollup: [{ __typename: 'StatusContext', state: 'FAILURE' }] }),
        ).ready,
      ).toBe(false)
    })
    it('does not authenticate author text or a CLI human-approval reference', () => {
      expect(
        verifyMergeGates(
          source({
            reviews: [],
            body: 'approved: true',
            comments: [{ body: 'LGTM /approve' }],
            labels: ['approved'],
          }),
          { humanApproval: 'anyone', autoMerge: true },
        ).ready,
      ).toBe(false)
    })
    it('passes current-head independent human review and successful CI', () => {
      expect(verifyMergeGates(source()).ready).toBe(true)
    })
    it('holds publication when the caller merely requests execute', async () => {
      const spawnFn = vi.fn(() => ({ status: 0, stdout: JSON.stringify(source()) }))
      const result = await steerMergeCheck({ prNumber: 105, execute: true, spawnFn })
      expect(result.merged).toBe(false)
      expect(spawnFn).toHaveBeenCalledTimes(1)
    })
    it('defaults a successful check to inspection', async () => {
      const spawnFn = vi.fn(() => ({ status: 0, stdout: JSON.stringify(source()) }))
      const result = await steerMergeCheck({ prNumber: 105, spawnFn })
      expect(result).toMatchObject({
        ok: true,
        ready: true,
        merged: false,
        status: 'MERGE_CHECK_ONLY',
      })
      expect(spawnFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('CLI end-to-end execution via bin/cli.mjs', () => {
    it('runs agentflow-sdlc steer --help and exits 0', () => {
      const output = execFileSync(process.execPath, [CLI_PATH, 'steer', '--help'], {
        encoding: 'utf8',
      })
      expect(output).toContain('Usage: agentflow-sdlc steer')
      expect(output).toContain('assign')
      expect(output).toContain('unfreeze')
      expect(output).toContain('triage')
      expect(output).toContain('merge-check')
    })

    it('runs agentflow-sdlc steer assign --dry-run --json', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-cli-'))
      try {
        const briefPath = join(tempDir, 'task.md')
        writeFileSync(briefPath, '# Task Heading\nDetails here.')

        const stdout = execFileSync(
          process.execPath,
          [
            CLI_PATH,
            'steer',
            'assign',
            '--destination',
            'pm.manager',
            '--brief',
            briefPath,
            '--dry-run',
            '--json',
          ],
          { encoding: 'utf8' },
        )
        const parsed = JSON.parse(stdout)
        expect(parsed.ok).toBe(true)
        expect(parsed.dryRun).toBe(true)
        expect(parsed.destination).toBe('pm.manager')
        expect(parsed.summary).toBe('Task brief: Task Heading')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('previews CLI unfreeze with explicit actor without applying unauthenticated authority', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-cli-'))
      try {
        const { ledger: frozenLedger } = tripLedgerBreaker({ fencingToken: 4 })
        const ledgerPath = join(tempDir, 'ledger.json')
        writeFileSync(ledgerPath, JSON.stringify(frozenLedger, null, 2))

        const stdout = execFileSync(
          process.execPath,
          [
            CLI_PATH,
            'steer',
            'unfreeze',
            '--ledger',
            ledgerPath,
            '--resolution',
            're-scope',
            '--rationale',
            'Trimming scope to deliver minimal vertical capability',
            '--actor',
            'steer.lead',
            '--dry-run',
            '--json',
          ],
          { encoding: 'utf8' },
        )
        const parsed = JSON.parse(stdout)
        expect(parsed.ok).toBe(true)
        expect(parsed.applied).toBe(false)
        expect(parsed.authorized).toBe(false)
        expect(parsed.fencingToken).toBe(6)
        expect(parsed.ledger.frozen).toBe(false)

        const onDisk = JSON.parse(readFileSync(ledgerPath, 'utf8'))
        expect(onDisk.frozen).toBe(true)
        expect(onDisk.fencingToken).toBe(5)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('runs agentflow-sdlc steer triage --task queue-ordering --json via CLI', () => {
      const payload = JSON.stringify({
        tasks: [
          { id: 'cli-low', reworkRound: 0 },
          { id: 'cli-high', reworkRound: 2 },
        ],
      })
      const stdout = execFileSync(
        process.execPath,
        [CLI_PATH, 'steer', 'triage', '--task', 'queue-ordering', '--payload', payload, '--json'],
        { encoding: 'utf8' },
      )
      const parsed = JSON.parse(stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.orderedTasks[0].id).toBe('cli-high')
    })

    it('runs agentflow-sdlc steer triage --task nudge-level --json via CLI', () => {
      const stdout = execFileSync(
        process.execPath,
        [
          CLI_PATH,
          'steer',
          'triage',
          '--task',
          'nudge-level',
          '--idle',
          '360',
          '--rework-round',
          '2',
          '--json',
        ],
        { encoding: 'utf8' },
      )
      const parsed = JSON.parse(stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.level).toBe('interrupt')
    })

    it('formats plain text output for steer assign dry-run', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-cli-plain-'))
      try {
        const briefPath = join(tempDir, 'plain.md')
        writeFileSync(briefPath, 'Simple summary task.')

        const stdout = execFileSync(
          process.execPath,
          [
            CLI_PATH,
            'steer',
            'assign',
            '--destination',
            'pm.manager',
            '--brief',
            briefPath,
            '--dry-run',
          ],
          { encoding: 'utf8' },
        )
        expect(stdout).toContain('[Dry Run] Prepared brief assignment to pm.manager')
        expect(stdout).toContain('Brief: ' + briefPath)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('formats plain text output for steer unfreeze', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-cli-plain-'))
      try {
        const { ledger: frozenLedger } = tripLedgerBreaker({ fencingToken: 1 })
        const ledgerPath = join(tempDir, 'ledger.json')
        writeFileSync(ledgerPath, JSON.stringify(frozenLedger, null, 2))

        const stdout = execFileSync(
          process.execPath,
          [
            CLI_PATH,
            'steer',
            'unfreeze',
            '--ledger',
            ledgerPath,
            '--resolution',
            'slice-split',
            '--rationale',
            'Split for safety',
            '--actor',
            'steer.lead',
            '--dry-run',
          ],
          { encoding: 'utf8' },
        )
        expect(stdout).toContain('Unfreeze resolution sealed')
        expect(stdout).toContain('Resolution: slice-split')
        expect(stdout).toContain('Next Epoch Fencing Token: 3')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('runs agentflow-sdlc steer liveness --json via CLI without treating a fresh heartbeat as authenticated authority', () => {
      const heartbeat = new Date(Date.now() - 60000).toISOString()
      const execution = spawnSync(
        process.execPath,
        [CLI_PATH, 'steer', 'liveness', '--last-heartbeat', heartbeat, '--json'],
        { encoding: 'utf8' },
      )
      expect(execution.status).toBe(3)
      const parsed = JSON.parse(execution.stdout)
      expect(parsed.reachable).toBe(false)
      expect(parsed.status).toBe('SUPERVISOR_UNVERIFIED')
      expect(parsed.holdNewSliceAdmission).toBe(true)
    })

    it('runs agentflow-sdlc steer liveness --json via CLI for stale supervisor with unmerged slices (AC-7)', () => {
      const stale = new Date(Date.now() - 35 * 60 * 1000).toISOString()
      const execution = spawnSync(
        process.execPath,
        [
          CLI_PATH,
          'steer',
          'liveness',
          '--last-heartbeat',
          stale,
          '--unmerged-count',
          '3',
          '--json',
        ],
        { encoding: 'utf8' },
      )
      expect(execution.status).toBe(3)
      const parsed = JSON.parse(execution.stdout)
      expect(parsed.reachable).toBe(false)
      expect(parsed.status).toBe('SUPERVISOR_UNREACHABLE')
      expect(parsed.holdNewSliceAdmission).toBe(true)
    })

    it('runs agentflow-sdlc steer btw --json via CLI (AC-8)', () => {
      const execution = spawnSync(
        process.execPath,
        [CLI_PATH, 'steer', 'btw', '--goal', 'goal://cap-514', '--json'],
        { encoding: 'utf8' },
      )
      expect(execution.status).toBe(0)
      const parsed = JSON.parse(execution.stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.mode).toBe('read-only-no-nudge')
      expect(parsed.nudgeDispatched).toBe(false)
      expect(parsed.goal).toBe('goal://cap-514')
    })

    it('runs agentflow-sdlc steer assign --no-nudge --dry-run --json via CLI (AC-8)', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-cli-nonudge-'))
      try {
        const briefPath = join(tempDir, 'task.md')
        writeFileSync(briefPath, '# No Nudge Task\nQueued without interrupting workers.')

        const execution = spawnSync(
          process.execPath,
          [
            CLI_PATH,
            'steer',
            'assign',
            '--destination',
            'pm.manager',
            '--brief',
            briefPath,
            '--no-nudge',
            '--dry-run',
            '--json',
          ],
          { encoding: 'utf8' },
        )
        expect(execution.status).toBe(0)
        const parsed = JSON.parse(execution.stdout)
        expect(parsed.ok).toBe(true)
        expect(parsed.dryRun).toBe(true)
        expect(parsed.noNudge).toBe(true)
        expect(parsed.command).toContain('--no-nudge')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('evaluateSupervisorLiveness', () => {
    it('returns SUPERVISOR_UNVERIFIED when only a recent heartbeat is supplied', () => {
      const nowMs = 1700000000000
      const recentHeartbeat = new Date(nowMs - 5 * 60 * 1000).toISOString()
      const result = evaluateSupervisorLiveness({
        lastHeartbeatAt: recentHeartbeat,
        nowMs,
        unmergedAcceptedCount: 0,
      })

      expect(result.reachable).toBe(false)
      expect(result.status).toBe('SUPERVISOR_UNVERIFIED')
      expect(result.ageMs).toBe(5 * 60 * 1000)
      expect(result.staleTimeoutMs).toBe(SUPERVISOR_STALE_TIMEOUT_MS)
      expect(result.holdNewSliceAdmission).toBe(true)
    })

    it('returns SUPERVISOR_UNREACHABLE with holdNewSliceAdmission when > 30m and unmerged >= 1 (AC-7)', () => {
      const nowMs = 1700000000000
      const staleHeartbeat = new Date(nowMs - 35 * 60 * 1000).toISOString()
      const result = evaluateSupervisorLiveness({
        lastHeartbeatAt: staleHeartbeat,
        nowMs,
        unmergedAcceptedCount: 2,
      })

      expect(result.reachable).toBe(false)
      expect(result.status).toBe('SUPERVISOR_UNREACHABLE')
      expect(result.ageMs).toBe(35 * 60 * 1000)
      expect(result.holdNewSliceAdmission).toBe(true)
    })

    it('returns SUPERVISOR_UNREACHABLE without holdNewSliceAdmission when unmerged is 0', () => {
      const nowMs = 1700000000000
      const staleHeartbeat = new Date(nowMs - 35 * 60 * 1000).toISOString()
      const result = evaluateSupervisorLiveness({
        lastHeartbeatAt: staleHeartbeat,
        nowMs,
        unmergedAcceptedCount: 0,
      })

      expect(result.reachable).toBe(false)
      expect(result.status).toBe('SUPERVISOR_UNREACHABLE')
      expect(result.holdNewSliceAdmission).toBe(true)
    })

    it('returns SUPERVISOR_UNREACHABLE when lastHeartbeatAt is missing or invalid', () => {
      const missing = evaluateSupervisorLiveness({ unmergedAcceptedCount: 1 })
      expect(missing.reachable).toBe(false)
      expect(missing.status).toBe('SUPERVISOR_UNREACHABLE')
      expect(missing.ageMs).toBeNull()
      expect(missing.holdNewSliceAdmission).toBe(true)

      const invalid = evaluateSupervisorLiveness({
        lastHeartbeatAt: 'not-a-timestamp',
        unmergedAcceptedCount: 0,
      })
      expect(invalid.reachable).toBe(false)
      expect(invalid.status).toBe('SUPERVISOR_UNREACHABLE')
      expect(invalid.ageMs).toBeNull()
      expect(invalid.holdNewSliceAdmission).toBe(true)
    })
  })

  describe('steerBtwQuery', () => {
    it('executes read-only status query with zero worker nudges (AC-8)', () => {
      const result = steerBtwQuery({ goal: 'goal://477' })
      expect(result.ok).toBe(true)
      expect(result.mode).toBe('read-only-no-nudge')
      expect(result.nudgeDispatched).toBe(false)
      expect(result.goal).toBe('goal://477')
      expect(typeof result.inspectedAt).toBe('string')
    })

    it('reads local heartbeat or state artifacts if present', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'steer-btw-'))
      try {
        const heartbeatDir = join(tempDir, '.agent-runs', 'steer')
        mkdirSync(heartbeatDir, { recursive: true })
        writeFileSync(
          join(heartbeatDir, 'heartbeat.json'),
          JSON.stringify({ supervisor: 'healthy', epoch: 1 }),
        )

        const result = steerBtwQuery({ targetDir: tempDir })
        expect(result.ok).toBe(true)
        expect(result.mode).toBe('read-only-no-nudge')
        expect(result.nudgeDispatched).toBe(false)
        expect(result.state).toEqual({ supervisor: 'healthy', epoch: 1 })
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})
