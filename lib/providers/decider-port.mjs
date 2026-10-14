// Decider provider port and Jev authentication adapter.
//
// Connects the external steering plane exclusively to the local non-causal decision model
// (d3-flash on port 8002) for sub-15ms heuristic triage (queue ordering, issue dedupe,
// nudge levels).
//
// Strict Invariants:
// 1. Plane Isolation: Connects strictly in the external supervisory steering plane.
//    In-rig execution seats are barred from invoking the decider port. Fails closed
//    when seat or plane is missing or unverified.
// 2. Strict Allowlist: Restricted to heuristic sorting (queue-ordering, issue-dedupe, nudge-level).
//    Strictly prohibited from gate sign-offs, scope modifications, or merge execution.
// 3. Payload Redaction: Redacts raw source code, patches, diffs, and credentials; transmits
//    only criterion IDs, exit codes, and diff statistics.
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

export const STEERING_SEATS = Object.freeze([
  'steer',
  'steerer',
  'supervisor',
  'steer.po',
  'orch.steer',
  'antigravity',
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

const SENSITIVE_KEY_PATTERN =
  /diff|patch|token|secret|key|passw|cred|auth|source.*code|stdout|stderr|snippet|rawlines|file.*content/i

// Validates endpoint: loopback required for all protocols to prevent credential egress (contract: local decider only)
export function validateEndpoint(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr.trim()) {
    throw new Error('Decider endpoint URL is required')
  }
  let url
  try {
    url = new URL(urlStr)
  } catch {
    throw new Error(`Invalid decider endpoint URL: ${urlStr}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol for decider endpoint: ${url.protocol}`)
  }
  const hostname = url.hostname.toLowerCase()
  const isLoopback =
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]'
  if (!isLoopback) {
    throw new Error(
      `Decider endpoint must be a loopback address (127.0.0.1, localhost, or ::1); got "${hostname}". Non-loopback endpoints are prohibited by decider port contract to prevent credential egress.`,
    )
  }
  return urlStr
}

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

