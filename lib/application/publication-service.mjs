import { recordDigest } from '../core/record-digest.mjs'
import { sealDeliveryRecord, requireDeliveryRecord } from '../core/delivery-record.mjs'

export function planProjection({ status, repo, issueNumber }) {
  if (
    !status?.durable ||
    !status.revision ||
    !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
    !Number.isInteger(issueNumber) ||
    issueNumber < 1
  )
    throw new Error('Projection requires a durable run and exact issue destination')
  const payload = {
    repo,
    issueNumber,
    runId: status.runId,
    revision: status.revision,
    status: status.status,
    role: status.role,
    candidateDigest: status.candidateDigest,
    nextAction: status.nextAction,
  }
  const id = recordDigest(payload)
  const body = `<!-- agentflow-run-projection:${id} -->\nAgentflow run **${status.runId}**: ${status.status}\n\nRole: ${status.role}\nCandidate: ${status.candidateDigest ?? 'unverified'}\nNext action: ${status.nextAction}\nRun revision: ${status.revision}\n`
  return sealDeliveryRecord('projection-plan', { ...payload, id, body })
}

export async function reconcileProjection({ client, plan }) {
  const marker = `<!-- agentflow-run-projection:${plan.id} -->`
  const matches = []
  for (let page = 1; page <= 100; page++) {
    const comments = await client.request(
      `/repos/${plan.repo}/issues/${plan.issueNumber}/comments?per_page=100&page=${page}`,
    )
    if (!Array.isArray(comments)) throw new Error('Invalid comments response')
    matches.push(...comments.filter((c) => c.body === plan.body && c.body.includes(marker)))
    if (comments.length < 100)
      return matches.length === 1
        ? { verified: true, state: 'confirmed', url: matches[0].html_url, id: matches[0].id }
        : {
            state: 'unknown',
            reason: matches.length
              ? 'Duplicate projection markers'
              : 'Projection not observed; absence does not prove submission failed',
          }
  }
  return { state: 'unknown', reason: 'Incomplete comment pagination' }
}

export async function publishProjection({ service, client, plan, confirm, authority }) {
  requireDeliveryRecord(plan, 'projection-plan')
  if (confirm !== plan.digest) throw new Error('Projection confirmation mismatch')
  let { state } = await service.read()
  const operation = state.operations[plan.id]
  if (operation) {
    if (operation.payloadDigest !== plan.digest)
      throw new Error('Projection operation payload changed')
    if (operation.state === 'confirmed') return operation.result
    // A second invocation is reconciliation only, never another POST.
    const result = await reconcileProjection({ client, plan })
    if (result.verified)
      await service.reconcile(plan.id, { expectedRevision: state.revision, authority })
    return result
  }
  if (state.revision !== plan.revision) throw new Error('Projection plan is stale')
  const intent = {
    id: plan.id,
    payloadDigest: plan.digest,
    kind: 'issue-projection',
    destination: { repo: plan.repo, issueNumber: plan.issueNumber },
    state: 'planned',
    plan,
  }
  await service.record('operation', intent, { expectedRevision: state.revision, authority })
  state = (await service.read()).state
  await service.record(
    'operation',
    { ...intent, state: 'submitted' },
    { expectedRevision: state.revision, authority },
  )
  try {
    await client.request(`/repos/${plan.repo}/issues/${plan.issueNumber}/comments`, {
      method: 'POST',
      body: { body: plan.body },
    })
    const result = await reconcileProjection({ client, plan })
    state = (await service.read()).state
    if (result.verified)
      await service.reconcile(plan.id, { expectedRevision: state.revision, authority })
    else
      await service.record(
        'operation',
        { ...intent, state: 'unknown' },
        { expectedRevision: state.revision, authority },
      )
    return result
  } catch {
    state = (await service.read()).state
    await service.record(
      'operation',
      { ...intent, state: 'unknown' },
      { expectedRevision: state.revision, authority },
    )
    return { state: 'unknown', reason: 'Reconcile before any retry' }
  }
}
