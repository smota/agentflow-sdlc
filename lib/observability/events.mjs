import { createHash } from 'node:crypto'

const counter = (value) => Number.isSafeInteger(value) && value >= 0
const measure = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const oneOf =
  (...values) =>
  (value) =>
    values.includes(value)
const nullable = (check) => (value) => value === null || check(value)
const identity = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const correlations = Object.fromEntries(
  ['runId', 'sessionId', 'attemptId', 'operationId', 'eventId'].map((key) => [key, identity]),
)
const digests = Object.fromEntries(
  ['candidateDigest', 'planDigest', 'policyDigest', 'grantDigest'].map((key) => [key, digest]),
)
const eventKind = oneOf(
  'started',
  'contract-frozen',
  'candidate',
  'observation',
  'budget-admission',
  'advanced',
  'returned',
  'rework-resolved',
  'paused',
  'blocked',
  'resumed',
  'operation',
  'cancelled',
  'completed',
  'checkpoint',
  'grant-issued',
  'grant-revoked',
  'operation-admitted',
)
const errorType = nullable(
  oneOf(
    'GitHubCliError',
    'GitHubApiError',
    'TransportError',
    'ParseError',
    'StoreError',
    'ExportError',
  ),
)
const source = {
  method: oneOf('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'),
  status: nullable((value) => Number.isInteger(value) && value >= 100 && value <= 599),
  requestBytes: counter,
  responseBytes: nullable(counter),
  duration: measure,
  errorType,
}

export const OBSERVATION_FIELDS = Object.freeze({
  github_cli_request: source,
  github_client_request: source,
  run_event_attempted: { eventKind },
  run_event_appended: { eventKind },
  run_event_failed: { eventKind, errorType },
  session: { state: oneOf('started', 'completed', 'failed'), duration: measure },
  file_read: {
    bytes: counter,
    files: counter,
    purpose: oneOf('policy', 'context', 'candidate', 'evidence', 'configuration'),
  },
  context_admitted: { bytes: counter, repeatedBytes: counter, policyBytes: counter },
  execution_attempt: {
    state: oneOf('started', 'completed', 'failed', 'cancelled', 'unknown'),
    duration: measure,
  },
  usage: {
    inputTokens: counter,
    outputTokens: counter,
    cachedInputTokens: counter,
    totalTokens: counter,
  },
  verification: { outcome: oneOf('pass', 'fail', 'unknown'), duration: measure },
  recovery: { outcome: oneOf('resumed', 'blocked', 'unknown'), duration: measure },
})

// Closed value domains stop secrets hidden under otherwise permitted attribute names.
// Correlation labels are hashed because run IDs can themselves contain private text.
export function normalizeObservation(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.hasOwn(OBSERVATION_FIELDS, value.kind)
  )
    return null
  const checks = { ...OBSERVATION_FIELDS[value.kind], ...correlations, ...digests }
  const result = { kind: value.kind, schemaVersion: 1 }
  for (const [key, field] of Object.entries(value)) {
    if (key === 'kind' || field === undefined) continue
    if (!Object.hasOwn(checks, key) || !checks[key](field)) return null
    result[key] = Object.hasOwn(correlations, key)
      ? createHash('sha256').update(field).digest('hex')
      : field
  }
  return result
}

// Only finite category values are metric dimensions. Measurements and correlation
// digests belong in values/spans, never metric labels.
export function metricLabels(event) {
  return Object.fromEntries(
    ['kind', 'method', 'status', 'errorType', 'eventKind', 'state', 'purpose', 'outcome']
      .filter((key) => event[key] !== undefined && event[key] !== null)
      .map((key) => [key, event[key]]),
  )
}
