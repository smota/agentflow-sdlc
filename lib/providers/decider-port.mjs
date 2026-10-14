// Decider provider port and Jev authentication adapter.
//
// Connects the external steering plane exclusively to the local non-causal decision model
// (d3-flash on port 8002) for sub-15ms heuristic triage (queue ordering, issue dedupe,
// nudge levels).
//
// Strict Invariants:
// 1. Plane Isolation: Connects strictly in the external supervisory steering plane.
//    In-rig execution seats are barred from invoking the decider port.
// 2. Strict Allowlist: Restricted to heuristic sorting (queue-ordering, issue-dedupe, nudge-level).
//    Strictly prohibited from gate sign-offs, scope modifications, or merge execution.
// 3. Payload Redaction: Redacts raw source code, patches, and secrets; transmits only
//    criterion IDs, exit codes, and diff statistics.
// 4. Deterministic Fallback: Every triage operation cleanly falls back to pure deterministic
//    heuristics when the decider service is offline, unresponsive, or unauthenticated.

export const DEFAULT_DECIDER_URL = 'http://127.0.0.1:8002/v1/decide'
export const DEFAULT_DECIDER_TIMEOUT_MS = 2000

export const ALLOWED_DECIDER_TASKS = Object.freeze([
  'queue-ordering',
  'issue-dedupe',
  'nudge-level',
])

export const PROHIBITED_DECIDER_ACTIONS = Object.freeze([
  'gate-signoff',
  'gate-advance',
  'phase-advance',
  'merge',
  'merge-execute',
  'scope-modify',
  'scope-modification',
  'waiver-grant',
  'person-waiver',
])

export const STEERING_PLANES = Object.freeze([
  'external-steering',
  'supervisory',
  'steerer',
  'steering',
])

export const IN_RIG_EXECUTION_SEATS = Object.freeze([
  'dev.build',
  'dev.build-jr',
  'dev.build-sr',
  'dev.test-eng',
  'dev.qa',
  'orch.pm',
  'pm.manager',
  'pm.analyst',
])

export const SENSITIVE_PAYLOAD_KEYS = Object.freeze([
  'sourcecode',
  'source_code',
  'code',
  'rawdiff',
  'diffcontent',
  'patch',
  'filecontent',
  'secret',
  'token',
  'password',
  'apikey',
  'privatekey',
  'credential',
])

// Builds Jev authentication and content headers
export function createJevAuthHeaders(token, customHeaders = {}) {
  const resolvedToken =
    token ??
    (typeof process !== 'undefined' && process.env
      ? process.env.JEV_AUTH_TOKEN || process.env.JEV_TOKEN
      : null)

  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders,
  }

  if (typeof resolvedToken === 'string' && resolvedToken.trim()) {
    const cleanToken = resolvedToken.trim()
    headers['X-Jev-Auth'] = cleanToken
    headers['Authorization'] = `Jev ${cleanToken}`
  }

  return headers
}

// Redacts code fences and raw multiline code blocks in strings
function redactCodeInString(text) {
  if (typeof text !== 'string') return text
  // Redact markdown code fences
  let sanitized = text.replace(/```[\s\S]*?```/g, '[REDACTED_CODE_BLOCK]')
  // Redact inline code blocks that look like raw code or credentials
  if (
    sanitized.length > 500 &&
    /(?:function\s+|class\s+|import\s+|export\s+|const\s+)/.test(sanitized)
  ) {
    sanitized = '[REDACTED_SOURCE_CODE]'
  }
  return sanitized
}

// Deeply sanitizes decider payloads to guarantee zero source code or credential egress
export function sanitizeDeciderPayload(input) {
  if (input === null || input === undefined) return input
  if (typeof input === 'string') return redactCodeInString(input)
  if (typeof input === 'number' || typeof input === 'boolean') return input

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeDeciderPayload(item))
  }

  if (typeof input === 'object') {
    const sanitized = {}
    for (const [key, value] of Object.entries(input)) {
      const lowerKey = key.toLowerCase()
      if (SENSITIVE_PAYLOAD_KEYS.includes(lowerKey)) {
        if (lowerKey.includes('diff') && typeof value === 'object' && value !== null) {
          // Preserve diff statistics if already aggregated
          sanitized.diffStats = {
            filesChanged: Number(value.filesChanged || value.changedFiles || 0),
            insertions: Number(value.insertions || 0),
            deletions: Number(value.deletions || 0),
          }
        } else if (lowerKey.includes('diff') || lowerKey.includes('patch')) {
          sanitized[key] = '[REDACTED_DIFF_STATISTICS_ONLY]'
        } else if (
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('key') ||
          lowerKey.includes('password') ||
          lowerKey.includes('credential')
        ) {
          sanitized[key] = '[REDACTED_SECRET]'
        } else {
          sanitized[key] = '[REDACTED_SOURCE_CODE]'
        }
      } else {
        sanitized[key] = sanitizeDeciderPayload(value)
      }
    }
    return sanitized
  }

  return String(input)
}

