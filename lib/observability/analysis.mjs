import { normalizeObservation } from './events.mjs'

// Advisory aggregate; absence is unknown, never a zero-cost/zero-loss claim.
export function analyzeObservations(values, { losses = null } = {}) {
  const events = values.map(normalizeObservation).filter(Boolean)
  const select = (kind) => events.filter((event) => event.kind === kind)
  const sum = (items, field) => {
    const known = items.filter((event) => typeof event[field] === 'number')
    return known.length ? known.reduce((total, event) => total + event[field], 0) : null
  }
  const ratio = (value, denominator) =>
    value !== null && denominator > 0 ? value / denominator : null
  const acknowledged = select('run_event_appended')
  const acceptedDeliveries = acknowledged.filter((event) => event.eventKind === 'completed').length
  const checkpoints = acknowledged.filter((event) => event.eventKind === 'checkpoint').length
  const source = (kind) => {
    const items = select(kind)
    const responseBytes = sum(items, 'responseBytes')
    return {
      observedCalls: items.length,
      requestBytes: sum(items, 'requestBytes'),
      responseBytes,
      callsPerAcceptedDelivery: ratio(items.length, acceptedDeliveries),
      callsPerCheckpoint: ratio(items.length, checkpoints),
      responseBytesPerAcceptedDelivery: ratio(responseBytes, acceptedDeliveries),
      responseBytesPerCheckpoint: ratio(responseBytes, checkpoints),
    }
  }
  const context = select('context_admitted')
  const admittedBytes = sum(context, 'bytes')
  const usage = select('usage')
  return {
    schemaVersion: 1,
    coverage: 'observed-boundaries-only',
    inputRecords: values.length,
    acceptedRecords: events.length,
    rejectedRecords: values.length - events.length,
    denominators: { acceptedDeliveries, checkpoints },
    sourceHttp: source('github_client_request'),
    sourceCli: source('github_cli_request'),
    physicalReads: {
      files: sum(select('file_read'), 'files'),
      bytes: sum(select('file_read'), 'bytes'),
    },
    context: {
      admittedBytes,
      repeatedBytes: sum(context, 'repeatedBytes'),
      repeatedRatio: ratio(sum(context, 'repeatedBytes'), admittedBytes),
    },
    usage: Object.fromEntries(
      ['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens'].map((field) => [
        field,
        sum(usage, field),
      ]),
    ),
    dispatches: select('execution_attempt').filter((event) => event.state === 'started').length,
    reworkEvents: acknowledged.filter((event) => event.eventKind === 'returned').length,
    durationMs: {
      execution: sum(
        select('execution_attempt').filter((event) => event.state !== 'started'),
        'duration',
      ),
      verification: sum(select('verification'), 'duration'),
      recovery: sum(select('recovery'), 'duration'),
      coordination: null,
      humanWait: null,
      ci: null,
    },
    losses,
    unknowns: [
      'native-harness-internals',
      'unobserved-http-retries',
      'time-to-first-evidence',
      'cold-warm-resume-classification',
      'grant-denial-reasons',
      'duplicate-external-effects',
      'financial-cost',
    ],
  }
}
