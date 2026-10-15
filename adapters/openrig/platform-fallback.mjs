import {
  CAPABILITY_TIER_RANK,
  validateFourEyesIndependence,
} from '../../lib/core/execution-receipt.mjs'

export const DEFAULT_PLATFORM_CHAINS = Object.freeze({
  'pm.manager': Object.freeze([
    'pi:grok',
    'pi:antigravity',
    'codex:openai-codex',
    'claude-code:anthropic',
  ]),
  'pm.analyst': Object.freeze([
    'pi:grok',
    'pi:antigravity',
    'codex:openai-codex',
    'claude-code:anthropic',
  ]),
  'orch.arch': Object.freeze(['codex:openai-codex', 'claude-code:anthropic', 'pi:antigravity']),
  'dev.build-jr': Object.freeze([
    'pi:grok',
    'pi:antigravity',
    'codex:openai-codex',
    'claude-code:anthropic',
  ]),
  'dev.build': Object.freeze([
    'pi:antigravity',
    'pi:grok',
    'codex:openai-codex',
    'claude-code:anthropic',
  ]),
  'dev.build-sr': Object.freeze(['pi:antigravity', 'codex:openai-codex', 'claude-code:anthropic']),
  'dev.qa': Object.freeze([
    'pi:grok',
    'pi:antigravity',
    'codex:openai-codex',
    'claude-code:anthropic',
  ]),
  'rev.review': Object.freeze(['pi:antigravity', 'claude-code:anthropic', 'codex:openai-codex']),
})

export const DEFAULT_TIER_MODEL_MATRIX = Object.freeze({
  lightweight: Object.freeze({
    'pi:grok': Object.freeze({
      runtime: 'pi',
      providerFamily: 'xai',
      model: 'grok-cli/grok-4-fast',
      effort: 'low',
    }),
    'pi:antigravity': Object.freeze({
      runtime: 'pi',
      providerFamily: 'google',
      model: 'antigravity/gemini-3.8-flash',
      effort: 'low',
    }),
    'codex:openai-codex': Object.freeze({
      runtime: 'codex',
      providerFamily: 'openai',
      model: 'gpt-5.3-codex-spark',
      effort: 'low',
    }),
    'claude-code:anthropic': Object.freeze({
      runtime: 'claude-code',
      providerFamily: 'anthropic',
      model: 'claude-haiku-4-5',
      effort: 'low',
    }),
  }),
  balanced: Object.freeze({
    'pi:grok': Object.freeze({
      runtime: 'pi',
      providerFamily: 'xai',
      model: 'grok-cli/grok-code-fast-1',
      effort: 'medium',
    }),
    'pi:antigravity': Object.freeze({
      runtime: 'pi',
      providerFamily: 'google',
      model: 'antigravity/gemini-3.8-flash',
      effort: 'medium',
    }),
    'codex:openai-codex': Object.freeze({
      runtime: 'codex',
      providerFamily: 'openai',
      model: 'gpt-6-astra',
      effort: 'medium',
    }),
    'claude-code:anthropic': Object.freeze({
      runtime: 'claude-code',
      providerFamily: 'anthropic',
      model: 'claude-sonnet-4-6',
      effort: 'medium',
    }),
  }),
  'deep-reasoning': Object.freeze({
    'pi:grok': Object.freeze({
      runtime: 'pi',
      providerFamily: 'xai',
      model: 'grok-cli/grok-4.7',
      effort: 'high',
    }),
    'pi:antigravity': Object.freeze({
      runtime: 'pi',
      providerFamily: 'google',
      model: 'antigravity/gemini-3.1-pro',
      effort: 'high',
    }),
    'codex:openai-codex': Object.freeze({
      runtime: 'codex',
      providerFamily: 'openai',
      model: 'gpt-6.1-sol',
      effort: 'high',
    }),
    'claude-code:anthropic': Object.freeze({
      runtime: 'claude-code',
      providerFamily: 'anthropic',
      model: 'claude-opus-4-6',
      effort: 'high',
    }),
  }),
  'architect-lead': Object.freeze({
    'codex:openai-codex': Object.freeze({
      runtime: 'codex',
      providerFamily: 'openai',
      model: 'gpt-6.1-sol',
      effort: 'high',
    }),
    'claude-code:anthropic': Object.freeze({
      runtime: 'claude-code',
      providerFamily: 'anthropic',
      model: 'claude-opus-4-6',
      effort: 'high',
    }),
    'pi:antigravity': Object.freeze({
      runtime: 'pi',
      providerFamily: 'google',
      model: 'antigravity/gemini-3.1-pro',
      effort: 'high',
    }),
    'pi:grok': Object.freeze({
      runtime: 'pi',
      providerFamily: 'xai',
      model: 'grok-cli/grok-4.7',
      effort: 'high',
    }),
  }),
})