export function isDeciderTaskAllowed(task) {
  if (typeof task !== 'string') return false
  const normalized = task.trim().toLowerCase()
  if (PROHIBITED_DECIDER_ACTIONS.some((action) => normalized.includes(action))) {
    return false
  }
  return ALLOWED_DECIDER_TASKS.includes(normalized)
}

function ensureSteeringPlaneAndSeat(plane, seat) {
  if (plane && !STEERING_PLANES.includes(plane)) {
    throw new Error(
      `Decider port is restricted exclusively to external supervisory steering plane (got plane: "${plane}")`,
    )
  }
  if (seat && IN_RIG_EXECUTION_SEATS.includes(seat)) {
    throw new Error(
      `In-rig execution seats (${seat}) cannot connect to the decider port; steering plane only`,
    )
  }
}

function ensureAllowedTask(task) {
  if (typeof task !== 'string' || !task.trim()) {
    throw new Error('Decider task must be a non-empty string')
  }
  const normalized = task.trim().toLowerCase()
  if (PROHIBITED_DECIDER_ACTIONS.some((action) => normalized.includes(action))) {
    throw new Error(
      `Task "${task}" involves prohibited decision actions. Decider port cannot perform gate sign-offs, scope modifications, or merges`,
    )
  }
  if (!ALLOWED_DECIDER_TASKS.includes(normalized)) {
    throw new Error(
      `Task "${task}" is not permitted on decider port allowlist. Permitted tasks: ${ALLOWED_DECIDER_TASKS.join(', ')}`,
    )
  }
}

// Health probe for local decider service
export async function isDeciderAvailable(options = {}) {
  const endpoint =
    options.endpoint ||
    (typeof process !== 'undefined' && process.env?.DECIDER_ENDPOINT) ||
    DEFAULT_DECIDER_URL
  const healthUrl = endpoint.replace(/\/v1\/decide$/, '/health')
  const timeoutMs = options.timeoutMs ?? 500

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

// Core raw query to decider model with strict redaction and error boundaries
export async function queryDecider({
  task,
  plane = 'external-steering',
  seat = null,
  state,
  question,
  options = {},
} = {}) {
  ensureSteeringPlaneAndSeat(plane, seat)
  ensureAllowedTask(task)

  const sanitizedState = sanitizeDeciderPayload(state)
  const sanitizedQuestion = sanitizeDeciderPayload(question)

  const endpoint =
    options.endpoint ||
    (typeof process !== 'undefined' && process.env?.DECIDER_ENDPOINT) ||
    DEFAULT_DECIDER_URL
  const timeoutMs = options.timeoutMs ?? DEFAULT_DECIDER_TIMEOUT_MS
  const headers = createJevAuthHeaders(options.jevToken || options.token, options.headers)

  const body = JSON.stringify({
    model: options.model || 'd3-flash',
    state: sanitizedState,
    question: sanitizedQuestion,
  })

  const startTime = Date.now()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timer)
    const latencyMs = Date.now() - startTime

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      return {
        ok: false,
        source: 'fallback',
        status: response.status,
        error: `Decider HTTP ${response.status}: ${errorText || response.statusText}`,
        fallbackReason: 'http-error',
        latencyMs,
      }
    }

    const answer = await response.json()
    return {
      ok: true,
      source: 'decider',
      task,
      answer,
      latencyMs,
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime
    const isTimeout = err?.name === 'AbortError' || err?.code === 'ABORT_ERR'
    return {
      ok: false,
      source: 'fallback',
      error: err?.message || String(err),
      fallbackReason: isTimeout ? 'timeout' : 'network-error',
      latencyMs,
    }
  }
}

