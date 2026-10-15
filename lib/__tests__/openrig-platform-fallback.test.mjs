import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePresets } from '../../adapters/openrig/lifecycle.mjs'
import {
  DEFAULT_PLATFORM_CHAINS,
  DEFAULT_TIER_MODEL_MATRIX,
  SEAT_DEFAULT_TIER,
  resolveFourEyesReviewerTarget,
  resolveTwoLevelFallback,
} from '../../adapters/openrig/platform-fallback.mjs'
import { CAPABILITY_TIER_RANK } from '../core/execution-receipt.mjs'

const CONFIG_PATH = resolve('adapters/openrig/agentflow/configurations.yaml')

describe('adapters/openrig/platform-fallback (Issue #512)', () => {
  describe('constants and matrix contracts', () => {
    it('defines non-empty platform fallback chains for all delivery and product seats', () => {
      const seats = [
        'pm.manager',
        'pm.analyst',
        'orch.arch',
        'dev.build-jr',
        'dev.build',
        'dev.build-sr',
        'dev.qa',
        'rev.review',
      ]
      for (const seat of seats) {
        expect(DEFAULT_PLATFORM_CHAINS[seat]).toBeDefined()
        expect(Array.isArray(DEFAULT_PLATFORM_CHAINS[seat])).toBe(true)
        expect(DEFAULT_PLATFORM_CHAINS[seat].length).toBeGreaterThan(0)
      }
    })

    it('defines standard seat default capability tiers', () => {
      expect(SEAT_DEFAULT_TIER['pm.manager']).toBe('lightweight')
      expect(SEAT_DEFAULT_TIER['pm.analyst']).toBe('balanced')
      expect(SEAT_DEFAULT_TIER['orch.arch']).toBe('architect-lead')
      expect(SEAT_DEFAULT_TIER['dev.build-jr']).toBe('lightweight')
      expect(SEAT_DEFAULT_TIER['dev.build']).toBe('balanced')
      expect(SEAT_DEFAULT_TIER['dev.build-sr']).toBe('architect-lead')
      expect(SEAT_DEFAULT_TIER['dev.qa']).toBe('balanced')
      expect(SEAT_DEFAULT_TIER['rev.review']).toBe('deep-reasoning')
    })

    it('defines capability tier model matrix across 4 canonical tiers', () => {
      const tiers = ['lightweight', 'balanced', 'deep-reasoning', 'architect-lead']
      for (const tier of tiers) {
        expect(DEFAULT_TIER_MODEL_MATRIX[tier]).toBeDefined()
        const platforms = Object.keys(DEFAULT_TIER_MODEL_MATRIX[tier])
        expect(platforms.length).toBeGreaterThanOrEqual(3)
        for (const platform of platforms) {
          const entry = DEFAULT_TIER_MODEL_MATRIX[tier][platform]
          expect(entry).toHaveProperty('runtime')
          expect(entry).toHaveProperty('providerFamily')
          expect(entry).toHaveProperty('model')
          expect(entry).toHaveProperty('effort')
        }
      }
    })

    it('enforces object immutability', () => {
      expect(Object.isFrozen(DEFAULT_PLATFORM_CHAINS)).toBe(true)
      expect(Object.isFrozen(DEFAULT_TIER_MODEL_MATRIX)).toBe(true)
      expect(Object.isFrozen(SEAT_DEFAULT_TIER)).toBe(true)
    })
  })

  describe('resolveTwoLevelFallback', () => {
    it('resolves primary platform and model when all platforms are healthy', () => {
      const result = resolveTwoLevelFallback({ seat: 'dev.build-jr' })
      expect(result).toEqual({
        ok: true,
        status: 'RESOLVED',
        seat: 'dev.build-jr',
        capabilityTier: 'lightweight',
        platform: 'pi:grok',
        runtime: 'pi',
        providerFamily: 'xai',
        model: 'grok-cli/grok-4-fast',
        effort: 'low',
        fallbackIndex: 0,
      })
    })

    it('falls back to codex with lightweight spark (effort: low) when grok and antigravity are unhealthy', () => {
      const result = resolveTwoLevelFallback({
        seat: 'dev.build-jr',
        healthyPlatforms: ['codex:openai-codex', 'claude-code:anthropic'],
      })
      expect(result).toEqual({
        ok: true,
        status: 'RESOLVED',
        seat: 'dev.build-jr',
        capabilityTier: 'lightweight',
        platform: 'codex:openai-codex',
        runtime: 'codex',
        providerFamily: 'openai',
        model: 'gpt-5.3-codex-spark',
        effort: 'low',
        fallbackIndex: 2,
      })
      // Must NEVER select gpt-6.1-sol or high effort for lightweight tier!
      expect(result.model).not.toBe('gpt-6.1-sol')
      expect(result.effort).toBe('low')
    })

    it('selects gpt-6-astra:medium or claude-sonnet-4-6:medium when dev.qa falls back', () => {
      const codexResult = resolveTwoLevelFallback({
        seat: 'dev.qa',
        healthyPlatforms: ['codex:openai-codex'],
      })
      expect(codexResult).toEqual({
        ok: true,
        status: 'RESOLVED',
        seat: 'dev.qa',
        capabilityTier: 'balanced',
        platform: 'codex:openai-codex',
        runtime: 'codex',
        providerFamily: 'openai',
        model: 'gpt-6-astra',
        effort: 'medium',
        fallbackIndex: 2,
      })

      const claudeResult = resolveTwoLevelFallback({
        seat: 'dev.qa',
        healthyPlatforms: ['claude-code:anthropic'],
      })
      expect(claudeResult).toEqual({
        ok: true,
        status: 'RESOLVED',
        seat: 'dev.qa',
        capabilityTier: 'balanced',
        platform: 'claude-code:anthropic',
        runtime: 'claude-code',
        providerFamily: 'anthropic',
        model: 'claude-sonnet-4-6',
        effort: 'medium',
        fallbackIndex: 3,
      })
    })

    it('rejects mid-phase platform hops when current platform becomes unhealthy (BLOCKER-6)', () => {
      expect(() =>
        resolveTwoLevelFallback({
          seat: 'dev.build',
          currentPlatform: 'pi:antigravity',
          healthyPlatforms: ['codex:openai-codex'],
          atPhaseBoundary: false,
        }),
      ).toThrow(
        /MID_PHASE_PLATFORM_SWITCH_DENIED: platform fallback switches are only allowed at phase boundaries/,
      )
    })

    it('retains currentPlatform mid-phase if current platform remains healthy', () => {
      const result = resolveTwoLevelFallback({
        seat: 'dev.build',
        currentPlatform: 'pi:antigravity',
        healthyPlatforms: ['pi:antigravity', 'codex:openai-codex'],
        atPhaseBoundary: false,
      })
      expect(result.ok).toBe(true)
      expect(result.platform).toBe('pi:antigravity')
      expect(result.model).toBe('antigravity/gemini-3.8-flash')
    })

    it('allows platform fallback switch when at phase boundary', () => {
      const result = resolveTwoLevelFallback({
        seat: 'dev.build',
        currentPlatform: 'pi:antigravity',
        healthyPlatforms: ['codex:openai-codex'],
        atPhaseBoundary: true,
      })
      expect(result.ok).toBe(true)
      expect(result.platform).toBe('codex:openai-codex')
      expect(result.model).toBe('gpt-6-astra')
    })

    it('returns NO_HEALTHY_PLATFORM when no platforms in chain are healthy', () => {
      const result = resolveTwoLevelFallback({
        seat: 'orch.arch',
        healthyPlatforms: ['unsupported:unknown'],
      })
      expect(result).toEqual({
        ok: false,
        status: 'NO_HEALTHY_PLATFORM',
        seat: 'orch.arch',
        capabilityTier: 'architect-lead',
      })
    })

    it('supports explicit capabilityTier override', () => {
      const result = resolveTwoLevelFallback({
        seat: 'dev.build-jr',
        capabilityTier: 'deep-reasoning',
      })
      expect(result.ok).toBe(true)
      expect(result.capabilityTier).toBe('deep-reasoning')
      expect(result.platform).toBe('pi:grok')
      expect(result.model).toBe('grok-cli/grok-4.7')
      expect(result.effort).toBe('high')
    })
  })

  describe('resolveFourEyesReviewerTarget', () => {
    it('dynamically elevates rev.review to architect-lead when builder builds at architect-lead tier (BLOCKER-5)', () => {
      const builderReceipt = {
        actual: {
          platform: 'openai-codex',
          model: 'gpt-6.1-sol',
        },
        metadata: {
          capabilityTier: 'architect-lead',
        },
      }

      const result = resolveFourEyesReviewerTarget({
        builderReceipt,
      })

      expect(result.ok).toBe(true)
      expect(result.status).toBe('FOUR_EYES_RESOLVED')
      expect(result.seat).toBe('rev.review')
      expect(result.capabilityTier).toBe('architect-lead')
      expect(result.platform).toBe('pi:antigravity')
      expect(result.model).toBe('antigravity/gemini-3.1-pro')
      expect(result.effort).toBe('high')
      expect(result.builderFamily).toBe('openai')
      expect(result.reviewerFamily).toBe('google')
      expect(result.builderFamily).not.toBe(result.reviewerFamily)
      expect(CAPABILITY_TIER_RANK[result.capabilityTier]).toBeGreaterThanOrEqual(
        CAPABILITY_TIER_RANK[builderReceipt.metadata.capabilityTier],
      )
    })

    it('dynamically selects claude-code:anthropic at architect-lead tier when pi:antigravity is unhealthy', () => {
      const builderReceipt = {
        actual: {
          platform: 'openai-codex',
          model: 'gpt-6.1-sol',
        },
        metadata: {
          capabilityTier: 'architect-lead',
        },
      }

      const result = resolveFourEyesReviewerTarget({
        builderReceipt,
        healthyPlatforms: ['claude-code:anthropic', 'codex:openai-codex'],
      })

      expect(result.ok).toBe(true)
      expect(result.status).toBe('FOUR_EYES_RESOLVED')
      expect(result.seat).toBe('rev.review')
      expect(result.capabilityTier).toBe('architect-lead')
      expect(result.platform).toBe('claude-code:anthropic')
      expect(result.model).toBe('claude-opus-4-6')
      expect(result.effort).toBe('high')
      expect(result.builderFamily).toBe('openai')
      expect(result.reviewerFamily).toBe('anthropic')
    })

    it('fails closed with FOUR_EYES_UNAVAILABLE when only builder family platform is healthy', () => {
      const builderReceipt = {
        actual: {
          platform: 'openai-codex',
          model: 'gpt-6.1-sol',
        },
        metadata: {
          capabilityTier: 'architect-lead',
        },
      }

      const result = resolveFourEyesReviewerTarget({
        builderReceipt,
        healthyPlatforms: ['codex:openai-codex'],
      })

      expect(result).toEqual({
        ok: false,
        status: 'FOUR_EYES_UNAVAILABLE',
        reason: 'No healthy independent provider family meets the builder tier floor',
      })
    })

    it('uses deep-reasoning floor for balanced builder tier', () => {
      const builderReceipt = {
        actual: {
          platform: 'anthropic',
          model: 'claude-sonnet-4-6',
        },
        metadata: {
          capabilityTier: 'balanced',
        },
      }

      const result = resolveFourEyesReviewerTarget({
        builderReceipt,
      })

      expect(result.ok).toBe(true)
      expect(result.capabilityTier).toBe('deep-reasoning')
      expect(result.platform).toBe('pi:antigravity')
      expect(result.model).toBe('antigravity/gemini-3.1-pro')
      expect(result.effort).toBe('high')
      expect(result.builderFamily).toBe('anthropic')
      expect(result.reviewerFamily).toBe('google')
    })

    it('fails closed when builder receipt is missing', () => {
      const result = resolveFourEyesReviewerTarget({
        builderReceipt: null,
      })
      expect(result.ok).toBe(false)
      expect(result.status).toBe('FOUR_EYES_UNAVAILABLE')
    })
  })

  describe('backward-compatible configurations.yaml parsing (MIG-4)', () => {
    it('preserves declared presets and recommended configuration intact', () => {
      const content = readFileSync(CONFIG_PATH, 'utf8')
      const { recommended, presets } = parsePresets(content)

      expect(recommended).toBe('balanced-grok-lead')
      const presetNames = [
        'balanced-grok-lead',
        'codex-gemini-grok',
        'grok-gemini',
        'inverted-codex-lead',
        'grok-heavy',
        'claude-heavy',
        'codex-heavy',
        'all-grok',
        'all-claude',
        'all-codex',
      ]
      for (const name of presetNames) {
        expect(presets[name]).toBeDefined()
      }
      expect(presets['balanced-grok-lead']).toEqual({
        'orch.arch': 'pi',
        'dev.build-jr': 'claude-code',
        'dev.build': 'claude-code',
        'dev.build-sr': 'claude-code',
        'dev.qa': 'codex',
        'rev.review': 'pi',
      })
    })

    it('keeps optional bundle overrides without duplicating built-in model policy', () => {
      const content = readFileSync(CONFIG_PATH, 'utf8')
      expect(content).toContain('capability_tiers: {}')
      expect(content).toContain('fallback_chains: {}')
      for (const tier of ['lightweight', 'balanced', 'deep-reasoning', 'architect-lead']) {
        expect(DEFAULT_TIER_MODEL_MATRIX[tier]).toBeDefined()
      }
    })

    it('includes 2026 frontline and all-antigravity presets and effort_policy', async () => {
      const { FRONTIER_2026_MODELS, enforceEffortDegradationGuard } =
        await import('../../adapters/openrig/platform-fallback.mjs')
      const content = readFileSync(CONFIG_PATH, 'utf8')
      const { presets } = parsePresets(content)
      expect(presets.frontline).toBeDefined()
      expect(presets['all-antigravity']).toBeDefined()
      expect(content).toContain('effort_policy:')

      expect(FRONTIER_2026_MODELS.google.flagship).toBe('antigravity/gemini-4-argon')
      expect(FRONTIER_2026_MODELS.openai.flagship).toBe('gpt-6.1-sol')
      expect(FRONTIER_2026_MODELS.openai.balanced).toBe('gpt-6-astra')

      const clamped = enforceEffortDegradationGuard({
        seat: 'dev.build',
        requestedEffort: 'high',
        phase: 4,
        rung: 'P1',
        isPersistentLoop: true,
      })
      expect(clamped.clamped).toBe(true)
      expect(clamped.effectiveEffort).toBe('medium')

      const allowedBurst = enforceEffortDegradationGuard({
        seat: 'orch.arch',
        requestedEffort: 'high',
        phase: 2,
        rung: 'P3',
        isPersistentLoop: false,
        isOneShotBurst: true,
      })
      expect(allowedBurst.clamped).toBe(false)
      expect(allowedBurst.effectiveEffort).toBe('high')
    })
  })
})
