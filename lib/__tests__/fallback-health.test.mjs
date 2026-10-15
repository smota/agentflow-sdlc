import { describe, expect, it } from 'vitest'
import {
  resolveTwoLevelFallback,
  resolveFourEyesReviewerTarget,
} from '../../adapters/openrig/platform-fallback.mjs'
import { validateFourEyesIndependence } from '../core/execution-receipt.mjs'
describe('unknown execution health and independence (#522)', () => {
  it('never selects a fallback with absent health evidence', () => {
    expect(resolveTwoLevelFallback({ seat: 'dev.build' }).ok).toBe(false)
  })
  it('never selects a reviewer with absent health evidence', () => {
    expect(
      resolveFourEyesReviewerTarget({
        builderReceipt: {
          actual: { model: 'gpt-6.1-sol' },
          metadata: { capabilityTier: 'balanced' },
        },
      }).ok,
    ).toBe(false)
  })
  it('does not treat differing unknown transport names as independent model families', () => {
    expect(
      validateFourEyesIndependence(
        { actual: { platform: 'gateway-a', model: 'opaque-a' } },
        { actual: { platform: 'gateway-b', model: 'opaque-b' } },
      ).ok,
    ).toBe(false)
  })
  it('uses explicit canonical family for namespaced Munito models', () => {
    const builder = {
      actual: { platform: 'pi', model: 'zai-org/glm-5.3-flash', providerFamily: 'zai' },
      metadata: { capabilityTier: 'balanced' },
    }
    const reviewer = {
      actual: { platform: 'pi', model: 'qwen/qwen3.8-27b', providerFamily: 'qwen' },
      metadata: { capabilityTier: 'deep-reasoning' },
    }
    expect(validateFourEyesIndependence(builder, reviewer)).toMatchObject({
      ok: true,
      builderFamily: 'zai',
      reviewerFamily: 'qwen',
    })
  })
  it('rejects explicit family spoofing against recognizable model family', () => {
    expect(
      validateFourEyesIndependence(
        { actual: { model: 'gpt-6.1-sol', providerFamily: 'anthropic' } },
        { actual: { model: 'gpt-6-astra', providerFamily: 'openai' } },
      ).ok,
    ).toBe(false)
  })
})
