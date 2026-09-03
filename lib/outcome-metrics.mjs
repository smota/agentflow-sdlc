const EVENT_TYPES = new Set([
  'work-started',
  'validation-completed',
  'review-requested',
  'review-completed',
  'pr-ready',
  'released',
  'follow-up-opened',
  'follow-up-closed',
  'incident-opened',
  'regression-eval-added',
])

function duration(start, end) {
  if (!start || !end) return null
  const seconds = (Date.parse(end) - Date.parse(start)) / 1000
  return seconds < 0 ? null : seconds
}

export function deriveOutcomeMetrics(events = [], { now = new Date().toISOString() } = {}) {
  const valid = []
  const seen = new Set()
  const warnings = []
  for (const event of [...events].sort((a, b) =>
    String(a.timestamp).localeCompare(String(b.timestamp)),
  )) {
    if (!event?.id || seen.has(event.id)) {
      warnings.push(`ignored duplicate or missing event id: ${event?.id ?? '<missing>'}`)
      continue
    }
    if (
      typeof event.subject !== 'string' ||
      !event.subject.trim() ||
      !EVENT_TYPES.has(event.type) ||
      Number.isNaN(Date.parse(event.timestamp))
    ) {
      warnings.push(`ignored invalid event: ${event.id}`)
      continue
    }
    seen.add(event.id)
    valid.push(event)
  }
  const bySubject = new Map()
  for (const event of valid)
    bySubject.set(event.subject, [...(bySubject.get(event.subject) ?? []), event])
  const samples = []
  for (const [subject, subjectEvents] of bySubject) {
    const first = (type) => subjectEvents.find((event) => event.type === type)?.timestamp ?? null
    samples.push({
      subject,
      cycleTimeSeconds: duration(first('work-started'), first('pr-ready')),
      reviewLatencySeconds: duration(first('review-requested'), first('review-completed')),
      releaseLeadTimeSeconds: duration(first('pr-ready'), first('released')),
      followUpAgeSeconds: duration(first('follow-up-opened'), first('follow-up-closed') ?? now),
      incidentToEvalSeconds: duration(first('incident-opened'), first('regression-eval-added')),
      firstPassValidation:
        subjectEvents.find((event) => event.type === 'validation-completed')?.outcome === 'pass'
          ? true
          : subjectEvents.some((event) => event.type === 'validation-completed')
            ? false
            : null,
    })
  }
  const knownFirstPass = samples
    .map((item) => item.firstPassValidation)
    .filter((value) => value !== null)
  return {
    version: 1,
    derived: true,
    eventCount: valid.length,
    subjectCount: samples.length,
    firstPassValidationRate: knownFirstPass.length
      ? knownFirstPass.filter(Boolean).length / knownFirstPass.length
      : null,
    samples,
    warnings,
  }
}

export function deriveRunMetrics(events = []) {
  const unique = new Map()
  for (const event of events) {
    if (!event.id) throw new Error('Run metric event identity required')
    const previous = unique.get(event.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(event))
      throw new Error('Conflicting metric event')
    unique.set(event.id, event)
  }
  events = [...unique.values()]
  const first = events[0]?.timestamp ?? null
  const observations = events.filter((e) => e.kind === 'observation')
  const usable = observations.find(
    (e) =>
      ['collector-observed', 'external-resolved'].includes(e.payload?.observation?.origin) &&
      e.payload?.observation?.outcome === 'pass',
  )
  const recoveries = events
    .filter((e) => e.kind === 'resumed')
    .map((e) => {
      const previous = events
        .slice(0, events.indexOf(e))
        .findLast((item) => ['paused', 'blocked'].includes(item.kind))
      return { eventId: e.id, seconds: duration(previous?.timestamp, e.timestamp) }
    })
  const observed = observations.filter((e) =>
    ['collector-observed', 'external-resolved'].includes(e.payload?.observation?.origin),
  )
  let phase = 0
  const attempts = [],
    priorAttempts = new Map(),
    retryCauses = new Map()
  for (const event of events) {
    if (['advanced', 'returned'].includes(event.kind)) phase = event.payload.to
    if (event.kind !== 'observation') continue
    const observation = event.payload.observation
    const key = `${event.runId}:${phase}:${observation.criterionId}`
    const previous = priorAttempts.get(key)
    if (previous) {
      const reasons = previous.errors?.length ? previous.errors : ['unclassified']
      for (const reason of new Set(reasons))
        retryCauses.set(reason, (retryCauses.get(reason) ?? 0) + 1)
    }
    attempts.push({
      runId: event.runId,
      phase,
      eventId: event.id,
      invocationId: observation.invocationId,
      criterionId: observation.criterionId,
      candidateDigest: observation.candidateDigest,
      outcome: observation.outcome,
      origin: observation.origin,
      retry: Boolean(previous),
    })
    priorAttempts.set(key, observation)
  }
  const accepted = events.find((e) => ['advanced', 'completed'].includes(e.kind))
  const activated = events.find((e) => e.kind === 'advanced' && e.payload.to === 4)
  const completed = events.find((e) => e.kind === 'completed')
  const budget = events.findLast((e) => e.kind === 'budget-admission')?.payload
  return {
    version: 1,
    derived: true,
    attempts: observations.length,
    observedAttempts: observed.length,
    passedAttempts: observed.filter((e) => e.payload.observation.outcome === 'pass').length,
    firstObservedEvidenceSeconds: duration(first, usable?.timestamp),
    firstAcceptedDeliverySeconds: duration(first, accepted?.timestamp),
    setupAndPlanningSeconds: duration(first, activated?.timestamp),
    activatedExecutionSeconds: duration(activated?.timestamp, completed?.timestamp),
    attemptDetails: attempts,
    retries: attempts.filter((a) => a.retry).length,
    retryCauses: Object.fromEntries(retryCauses),
    plannedPromotions: events.filter((e) => e.kind === 'advanced').length,
    returnedFindings: events
      .filter((e) => e.kind === 'returned')
      .reduce((sum, e) => sum + (e.payload.findings?.length ?? 0), 0),
    unknownOperations: events.filter(
      (e) => e.kind === 'operation' && e.payload?.state === 'unknown',
    ).length,
    projectionFailures: events.filter(
      (e) =>
        e.kind === 'operation' &&
        e.payload?.kind === 'issue-projection' &&
        ['unknown', 'failed'].includes(e.payload.state),
    ).length,
    usage: budget
      ? { used: budget.used, unit: budget.unit, known: budget.usageKnown === true }
      : { used: null, unit: null, known: false },
    interventions: null,
    unsupportedClaims: null,
    missingMeasurements: [
      'human-interventions',
      'unsupported-claim-audit',
      ...(budget?.usageKnown !== true ? ['provider-usage'] : []),
    ],
    recoveries,
    cost: null,
    costBasis: 'Provider usage and timestamped rates required; no invoice inferred',
  }
}
