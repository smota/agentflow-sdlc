import { sealDeliveryRecord } from '../core/delivery-record.mjs'

export async function observeGitHubLifecycle({
  client,
  repo,
  kind,
  target,
  candidateDigest,
  commit,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40,64}$/.test(commit))
    throw new Error('Exact repository and commit required')
  const prefix = `/repos/${repo}`
  const tagCommit = async (tag) => {
    let ref = await client.request(`${prefix}/git/ref/tags/${encodeURIComponent(tag)}`)
    let object = ref.object
    for (let depth = 0; object.type === 'tag' && depth < 8; depth++)
      object = (await client.request(`${prefix}/git/tags/${object.sha}`)).object
    if (object.type !== 'commit') throw new Error('Tag does not resolve to a commit')
    return object.sha
  }
  let source, observedCommit, outcome
  if (kind === 'merge') {
    if (!Number.isInteger(Number(target)) || Number(target) < 1)
      throw new Error('PR number required')
    source = await client.request(`${prefix}/pulls/${target}`)
    observedCommit = source.merge_commit_sha
    outcome = source.merged === true && observedCommit === commit ? 'pass' : 'fail'
  } else if (kind === 'tag') {
    observedCommit = await tagCommit(target)
    outcome = observedCommit === commit ? 'pass' : 'fail'
    source = { id: target }
  } else if (kind === 'release') {
    source = await client.request(`${prefix}/releases/tags/${encodeURIComponent(target)}`)
    observedCommit = await tagCommit(source.tag_name)
    outcome = source.draft !== true && observedCommit === commit ? 'pass' : 'fail'
  } else
    throw new Error(
      'Use the check collector or a deployment/rollback provider for this lifecycle kind',
    )
  return sealDeliveryRecord('lifecycle-observation', {
    id: String(source.id ?? target),
    kind,
    target: String(target),
    candidateDigest,
    expectedCommit: commit,
    observedCommit,
    outcome,
    origin: 'external-resolved',
    source: { repo, url: source.html_url ?? null },
    observedAt: new Date().toISOString(),
    prerelease: source.prerelease ?? null,
  })
}

export async function observeRollback({
  provider,
  target,
  candidateDigest,
  fromCandidateDigest,
  requiredAssertions,
}) {
  if (typeof provider?.observeRollback !== 'function')
    throw new Error('Rollback observation capability unavailable')
  const result = await provider.observeRollback({
    target,
    candidateDigest,
    fromCandidateDigest,
    requiredAssertions,
  })
  if (
    result?.verified !== true ||
    result.exercised !== true ||
    result.candidateDigest !== candidateDigest ||
    result.fromCandidateDigest !== fromCandidateDigest ||
    !result.runtimeIdentity ||
    !requiredAssertions?.length ||
    requiredAssertions.some(
      (id) => !result.assertions?.some((a) => a.id === id && a.outcome === 'pass'),
    )
  )
    throw new Error('Exercised rollback identity or behavior unverified')
  return sealDeliveryRecord('lifecycle-observation', {
    id: result.id,
    kind: 'rollback',
    target,
    candidateDigest,
    fromCandidateDigest,
    runtimeIdentity: result.runtimeIdentity,
    assertions: result.assertions,
    outcome: 'pass',
    exercised: true,
    origin: 'external-resolved',
    observedAt: result.observedAt,
  })
}

export async function observeDeployment({ provider, target, candidateDigest, requiredAssertions }) {
  if (typeof provider?.observeDeployment !== 'function')
    throw new Error('Deployment observation capability unavailable')
  const result = await provider.observeDeployment({ target, candidateDigest, requiredAssertions })
  if (
    result?.verified !== true ||
    result.candidateDigest !== candidateDigest ||
    !result.runtimeIdentity ||
    !requiredAssertions.length ||
    requiredAssertions.some(
      (id) => !result.assertions?.some((a) => a.id === id && a.outcome === 'pass'),
    )
  )
    throw new Error('Deployment identity or essential behavior unverified')
  return sealDeliveryRecord('lifecycle-observation', {
    id: result.id,
    kind: 'deployment',
    target,
    candidateDigest,
    runtimeIdentity: result.runtimeIdentity,
    assertions: result.assertions,
    outcome: 'pass',
    origin: 'external-resolved',
    observedAt: result.observedAt,
  })
}