// Triage 1: Queue ordering
// Ranks queued tasks based on failure counts, rework rounds, and decider scoring,
// with clean deterministic fallback.
export async function triageQueueOrdering({
  tasks = [],
  plane = 'external-steering',
  seat = null,
  options = {},
} = {}) {
  ensureSteeringPlaneAndSeat(plane, seat)

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return {
      ok: true,
      source: 'deterministic',
      orderedTasks: [],
      selectedTaskId: null,
    }
  }

  if (tasks.length === 1) {
    return {
      ok: true,
      source: 'deterministic',
      orderedTasks: [...tasks],
      selectedTaskId: tasks[0].id ?? null,
    }
  }

  // Deterministic baseline ranking function
  const deterministicSort = (items) => {
    return [...items].sort((a, b) => {
      // 1. Unblocked tasks before blocked tasks
      if (Boolean(a.blocked) !== Boolean(b.blocked)) {
        return a.blocked ? 1 : -1
      }
      // 2. Higher rework round / circuit breaker proximity first
      const roundA = Number(a.reworkRound || 0)
      const roundB = Number(b.reworkRound || 0)
      if (roundA !== roundB) return roundB - roundA

      // 3. Higher distinct failure count first
      const failuresA = Array.isArray(a.failures) ? a.failures.length : Number(a.failureCount || 0)
      const failuresB = Array.isArray(b.failures) ? b.failures.length : Number(b.failureCount || 0)
      if (failuresA !== failuresB) return failuresB - failuresA

      // 4. Lower priority number (1 > 2)
      const priorityA = Number(a.priority ?? 999)
      const priorityB = Number(b.priority ?? 999)
      if (priorityA !== priorityB) return priorityA - priorityB

      // 5. FIFO
      return (a.createdAt || 0) - (b.createdAt || 0)
    })
  }

  const sanitizedTasks = tasks.map((t) => ({
    id: String(t.id || ''),
    criterionId: t.criterionId ? String(t.criterionId) : undefined,
    reworkRound: Number(t.reworkRound || 0),
    failuresCount: Array.isArray(t.failures) ? t.failures.length : Number(t.failureCount || 0),
    blocked: Boolean(t.blocked),
    diffStats: t.diffStats
      ? {
          insertions: Number(t.diffStats.insertions || 0),
          deletions: Number(t.diffStats.deletions || 0),
        }
      : undefined,
  }))

  const criteria = {}
  sanitizedTasks.forEach((t) => {
    criteria[t.id] =
      `Task ${t.id} (round: ${t.reworkRound}, failures: ${t.failuresCount}, blocked: ${t.blocked})`
  })

  const deciderRes = await queryDecider({
    task: 'queue-ordering',
    plane,
    seat,
    state: { queueCount: sanitizedTasks.length, items: sanitizedTasks },
    question: {
      type: 'choice',
      instructions: 'Select the task that requires highest immediate steering priority.',
      criteria,
    },
    options,
  })

  if (
    deciderRes.ok &&
    deciderRes.answer?.choice &&
    Object.hasOwn(criteria, deciderRes.answer.choice)
  ) {
    const chosenId = deciderRes.answer.choice
    const chosenItem = tasks.find((t) => String(t.id) === chosenId)
    const remaining = tasks.filter((t) => String(t.id) !== chosenId)
    return {
      ok: true,
      source: 'decider',
      orderedTasks: chosenItem
        ? [chosenItem, ...deterministicSort(remaining)]
        : deterministicSort(tasks),
      selectedTaskId: chosenId,
      confidence: deciderRes.answer.confidence,
      probabilities: deciderRes.answer.probabilities,
      latencyMs: deciderRes.latencyMs,
    }
  }

  // Fallback
  const ordered = deterministicSort(tasks)
  return {
    ok: true,
    source: 'fallback',
    orderedTasks: ordered,
    selectedTaskId: ordered[0]?.id ?? null,
    fallbackReason: deciderRes.fallbackReason || 'decider-unavailable',
  }
}

