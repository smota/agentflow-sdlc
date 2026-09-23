import { projectRunStatus, reduceRun } from './core/run-state.mjs'
import { deriveRunMetrics } from './outcome-metrics.mjs'

export async function loadRunView(store) {
  const snapshot = await store.read()
  const state = reduceRun(snapshot.events)
  return {
    status: projectRunStatus(state, { durable: store.durable }),
    metrics: deriveRunMetrics(snapshot.events),
    evidence: (state?.observations ?? []).map(
      ({ criterionId, outcome, origin, candidateDigest, digest }) => ({
        criterionId,
        outcome,
        origin,
        candidateDigest,
        digest,
      }),
    ),
    sourceRevision: snapshot.sourceRevision ?? null,
  }
}

export function renderRunView(view) {
  const escape = (value) =>
    String(value ?? 'unknown').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    )
  const status = view.status
  return `<section class="panel"><h1>Run ${escape(status.runId)}</h1><p>${escape(status.status)} · ${escape(status.role)}</p><dl>${[
    ['Candidate', status.candidateDigest],
    ['Writer', status.owner],
    ['Generation', status.generation],
    [
      'Budget',
      status.budget?.configuration
        ? `${status.budget.configuration.limit} ${status.budget.configuration.unit ?? 'units'} (${status.budget.configuration.level})`
        : 'unconfigured',
    ],
    ['Usage', status.budget?.usageKnown ? status.budget.lastAdmission.used : 'unknown'],
    ['Projection', status.projectionStatus],
    ['Next action', status.nextAction],
    ['Durable source', status.durable ? 'acknowledged' : 'local preview'],
    ['Revision', status.revision],
    ['Observed at', status.observedAt],
  ]
    .map(([label, value]) => `<dt>${label}</dt><dd>${escape(value)}</dd>`)
    .join(
      '',
    )}</dl><h2>Evidence</h2><ul>${view.evidence.map((e) => `<li>${escape(e.criterionId)}: ${escape(e.outcome)} (${escape(e.origin)})</li>`).join('') || '<li>No current observations</li>'}</ul><p>${status.pendingOperations?.length ?? 0} unresolved external operations; ${status.openRework?.length ?? 0} open findings.</p></section>`
}
