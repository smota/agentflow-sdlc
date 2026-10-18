import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALLOWED_OBSERVATION_SOURCES,
  QUOTA_COVERAGE_DISCLOSURE,
  classifyQuotaObservation,
  defaultQuotaControlPolicy,
  evaluateSeatQuotaControl,
  evaluateSubscriptionQuotaPools,
  resolveQuotaControlPolicy,
  validateQuotaControlPolicyShape,
} from '../config/quota-policy.mjs'
import {
  defaultDistributionSelection,
  resolveDistribution,
} from '../config/execution-distribution.mjs'
import {
  QUOTA_COVERAGE_DISCLOSURE as reexportedDisclosure,
  classifyQuotaObservation as reexportedClassify,
  evaluateSeatQuotaControl as reexportedEvaluate,
  resolveQuotaControlPolicy as reexportedResolve,
} from '../../adapters/openrig/platform-fallback.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cliPath = resolve(packageRoot, 'bin/cli.mjs')
const NOW = 1_800_000_000_000
const tempDirs = []

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
})

function enabledPolicy(overrides = {}) {
  return {
    ...defaultQuotaControlPolicy(),
    enabled: true,
    windows: ['weekly', 'five-hour'],
    thresholdRemainingPct: 25,
    simultaneousWindowRule: 'most-restrictive',
    ...overrides,
  }
}

function observation(overrides = {}) {
  return {
    subscription: 'gemini',
    window: 'weekly',
    source: 'provider-rate-limit-headers',
    mode: 'supported',
    observedAt: NOW - 1_000,
    remainingPct: 80,
    resetAt: NOW + 3_600_000,
    ...overrides,
  }
}

function preserveState() {
  return {
    owner: 'dev.build',
    taskId: 'task-535',
    worktree: '/tmp/agentflow/535-quota-checkpoints',
    oracleCustodyDigest: 'a'.repeat(64),
    artifactDigests: ['b'.repeat(64), 'c'.repeat(64)],
  }
}

function evaluate(overrides = {}) {
  return evaluateSeatQuotaControl({
    seat: 'dev.build',
    policy: enabledPolicy(),
    selection: defaultDistributionSelection(),
    observations: [],
    atSafeCheckpoint: true,
    excludedFamilies: [],
    preserveState: preserveState(),
    nowMs: NOW,
    ...overrides,
  })
}

function expectPreserved(result, families) {
  expect(result.preserved).toMatchObject(preserveState())
  expect(result.preserved.seat).toBe(result.seat)
  expect(result.effects).toEqual([])
  if (families) {
    expect(result.preserved.reviewerIndependenceExcludedFamilies).toEqual(families)
  }
}

function sharedGeminiSelection() {
  const selection = defaultDistributionSelection()
  const profile = resolveDistribution(selection)
  const geminiDefault = profile.roles['dev.build'].options[0]
  const geminiSibling = profile.roles['dev.build-sr'].options.find(
    (option) => option.subscription === 'gemini' && option.model !== geminiDefault.model,
  )
  const openai = profile.roles['dev.build'].options.find(
    (option) => option.subscription === 'openai',
  )
  return {
    selection: {
      ...selection,
      overrides: {
        'dev.build': {
          reason: 'Two approved models share one Gemini subscription budget',
          options: [
            structuredClone(geminiDefault),
            structuredClone(geminiSibling),
            structuredClone(openai),
          ],
        },
      },
    },
    geminiSibling,
    openai,
  }
}

