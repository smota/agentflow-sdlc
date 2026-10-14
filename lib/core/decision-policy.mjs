// Deterministic decision policy and model escalation table.
//
// Pure rule table for autonomous decision governance, deriving model promotions,
// defect routing, and human escalations as pure functions of recorded transition
// and test evidence. Prevents prompt debates, confidence gaming, and unearned escalations.

import {
  DEFAULT_MAX_REWORK_ROUNDS,
  deriveReworkRound,
  DEFAULT_ROLE_COLLABORATION_POLICY,
  ACCEPT_AND_REGISTER_SURFACES,
} from './role-collaboration.mjs'

export const MODEL_TIERS = Object.freeze({
  LIGHTWEIGHT: 'lightweight',
  BALANCED: 'balanced',
  DEEP_REASONING: 'deep-reasoning',
  ARCHITECT_LEAD: 'architect-lead',
  FRONTIER: 'frontier',
})

export const FRONTIER_MODELS = Object.freeze({
  codex: 'gpt-6.1-sol',
  gemini: 'gemini-pro-high',
  openai: 'gpt-6.1-sol',
  google: 'gemini-pro-high',
  default: 'gpt-6.1-sol',
})

export const BUILDER_SEATS = Object.freeze(['dev.build', 'dev.build-jr', 'dev.build-sr'])

export const TEST_ENG_SEATS = Object.freeze(['dev.test-eng'])

export const ESCALATION_ACTIONS = Object.freeze({
  PASS: 'pass',
  CONTINUE_CURRENT_TIER: 'continue-current-tier',
  ESCALATE_FRONTIER: 'escalate-frontier',
  ROUTE_TEST_ENG: 'route-test-eng',
  ESCALATE_HUMAN: 'escalate-human',
})

export const HUMAN_ESCALATION_REASONS = Object.freeze({
  TIMEOUT: 'timeout',
  UNKNOWN_ERROR: 'unknown',
  SENSITIVE_PATH: 'sensitive-path',
  CIRCUIT_BREAKER: 'circuit-breaker',
  CAPABILITY_CEILING: 'capability-ceiling',
})

export const SENSITIVE_SURFACES = Object.freeze(
  [
    ...new Set([
      ...DEFAULT_ROLE_COLLABORATION_POLICY.sensitiveSurfaces,
      ...ACCEPT_AND_REGISTER_SURFACES,
      'governance',
    ]),
  ].sort(),
)

// Normalizes path segments (resolving '.' and '..', stripping leading './' and '/')
function normalizePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return ''
  const segments = rawPath.replace(/\\/g, '/').split('/')
  const resolved = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      resolved.pop()
    } else {
      resolved.push(segment)
    }
  }
  return resolved.join('/')
}

const SENSITIVE_DIR_SEGMENTS = new Set([...SENSITIVE_SURFACES, 'migrations'])

const GOVERNANCE_POLICY_FILES = new Set([
  'agents.md',
  'agy.md',
  'claude.md',
  'codex.md',
  'culture.md',
  'openrig.md',
  'docs/agent-workflow.md',
  'docs/guiding-principles.md',
  'docs/issue-standards.md',
  'scripts/audit-reachability.mjs',
  'scripts/validate-path-ownership.mjs',
])

export function isSensitivePath(rawPath) {
  const normalized = normalizePath(rawPath)
  if (!normalized) return false

  const lower = normalized.toLowerCase()
  if (lower.startsWith('.github/') || lower.startsWith('manifests/')) {
    return true
  }

  if (GOVERNANCE_POLICY_FILES.has(lower)) {
    return true
  }

  const segments = lower.split('/')
  // Check if any directory segment is sensitive
  for (let i = 0; i < segments.length - 1; i++) {
    if (SENSITIVE_DIR_SEGMENTS.has(segments[i])) {
      return true
    }
  }

  // Check file basename at any depth (e.g. lib/auth.mjs, infra.tf, data.json)
  const lastSegment = segments[segments.length - 1]
  const fileName = lastSegment.replace(/\.[^.]+$/, '')
  const basePrefix = lastSegment.split('.')[0]
  if (SENSITIVE_DIR_SEGMENTS.has(fileName) || SENSITIVE_DIR_SEGMENTS.has(basePrefix)) {
    return true
  }

  return false
}

