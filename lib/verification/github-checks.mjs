import { recordDigest } from '../core/record-digest.mjs'
import { sealDeliveryRecord, requireDigest } from '../core/delivery-record.mjs'

export async function collectGitHubCheck({
  client,
  repo,
  candidateDigest,
  definition,
  now = () => new Date().toISOString(),
}) {
  requireDigest(candidateDigest, 'candidateDigest')
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
    !/^[a-f0-9]{40,64}$/.test(definition.commit ?? '') ||
    !definition.name ||
    !Number.isInteger(definition.appId)
  )
    throw new Error('Exact repository, commit, check name and producer app required')
  const matches = []
  for (let page = 1; page <= 100; page++) {
    const response = await client.request(
      `/repos/${repo}/commits/${definition.commit}/check-runs?per_page=100&page=${page}&filter=latest`,
    )
    if (!Array.isArray(response.check_runs)) throw new Error('Invalid check response')
    matches.push(
      ...response.check_runs.filter(
        (c) =>
          c.name === definition.name &&
          c.app?.id === definition.appId &&
          c.head_sha === definition.commit,
      ),
    )
    if (response.check_runs.length < 100) break
    if (page === 100) throw new Error('Check pagination limit reached; evidence incomplete')
  }
  if (matches.length !== 1)
    throw new Error('Expected exactly one check from the configured producer')
  const check = matches[0]
  const outcome =
    check.status === 'completed' && check.conclusion === 'success'
      ? 'pass'
      : check.status === 'completed'
        ? 'fail'
        : 'unknown'
  return sealDeliveryRecord('verification-observation', {
    id: `github-check-${check.id}`,
    invocationId: String(check.id),
    criterionId: definition.criterionId,
    producer: `github-app:${definition.appId}`,
    origin: 'external-resolved',
    isolation: 'immutable',
    candidateDigest,
    definitionDigest: recordDigest(definition),
    outcome,
    assertions: [{ id: definition.assertionId, outcome }],
    startedAt: check.started_at ?? now(),
    completedAt: check.completed_at ?? now(),
    source: { repo, commit: definition.commit, checkId: check.id, url: check.html_url },
  })
}

export async function resolveGitHubCheck({ observation, client, definition }) {
  try {
    const fresh = await collectGitHubCheck({
      client,
      repo: observation.source.repo,
      candidateDigest: observation.candidateDigest,
      definition,
    })
    return { verified: fresh.digest === observation.digest, observation: fresh }
  } catch {
    return { verified: false, observation }
  }
}
