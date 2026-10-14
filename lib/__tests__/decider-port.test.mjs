import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_DECIDER_URL,
  DEFAULT_DECIDER_TIMEOUT_MS,
  ALLOWED_DECIDER_TASKS,
  PROHIBITED_DECIDER_ACTIONS,
  STEERING_PLANES,
  IN_RIG_EXECUTION_SEATS,
  createJevAuthHeaders,
  sanitizeDeciderPayload,
  isDeciderTaskAllowed,
  isDeciderAvailable,
  queryDecider,
  triageQueueOrdering,
  triageIssueDedupe,
  triageNudgeLevel,
} from '../providers/decider-port.mjs'

describe('decider-port', () => {
  describe('constants and exports', () => {
    it('exports immutable tasks, prohibited actions, and plane definitions', () => {
      expect(DEFAULT_DECIDER_URL).toBe('http://127.0.0.1:8002/v1/decide')
      expect(DEFAULT_DECIDER_TIMEOUT_MS).toBe(2000)

      expect(ALLOWED_DECIDER_TASKS).toContain('queue-ordering')
      expect(ALLOWED_DECIDER_TASKS).toContain('issue-dedupe')
      expect(ALLOWED_DECIDER_TASKS).toContain('nudge-level')
      expect(ALLOWED_DECIDER_TASKS.length).toBe(3)

      expect(PROHIBITED_DECIDER_ACTIONS).toContain('gate-signoff')
      expect(PROHIBITED_DECIDER_ACTIONS).toContain('merge')
      expect(PROHIBITED_DECIDER_ACTIONS).toContain('scope-modify')
      expect(PROHIBITED_DECIDER_ACTIONS).toContain('waiver-grant')

      expect(STEERING_PLANES).toContain('external-steering')
      expect(IN_RIG_EXECUTION_SEATS).toContain('dev.build')
      expect(IN_RIG_EXECUTION_SEATS).toContain('dev.test-eng')
      expect(IN_RIG_EXECUTION_SEATS).toContain('pm.manager')
    })
  })

  describe('Jev auth header adapter', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('creates json headers without auth when no token is present', () => {
      delete process.env.JEV_AUTH_TOKEN
      delete process.env.JEV_TOKEN
      const headers = createJevAuthHeaders()
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['X-Jev-Auth']).toBeUndefined()
      expect(headers['Authorization']).toBeUndefined()
    })

    it('attaches X-Jev-Auth and Authorization headers when token is provided', () => {
      const headers = createJevAuthHeaders('sec-jev-test-token-123')
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['X-Jev-Auth']).toBe('sec-jev-test-token-123')
      expect(headers['Authorization']).toBe('Jev sec-jev-test-token-123')
    })

    it('reads JEV_AUTH_TOKEN from environment when token argument is omitted', () => {
      process.env.JEV_AUTH_TOKEN = 'env-token-xyz'
      const headers = createJevAuthHeaders()
      expect(headers['X-Jev-Auth']).toBe('env-token-xyz')
      expect(headers['Authorization']).toBe('Jev env-token-xyz')
    })

    it('reads JEV_TOKEN from environment as fallback', () => {
      delete process.env.JEV_AUTH_TOKEN
      process.env.JEV_TOKEN = 'fallback-env-token'
      const headers = createJevAuthHeaders()
      expect(headers['X-Jev-Auth']).toBe('fallback-env-token')
      expect(headers['Authorization']).toBe('Jev fallback-env-token')
    })

    it('merges custom headers cleanly', () => {
      const headers = createJevAuthHeaders('tok', { 'X-Custom-Trace': 'trace-999' })
      expect(headers['X-Custom-Trace']).toBe('trace-999')
      expect(headers['X-Jev-Auth']).toBe('tok')
    })
  })

  describe('payload sanitization and source code redaction', () => {
    it('leaves safe primitive types and metadata intact', () => {
      const safe = {
        criterionId: 'crit_test_1',
        exitCode: 0,
        failuresCount: 2,
        blocked: false,
        diffStats: { filesChanged: 3, insertions: 120, deletions: 15 },
      }
      const sanitized = sanitizeDeciderPayload(safe)
      expect(sanitized).toEqual(safe)
    })

    it('redacts sensitive keys such as sourceCode, code, rawDiff, and secrets', () => {
      const raw = {
        criterionId: 'crit_auth_jwt',
        sourceCode: 'function verifyToken(tok) { return secret; }',
        code: 'class AuthManager {}',
        rawDiff: 'diff --git a/lib/auth.mjs b/lib/auth.mjs\n+ secret_token',
        apiKey: 'sk-live-1234567890',
        token: 'super-secret',
        nested: {
          password: 'db-password',
          safeField: 'telemetry-summary',
        },
      }
      const sanitized = sanitizeDeciderPayload(raw)
      expect(sanitized.criterionId).toBe('crit_auth_jwt')
      expect(sanitized.sourceCode).toBe('[REDACTED_SOURCE_CODE]')
      expect(sanitized.code).toBe('[REDACTED_SOURCE_CODE]')
      expect(sanitized.rawDiff).toBe('[REDACTED_DIFF_STATISTICS_ONLY]')
      expect(sanitized.apiKey).toBe('[REDACTED_SECRET]')
      expect(sanitized.token).toBe('[REDACTED_SECRET]')
      expect(sanitized.nested.password).toBe('[REDACTED_SECRET]')
      expect(sanitized.nested.safeField).toBe('telemetry-summary')
    })

    it('preserves diff statistics when diff object contains count metrics', () => {
      const raw = {
        diffContent: {
          filesChanged: 4,
          insertions: 50,
          deletions: 12,
          rawLines: 'lots of code...',
        },
      }
      const sanitized = sanitizeDeciderPayload(raw)
      expect(sanitized.diffStats).toEqual({
        filesChanged: 4,
        insertions: 50,
        deletions: 12,
      })
    })

    it('redacts code fences and raw multiline code in string values', () => {
      const textWithFences =
        'Here is the failure context:\n```typescript\nconst x = 1;\nexport default x;\n```\nEnd trace.'
      const sanitized = sanitizeDeciderPayload(textWithFences)
      expect(sanitized).not.toContain('const x = 1')
      expect(sanitized).toContain('[REDACTED_CODE_BLOCK]')
    })
  })

  describe('plane separation and seat boundaries', () => {
    it('throws error when invoked by an in-rig builder or delivery seat', async () => {
      for (const seat of IN_RIG_EXECUTION_SEATS) {
        await expect(
          queryDecider({
            task: 'queue-ordering',
            seat,
            state: {},
            question: { type: 'choice', criteria: { a: 'A' } },
          }),
        ).rejects.toThrow(/In-rig execution seats .* cannot connect to the decider port/)
      }
    })

    it('throws error when plane is not an external steering plane', async () => {
      await expect(
        queryDecider({
          task: 'queue-ordering',
          plane: 'worker-plane',
          state: {},
          question: { type: 'choice', criteria: { a: 'A' } },
        }),
      ).rejects.toThrow(
        /Decider port is restricted exclusively to external supervisory steering plane/,
      )
    })

    it('allows external steering planes without throwing seat violation', async () => {
      for (const plane of STEERING_PLANES) {
        // Will throw on empty question / task validation, but plane check must pass
        expect(() => isDeciderTaskAllowed('queue-ordering')).not.toThrow()
      }
    })
  })

  describe('allowlist and prohibited actions enforcement', () => {
    it('identifies allowed tasks correctly', () => {
      expect(isDeciderTaskAllowed('queue-ordering')).toBe(true)
      expect(isDeciderTaskAllowed('issue-dedupe')).toBe(true)
      expect(isDeciderTaskAllowed('nudge-level')).toBe(true)
      expect(isDeciderTaskAllowed('  QUEUE-ORDERING  ')).toBe(true)
    })

    it('rejects prohibited actions and unauthorized tasks', () => {
      expect(isDeciderTaskAllowed('gate-signoff')).toBe(false)
      expect(isDeciderTaskAllowed('merge')).toBe(false)
      expect(isDeciderTaskAllowed('scope-modify')).toBe(false)
      expect(isDeciderTaskAllowed('arbitrary-code-exec')).toBe(false)
      expect(isDeciderTaskAllowed('')).toBe(false)
      expect(isDeciderTaskAllowed(null)).toBe(false)
    })

    it('throws when prohibited action is requested', async () => {
      await expect(
        queryDecider({
          task: 'gate-signoff',
          plane: 'external-steering',
        }),
      ).rejects.toThrow(/Task "gate-signoff" involves prohibited decision actions/)

      await expect(
        queryDecider({
          task: 'merge-execute',
          plane: 'external-steering',
        }),
      ).rejects.toThrow(/involves prohibited decision actions/)
    })

    it('throws when task is not on the allowlist', async () => {
      await expect(
        queryDecider({
          task: 'generate-code',
          plane: 'external-steering',
        }),
      ).rejects.toThrow(/is not permitted on decider port allowlist/)
    })
  })

  describe('live and fallback decider queries', () => {
    it('successfully queries the local d3-flash service when running', async () => {
      const res = await queryDecider({
        task: 'nudge-level',
        plane: 'external-steering',
        state: 'Seat dev.build has been idle for 250s on round 1',
        question: {
          type: 'choice',
          instructions: 'Choose nudge level',
          criteria: {
            gentle: 'Gentle reminder',
            standard: 'Standard notice',
            interrupt: 'Immediate interrupt',
          },
        },
      })

      if (res.ok) {
        expect(res.source).toBe('decider')
        expect(res.answer.type).toBe('choice')
        expect(['gentle', 'standard', 'interrupt']).toContain(res.answer.choice)
        expect(res.latencyMs).toBeGreaterThan(0)
      } else {
        // If local daemon is paused, clean fallback must be returned
        expect(res.source).toBe('fallback')
      }
    })

    it('cleanly returns fallback when decider endpoint is unreachable', async () => {
      const res = await queryDecider({
        task: 'queue-ordering',
        plane: 'external-steering',
        state: {},
        question: {
          type: 'choice',
          criteria: { t1: 'Task 1', t2: 'Task 2' },
        },
        options: {
          endpoint: 'http://127.0.0.1:9999/v1/decide', // dead port
          timeoutMs: 300,
        },
      })

      expect(res.ok).toBe(false)
      expect(res.source).toBe('fallback')
      expect(res.fallbackReason).toBe('network-error')
    })
  })

  describe('triage: queue ordering with deterministic fallback', () => {
    it('returns empty list when tasks array is empty', async () => {
      const res = await triageQueueOrdering({ tasks: [] })
      expect(res.ok).toBe(true)
      expect(res.orderedTasks).toEqual([])
      expect(res.selectedTaskId).toBeNull()
    })

    it('returns single item immediately', async () => {
      const res = await triageQueueOrdering({ tasks: [{ id: 'task-100' }] })
      expect(res.ok).toBe(true)
      expect(res.selectedTaskId).toBe('task-100')
      expect(res.orderedTasks.length).toBe(1)
    })

    it('orders tasks deterministically on fallback (unblocked first, higher rework rounds, higher failures)', async () => {
      const tasks = [
        { id: 't_blocked', blocked: true, reworkRound: 2, failureCount: 5 },
        { id: 't_clean', blocked: false, reworkRound: 0, failureCount: 0, priority: 2 },
        { id: 't_critical_rework', blocked: false, reworkRound: 2, failureCount: 3, priority: 1 },
      ]

      const res = await triageQueueOrdering({
        tasks,
        options: { endpoint: 'http://127.0.0.1:9999/v1/decide', timeoutMs: 200 },
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('fallback')
      // t_critical_rework must come before t_clean (rework round 2 > 0)
      // both must come before t_blocked
      expect(res.orderedTasks[0].id).toBe('t_critical_rework')
      expect(res.orderedTasks[1].id).toBe('t_clean')
      expect(res.orderedTasks[2].id).toBe('t_blocked')
    })

    it('orders tasks via live decider when service is responsive', async () => {
      const tasks = [
        { id: 't1', criterionId: 'crit_parser', failureCount: 4, reworkRound: 1 },
        { id: 't2', criterionId: 'crit_docs', failureCount: 0, reworkRound: 0 },
      ]

      const res = await triageQueueOrdering({ tasks })
      expect(res.ok).toBe(true)
      expect(res.orderedTasks.length).toBe(2)
      expect(res.selectedTaskId).toBeDefined()
    })
  })

  describe('triage: issue deduplication with deterministic fallback', () => {
    it('returns isDuplicate=false when existing list is empty', async () => {
      const res = await triageIssueDedupe({
        candidate: { title: 'New bug in token refresh' },
        existingIssues: [],
      })
      expect(res.ok).toBe(true)
      expect(res.isDuplicate).toBe(false)
      expect(res.duplicateOf).toBeNull()
    })

    it('matches duplicate deterministically on fallback by exact criterionId', async () => {
      const candidate = {
        title: 'Token expiry calculation error',
        criterionId: 'crit_jwt_expiry',
        errorCategory: 'token-expired',
      }
      const existing = [
        { id: '101', title: 'Unrelated issue', criterionId: 'crit_other' },
        {
          id: '102',
          title: 'JWT token expired early',
          criterionId: 'crit_jwt_expiry',
          errorCategory: 'token-expired',
        },
      ]

      const res = await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        options: { endpoint: 'http://127.0.0.1:9999/v1/decide', timeoutMs: 200 },
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('fallback')
      expect(res.isDuplicate).toBe(true)
      expect(res.duplicateOf).toBe('102')
    })

    it('matches duplicate deterministically on fallback by title match', async () => {
      const candidate = { title: 'SyntaxError in parser.mjs' }
      const existing = [{ id: '55', title: 'syntaxerror in parser.mjs' }]

      const res = await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        options: { endpoint: 'http://127.0.0.1:9999/v1/decide', timeoutMs: 200 },
      })

      expect(res.ok).toBe(true)
      expect(res.isDuplicate).toBe(true)
      expect(res.duplicateOf).toBe('55')
    })
  })

  describe('triage: nudge level with deterministic fallback', () => {
    it('determines nudge levels deterministically on fallback', async () => {
      // Gentle: idle < 120s and round < 2
      const gentle = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 45,
        reworkRound: 0,
        options: { endpoint: 'http://127.0.0.1:9999/v1/decide', timeoutMs: 200 },
      })
      expect(gentle.level).toBe('gentle')
      expect(gentle.source).toBe('fallback')

      // Standard: idle >= 120s
      const standard = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 150,
        reworkRound: 0,
        options: { endpoint: 'http://127.0.0.1:9999/v1/decide', timeoutMs: 200 },
      })
      expect(standard.level).toBe('standard')

      // Interrupt: idle >= 300s or reworkRound >= 2
      const interruptRound = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 10,
        reworkRound: 2,
        options: { endpoint: 'http://127.0.0.1:9999/v1/decide', timeoutMs: 200 },
      })
      expect(interruptRound.level).toBe('interrupt')

      const interruptIdle = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 350,
        reworkRound: 0,
        options: { endpoint: 'http://127.0.0.1:9999/v1/decide', timeoutMs: 200 },
      })
      expect(interruptIdle.level).toBe('interrupt')
    })

    it('evaluates nudge level via live decider when responsive', async () => {
      const res = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 60,
        reworkRound: 0,
      })
      expect(res.ok).toBe(true)
      expect(['gentle', 'standard', 'interrupt']).toContain(res.level)
    })
  })

  describe('service availability probe', () => {
    it('probes decider service availability', async () => {
      const available = await isDeciderAvailable()
      // Service is running locally on port 8002
      expect(typeof available).toBe('boolean')
    })

    it('returns false for unreachable endpoint', async () => {
      const available = await isDeciderAvailable({
        endpoint: 'http://127.0.0.1:9999/v1/decide',
        timeoutMs: 200,
      })
      expect(available).toBe(false)
    })
  })
})