// Redacts code fences, raw multiline code blocks, diff hunks, and secret patterns in strings
function redactStringValue(text) {
  if (typeof text !== 'string') return text
  let sanitized = text
  // 1. Redact secrets: PEM private keys, URL credentials, passwords/tokens, JWT, AWS AKIA, Google AIza, Slack tokens, sk- keys, Bearer
  sanitized = sanitized
    .replace(
      /-----BEGIN [A-Z0-9 ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+PRIVATE KEY-----/gi,
      '[REDACTED_SECRET]',
    )
    .replace(/\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^:\s/]+:[^@\s/]+@/g, '$1[REDACTED_SECRET]@')
    .replace(
      /\b(?:password|passwd|pwd|secret|auth_token)\s*[:=]\s*['"]?[^\s'";]+['"]?/gi,
      '[REDACTED_SECRET]',
    )
    .replace(/\bAIza[0-9A-Za-z-_]{35}\b/g, '[REDACTED_SECRET]')
    .replace(
      /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
      '[REDACTED_SECRET]',
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_SECRET]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{10,}\b/g, '[REDACTED_SECRET]')
    .replace(/\bxox[baprs]-(?:[a-zA-Z0-9]+-)+[a-zA-Z0-9]+\b/g, '[REDACTED_SECRET]')
    .replace(/\bxoxe[.-][a-zA-Z0-9-]+\b/g, '[REDACTED_SECRET]')
    .replace(/\bsk-[a-zA-Z0-9_-]{16,}\b/g, '[REDACTED_SECRET]')
    .replace(/\bBearer\s+[a-zA-Z0-9._~+/-]{8,}=*\b/g, '[REDACTED_SECRET]')

  // 2. Redact diff / patch content (unified diff headers, hunks, or multiple +/- lines)
  if (
    /diff --git|index [0-9a-f]{7,}\.\.[0-9a-f]{7,}|(?:^|\n)(?:--- [ab]\/|\+\+\+ [ab]\/)|@@\s*-\d+(?:,\d+)?\s*\+\d+(?:,\d+)?\s*@@|(?:^[+-].*\n){2,}/m.test(
      sanitized,
    )
  ) {
    return '[REDACTED_DIFF_CONTENT]'
  }
  // 3. Redact markdown code fences
  sanitized = sanitized.replace(/```[\s\S]*?```/g, '[REDACTED_CODE_BLOCK]')

  // 4. Redact raw code snippets (JS/TS, Python, C/C++, Shell, Go, Rust)
  // Bounded to avoid false positives on natural language titles like "package manager fails" or "import data from CSV"
  if (
    /(?:function\s*\(|function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|export\s+(?:default|const|function|class)|import\s+.*from\s+['"][^'"]+['"]|=>\s*\{|\bdef\s+\w+\s*\(|\bclass\s+\w+[\s:(]|for\s+.*\sin\s+.*:|\bimport\s+[a-zA-Z0-9_.]+\s+as\s+\w+|\bfrom\s+[a-zA-Z0-9_.]+\s+import|#include\s+[<"]|int\s+main\s*\(|^#!\s*\/(?:bin|usr)|\bpackage\s+[a-zA-Z0-9_]+;\s*$|\bfunc\s+\w+\(|\bfn\s+\w+\()/m.test(
      sanitized,
    )
  ) {
    return '[REDACTED_SOURCE_CODE]'
  }
  return sanitized
}

// Deeply sanitizes decider payloads to guarantee zero source code or credential egress
export function sanitizeDeciderPayload(input) {
  if (input === null || input === undefined) return input
  if (typeof input === 'string') return redactStringValue(input)
  if (typeof input === 'number' || typeof input === 'boolean') return input

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeDeciderPayload(item))
  }

  if (typeof input === 'object') {
    const sanitized = {}
    for (const [key, value] of Object.entries(input)) {
      const lowerKey = key.toLowerCase()

      // B3 & N4: If key is 'code', allow numeric exit codes; strictly redact non-numeric source code
      if (lowerKey === 'code') {
        if (typeof value === 'number' && Number.isFinite(value)) {
          sanitized[key] = value
        } else {
          sanitized[key] = '[REDACTED_CODE]'
        }
        continue
      }

      if (SENSITIVE_KEY_PATTERN.test(lowerKey)) {
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
          lowerKey.includes('passw') ||
          lowerKey.includes('cred') ||
          lowerKey.includes('auth')
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
  if (typeof plane !== 'string' || !plane.trim()) {
    throw new Error(
      'Plane is required. Decider port is restricted exclusively to external supervisory steering plane',
    )
  }
  const normalizedPlane = plane.trim().toLowerCase()
  if (!STEERING_PLANES.includes(normalizedPlane)) {
    throw new Error(
      `Decider port is restricted exclusively to external supervisory steering plane (got plane: "${plane}")`,
    )
  }

  if (typeof seat !== 'string' || !seat.trim()) {
    throw new Error('Seat is required. Decider port requires an authorized external steering seat')
  }
  const normalizedSeat = seat.trim().toLowerCase()
  if (IN_RIG_EXECUTION_SEATS.includes(normalizedSeat)) {
    throw new Error(
      `In-rig execution seats (${seat}) cannot connect to the decider port; steering plane only`,
    )
  }
  if (!STEERING_SEATS.includes(normalizedSeat)) {
    throw new Error(
      `Seat "${seat}" is not an authorized external steering seat. Authorized seats: ${STEERING_SEATS.join(', ')}`,
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
  let endpoint
  try {
    endpoint = validateEndpoint(
      options.endpoint ||
        (typeof process !== 'undefined' && process.env?.DECIDER_ENDPOINT) ||
        DEFAULT_DECIDER_URL,
    )
  } catch {
    return false
  }

  const healthUrl = endpoint.replace(/\/v1\/decide$/, '/health')
  const timeoutMs = options.timeoutMs ?? 500

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'error',
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

// Core raw query to decider model with strict redaction and error boundaries
export async function queryDecider({ task, plane, seat, state, question, options = {} } = {}) {
  ensureSteeringPlaneAndSeat(plane, seat)
  ensureAllowedTask(task)

  const sanitizedState = sanitizeDeciderPayload(state)
  const sanitizedQuestion = sanitizeDeciderPayload(question)

  let endpointUrl
  try {
    endpointUrl = validateEndpoint(
      options.endpoint ||
        (typeof process !== 'undefined' && process.env?.DECIDER_ENDPOINT) ||
        DEFAULT_DECIDER_URL,
    )
  } catch (err) {
    return {
      ok: false,
      source: 'fallback',
      error: err.message,
      fallbackReason: 'invalid-endpoint',
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_DECIDER_TIMEOUT_MS
  const headers = createJevAuthHeaders(options.jevToken || options.token, options.headers)

  const body = JSON.stringify({
    model: options.model || 'd3-flash',
    state: sanitizedState,
    question: sanitizedQuestion,
  })

  const startTime = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
      redirect: 'error',
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      return {
        ok: false,
        source: 'fallback',
        status: response.status,
        error: `Decider HTTP ${response.status}: ${errorText || response.statusText}`,
        fallbackReason: 'http-error',
        latencyMs: Date.now() - startTime,
      }
    }

    const answer = await response.json()
    return {
      ok: true,
      source: 'decider',
      task,
      answer,
      latencyMs: Date.now() - startTime,
    }
  } catch (err) {
    const isTimeout =
      err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.name === 'TimeoutError'
    return {
      ok: false,
      source: 'fallback',
      error: err?.message || String(err),
      fallbackReason: isTimeout ? 'timeout' : 'network-error',
      latencyMs: Date.now() - startTime,
    }
  } finally {
    clearTimeout(timer)
  }
}

// Parse timestamp robustly across numbers and ISO strings
function parseTime(val) {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const parsed = Date.parse(val)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

// Triage 1: Queue ordering
// Ranks queued tasks based on failure counts, rework rounds, and decider scoring,
// with clean deterministic fallback.
export async function triageQueueOrdering({ tasks = [], plane, seat, options = {} } = {}) {
  ensureSteeringPlaneAndSeat(plane, seat)

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return {
      ok: true,
      source: 'deterministic',
      orderedTasks: [],
      selectedTaskId: null,
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
      return parseTime(a.createdAt) - parseTime(b.createdAt)
    })
  }

  if (tasks.length === 1) {
    return {
      ok: true,
      source: 'deterministic',
      orderedTasks: [...tasks],
      selectedTaskId: tasks[0].id ?? null,
    }
  }

  const sanitizedTasks = tasks.map((t) => ({
    id: String(t.id ?? ''),
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

  const rawChoice = deciderRes.answer?.choice
  const chosenId = rawChoice !== null && rawChoice !== undefined ? String(rawChoice).trim() : null

  if (deciderRes.ok && chosenId && Object.hasOwn(criteria, chosenId)) {
    const chosenIndex = tasks.findIndex((t) => String(t.id) === chosenId)
    if (chosenIndex !== -1) {
      const chosenItem = tasks[chosenIndex]
      const remaining = [...tasks.slice(0, chosenIndex), ...tasks.slice(chosenIndex + 1)]
      return {
        ok: true,
        source: 'decider',
        orderedTasks: [chosenItem, ...deterministicSort(remaining)],
        selectedTaskId: chosenId,
        confidence: deciderRes.answer.confidence,
        probabilities: deciderRes.answer.probabilities,
        latencyMs: deciderRes.latencyMs,
      }
    }
  }

  // Fallback
  const ordered = deterministicSort(tasks)
  return {
    ok: true,
    source: 'fallback',
    orderedTasks: ordered,
    selectedTaskId: ordered[0]?.id ?? null,
    fallbackReason: deciderRes.ok
      ? 'invalid-choice'
      : deciderRes.fallbackReason || 'decider-unavailable',
  }
}

// Triage 2: Issue deduplication
// Determines if a newly observed finding matches an existing open issue.
export async function triageIssueDedupe({
  candidate,
  existingIssues = [],
  plane,
  seat,
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

  const sanitizedList = (Array.isArray(existingIssues) ? existingIssues : [])
    .map((issue) => {
      const idStr = String(issue.id ?? issue.number ?? '').trim()
      return {
        id: idStr,
        title: sanitizeDeciderPayload(issue.title || ''),
        criterionId: issue.criterionId ? String(issue.criterionId) : undefined,
        errorCategory: issue.errorCategory ? String(issue.errorCategory) : undefined,
        exitCode: Number.isInteger(issue.exitCode) ? issue.exitCode : undefined,
      }
    })
    .filter((issue) => Boolean(issue.id))

  // Deterministic matching: exact criterion + errorCategory or exact title (on raw unredacted inputs to avoid false duplicate collisions on [REDACTED_CODE_BLOCK])
  const deterministicMatch = () => {
    const rawCandTitle = String(candidate.title || '')
      .trim()
      .toLowerCase()
    const candCriterion = candidate.criterionId ? String(candidate.criterionId) : undefined
    const candCategory = candidate.errorCategory ? String(candidate.errorCategory) : undefined

    for (const rawIssue of Array.isArray(existingIssues) ? existingIssues : []) {
      const issueId = String(rawIssue.id ?? rawIssue.number ?? '').trim()
      if (!issueId) continue

      const rawIssueTitle = String(rawIssue.title || '')
        .trim()
        .toLowerCase()
      const issueCriterion = rawIssue.criterionId ? String(rawIssue.criterionId) : undefined
      const issueCategory = rawIssue.errorCategory ? String(rawIssue.errorCategory) : undefined

      // Exact criterion + errorCategory match
      if (candCriterion && issueCriterion && candCriterion === issueCriterion) {
        if (!candCategory || candCategory === issueCategory) {
          return issueId
        }
      }
      // Exact title match (only compare non-empty raw titles, avoiding false-duplicate collisions on [REDACTED_CODE_BLOCK])
      if (rawCandTitle && rawIssueTitle && rawCandTitle === rawIssueTitle) {
        return issueId
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

  // Pre-check: If an exact deterministic match exists, return immediately without decider latency
  const exactMatchId = deterministicMatch()
  if (exactMatchId !== null) {
    return {
      ok: true,
      source: 'deterministic',
      isDuplicate: true,
      duplicateOf: exactMatchId,
    }
  }

  const criteria = {
    none: 'Candidate is a new, distinct defect observation',
  }
  sanitizedList.forEach((issue) => {
    if (issue.id !== 'none') {
      criteria[issue.id] =
        `Duplicate of #${issue.id}: ${issue.title} (criterion: ${issue.criterionId || 'none'})`
    }
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

  if (
    deciderRes.ok &&
    deciderRes.answer?.choice !== undefined &&
    deciderRes.answer?.choice !== null
  ) {
    const choice = String(deciderRes.answer.choice).trim()
    if (choice === 'none') {
      return {
        ok: true,
        source: 'decider',
        isDuplicate: false,
        duplicateOf: null,
        confidence: deciderRes.answer.confidence,
        probabilities: deciderRes.answer.probabilities,
        latencyMs: deciderRes.latencyMs,
      }
    }
    if (Object.hasOwn(criteria, choice)) {
      return {
        ok: true,
        source: 'decider',
        isDuplicate: true,
        duplicateOf: choice,
        confidence: deciderRes.answer.confidence,
        probabilities: deciderRes.answer.probabilities,
        latencyMs: deciderRes.latencyMs,
      }
    }
    // If choice is unrecognized, fall back to deterministic match
  }

  // Fallback
  const fallbackMatchedId = deterministicMatch()
  return {
    ok: true,
    source: 'fallback',
    isDuplicate: fallbackMatchedId !== null,
    duplicateOf: fallbackMatchedId,
    fallbackReason: deciderRes.ok
      ? 'invalid-choice'
      : deciderRes.fallbackReason || 'decider-unavailable',
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
  plane,
  seat,
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

  const sanitizedSeatTarget = sanitizeDeciderPayload(String(seatTarget || 'unknown'))
  const sanitizedLastState = sanitizeDeciderPayload(String(lastState || 'idle'))

  const deciderRes = await queryDecider({
    task: 'nudge-level',
    plane,
    seat,
    state: {
      seatTarget: sanitizedSeatTarget,
      idleSeconds: idleSec,
      reworkRound: round,
      lastState: sanitizedLastState,
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
    fallbackReason: deciderRes.ok
      ? 'invalid-choice'
      : deciderRes.fallbackReason || 'decider-unavailable',
  }
}