// Triage 2: Issue deduplication
// Determines if a newly observed finding matches an existing open issue.
export async function triageIssueDedupe({
  candidate,
  existingIssues = [],
  plane = 'external-steering',
  seat = null,
  options = {},
} = {}) {
  ensureSteeringPlaneAndSeat(plane, seat)

  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Candidate issue object is required for deduplication triage')
  }

  const sanitizedCandidate = {
    title: sanitizeDeciderPayload(candidate.title || ''),
    criterionId: candidate.criterionId ? String(candidate.criterionId) : undefined,
    errorCategory: candidate.errorCategory ? String(candidate.errorCategory) : undefined,
    exitCode: Number.isInteger(candidate.exitCode) ? candidate.exitCode : undefined,
  }

  const sanitizedList = (Array.isArray(existingIssues) ? existingIssues : []).map((issue) => ({
    id: String(issue.id || issue.number || ''),
    title: sanitizeDeciderPayload(issue.title || ''),
    criterionId: issue.criterionId ? String(issue.criterionId) : undefined,
    errorCategory: issue.errorCategory ? String(issue.errorCategory) : undefined,
    exitCode: Number.isInteger(issue.exitCode) ? issue.exitCode : undefined,
  }))

  // Deterministic fallback matching
  const deterministicMatch = () => {
    const candTitle = String(sanitizedCandidate.title || '')
      .trim()
      .toLowerCase()
    const candCriterion = sanitizedCandidate.criterionId
    const candCategory = sanitizedCandidate.errorCategory

    for (const issue of sanitizedList) {
      const issueTitle = String(issue.title || '')
        .trim()
        .toLowerCase()
      // Exact criterion + errorCategory match
      if (candCriterion && issue.criterionId && candCriterion === issue.criterionId) {
        if (!candCategory || candCategory === issue.errorCategory) {
          return issue.id
        }
      }
      // Exact title match
      if (candTitle && issueTitle && candTitle === issueTitle) {
        return issue.id
      }
    }
    return null
  }

  if (sanitizedList.length === 0) {
    return {
      ok: true,
      source: 'deterministic',
      isDuplicate: false,
      duplicateOf: null,
    }
  }

  const criteria = {
    none: 'Candidate is a new, distinct defect observation',
  }
  sanitizedList.slice(0, 50).forEach((issue) => {
    criteria[issue.id] =
      `Duplicate of #${issue.id}: ${issue.title} (criterion: ${issue.criterionId || 'none'})`
  })

  const deciderRes = await queryDecider({
    task: 'issue-dedupe',
    plane,
    seat,
    state: { candidate: sanitizedCandidate, candidatesCount: sanitizedList.length },
    question: {
      type: 'choice',
      instructions:
        'Determine whether candidate issue is a duplicate of any existing issue or a distinct defect.',
      criteria,
    },
    options,
  })

  if (deciderRes.ok && deciderRes.answer?.choice) {
    const choice = deciderRes.answer.choice
    const isDuplicate = choice !== 'none' && Object.hasOwn(criteria, choice)
    return {
      ok: true,
      source: 'decider',
      isDuplicate,
      duplicateOf: isDuplicate ? choice : null,
      confidence: deciderRes.answer.confidence,
      probabilities: deciderRes.answer.probabilities,
      latencyMs: deciderRes.latencyMs,
    }
  }

  // Fallback
  const matchedId = deterministicMatch()
  return {
    ok: true,
    source: 'fallback',
    isDuplicate: matchedId !== null,
    duplicateOf: matchedId,
    fallbackReason: deciderRes.fallbackReason || 'decider-unavailable',
  }
}

// Triage 3: Nudge level selection
// Selects appropriate nudge level ("gentle" | "standard" | "interrupt") based on
// idle duration, current rework round, and decider advice.
export async function triageNudgeLevel({
  seatTarget,
  idleSeconds = 0,
  reworkRound = 0,
  lastState = 'idle',
  plane = 'external-steering',
  seat = null,
  options = {},
} = {}) {
  ensureSteeringPlaneAndSeat(plane, seat)

  const idleSec = Math.max(0, Number(idleSeconds) || 0)
  const round = Math.max(0, Number(reworkRound) || 0)

  // Pure deterministic baseline
  const deterministicLevel = () => {
    if (round >= 2 || idleSec >= 300) return 'interrupt'
    if (idleSec >= 120) return 'standard'
    return 'gentle'
  }

  const deciderRes = await queryDecider({
    task: 'nudge-level',
    plane,
    seat,
    state: {
      seatTarget: String(seatTarget || 'unknown'),
      idleSeconds: idleSec,
      reworkRound: round,
      lastState: String(lastState || 'idle'),
    },
    question: {
      type: 'choice',
      instructions: 'Select the appropriate nudge level for this squad seat.',
      criteria: {
        gentle: 'Informational status wake or reminder',
        standard: 'Expected transition or handoff overdue notice',
        interrupt: 'Cancel hung turn or recover stuck execution',
      },
    },
    options,
  })

  const validLevels = ['gentle', 'standard', 'interrupt']
  if (
    deciderRes.ok &&
    deciderRes.answer?.choice &&
    validLevels.includes(deciderRes.answer.choice)
  ) {
    return {
      ok: true,
      source: 'decider',
      level: deciderRes.answer.choice,
      confidence: deciderRes.answer.confidence,
      probabilities: deciderRes.answer.probabilities,
      latencyMs: deciderRes.latencyMs,
    }
  }

  return {
    ok: true,
    source: 'fallback',
    level: deterministicLevel(),
    fallbackReason: deciderRes.fallbackReason || 'decider-unavailable',
  }
}
