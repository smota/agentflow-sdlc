// Deterministic decision policy and model escalation table.
//
// Pure rule table for autonomous decision governance, deriving model promotions and
// defect routing as pure functions of recorded transition and test evidence.
// Prevents prompt debates, confidence gaming, and unearned frontier escalations.

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
})

export const SENSITIVE_SURFACES = Object.freeze([
  'security',
  'auth',
  'crypto',
  'migration',
  'billing',
  'governance',
])

const SENSITIVE_PATH_PATTERNS = Object.freeze([
  /^\.github\//,
  /^manifests\//,
  /^AGENTS\.md$/,
  /^auth\//,
  /^crypto\//,
  /^security\//,
  /^billing\//,
])

export function isSensitivePath(path) {
  if (typeof path !== 'string' || !path.trim()) return false
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
}

function normalizeFailures(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map((item) => String(item).trim()).filter(Boolean))]
  }
  if (typeof input === 'number' && Number.isInteger(input) && input > 0) {
    return Array.from({ length: input }, (_, i) => `failure-${i + 1}`)
  }
  return []
}

export function evaluateDecisionPolicy(evidence = {}) {
  const {
    seat = null,
    currentTier = MODEL_TIERS.BALANCED,
    platform = 'codex',
    coreExitCode = 0,
    distinctCoreFailures = [],
    oracleExitCode = 0,
    distinctOracleFailures = [],
    timedOut = false,
    unknownError = false,
    pathsModified = [],
    sensitivePathsModified = false,
    reworkRound = 0,
    maxReworkRounds = 2,
  } = evidence

  // 1. Human Escalation Guards (Highest Priority)
  if (timedOut === true) {
    return {
      action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
      reason: HUMAN_ESCALATION_REASONS.TIMEOUT,
      targetRole: 'human',
      message: 'Execution timed out; requires human intervention',
    }
  }

  if (Boolean(unknownError) === true) {
    const errorDetail = typeof unknownError === 'string' ? unknownError : 'Unknown error'
    return {
      action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
      reason: HUMAN_ESCALATION_REASONS.UNKNOWN_ERROR,
      targetRole: 'human',
      message: `Unclassified failure encountered: ${errorDetail}`,
    }
  }

  const hasSensitivePath =
    Boolean(sensitivePathsModified) === true ||
    (Array.isArray(pathsModified) && pathsModified.some(isSensitivePath))

  if (hasSensitivePath) {
    return {
      action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
      reason: HUMAN_ESCALATION_REASONS.SENSITIVE_PATH,
      targetRole: 'human',
      message: 'Sensitive paths modified; requires human security and acceptance review',
    }
  }

  if (Number.isInteger(reworkRound) && reworkRound > maxReworkRounds) {
    return {
      action: ESCALATION_ACTIONS.ESCALATE_HUMAN,
      reason: HUMAN_ESCALATION_REASONS.CIRCUIT_BREAKER,
      targetRole: 'human',
      message: `Rework round ${reworkRound} exceeds circuit breaker threshold of ${maxReworkRounds}`,
    }
  }

  const coreFailuresList = normalizeFailures(distinctCoreFailures)
  const coreFailuresCount = coreFailuresList.length || (coreExitCode !== 0 ? 1 : 0)

  const oracleFailuresList = normalizeFailures(distinctOracleFailures)
  const oracleFailuresCount = oracleFailuresList.length || (oracleExitCode !== 0 ? 1 : 0)

  // 2. Oracle Defect Routing (dev.test-eng)
  // When core implementation tests exit 0, but oracle tests fail, the defect belongs to the oracle.
  if (
    coreExitCode === 0 &&
    coreFailuresCount === 0 &&
    (oracleExitCode !== 0 || oracleFailuresCount > 0)
  ) {
    return {
      action: ESCALATION_ACTIONS.ROUTE_TEST_ENG,
      targetSeat: 'dev.test-eng',
      reason: 'oracle-defect',
      message: 'Core tests exit 0; routing oracle defect to dev.test-eng',
      distinctOracleFailures: oracleFailuresList,
    }
  }

  // 3. Builder Frontier Model Escalation
  // Escalates builder seat to frontier tier (Codex GPT-6.1 Sol / Gemini Pro High) ONLY upon >= 2 distinct core test failures.
  const isBuilder = BUILDER_SEATS.includes(seat)
  if (isBuilder) {
    if (coreFailuresCount >= 2) {
      const selectedModel = FRONTIER_MODELS[platform] ?? FRONTIER_MODELS.default
      return {
        action: ESCALATION_ACTIONS.ESCALATE_FRONTIER,
        targetTier: MODEL_TIERS.FRONTIER,
        model: selectedModel,
        reason: 'capability-ceiling',
        message: `Builder encountered ${coreFailuresCount} distinct core test failures; escalating to frontier tier (${selectedModel})`,
        distinctCoreFailures: coreFailuresList,
      }
    }

    if (coreExitCode !== 0 || coreFailuresCount === 1) {
      return {
        action: ESCALATION_ACTIONS.CONTINUE_CURRENT_TIER,
        targetTier: currentTier,
        reason: 'retry-within-tier',
        message:
          'Core test failure count is below frontier escalation threshold (requires >= 2); continuing in current tier',
        distinctCoreFailures: coreFailuresList,
      }
    }
  }

  // 4. Pass / Clean Execution
  if (
    coreExitCode === 0 &&
    oracleExitCode === 0 &&
    coreFailuresCount === 0 &&
    oracleFailuresCount === 0
  ) {
    return {
      action: ESCALATION_ACTIONS.PASS,
      targetTier: currentTier,
      reason: 'clean-pass',
      message: 'All verification checks passed cleanly',
    }
  }

  // 5. Default Non-Builder Failure
  return {
    action: ESCALATION_ACTIONS.CONTINUE_CURRENT_TIER,
    targetTier: currentTier,
    reason: 'retry-within-tier',
    message: 'Verification failed for non-builder seat; continuing in current tier',
    distinctCoreFailures: coreFailuresList,
    distinctOracleFailures: oracleFailuresList,
  }
}