export const SEAT_DEFAULT_TIER = Object.freeze({
  'pm.manager': 'lightweight',
  'pm.analyst': 'balanced',
  'orch.arch': 'architect-lead',
  'dev.build-jr': 'lightweight',
  'dev.build': 'balanced',
  'dev.build-sr': 'architect-lead',
  'dev.qa': 'balanced',
  'rev.review': 'deep-reasoning',
})

export function resolveTwoLevelFallback({
  seat,
  capabilityTier = null,
  healthyPlatforms = null,
  atPhaseBoundary = true,
  currentPlatform = null,
  platformChains = DEFAULT_PLATFORM_CHAINS,
  tierMatrix = DEFAULT_TIER_MODEL_MATRIX,
} = {}) {
  if (
    !atPhaseBoundary &&
    currentPlatform &&
    healthyPlatforms &&
    !healthyPlatforms.includes(currentPlatform)
  ) {
    throw new Error(
      'MID_PHASE_PLATFORM_SWITCH_DENIED: platform fallback switches are only allowed at phase boundaries',
    )
  }

  const tier = capabilityTier ?? SEAT_DEFAULT_TIER[seat] ?? 'balanced'
  const chain = platformChains[seat] ?? ['codex:openai-codex', 'claude-code:anthropic']

  const candidateList = !atPhaseBoundary && currentPlatform ? [currentPlatform] : chain

  const tierEntry = tierMatrix?.[tier]
  if (!tierEntry) {
    return { ok: false, status: 'NO_HEALTHY_PLATFORM', seat, capabilityTier: tier }
  }

  const isHealthy = (p) =>
    healthyPlatforms === null || healthyPlatforms === undefined
      ? true
      : healthyPlatforms.includes(p)

  const selectedPlatform = candidateList.find(
    (platform) => isHealthy(platform) && Boolean(tierEntry[platform]),
  )

  if (!selectedPlatform) {
    return { ok: false, status: 'NO_HEALTHY_PLATFORM', seat, capabilityTier: tier }
  }

  const platformMeta = tierEntry[selectedPlatform]
  const fallbackIndex = chain.indexOf(selectedPlatform)

  return {
    ok: true,
    status: 'RESOLVED',
    seat,
    capabilityTier: tier,
    platform: selectedPlatform,
    ...platformMeta,
    fallbackIndex,
  }
}

export function resolveFourEyesReviewerTarget({
  builderReceipt,
  healthyPlatforms = null,
  reviewerTier = null,
  platformChains = DEFAULT_PLATFORM_CHAINS,
  tierMatrix = DEFAULT_TIER_MODEL_MATRIX,
} = {}) {
  const builderTier = builderReceipt?.metadata?.capabilityTier ?? 'balanced'
  const minRank = Math.max(
    CAPABILITY_TIER_RANK[builderTier] ?? 1,
    CAPABILITY_TIER_RANK[reviewerTier ?? 'deep-reasoning'] ?? 2,
  )
  const effectiveReviewerTier = minRank >= 3 ? 'architect-lead' : 'deep-reasoning'

  const chain = platformChains['rev.review'] ?? [
    'pi:antigravity',
    'claude-code:anthropic',
    'codex:openai-codex',
  ]

  const isHealthy = (p) =>
    healthyPlatforms === null || healthyPlatforms === undefined
      ? true
      : healthyPlatforms.includes(p)

  const candidatePlatforms = chain.filter((p) => isHealthy(p))

  const tierEntry = tierMatrix?.[effectiveReviewerTier]
  if (tierEntry) {
    for (const platform of candidatePlatforms) {
      const entry = tierEntry[platform]
      if (!entry) continue

      const reviewerReceipt = {
        actual: {
          platform: entry.providerFamily,
          model: entry.model,
        },
        metadata: {
          capabilityTier: effectiveReviewerTier,
        },
      }

      const fourEyes = validateFourEyesIndependence(builderReceipt, reviewerReceipt)
      if (fourEyes.ok) {
        return {
          ok: true,
          status: 'FOUR_EYES_RESOLVED',
          seat: 'rev.review',
          capabilityTier: effectiveReviewerTier,
          platform,
          ...entry,
          builderFamily: fourEyes.builderFamily,
          reviewerFamily: fourEyes.reviewerFamily,
        }
      }
    }
  }

  return {
    ok: false,
    status: 'FOUR_EYES_UNAVAILABLE',
    reason: 'No healthy independent provider family meets the builder tier floor',
  }
}