function extractDistinctFailures(input) {
  if (!Array.isArray(input)) return []
  return [
    ...new Set(
      input
        .filter((item) => typeof item === 'string')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
}

const rules = [
  {
    id: 'timeout-escalation',
    description: 'Execution timeouts escalate directly to human',
    evaluate: (ctx) => {
      if (Boolean(ctx.timedOut) === true) {
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.TIMEOUT,
          targetRole: 'human',
          message: 'Execution timed out; requires human intervention',
        }
      }
      return null
    },
  },
  {
    id: 'unknown-error-escalation',
    description: 'Unclassified failures escalate directly to human',
    evaluate: (ctx) => {
      if (Boolean(ctx.unknownError) === true) {
        const detail =
          typeof ctx.unknownError === 'string' ? ctx.unknownError : 'Unclassified error'
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR,
          targetRole: 'human',
          message: `Unclassified failure encountered: ${detail}`,
        }
      }
      return null
    },
  },
  {
    id: 'missing-or-invalid-evidence',
    description:
      'Requires valid transition ledger and integer exit codes for core and oracle tests',
    evaluate: (ctx) => {
      if (!ctx.ledger || typeof ctx.ledger !== 'object' || Array.isArray(ctx.ledger)) {
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR,
          targetRole: 'human',
          message: 'Transition ledger is required to evaluate decision policy',
        }
      }
      if (!Number.isInteger(ctx.coreExitCode) || !Number.isInteger(ctx.oracleExitCode)) {
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR,
          targetRole: 'human',
          message: `Test exit codes must be valid integers (got coreExitCode: ${ctx.coreExitCode}, oracleExitCode: ${ctx.oracleExitCode})`,
        }
      }
      return null
    },
  },
  {
    id: 'contradictory-evidence',
    description: 'Exit code 0 contradictory with non-empty failures escalates to human',
    evaluate: (ctx) => {
      if (ctx.coreExitCode === 0 && ctx.coreFailuresCount > 0) {
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR,
          targetRole: 'human',
          message: 'Contradictory evidence: core tests reported exit code 0 but non-empty failures',
        }
      }
      if (ctx.oracleExitCode === 0 && ctx.oracleFailuresCount > 0) {
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR,
          targetRole: 'human',
          message:
            'Contradictory evidence: oracle tests reported exit code 0 but non-empty failures',
        }
      }
      return null
    },
  },
  {
    id: 'fenced-ledger',
    description: 'Fenced worktree on frozen ledger escalates to human',
    evaluate: (ctx) => {
      if (ctx.ledger?.frozen === true) {
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.CIRCUIT_BREAKER,
          targetRole: 'human',
          message: 'Fenced worktree: execution is frozen on ledger circuit breaker',
        }
      }
      return null
    },
  },
  {
    id: 'circuit-breaker-exhausted',
    description: 'Rework round exceeding circuit breaker threshold on failure escalates to human',
    evaluate: (ctx) => {
      const isFailure =
        ctx.coreExitCode !== 0 ||
        ctx.oracleExitCode !== 0 ||
        ctx.coreFailuresCount > 0 ||
        ctx.oracleFailuresCount > 0
      if (isFailure && ctx.effectiveRound > DEFAULT_MAX_REWORK_ROUNDS) {
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.CIRCUIT_BREAKER,
          targetRole: 'human',
          message: `Rework round ${ctx.effectiveRound} exceeds circuit breaker threshold of ${DEFAULT_MAX_REWORK_ROUNDS}`,
        }
      }
      return null
    },
  },
  {
    id: 'sensitive-surface-or-path',
    description: 'Modifications to sensitive surfaces or governance paths escalate to human',
    evaluate: (ctx) => {
      if (ctx.hasSensitivePath || ctx.hasSensitiveSurface) {
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.SENSITIVE_PATH,
          targetRole: 'human',
          message:
            'Sensitive paths or surfaces modified; requires human security and acceptance review',
        }
      }
      return null
    },
  },
  {
    id: 'oracle-defect-routing',
    description: 'When core tests exit 0, oracle failures route to dev.test-eng',
    evaluate: (ctx) => {
      if (
        ctx.coreExitCode === 0 &&
        ctx.coreFailuresCount === 0 &&
        (ctx.oracleExitCode !== 0 || ctx.oracleFailuresCount > 0)
      ) {
        return {
          action: ESCALATION_ACTIONS.ROUTE_TEST_ENG,
          targetSeat: 'dev.test-eng',
          reason: 'oracle-defect',
          message: 'Core tests exit 0; routing oracle defect to dev.test-eng',
          distinctOracleFailures: ctx.oracleFailuresList,
        }
      }
      return null
    },
  },
  {
    id: 'frontier-capability-exhausted',
    description: 'Builder failures while already at frontier tier escalate to human',
    evaluate: (ctx) => {
      if (
        ctx.isBuilder &&
        ctx.currentTier === MODEL_TIERS.FRONTIER &&
        (ctx.coreExitCode !== 0 || ctx.coreFailuresCount > 0)
      ) {
        return {
          action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
          reason: HUMAN_ESCALATION_REASONS.CAPABILITY_CEILING,
          targetRole: 'human',
          message:
            'Builder failed while running at frontier tier; capability ceiling reached with no higher tier',
          distinctCoreFailures: ctx.coreFailuresList,
        }
      }
      return null
    },
  },
  {
    id: 'builder-frontier-escalation',
    description: 'Builder with >= 2 distinct core test failures escalates to frontier tier',
    evaluate: (ctx) => {
      if (ctx.isBuilder && ctx.coreFailuresCount >= 2) {
        const selectedModel = Object.hasOwn(FRONTIER_MODELS, ctx.platform)
          ? FRONTIER_MODELS[ctx.platform]
          : FRONTIER_MODELS.default
        return {
          action: ESCALATION_ACTIONS.ESCALATE_FRONTIER,
          targetTier: MODEL_TIERS.FRONTIER,
          model: selectedModel,
          reason: 'capability-ceiling',
          message: `Builder encountered ${ctx.coreFailuresCount} distinct core test failures; escalating to frontier tier (${selectedModel})`,
          distinctCoreFailures: ctx.coreFailuresList,
        }
      }
      return null
    },
  },
  {
    id: 'builder-retry-within-tier',
    description: 'Builder with < 2 distinct core test failures retries within current tier',
    evaluate: (ctx) => {
      if (ctx.isBuilder && (ctx.coreExitCode !== 0 || ctx.coreFailuresCount === 1)) {
        return {
          action: ESCALATION_ACTIONS.CONTINUE_CURRENT_TIER,
          targetTier: ctx.currentTier,
          reason: 'retry-within-tier',
          message:
            'Core test failure count is below frontier escalation threshold (requires >= 2); continuing in current tier',
          distinctCoreFailures: ctx.coreFailuresList,
        }
      }
      return null
    },
  },
  {
    id: 'clean-pass',
    description: 'All tests exit 0 with 0 failures passes cleanly',
    evaluate: (ctx) => {
      if (
        ctx.coreExitCode === 0 &&
        ctx.oracleExitCode === 0 &&
        ctx.coreFailuresCount === 0 &&
        ctx.oracleFailuresCount === 0
      ) {
        return {
          action: ESCALATION_ACTIONS.PASS,
          targetTier: ctx.currentTier,
          reason: 'clean-pass',
          message: 'All verification checks passed cleanly',
        }
      }
      return null
    },
  },
  {
    id: 'fallback-retry',
    description: 'Non-builder verification failures retry within current tier',
    evaluate: (ctx) => {
      return {
        action: ESCALATION_ACTIONS.CONTINUE_CURRENT_TIER,
        targetTier: ctx.currentTier,
        reason: 'retry-within-tier',
        message: 'Verification failed for non-builder seat; continuing in current tier',
        distinctCoreFailures: ctx.coreFailuresList,
        distinctOracleFailures: ctx.oracleFailuresList,
      }
    },
  },
]