describe('quota policy defaults and re-exports', () => {
  it('AC1: default disabled policy performs no intervention and records no effects', () => {
    const policy = defaultQuotaControlPolicy()
    expect(policy.enabled).toBe(false)
    expect(validateQuotaControlPolicyShape(policy).ok).toBe(true)

    const result = evaluateSeatQuotaControl({
      seat: 'dev.build',
      policy,
      observations: [observation({ remainingPct: 0, mode: 'unavailable' })],
      atSafeCheckpoint: false,
      nowMs: NOW,
    })

    expect(result).toMatchObject({
      ok: true,
      enabled: false,
      intervention: 'none',
      status: 'QUOTA_CONTROL_DISABLED',
      checkpointRequired: false,
      effects: [],
      selectedOption: result.currentOption,
    })
    expect(result.coverageDisclosure).toBe(QUOTA_COVERAGE_DISCLOSURE)
    expect(result.coverageDisclosure).toMatchObject({
      defaultEnabled: false,
      grantsPublicationOrPushAuthority: false,
      rewritesSavedDistributionPolicy: false,
      treatsSameSubscriptionModelsAsIndependentQuota: false,
      parsesTranscriptOrContextTokensAsQuota: false,
    })
    expect(result.currentSubscriptionPool).toBeUndefined()
    expect(result.publicationAuthorityGranted).not.toBe(true)
    expect(result.savedPolicyModified).not.toBe(true)
  })

  it('re-exports quota evaluation from the OpenRig platform fallback adapter', () => {
    expect(reexportedEvaluate).toBe(evaluateSeatQuotaControl)
    expect(reexportedResolve).toBe(resolveQuotaControlPolicy)
    expect(reexportedClassify).toBe(classifyQuotaObservation)
    expect(reexportedDisclosure).toBe(QUOTA_COVERAGE_DISCLOSURE)
  })

  it('merges steering hints under saved quotaControl and explicit overrides without persisting them', () => {
    const resolved = resolveQuotaControlPolicy(
      {
        steering: { quotaPolicy: { autoMonitoring: true, mode: 'park-and-checkpoint' } },
        quotaControl: { enabled: false, windows: ['five-hour'] },
      },
      { thresholdRemainingPct: 10 },
    )
    expect(resolved).toMatchObject({
      enabled: false,
      fallbackAction: 'park-only',
      windows: ['five-hour'],
      thresholdRemainingPct: 10,
    })
    expect(resolved.policyDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(() => resolveQuotaControlPolicy({}, { windows: ['daily'] })).toThrow(
      /Invalid quota control policy/,
    )
  })
})

describe('AC2: observation classification and simultaneous windows', () => {
  it('classifies supported, approximate, aged, future-dated, and unavailable observations', () => {
    const supported = classifyQuotaObservation(observation(), {
      nowMs: NOW,
      thresholdRemainingPct: 25,
    })
    expect(supported).toMatchObject({
      valid: true,
      classification: 'supported',
      health: 'healthy',
      thresholdCrossed: false,
      reason: 'within-quota-budget',
      remainingPct: 80,
    })

    const approximate = classifyQuotaObservation(
      observation({
        mode: 'approximate',
        source: 'cli-usage-probe',
        remainingPct: 25,
      }),
      { nowMs: NOW, thresholdRemainingPct: 25 },
    )
    expect(approximate).toMatchObject({
      valid: true,
      classification: 'approximate',
      health: 'healthy',
      thresholdCrossed: false,
      reason: 'within-quota-budget',
    })

    const aged = classifyQuotaObservation(
      observation({ observedAt: NOW - 300_001, source: 'subscription-dashboard-snapshot' }),
      { nowMs: NOW, maxObservationAgeMs: 300_000 },
    )
    expect(aged).toMatchObject({
      valid: true,
      classification: 'stale',
      health: 'unknown',
      reason: 'observation-exceeds-max-age',
    })

    const futureDated = classifyQuotaObservation(
      observation({
        observedAt: new Date(NOW + 5_000).toISOString(),
        source: 'provider-status-api',
      }),
      { nowMs: NOW },
    )
    expect(futureDated).toMatchObject({
      valid: false,
      classification: 'unavailable',
      health: 'unknown',
      reason: 'missing-or-future-timestamp',
    })

    const expiredReset = classifyQuotaObservation(
      observation({ resetAt: NOW - 1, remainingPct: 4, source: 'operator-reported-snapshot' }),
      { nowMs: NOW, thresholdRemainingPct: 25 },
    )
    expect(expiredReset).toMatchObject({
      valid: true,
      classification: 'supported',
      health: 'threshold-crossed',
      exhausted: false,
      reason: 'below-remaining-threshold',
      resetAt: null,
    })

    const unavailable = classifyQuotaObservation(
      observation({ mode: 'unavailable', status: 'unavailable', remainingPct: null }),
      { nowMs: NOW },
    )
    expect(unavailable).toMatchObject({
      valid: true,
      classification: 'unavailable',
      health: 'unavailable',
      reason: 'provider-reported-unavailable',
    })

    expect(ALLOWED_OBSERVATION_SOURCES).toEqual([
      'provider-status-api',
      'provider-rate-limit-headers',
      'subscription-dashboard-snapshot',
      'cli-usage-probe',
      'operator-reported-snapshot',
    ])
  })

  it('rejects context-token and transcript sources instead of treating them as provider quota', () => {
    const rejected = [
      observation({ kind: 'context-tokens', remainingPct: 1 }),
      observation({ kind: 'transcript-text', remainingPct: 1 }),
      observation({ source: 'context-window', remainingPct: 1 }),
      observation({ source: 'transcript', remainingPct: 1 }),
    ].map((item) => classifyQuotaObservation(item, { nowMs: NOW }))

    for (const result of rejected) {
      expect(result).toMatchObject({
        valid: false,
        classification: 'unavailable',
        health: 'unknown',
        reason: 'context-or-transcript-usage-is-not-provider-quota',
      })
    }

    const seat = evaluate({
      observations: rejected.map((item, index) => ({
        ...observation({ remainingPct: 0 }),
        kind: index % 2 === 0 ? 'context-tokens' : 'transcript-text',
      })),
    })
    expect(seat).toMatchObject({
      ok: false,
      intervention: 'hold-unverified-quota',
      status: 'QUOTA_OBSERVATION_UNAVAILABLE',
      selectedOption: null,
      checkpointRequired: true,
    })
    expect(seat.effects).toEqual([])
    expectPreserved(seat)
  })

  it('applies the most-restrictive rule and deduplicates same subscription and window', () => {
    const policy = enabledPolicy()
    const bothLow = evaluateSubscriptionQuotaPools({
      policy,
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', remainingPct: 90 }),
        observation({ window: 'five-hour', remainingPct: 24 }),
      ],
    })
    expect(bothLow.pools.gemini).toMatchObject({
      status: 'threshold-crossed',
      reason: 'configured-window-below-threshold',
      lowestRemainingPct: 24,
    })

    const weeklyRestricts = evaluateSubscriptionQuotaPools({
      policy,
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', remainingPct: 10 }),
        observation({ window: 'five-hour', remainingPct: 90 }),
      ],
    })
    expect(weeklyRestricts.pools.gemini.status).toBe('threshold-crossed')
    expect(weeklyRestricts.pools.gemini.lowestRemainingPct).toBe(10)

    const boundary = evaluateSubscriptionQuotaPools({
      policy,
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', remainingPct: 25 }),
        observation({ window: 'five-hour', remainingPct: 25 }),
      ],
    })
    expect(boundary.pools.gemini.status).toBe('healthy')

    const newestWins = evaluateSubscriptionQuotaPools({
      policy,
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', observedAt: NOW - 5_000, remainingPct: 1 }),
        observation({ window: 'weekly', observedAt: NOW - 1_000, remainingPct: 70 }),
        observation({ window: 'five-hour', observedAt: NOW - 4_000, remainingPct: 4 }),
        observation({ window: 'five-hour', observedAt: NOW - 2_000, remainingPct: 60 }),
      ],
    })
    expect(newestWins.pools.gemini.status).toBe('healthy')
    expect(newestWins.pools.gemini.windows.weekly.remainingPct).toBe(70)
    expect(newestWins.pools.gemini.windows['five-hour'].remainingPct).toBe(60)
    expect(newestWins.pools.gemini.lowestRemainingPct).toBe(60)

    const conflict = evaluateSubscriptionQuotaPools({
      policy,
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', observedAt: NOW - 1_000, remainingPct: 80 }),
        observation({ window: 'weekly', observedAt: NOW - 1_000, remainingPct: 5 }),
      ],
    })
    expect(conflict.pools.gemini).toMatchObject({
      status: 'unknown',
      reason: 'conflicting-simultaneous-window-observations',
    })

    const staleLosesToThreshold = evaluateSubscriptionQuotaPools({
      policy,
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', remainingPct: 4 }),
        observation({ window: 'five-hour', observedAt: NOW - 400_000, remainingPct: 99 }),
      ],
    })
    expect(staleLosesToThreshold.pools.gemini.status).toBe('threshold-crossed')

    const staleWithoutCrossing = evaluateSubscriptionQuotaPools({
      policy,
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', remainingPct: 80 }),
        observation({ window: 'five-hour', observedAt: NOW - 400_000, remainingPct: 80 }),
      ],
    })
    expect(staleWithoutCrossing.pools.gemini).toMatchObject({
      status: 'stale',
      reason: 'configured-window-stale-or-unverified',
    })

    const unavailableWindow = evaluateSubscriptionQuotaPools({
      policy,
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', remainingPct: 80 }),
        observation({ window: 'five-hour', mode: 'unavailable', remainingPct: null }),
      ],
    })
    expect(unavailableWindow.pools.gemini.status).toBe('unavailable')

    const unconfiguredWindowIgnored = evaluateSubscriptionQuotaPools({
      policy: enabledPolicy({ windows: ['weekly'] }),
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', remainingPct: 80 }),
        observation({ window: 'five-hour', remainingPct: 0 }),
      ],
    })
    expect(unconfiguredWindowIgnored.pools.gemini.status).toBe('healthy')

    const perWindowThreshold = evaluateSubscriptionQuotaPools({
      policy: enabledPolicy({
        thresholdRemainingPct: 25,
        windowThresholds: { 'five-hour': 10 },
      }),
      nowMs: NOW,
      observations: [
        observation({ window: 'weekly', remainingPct: 30 }),
        observation({ window: 'five-hour', remainingPct: 12 }),
      ],
    })
    expect(perWindowThreshold.pools.gemini.status).toBe('healthy')
  })

  it('holds unverified quota instead of switching on stale or missing observations', () => {
    const stale = evaluate({
      observations: [observation({ observedAt: NOW - 400_000, remainingPct: 1 })],
    })
    expect(stale).toMatchObject({
      ok: false,
      intervention: 'hold-unverified-quota',
      status: 'QUOTA_OBSERVATION_STALE',
      selectedOption: null,
      checkpointRequired: true,
    })
    expect(stale.effects).toEqual([])
    expectPreserved(stale)

    const future = evaluate({
      observations: [observation({ observedAt: NOW + 10_000, remainingPct: 1 })],
    })
    expect(future.status).toBe('QUOTA_OBSERVATION_UNAVAILABLE')
    expect(future.currentSubscriptionPool.reason).toBe('configured-window-invalid-or-unverified')
    expect(future.selectedOption).toBeNull()

    const missingSecondWindow = evaluate({
      policy: enabledPolicy({ windows: ['weekly', 'five-hour'] }),
      observations: [observation({ window: 'weekly', remainingPct: 80 })],
    })
    expect(missingSecondWindow.status).toBe('QUOTA_OBSERVATION_UNAVAILABLE')
    expect(missingSecondWindow.currentSubscriptionPool.reason).toBe(
      'missing-observation-for-configured-window',
    )
    expect(missingSecondWindow.currentSubscriptionPool.missingWindows).toEqual(['five-hour'])
    expect(missingSecondWindow.selectedOption).toBeNull()

    const missing = evaluate({ observations: [] })
    expect(missing).toMatchObject({
      ok: false,
      intervention: 'hold-unverified-quota',
      status: 'QUOTA_OBSERVATION_UNAVAILABLE',
      selectedOption: null,
    })
    expect(missing.currentSubscriptionPool.reason).toBe('no-observation-for-active-subscription')
  })

  it('supports custom maxObservationAgeMs > 300000ms for fallback selection and normalizes Windows worktree paths', () => {
    const customAgeResult = evaluate({
      policy: enabledPolicy({
        windows: ['weekly', 'five-hour'],
        maxObservationAgeMs: 600_000,
      }),
      observations: [
        observation({
          subscription: 'gemini',
          window: 'weekly',
          observedAt: NOW - 400_000,
          remainingPct: 10,
        }),
        observation({
          subscription: 'gemini',
          window: 'five-hour',
          observedAt: NOW - 400_000,
          remainingPct: 10,
        }),
        observation({
          subscription: 'openai',
          window: 'weekly',
          observedAt: NOW - 400_000,
          remainingPct: 80,
        }),
        observation({
          subscription: 'openai',
          window: 'five-hour',
          observedAt: NOW - 400_000,
          remainingPct: 80,
        }),
      ],
      preserveState: {
        owner: 'dev.build',
        taskId: '535',
        worktree: 'C:\\repo\\.worktrees\\535-quota-checkpoints',
        oracleCustodyDigest: 'sha256:oracle-1',
        artifactDigests: { spec: 'sha256:spec-1' },
      },
    })
    expect(customAgeResult.status).toBe('QUOTA_FALLBACK_PROPOSED')
    expect(customAgeResult.selectedOption?.subscription).toBe('openai')
    expect(customAgeResult.preserved.worktree).toBe('C:/repo/.worktrees/535-quota-checkpoints')

    const steeringOnlyPolicy = resolveQuotaControlPolicy({
      steering: { quotaPolicy: { autoMonitoring: true, mode: 'park-and-checkpoint' } },
    })
    expect(steeringOnlyPolicy.enabled).toBe(false)
    expect(steeringOnlyPolicy.fallbackAction).toBe('park-only')
  })
})

