import { describe, expect, it } from 'vitest'
import {
  classifyBranch,
  DEFAULT_BRANCH_STRATEGY,
  resolveBranchStrategy,
  validateBranchStrategyConfig,
} from '../branch-strategy.mjs'

describe('branch strategy', () => {
  it('defaults to main -> staging -> development and denies direct development edits', () => {
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

  it('rejects duplicate protected tiers', () => {
    const result = validateBranchStrategyConfig({
      branching: { trunk: 'main', releaseCandidate: 'main', integration: 'development' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('must be distinct')
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
