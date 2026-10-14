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
    })
  })

  describe('isSensitivePath', () => {
    it('detects governance and security surfaces', () => {
      expect(isSensitivePath('.github/workflows/validate-pr.yml')).toBe(true)
      expect(isSensitivePath('manifests/path-ownership.json')).toBe(true)
      expect(isSensitivePath('AGENTS.md')).toBe(true)
      expect(isSensitivePath('auth/credentials.mjs')).toBe(true)
      expect(isSensitivePath('crypto/keys.mjs')).toBe(true)
      expect(isSensitivePath('security/policy.mjs')).toBe(true)
      expect(isSensitivePath('billing/stripe.mjs')).toBe(true)
    })

    it('returns false for standard application and test paths', () => {
      expect(isSensitivePath('src/index.js')).toBe(false)
      expect(isSensitivePath('lib/core/role-collaboration.mjs')).toBe(false)
      expect(isSensitivePath('tests/unit/app.test.mjs')).toBe(false)
      expect(isSensitivePath('tests/oracles/spec.json')).toBe(false)
      expect(isSensitivePath('')).toBe(false)
      expect(isSensitivePath(null)).toBe(false)
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
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.CONTINUE_CURRENT_TIER)
      expect(result.targetTier).toBe(MODEL_TIERS.BALANCED)
      expect(result.reason).toBe('retry-within-tier')
    })

    it('deduplicates failure names and does NOT escalate if distinct count is 1', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        currentTier: MODEL_TIERS.BALANCED,
        distinctCoreFailures: ['test_user_login', 'test_user_login', 'test_user_login'],
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

  describe('human escalation guards', () => {
    it('escalates directly to human on timeout', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
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
        unknownError: 'SIGSEGV memory error in sandbox',
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR)
      expect(result.message).toContain('SIGSEGV memory error')
    })

    it('escalates directly to human on sensitive paths modified flag', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        sensitivePathsModified: true,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.SENSITIVE_PATH)
    })

    it('escalates directly to human when pathsModified contains sensitive files', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        pathsModified: ['lib/app.mjs', '.github/workflows/validate-pr.yml'],
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.SENSITIVE_PATH)
    })

    it('escalates directly to human when rework round exceeds circuit breaker', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        reworkRound: 3,
        maxReworkRounds: 2,
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.CIRCUIT_BREAKER)
    })

    it('prioritizes human escalation over frontier escalation', () => {
      const result = evaluateDecisionPolicy({
        seat: 'dev.build',
        timedOut: true,
        distinctCoreFailures: ['test_1', 'test_2', 'test_3'],
      })
      expect(result.action).toBe(ESCALATION_ACTIONS.ESCALATE_HUMAN)
      expect(result.reason).toBe(HUMAN_ESCALATION_REASONS.TIMEOUT)
    })
  })
})