describe('AC3: checkpoint, fallback, shared budget, and park guards', () => {
  const lowGemini = [
    observation({ window: 'weekly', remainingPct: 10 }),
    observation({ window: 'five-hour', remainingPct: 12 }),
  ]
  const healthyDistinct = [
    ...lowGemini,
    observation({ subscription: 'openai', window: 'weekly', remainingPct: 70 }),
    observation({ subscription: 'openai', window: 'five-hour', remainingPct: 65 }),
    observation({ subscription: 'grok', window: 'weekly', remainingPct: 90 }),
    observation({ subscription: 'grok', window: 'five-hour', remainingPct: 88 }),
  ]

  it('requires a safe checkpoint before proposing a fallback once remaining quota is below 25%', () => {
    const midPhase = evaluate({
      observations: healthyDistinct,
      atSafeCheckpoint: false,
    })
    expect(midPhase).toMatchObject({
      ok: false,
      enabled: true,
      intervention: 'reach-safe-checkpoint',
      status: 'QUOTA_THRESHOLD_REACH_CHECKPOINT',
      checkpointRequired: true,
      checkpointCadence: 'phase-boundary',
      selectedOption: null,
    })
    expect(midPhase.currentOption.subscription).toBe('gemini')
    expect(midPhase.effects).toEqual([])
    expect(midPhase.publicationAuthorityGranted).not.toBe(true)
    expect(midPhase.savedPolicyModified).not.toBe(true)
    expectPreserved(midPhase)

    const approximateCross = evaluate({
      observations: [
        observation({
          mode: 'approximate',
          source: 'cli-usage-probe',
          window: 'weekly',
          remainingPct: 24.9,
        }),
        observation({
          mode: 'approximate',
          source: 'cli-usage-probe',
          window: 'five-hour',
          remainingPct: 90,
        }),
        observation({ subscription: 'openai', window: 'weekly', remainingPct: 80 }),
        observation({ subscription: 'openai', window: 'five-hour', remainingPct: 80 }),
      ],
      atSafeCheckpoint: false,
    })
    expect(approximateCross.status).toBe('QUOTA_THRESHOLD_REACH_CHECKPOINT')
  })

  it('at a safe checkpoint proposes an eligible fallback on a distinct subscription without granting authority', () => {
    const before = JSON.stringify(defaultDistributionSelection())
    const result = evaluate({ observations: healthyDistinct, excludedFamilies: ['xai'] })
    expect(result).toMatchObject({
      ok: true,
      intervention: 'checkpoint-and-fallback',
      status: 'QUOTA_FALLBACK_PROPOSED',
      checkpointRequired: true,
      savedPolicyModified: false,
      publicationAuthorityGranted: false,
      fallbackIndex: 1,
    })
    expect(result.currentOption).toMatchObject({
      subscription: 'gemini',
      model: 'gemini-3.8-flash',
    })
    expect(result.selectedOption).toMatchObject({ subscription: 'openai', model: 'gpt-6.1-sol' })
    expect(result.selectedOption.subscription).not.toBe(result.currentOption.subscription)
    expect(result.targetSubscriptionPool.status).toBe('healthy')
    expect(result.effects).toEqual([])
    expectPreserved(result, ['xai'])
    expect(JSON.stringify(defaultDistributionSelection())).toBe(before)
  })

  it('does not treat another model on the exhausted shared subscription as independent quota', () => {
    const { selection, geminiSibling, openai } = sharedGeminiSelection()
    const onlySharedBudgetLooksSplit = evaluate({
      selection,
      observations: [
        observation({ window: 'weekly', remainingPct: 4, observedAt: NOW - 2_000 }),
        observation({ window: 'five-hour', remainingPct: 3 }),
        observation({
          window: 'weekly',
          remainingPct: 99,
          observedAt: NOW - 3_000,
          source: 'subscription-dashboard-snapshot',
        }),
      ],
    })
    expect(onlySharedBudgetLooksSplit).toMatchObject({
      ok: false,
      status: 'QUOTA_PARKED_NO_ELIGIBLE_FALLBACK',
      intervention: 'park-and-checkpoint',
      selectedOption: null,
      savedPolicyModified: false,
      publicationAuthorityGranted: false,
      reason: 'no-eligible-fallback-on-distinct-healthy-subscription',
    })
    expect(onlySharedBudgetLooksSplit.selectedOption?.model).not.toBe(geminiSibling.model)
    expectPreserved(onlySharedBudgetLooksSplit, [])

    const distinctBudget = evaluate({
      selection,
      observations: [
        observation({ window: 'weekly', remainingPct: 4 }),
        observation({ window: 'five-hour', remainingPct: 4 }),
        observation({ subscription: 'openai', window: 'weekly', remainingPct: 77 }),
        observation({ subscription: 'openai', window: 'five-hour', remainingPct: 77 }),
      ],
    })
    expect(distinctBudget.status).toBe('QUOTA_FALLBACK_PROPOSED')
    expect(distinctBudget.selectedOption).toMatchObject({
      subscription: openai.subscription,
      model: openai.model,
    })
    expect(distinctBudget.selectedOption.model).not.toBe(geminiSibling.model)
    expect(distinctBudget.fallbackIndex).toBe(2)
  })

  it('preserves four-eyes excluded families when choosing or refusing a reviewer fallback', () => {
    const result = evaluate({
      seat: 'rev.review',
      excludedFamilies: ['openai'],
      observations: [
        observation({ subscription: 'openai', window: 'weekly', remainingPct: 5 }),
        observation({ subscription: 'openai', window: 'five-hour', remainingPct: 5 }),
        observation({ subscription: 'claude', window: 'weekly', remainingPct: 80 }),
        observation({ subscription: 'claude', window: 'five-hour', remainingPct: 80 }),
        observation({ subscription: 'gemini', window: 'weekly', remainingPct: 80 }),
        observation({ subscription: 'gemini', window: 'five-hour', remainingPct: 80 }),
      ],
    })
    expect(result).toMatchObject({
      status: 'QUOTA_FALLBACK_PROPOSED',
      intervention: 'checkpoint-and-fallback',
      savedPolicyModified: false,
      publicationAuthorityGranted: false,
    })
    expect(result.currentOption.providerFamily).toBe('openai')
    expect(result.selectedOption).toMatchObject({
      subscription: 'claude',
      providerFamily: 'anthropic',
    })
    expectPreserved(result, ['openai'])

    const blocked = evaluate({
      observations: healthyDistinct,
      excludedFamilies: ['openai', 'xai'],
    })
    expect(blocked).toMatchObject({
      ok: false,
      status: 'QUOTA_PARKED_NO_ELIGIBLE_FALLBACK',
      intervention: 'park-and-checkpoint',
      selectedOption: null,
      savedPolicyModified: false,
      publicationAuthorityGranted: false,
    })
    expect(
      blocked.fallbackReasons.some((reason) => reason.reason === 'independence-boundary'),
    ).toBe(true)
    expectPreserved(blocked, ['openai', 'xai'])
  })

  it('parks without switching when policy is park-only, even if another subscription is healthy', () => {
    const result = evaluate({
      policy: enabledPolicy({ fallbackAction: 'park-only' }),
      observations: healthyDistinct,
    })
    expect(result).toMatchObject({
      ok: false,
      intervention: 'park-and-checkpoint',
      status: 'QUOTA_PARKED_AT_CHECKPOINT',
      reason: 'policy-configured-for-park-only',
      selectedOption: null,
      publicationAuthorityGranted: false,
    })
    expect(result.effects).toEqual([])
    expectPreserved(result)
    expect(result.obligation.action).toBe('wrap-up-update-records-and-park-until-reset-or-decision')
  })

  it('parks when no distinct subscription has an eligible healthy observation', () => {
    const result = evaluate({
      observations: [
        ...lowGemini,
        observation({
          subscription: 'openai',
          mode: 'unavailable',
          window: 'weekly',
          remainingPct: null,
        }),
        observation({
          subscription: 'openai',
          mode: 'unavailable',
          window: 'five-hour',
          remainingPct: null,
        }),
      ],
    })
    expect(result).toMatchObject({
      ok: false,
      intervention: 'park-and-checkpoint',
      status: 'QUOTA_PARKED_NO_ELIGIBLE_FALLBACK',
      reason: 'no-eligible-fallback-on-distinct-healthy-subscription',
      selectedOption: null,
      checkpointRequired: true,
      savedPolicyModified: false,
      publicationAuthorityGranted: false,
    })
    expect(result.effects).toEqual([])
    expectPreserved(result, [])
  })

  it('holds while a concurrent writer is still active', () => {
    const result = evaluate({
      observations: healthyDistinct,
      switchHistory: { switchCount: 0, lastSwitchAt: null, activeWriterRunning: true },
    })
    expect(result).toMatchObject({
      ok: false,
      intervention: 'park-and-checkpoint',
      status: 'QUOTA_CONCURRENT_WRITER_HOLD',
      reason: 'prior-writer-still-active-cannot-switch',
      selectedOption: null,
      publicationAuthorityGranted: false,
    })
    expect(result.effects).toEqual([])
    expect(result.obligation.action).toBe('fence-prior-writer-before-quota-fallback')
    expectPreserved(result)
  })

  it('holds during switch cooldown and parks after max switches per incident', () => {
    const cooldown = evaluate({
      observations: healthyDistinct,
      policy: enabledPolicy({ minSwitchCooldownMs: 300_000, maxSwitchesPerIncident: 2 }),
      switchHistory: { switchCount: 1, lastSwitchAt: NOW - 1_000, activeWriterRunning: false },
    })
    expect(cooldown).toMatchObject({
      ok: false,
      intervention: 'park-and-checkpoint',
      status: 'QUOTA_SWITCH_COOLDOWN_HOLD',
      reason: 'switch-cooldown-active-avoiding-retry-storm',
      selectedOption: null,
      publicationAuthorityGranted: false,
    })
    expect(cooldown.effects).toEqual([])
    expectPreserved(cooldown)

    const maxed = evaluate({
      observations: healthyDistinct,
      policy: enabledPolicy({ minSwitchCooldownMs: 300_000, maxSwitchesPerIncident: 2 }),
      switchHistory: { switchCount: 2, lastSwitchAt: NOW - 900_000, activeWriterRunning: false },
    })
    expect(maxed).toMatchObject({
      ok: false,
      intervention: 'park-and-checkpoint',
      status: 'QUOTA_MAX_SWITCHES_EXCEEDED_PARK',
      reason: 'max-switches-per-incident-exhausted',
      selectedOption: null,
      publicationAuthorityGranted: false,
    })
    expect(maxed.effects).toEqual([])
    expectPreserved(maxed)
  })

  it('continues with no effects while every configured window stays at or above the threshold', () => {
    const result = evaluate({
      observations: [
        observation({ window: 'weekly', remainingPct: 25 }),
        observation({ window: 'five-hour', mode: 'approximate', remainingPct: 40 }),
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      intervention: 'none',
      status: 'QUOTA_HEALTHY_CONTINUE',
      checkpointRequired: false,
      effects: [],
    })
    expect(result.selectedOption).toEqual(result.currentOption)
    expect(result.currentSubscriptionPool.windows['five-hour'].classification).toBe('approximate')
  })
})

describe('AC4: distribution quota CLI', () => {
  function runCli(args, cwd) {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env },
      timeout: 20000,
    })
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
  }

  function tempProject(workflow) {
    const dir = mkdtempSync(join(tmpdir(), 'quota-policy-cli-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'agent-workflow.config.json'), `${JSON.stringify(workflow, null, 2)}\n`)
    return dir
  }

  it('reports the default disabled policy and coverage disclosure as JSON', () => {
    const saved = { quotaControl: { enabled: false, windows: ['weekly'] } }
    const cwd = tempProject(saved)
    const configPath = join(cwd, 'agent-workflow.config.json')
    const before = readFileSync(configPath, 'utf8')
    const cli = runCli(['distribution', 'quota', '--json'], cwd)
    expect(cli.status).toBe(0)
    expect(cli.stderr).toBe('')
    const body = JSON.parse(cli.stdout)
    expect(body.ok).toBe(true)
    expect(body.effects).toEqual([])
    expect(body.policy.enabled).toBe(false)
    expect(body.coverageDisclosure).toEqual(QUOTA_COVERAGE_DISCLOSURE)
    const seats = Object.values(body.seats)
    expect(seats.length).toBeGreaterThan(1)
    for (const seat of seats) {
      expect(seat).toMatchObject({
        ok: true,
        enabled: false,
        intervention: 'none',
        status: 'QUOTA_CONTROL_DISABLED',
        checkpointRequired: false,
        effects: [],
      })
      expect(seat.coverageDisclosure).toEqual(QUOTA_COVERAGE_DISCLOSURE)
    }
    expect(body.seats['dev.build']).toBeDefined()
    expect(readFileSync(configPath, 'utf8')).toBe(before)
  })

  it('evaluates repeated weekly and five-hour windows for one seat without rewriting policy', () => {
    const saved = {
      executionDistribution: defaultDistributionSelection(),
      quotaControl: { enabled: false },
    }
    const cwd = tempProject(saved)
    const configPath = join(cwd, 'agent-workflow.config.json')
    const before = readFileSync(configPath, 'utf8')
    const now = Date.now()
    const observationsPath = join(cwd, 'quota-observations.json')
    writeFileSync(
      observationsPath,
      JSON.stringify([
        observation({ observedAt: now - 1_000, window: 'weekly', remainingPct: 80 }),
        observation({ observedAt: now - 1_000, window: 'five-hour', remainingPct: 9 }),
        observation({
          observedAt: now - 1_000,
          subscription: 'openai',
          window: 'weekly',
          remainingPct: 70,
        }),
        observation({
          observedAt: now - 1_000,
          subscription: 'openai',
          window: 'five-hour',
          remainingPct: 66,
        }),
      ]),
    )

    const cli = runCli(
      [
        'distribution',
        'quota',
        '--enable',
        '--window',
        'weekly',
        '--window',
        'five-hour',
        '--threshold',
        '25',
        '--observations',
        observationsPath,
        '--seat',
        'dev.build',
        '--json',
      ],
      cwd,
    )
    expect(cli.status).toBe(0)
    expect(cli.stderr).toBe('')
    const body = JSON.parse(cli.stdout)
    expect(body.ok).toBe(true)
    expect(body.effects).toEqual([])
    expect(body.policy).toMatchObject({
      enabled: true,
      windows: ['weekly', 'five-hour'],
      thresholdRemainingPct: 25,
      simultaneousWindowRule: 'most-restrictive',
    })
    expect(body.coverageDisclosure).toEqual(QUOTA_COVERAGE_DISCLOSURE)
    expect(Object.keys(body.seats)).toEqual(['dev.build'])
    expect(body.seats['dev.build']).toMatchObject({
      status: 'QUOTA_FALLBACK_PROPOSED',
      intervention: 'checkpoint-and-fallback',
      savedPolicyModified: false,
      publicationAuthorityGranted: false,
      effects: [],
    })
    expect(body.seats['dev.build'].selectedOption.subscription).toBe('openai')
    expect(body.seats['dev.build'].currentOption.subscription).toBe('gemini')
    expect(body.seats['dev.build'].coverageDisclosure).toEqual(QUOTA_COVERAGE_DISCLOSURE)
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(saved)
    expect(readFileSync(configPath, 'utf8')).toBe(before)
  })

  it('keeps a mid-phase enabled evaluation at the checkpoint on the CLI path', () => {
    const cwd = tempProject({ quotaControl: { enabled: true, windows: ['weekly', 'five-hour'] } })
    const now = Date.now()
    const observationsPath = join(cwd, 'quota-observations.json')
    writeFileSync(
      observationsPath,
      JSON.stringify([
        observation({ observedAt: now - 500, window: 'weekly', remainingPct: 1 }),
        observation({ observedAt: now - 500, window: 'five-hour', remainingPct: 1 }),
        observation({
          observedAt: now - 500,
          subscription: 'openai',
          window: 'weekly',
          remainingPct: 90,
        }),
        observation({
          observedAt: now - 500,
          subscription: 'openai',
          window: 'five-hour',
          remainingPct: 90,
        }),
      ]),
    )
    const cli = runCli(
      [
        'distribution',
        'quota',
        '--window',
        'weekly,five-hour',
        '--threshold',
        '25',
        '--observations',
        'quota-observations.json',
        '--seat',
        'dev.build',
        '--mid-phase',
        '--json',
      ],
      cwd,
    )
    expect(cli.status).toBe(0)
    const body = JSON.parse(cli.stdout)
    expect(body.policy.windows).toEqual(['weekly', 'five-hour'])
    expect(body.seats['dev.build']).toMatchObject({
      status: 'QUOTA_THRESHOLD_REACH_CHECKPOINT',
      intervention: 'reach-safe-checkpoint',
      checkpointRequired: true,
      selectedOption: null,
      effects: [],
    })
    expect(body.coverageDisclosure.parsesTranscriptOrContextTokensAsQuota).toBe(false)
  })
})