export const DECISION_RULES = Object.freeze(rules.map((rule) => Object.freeze(rule)))

export function evaluateDecisionPolicy(evidence = {}) {
  const {
    seat = null,
    currentTier = MODEL_TIERS.BALANCED,
    platform = 'codex',
    coreExitCode,
    distinctCoreFailures,
    oracleExitCode,
    distinctOracleFailures,
    timedOut = false,
    unknownError = false,
    pathsModified = [],
    sensitivePathsModified = false,
    changeSurface,
    ledger = null,
  } = evidence

  const coreFailuresList = extractDistinctFailures(distinctCoreFailures)
  const oracleFailuresList = extractDistinctFailures(distinctOracleFailures)

  const effectiveRound =
    ledger && typeof ledger === 'object' && !Array.isArray(ledger) ? deriveReworkRound(ledger) : 0

  const rawSurfaces = Array.isArray(changeSurface)
    ? changeSurface
    : typeof changeSurface === 'string' && changeSurface.trim()
      ? [changeSurface]
      : []

  const surfaces = rawSurfaces
    .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
    .filter(Boolean)

  const hasSensitiveSurface = surfaces.some((surface) => SENSITIVE_SURFACES.includes(surface))

  const hasSensitivePath =
    Boolean(sensitivePathsModified) === true ||
    (Array.isArray(pathsModified) && pathsModified.some(isSensitivePath))

  const ctx = {
    seat,
    currentTier,
    platform,
    coreExitCode,
    oracleExitCode,
    coreFailuresList,
    coreFailuresCount: coreFailuresList.length,
    oracleFailuresList,
    oracleFailuresCount: oracleFailuresList.length,
    timedOut,
    unknownError,
    hasSensitivePath,
    hasSensitiveSurface,
    ledger,
    effectiveRound,
    isBuilder: BUILDER_SEATS.includes(seat),
  }

  for (const rule of DECISION_RULES) {
    const outcome = rule.evaluate(ctx)
    if (outcome !== null) {
      return {
        ruleId: rule.id,
        ...outcome,
      }
    }
  }
}
