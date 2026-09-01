import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_RUNTIME_PLATFORM_REGISTRY,
  ROUTABLE_RUNTIME_PLATFORM_SLUGS,
  describeRuntimePlatform,
  isRegisteredRuntimePlatform,
  runtimePlatformSlugs,
  validateRuntimePlatformRegistry,
} from '../runtime-platforms.mjs'

describe('runtime platform registry', () => {
  it('registers current harnesses, agent runtimes, and human identity', () => {
    expect(runtimePlatformSlugs()).toEqual(
      expect.arrayContaining([
        'chatgpt',
        'cowork',
        'antigravity',
        'pi',
        'claude',
        'codex',
        'agy',
        'human',
      ]),
    )
  })

  it('keeps routable platforms distinct from all valid evidence identities', () => {
    expect(ROUTABLE_RUNTIME_PLATFORM_SLUGS).toEqual(['agy', 'claude', 'codex', 'pi'])
    expect(describeRuntimePlatform('cowork')).toMatchObject({ kind: 'harness', routable: false })
  })

  it('accepts a project-registered future runtime without validator changes', () => {
    const config = {
      platformRegistry: {
        additionalPlatforms: [
          {
            slug: 'future-runtime',
            displayName: 'Future Runtime',
            kind: 'harness',
            routable: false,
          },
        ],
      },
    }
    expect(isRegisteredRuntimePlatform('future-runtime', config)).toBe(true)
  })

  it('rejects unregistered platform slugs', () => {
    expect(isRegisteredRuntimePlatform('robot')).toBe(false)
  })

  it('rejects duplicate and malformed registry entries with actionable errors', () => {
    const registry = structuredClone(BUILT_IN_RUNTIME_PLATFORM_REGISTRY)
    registry.platforms.push({
      slug: 'pi',
      displayName: '',
      kind: 'unknown',
      routable: 'yes',
    })
    const result = validateRuntimePlatformRegistry(registry)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('duplicates registered platform: pi')
    expect(result.errors.join('\n')).toContain('displayName must be a non-empty string')
    expect(result.errors.join('\n')).toContain('kind must be agent-runtime, harness, or human')
    expect(result.errors.join('\n')).toContain('routable must be boolean')
  })
})
