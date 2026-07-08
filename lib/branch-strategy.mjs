import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const DEFAULT_BRANCH_STRATEGY = {
  trunk: 'main',
  releaseCandidate: 'staging',
  integration: 'development',
  directEditDeniedBranches: ['main', 'staging', 'development'],
  defaultPrTarget: 'development',
  promotionOrder: ['development', 'staging', 'main'],
  workBranchPrefixes: ['work/', 'feature/', 'fix/', 'hotfix/', 'spike/'],
  compatibilityBranchPrefixes: ['issue/', 'wt/', 'claude/'],
  requireBoundedWorkBranch: true,
}

const CONFIG_PATH = 'agent-workflow.config.json'
const SLUG_PATTERN = '[a-z][a-z0-9-]*'

export function loadProjectConfig(repoRoot = process.cwd(), configPath = CONFIG_PATH) {
  const fullPath = resolve(repoRoot, configPath)
  if (!existsSync(fullPath)) return {}
  return JSON.parse(readFileSync(fullPath, 'utf8'))
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeArray(value, fallback) {
  return Array.isArray(value) ? value : fallback
}

export function resolveBranchStrategy(config = {}) {
  const branching = isPlainObject(config.branching) ? config.branching : {}
  return {
    trunk: branching.trunk ?? DEFAULT_BRANCH_STRATEGY.trunk,
    releaseCandidate:
      branching.releaseCandidate === null
        ? null
        : (branching.releaseCandidate ?? DEFAULT_BRANCH_STRATEGY.releaseCandidate),
    integration: branching.integration ?? DEFAULT_BRANCH_STRATEGY.integration,
    directEditDeniedBranches: normalizeArray(
      branching.directEditDeniedBranches,
      DEFAULT_BRANCH_STRATEGY.directEditDeniedBranches,
    ),
    defaultPrTarget: branching.defaultPrTarget ?? DEFAULT_BRANCH_STRATEGY.defaultPrTarget,
    promotionOrder: normalizeArray(
      branching.promotionOrder,
      DEFAULT_BRANCH_STRATEGY.promotionOrder,
    ),
    workBranchPrefixes: normalizeArray(
      branching.workBranchPrefixes,
      DEFAULT_BRANCH_STRATEGY.workBranchPrefixes,
    ),
    compatibilityBranchPrefixes: normalizeArray(
      branching.compatibilityBranchPrefixes,
      DEFAULT_BRANCH_STRATEGY.compatibilityBranchPrefixes,
    ),
    requireBoundedWorkBranch:
      branching.requireBoundedWorkBranch ?? DEFAULT_BRANCH_STRATEGY.requireBoundedWorkBranch,
  }
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return
  }
  for (const item of value) {
    if (!nonEmptyString(item)) errors.push(`${path} entries must be non-empty strings`)
  }
  if (hasDuplicates(value)) errors.push(`${path} must not contain duplicates`)
}

export function validateBranchStrategyConfig(config = {}) {
  const errors = []
  const warnings = []
  const branching = config.branching

  if (branching !== undefined && !isPlainObject(branching)) {
    return { ok: false, errors: ['branching must be an object'], warnings }
  }

  if (isPlainObject(branching)) {
    for (const key of ['trunk', 'integration', 'defaultPrTarget']) {
      if (branching[key] !== undefined && !nonEmptyString(branching[key])) {
        errors.push(`branching.${key} must be a non-empty string`)
      }
    }
    if (
      branching.releaseCandidate !== undefined &&
      branching.releaseCandidate !== null &&
      !nonEmptyString(branching.releaseCandidate)
    ) {
      errors.push('branching.releaseCandidate must be a non-empty string or null')
    }
    for (const key of [
      'directEditDeniedBranches',
      'promotionOrder',
      'workBranchPrefixes',
      'compatibilityBranchPrefixes',
    ]) {
      if (branching[key] !== undefined)
        validateStringArray(branching[key], `branching.${key}`, errors)
    }
    if (
      branching.requireBoundedWorkBranch !== undefined &&
      typeof branching.requireBoundedWorkBranch !== 'boolean'
    ) {
      errors.push('branching.requireBoundedWorkBranch must be boolean')
    }
  } else {
    warnings.push('branching config missing; using default main -> staging -> development strategy')
  }

  const strategy = resolveBranchStrategy(config)
  const tiers = [strategy.trunk, strategy.releaseCandidate, strategy.integration].filter(Boolean)
  if (hasDuplicates(tiers)) {
    errors.push('branching trunk, releaseCandidate, and integration branches must be distinct')
  }
  if (!strategy.promotionOrder.includes(strategy.defaultPrTarget)) {
    errors.push('branching.defaultPrTarget must appear in branching.promotionOrder')
  }
  for (const tier of tiers) {
    if (!strategy.promotionOrder.includes(tier)) {
      errors.push(`branching.promotionOrder must include protected tier ${tier}`)
    }
    if (!strategy.directEditDeniedBranches.includes(tier)) {
      errors.push(`branching.directEditDeniedBranches must include protected tier ${tier}`)
    }
  }
  if (strategy.requireBoundedWorkBranch && strategy.workBranchPrefixes.length === 0) {
    errors.push(
      'branching.workBranchPrefixes must not be empty when requireBoundedWorkBranch is true',
    )
  }

  return { ok: errors.length === 0, errors, warnings, strategy }
}

