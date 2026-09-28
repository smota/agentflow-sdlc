import { normalizeObservation } from './events.mjs'

const PROCESS_STAGES = Object.freeze({
  coordination: 'coordination',
  humanWait: 'human-wait',
  ci: 'ci',
  timeToFirstEvidence: 'first-evidence',
})

const sum = (items, field) => {
  const known = items.filter((event) => typeof event[field] === 'number')
  return known.length ? known.reduce((total, event) => total + event[field], 0) : null
}

// Nearest-rank percentiles summarize only durations that were actually observed.
function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 0) return { count: 0, totalMs: null, p50Ms: null, p95Ms: null }
  const percentile = (fraction) => sorted[Math.ceil(fraction * sorted.length) - 1]
  return {
    count: sorted.length,
    totalMs: sorted.reduce((total, value) => total + value, 0),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  }
}

// Advisory aggregate; absence is unknown, never a zero-cost/zero-loss claim.
export function analyzeObservations(values, { losses = null } = {}) {
  const events = values.map(normalizeObservation).filter(Boolean)
  const select = (kind) => events.filter((event) => event.kind === kind)
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
  const processEvents = select('process_stage')
  const stageEvents = (stage) => processEvents.filter((event) => event.stage === stage)
  const stageDistribution = (stage) =>
    distribution(stageEvents(stage).map((event) => event.duration))
  const processDurationsMs = Object.fromEntries(
    Object.entries(PROCESS_STAGES).map(([key, stage]) => [key, stageDistribution(stage)]),
  )
  const recoveryEvents = select('recovery')
  const classifiedRecoveries = recoveryEvents.filter(
    (event) => event.temperature === 'cold' || event.temperature === 'warm',
  )
  const hasCompleteRecoveryClassification =
    recoveryEvents.length > 0 && classifiedRecoveries.length === recoveryEvents.length
  const unknowns = [
    'native-harness-internals',
    'unobserved-http-retries',
    ...(processDurationsMs.timeToFirstEvidence.count ? [] : ['time-to-first-evidence']),
    ...(hasCompleteRecoveryClassification ? [] : ['cold-warm-resume-classification']),
    'grant-denial-reasons',
    'duplicate-external-effects',
    'financial-cost',
  ]
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
      recovery: sum(recoveryEvents, 'duration'),
      coordination: processDurationsMs.coordination.totalMs,
      humanWait: processDurationsMs.humanWait.totalMs,
      ci: processDurationsMs.ci.totalMs,
    },
    durationDistributionsMs: processDurationsMs,
    recoveryTemperature: {
      cold: recoveryEvents.length
        ? classifiedRecoveries.filter((event) => event.temperature === 'cold').length
        : null,
      warm: recoveryEvents.length
        ? classifiedRecoveries.filter((event) => event.temperature === 'warm').length
        : null,
      unknown: recoveryEvents.length ? recoveryEvents.length - classifiedRecoveries.length : null,
    },
    losses,
    unknowns,
  }
}
