import { describe, expect, it } from 'vitest'
import {
  classifyBranch,
  DEFAULT_BRANCH_STRATEGY,
  resolveBranchStrategy,
  validateBranchStrategyConfig,
} from '../branch-strategy.mjs'

describe('branch strategy', () => {
  const trunkBasedConfig = {
    branching: {
      trunk: 'main',
      releaseCandidate: null,
      integration: 'main',
      directEditDeniedBranches: ['main'],
      defaultPrTarget: 'main',
      promotionOrder: ['main'],
    },
  }

  it('defaults to main -> staging -> development and denies direct development edits', () => {
    expect(validateBranchStrategyConfig({}).ok).toBe(true)
    const strategy = resolveBranchStrategy({})
    expect(strategy.trunk).toBe('main')
    expect(strategy.releaseCandidate).toBe('staging')
    expect(strategy.integration).toBe('development')
    expect(strategy.promotionOrder).toEqual(['development', 'staging', 'main'])

    const branch = classifyBranch('development', {})
    expect(branch.classification).toBe('protected')
    expect(branch.allowedForImplementation).toBe(false)
    expect(branch.directEditAllowed).toBe(false)
  })

  it('allows default work branch prefixes', () => {
    for (const prefix of DEFAULT_BRANCH_STRATEGY.workBranchPrefixes) {
      const branch = classifyBranch(`${prefix}customer-registry`, {})
      expect(branch.classification).toBe('work')
      expect(branch.allowedForImplementation).toBe(true)
    }
  })

  it('supports custom branch names and work prefixes', () => {
    const config = {
      branching: {
        trunk: 'production',
        releaseCandidate: 'preprod',
        integration: 'develop',
        directEditDeniedBranches: ['production', 'preprod', 'develop'],
        defaultPrTarget: 'develop',
        promotionOrder: ['develop', 'preprod', 'production'],
        workBranchPrefixes: ['task/'],
        requireBoundedWorkBranch: true,
      },
    }

    expect(validateBranchStrategyConfig(config).ok).toBe(true)
    expect(classifyBranch('develop', config).allowedForImplementation).toBe(false)
    expect(classifyBranch('task/customer-registry', config).allowedForImplementation).toBe(true)
    expect(classifyBranch('work/customer-registry', config).allowedForImplementation).toBe(false)
  })

  it('supports projects without a release-candidate branch', () => {
    const config = {
      branching: {
        trunk: 'main',
        releaseCandidate: null,
        integration: 'development',
        directEditDeniedBranches: ['main', 'development'],
        defaultPrTarget: 'development',
        promotionOrder: ['development', 'main'],
      },
    }

    const result = validateBranchStrategyConfig(config)
    expect(result.ok).toBe(true)
    expect(result.strategy.releaseCandidate).toBe(null)
    expect(result.strategy.promotionOrder).toEqual(['development', 'main'])
  })

  it('supports trunk-based projects with a shared trunk and integration branch', () => {
    const result = validateBranchStrategyConfig(trunkBasedConfig)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.strategy.releaseCandidate).toBe(null)
    expect(result.strategy.promotionOrder).toEqual(['main'])
    expect(classifyBranch('main', trunkBasedConfig).directEditAllowed).toBe(false)
    expect(classifyBranch('work/customer-registry', trunkBasedConfig).expectedPrTarget).toBe('main')
  })

  it('supports three-tier projects with a release-candidate branch', () => {
    const result = validateBranchStrategyConfig({
      branching: {
        trunk: 'main',
        releaseCandidate: 'rc/*',
        integration: 'development',
        directEditDeniedBranches: ['main', 'rc/*', 'development'],
        defaultPrTarget: 'development',
        promotionOrder: ['development', 'rc/*', 'main'],
      },
    })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it.each(['main', 'development'])(
    'rejects a duplicated release candidate %s',
    (releaseCandidate) => {
      const result = validateBranchStrategyConfig({
        branching: { trunk: 'main', releaseCandidate, integration: 'development' },
      })
      expect(result.ok).toBe(false)
      expect(result.errors.join('\n')).toContain('must be distinct')
    },
  )

  it('rejects a shared trunk and integration branch when a release candidate exists', () => {
    const result = validateBranchStrategyConfig({
      branching: { trunk: 'main', releaseCandidate: 'staging', integration: 'main' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('must be distinct')
  })

  it.each(['main', 'staging', 'development'])('rejects a missing promotion tier %s', (tier) => {
    const result = validateBranchStrategyConfig({
      branching: {
        promotionOrder: DEFAULT_BRANCH_STRATEGY.promotionOrder.filter((branch) => branch !== tier),
      },
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(`branching.promotionOrder must include protected tier ${tier}`)
  })

  it('requires the shared trunk-based tier in promotionOrder', () => {
    const result = validateBranchStrategyConfig({
      branching: { ...trunkBasedConfig.branching, promotionOrder: [] },
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('branching.promotionOrder must include protected tier main')
  })

  it('requires the trunk-based default PR target in promotionOrder', () => {
    const result = validateBranchStrategyConfig({
      branching: { ...trunkBasedConfig.branching, defaultPrTarget: 'development' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'branching.defaultPrTarget must appear in branching.promotionOrder',
    )
  })

  it('requires direct-edit protection for the shared trunk-based tier', () => {
    const result = validateBranchStrategyConfig({
      branching: { ...trunkBasedConfig.branching, directEditDeniedBranches: [] },
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'branching.directEditDeniedBranches must include protected tier main',
    )
  })

  it('fails closed when work branch prefixes are empty and required', () => {
    const result = validateBranchStrategyConfig({
      branching: {
        workBranchPrefixes: [],
        requireBoundedWorkBranch: true,
      },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('workBranchPrefixes must not be empty')
  })
})