function slugAfterPrefix(branch, prefix) {
  if (!branch.startsWith(prefix)) return null
  return branch.slice(prefix.length)
}

export function classifyBranch(branch, config = {}) {
  const strategy = resolveBranchStrategy(config)
  if (!branch) {
    return {
      branch,
      classification: 'detached',
      allowedForImplementation: true,
      directEditAllowed: true,
      expectedPrTarget: strategy.defaultPrTarget,
      requireBoundedWorkBranch: strategy.requireBoundedWorkBranch,
      reason: 'detached head or branch unavailable',
      strategy,
    }
  }

  if (strategy.directEditDeniedBranches.includes(branch)) {
    return {
      branch,
      classification: 'protected',
      allowedForImplementation: false,
      directEditAllowed: false,
      expectedPrTarget: strategy.defaultPrTarget,
      requireBoundedWorkBranch: strategy.requireBoundedWorkBranch,
      reason: `direct edits denied on ${branch}`,
      strategy,
    }
  }

  for (const prefix of strategy.workBranchPrefixes) {
    const slug = slugAfterPrefix(branch, prefix)
    if (slug !== null) {
      const slugOk = new RegExp(`^${SLUG_PATTERN}$`).test(slug)
      return {
        branch,
        classification: slugOk ? 'work' : 'invalid',
        allowedForImplementation: slugOk,
        directEditAllowed: slugOk,
        expectedPrTarget: strategy.defaultPrTarget,
        requireBoundedWorkBranch: strategy.requireBoundedWorkBranch,
        reason: slugOk
          ? `matches work branch prefix ${prefix}`
          : `invalid branch slug after ${prefix}`,
        strategy,
      }
    }
  }

  if (/^issue\/[0-9]+-[a-z][a-z0-9-]+$/.test(branch)) {
    return {
      branch,
      classification: 'compatibility',
      allowedForImplementation: true,
      directEditAllowed: true,
      expectedPrTarget: strategy.defaultPrTarget,
      requireBoundedWorkBranch: strategy.requireBoundedWorkBranch,
      reason: 'matches issue compatibility branch',
      strategy,
    }
  }

  for (const prefix of strategy.compatibilityBranchPrefixes.filter(
    (prefix) => prefix !== 'issue/',
  )) {
    if (branch.startsWith(prefix)) {
      return {
        branch,
        classification: 'compatibility',
        allowedForImplementation: true,
        directEditAllowed: true,
        expectedPrTarget: strategy.defaultPrTarget,
        requireBoundedWorkBranch: strategy.requireBoundedWorkBranch,
        reason: `matches compatibility branch prefix ${prefix}`,
        strategy,
      }
    }
  }

  return {
    branch,
    classification: 'invalid',
    allowedForImplementation: !strategy.requireBoundedWorkBranch,
    directEditAllowed: !strategy.requireBoundedWorkBranch,
    expectedPrTarget: strategy.defaultPrTarget,
    requireBoundedWorkBranch: strategy.requireBoundedWorkBranch,
    reason: strategy.requireBoundedWorkBranch
      ? 'does not match configured work or compatibility branch prefixes'
      : 'bounded work branch not required by config',
    strategy,
  }
}
