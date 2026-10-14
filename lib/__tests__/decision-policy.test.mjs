import { describe, it, expect } from 'vitest'
import {
  evaluateDecisionPolicy,
  isSensitivePath,
  MODEL_TIERS,
  FRONTIER_MODELS,
  BUILDER_SEATS,
  TEST_ENG_SEATS,
  ESCALATION_ACTIONS,
  HUMAN_ESCALATION_REASONS,
  SENSITIVE_SURFACES,
  DECISION_RULES,
} from '../core/decision-policy.mjs'

describe('decision-policy', () => {
  describe('constants and exports', () => {
    it('exports immutable tiers, models, and seats', () => {
      expect(MODEL_TIERS.FRONTIER).toBe('frontier')
      expect(FRONTIER_MODELS.codex).toBe('gpt-6.1-sol')
      expect(FRONTIER_MODELS.gemini).toBe('gemini-pro-high')
      expect(BUILDER_SEATS).toContain('dev.build')
      expect(TEST_ENG_SEATS).toContain('dev.test-eng')
      expect(SENSITIVE_SURFACES).toContain('security')
      expect(SENSITIVE_SURFACES).toContain('auth')
      expect(SENSITIVE_SURFACES).toContain('crypto')
      expect(SENSITIVE_SURFACES).toContain('migration')
      expect(SENSITIVE_SURFACES).toContain('billing')
      expect(SENSITIVE_SURFACES).toContain('data')
      expect(SENSITIVE_SURFACES).toContain('infra')
      expect(SENSITIVE_SURFACES).toContain('governance')
    })

    it('exports an ordered DECISION_RULES table', () => {
      expect(Array.isArray(DECISION_RULES)).toBe(true)
      expect(DECISION_RULES.length).toBeGreaterThan(5)
      expect(DECISION_RULES[0].id).toBe('missing-or-invalid-evidence')
    })
  })

  describe('B1: evidence validation and missing exit codes', () => {
    it('escalates to human when evidence is empty', () => {
      const result = evaluateDecisionPolicy()
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR)
      expect(result.message).toContain('Test exit codes must be valid integers')
    })

    it('escalates to human when coreExitCode is missing or not an integer', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR)
      expect(result.message).toContain('coreExitCode: undefined')
    })

    it('escalates to human when oracleExitCode is string or non-integer', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 0,
        oracleExitCode: '0',
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR)
    })
  })

  describe('B2: circuit breaker and ledger integration', () => {
    it('escalates to human when ledger is frozen', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 1,
        distinctCoreFailures: ['test_1', 'test_2'],
        oracleExitCode: 0,
        ledger: { frozen: true },
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.CIRCUIT_BREAKER)
      expect(result.message).toContain('frozen on ledger')
    })

    it('derives rework round from ledger and does not trip at round 2', () => {
      const ledger = { rounds: [{ id: 1 }] }
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 1,
        distinctCoreFailures: ['test_1', 'test_2'],
        oracleExitCode: 0,
        ledger,
      })
      // Round is 2 (history 1 + 1), does not exceed max of 2, so frontier escalation proceeds
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_FRONTIER)
    })

    it('trips circuit breaker when derived ledger round is 3', () => {
      const ledger = { rounds: [{ id: 1 }, { id: 2 }] }
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 1,
        distinctCoreFailures: ['test_1', 'test_2'],
        oracleExitCode: 0,
        ledger,
      })
      // Round is 3 (history 2 + 1), exceeds DEFAULT_MAX_REWORK_ROUNDS (2)
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.CIRCUIT_BREAKER)
      expect(result.message).toContain('Rework round 3 exceeds circuit breaker threshold')
    })

    it('enforces fixed circuit breaker threshold even if caller attempts override', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 1,
        distinctCoreFailures: ['test_1', 'test_2'],
        oracleExitCode: 0,
        reworkRound: 5,
        maxReworkRounds: 99,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.CIRCUIT_BREAKER)
    })
  })

  describe('B3: sensitive path detection and normalization', () => {
    it('detects leading relative dot segments and slashes', () => {
      expect(isSensitivePath('./.github/workflows/validate-pr.yml')).toBe(true)
      expect(isSensitivePath('.\\manifests\\path-ownership.json')).toBe(true)
      expect(isSensitivePath('/AGENTS.md')).toBe(true)
    })

    it('detects nested sensitive surface folders at any depth', () => {
      expect(isSensitivePath('lib/auth/session.mjs')).toBe(true)
      expect(isSensitivePath('src/crypto/keys.mjs')).toBe(true)
      expect(isSensitivePath('packages/core/security/tokens.mjs')).toBe(true)
      expect(isSensitivePath('app/billing/stripe.ts')).toBe(true)
      expect(isSensitivePath('db/migrations/001_init.sql')).toBe(true)
      expect(isSensitivePath('src/migration/data.js')).toBe(true)
    })

    it('detects governance files and policy documentation', () => {
      expect(isSensitivePath('scripts/validate-path-ownership.mjs')).toBe(true)
      expect(isSensitivePath('CLAUDE.md')).toBe(true)
      expect(isSensitivePath('CODEX.md')).toBe(true)
      expect(isSensitivePath('CULTURE.md')).toBe(true)
      expect(isSensitivePath('OPENRIG.md')).toBe(true)
      expect(isSensitivePath('docs/agent-workflow.md')).toBe(true)
      expect(isSensitivePath('docs/guiding-principles.md')).toBe(true)
    })

    it('is case-insensitive for sensitive folders and files', () => {
      expect(isSensitivePath('Security/x.mjs')).toBe(true)
      expect(isSensitivePath('AUTH/token.js')).toBe(true)
      expect(isSensitivePath('Agents.MD')).toBe(true)
    })

    it('returns false for standard application and test paths', () => {
      expect(isSensitivePath('src/index.js')).toBe(false)
      expect(isSensitivePath('lib/core/run-state.mjs')).toBe(false)
      expect(isSensitivePath('tests/unit/app.test.mjs')).toBe(false)
      expect(isSensitivePath('tests/oracles/spec.json')).toBe(false)
      expect(isSensitivePath('')).toBe(false)
      expect(isSensitivePath(null)).toBe(false)
    })
  })

  describe('B4: changeSurface input verification', () => {
    it('escalates to human when changeSurface contains sensitive surfaces', () => {
      const surfaces = [
        'migration',
        'auth',
        'crypto',
        'security',
        'billing',
        'data',
        'infra',
        'governance',
      ]
      for (const surface of surfaces) {
        const result = evaluateDecisionPolicy({
          seat: 'dev.build',
          coreExitCode: 0,
          oracleExitCode: 0,
          changeSurface: surface,
        })
        expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
        expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.SENSITIVE_PATH)
      }
    })

    it('accepts array of change surfaces and detects sensitive entries', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 0,
        oracleExitCode: 0,
        changeSurface: ['docs', 'ui', 'data'],
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.SENSITIVE_PATH)
    })

    it('does not escalate to human on safe change surface', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 0,
        oracleExitCode: 0,
        changeSurface: 'docs',
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.PASS)
    })
  })

  describe('M1: failure names array requirement', () => {
    it('ignores plain number inputs and does not escalate to frontier', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 1,
        distinctCoreFailures: 2, // plain number should NOT be converted to synthetic names
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.CONTINUE_CURRENT_TIER)
      expect(result.reason).toBe('retry-within-tier')
    })
  })

  describe('M2: contradictory evidence detection', () => {
    it('escalates to human when coreExitCode is 0 but distinctCoreFailures is non-empty', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 0,
        distinctCoreFailures: ['test_login', 'test_auth'],
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR)
      expect(result.message).toContain('Contradictory evidence: core tests reported exit code 0')
    })

    it('escalates to human when oracleExitCode is 0 but distinctOracleFailures is non-empty', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 0,
        oracleExitCode: 0,
        distinctOracleFailures: ['oracle_mismatch'],
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR)
      expect(result.message).toContain('Contradictory evidence: oracle tests reported exit code 0')
    })
  })

  describe('M3: platform prototype safety', () => {
    it('safely falls back to default model on prototype key without throwing', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        platform: 'toString',
        coreExitCode: 1,
        distinctCoreFailures: ['test_1', 'test_2'],
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_FRONTIER)
      expect(result.model).toBe('gpt-6.1-sol')
    })
  })

  describe('M4: frontier capability ceiling', () => {
    it('escalates to human when builder fails while already at frontier tier', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        currentTier: MODEL_TIERS.FRONTIER,
        coreExitCode: 1,
        distinctCoreFailures: ['test_complex_algorithm', 'test_corner_case'],
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.CAPABILITY_CEILING)
      expect(result.message).toContain('running at frontier tier; capability ceiling reached')
    })
  })

  describe('clean execution (pass)', () => {
    it('returns pass when all checks succeed with 0 failures', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 0,
        oracleExitCode: 0,
        distinctCoreFailures: [],
        distinctOracleFailures: [],
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.PASS)
      expect(result.reason).toBe('clean-pass')
    })
  })

  describe('builder model escalation', () => {
    it('does NOT escalate to frontier when builder has only 1 core failure', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        currentTier: MODEL_TIERS.BALANCED,
        coreExitCode: 1,
        distinctCoreFailures: ['test_user_login'],
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.CONTINUE_CURRENT_TIER)
      expect(result.targetTier).toBe(MODEL_TIERS.BALANCED)
      expect(result.reason).toBe('retry-within-tier')
    })

    it('deduplicates failure names and does NOT escalate if distinct count is 1', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        currentTier: MODEL_TIERS.BALANCED,
        coreExitCode: 1,
        distinctCoreFailures: ['test_user_login', 'test_user_login', 'test_user_login'],
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.CONTINUE_CURRENT_TIER)
      expect(result.targetTier).toBe(MODEL_TIERS.BALANCED)
    })

    it('escalates builder to frontier tier (Codex GPT-6.1 Sol) upon >= 2 distinct core test failures', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        platform: 'codex',
        coreExitCode: 1,
        distinctCoreFailures: ['test_user_login', 'test_token_refresh'],
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_FRONTIER)
      expect(result.targetTier).toBe(MODEL_TIERS.FRONTIER)
      expect(result.model).toBe('gpt-6.1-sol')
      expect(result.reason).toBe('capability-ceiling')
      expect(result.distinctCoreFailures).toEqual(['test_user_login', 'test_token_refresh'])
    })

    it('escalates builder to Gemini Pro High when platform is gemini', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build-sr',
        platform: 'gemini',
        coreExitCode: 1,
        distinctCoreFailures: ['test_parser', 'test_compiler', 'test_codegen'],
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_FRONTIER)
      expect(result.targetTier).toBe(MODEL_TIERS.FRONTIER)
      expect(result.model).toBe('gemini-pro-high')
    })

    it('does not escalate non-builder seats to builder frontier tier', () => {
      const result = evaluateDecisionPolicy({
        seat: 'pm.manager',
        coreExitCode: 1,
        distinctCoreFailures: ['test_1', 'test_2'],
        oracleExitCode: 0,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.CONTINUE_CURRENT_TIER)
    })
  })

  describe('oracle defect routing to dev.test-eng', () => {
    it('routes to dev.test-eng when core tests exit 0 but oracle tests fail', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 0,
        distinctCoreFailures: [],
        oracleExitCode: 1,
        distinctOracleFailures: ['criterion-spec-mismatch', 'assertion-timeout'],
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ROUTE_TEST_ENG)
      expect(result.targetSeat).toBe('dev.test-eng')
      expect(result.reason).toBe('oracle-defect')
      expect(result.distinctOracleFailures).toEqual([
        'criterion-spec-mismatch',
        'assertion-timeout',
      ])
    })

    it('does not route to test-eng if core tests failed', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 1,
        distinctCoreFailures: ['test_login', 'test_auth'],
        oracleExitCode: 1,
        distinctOracleFailures: ['oracle_1'],
      })
      // Core failures take precedence for builder
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_FRONTIER)
    })
  })

  describe('human escalation guards and priority', () => {
    it('escalates directly to human on timeout', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 1,
        oracleExitCode: 0,
        timedOut: true,
        distinctCoreFailures: ['test_1', 'test_2'],
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.TIMEOUT)
      expect(result.targetRole).toBe('human')
    })

    it('escalates directly to human on unknown error', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 1,
        oracleExitCode: 0,
        unknownError: 'SIGSEGV memory error in sandbox',
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR)
      expect(result.message).toContain('SIGSEGV memory error')
    })

    it('escalates directly to human on sensitive paths modified flag', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 0,
        oracleExitCode: 0,
        sensitivePathsModified: true,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.SENSITIVE_PATH)
    })

    it('escalates directly to human when pathsModified contains sensitive files', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 0,
        oracleExitCode: 0,
        pathsModified: ['lib/app.mjs', '.github/workflows/validate-pr.yml'],
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.SENSITIVE_PATH)
    })

    it('prioritizes human escalation over frontier escalation', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        coreExitCode: 1,
        oracleExitCode: 0,
        timedOut: true,
        distinctCoreFailures: ['test_1', 'test_2', 'test_3'],
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.TIMEOUT)
    })
  })
})
