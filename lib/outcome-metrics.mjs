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
