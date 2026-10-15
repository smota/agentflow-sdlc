// Source-backed readiness only. This function never publishes, authenticates a caller,
// or treats PR-authored text/CLI approval strings as review evidence.
const sha = (value) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)
const identity = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$/.test(value)
const human = (author) =>
  author?.is_bot !== true &&
  author?.__typename !== 'Bot' &&
  (author?.is_bot === false || author?.__typename === 'User')
const checkPasses = (check) => {
  if (!check || typeof check !== 'object') return false
  if (check.__typename === 'StatusContext') return check.state === 'SUCCESS'
  if (check.__typename === 'CheckRun')
    return check.status === 'COMPLETED' && check.conclusion === 'SUCCESS'
  return false
}

export function evaluateMergeReadiness(
  pr,
  { requireHumanApproval = true, allowSelfReview = false, resolveReviewEvidence } = {},
) {
  const gates = {},
    failedGates = []
  const gate = (name, pass, details) => {
    gates[name] = { pass: pass === true, details }
    if (pass !== true) failedGates.push({ name, reason: details })
  }
  const headOid = sha(pr?.headRefOid) ? pr.headRefOid : null
  gate(
    'state',
    pr?.state === 'OPEN' && pr?.isDraft === false && Number.isInteger(pr?.number) && pr.number > 0,
    'open-nondraft-pr-required',
  )
  gate('head', headOid !== null, 'current-head-required')
  gate('mergeable', pr?.mergeable === 'MERGEABLE', 'known-mergeability-required')
  gate(
    'ci',
    Array.isArray(pr?.statusCheckRollup) &&
      pr.statusCheckRollup.length > 0 &&
      pr.statusCheckRollup.every(checkPasses),
    'all-current-checks-must-have-known-success',
  )

  const latest = new Map()
  let reviewSourceValid = Array.isArray(pr?.reviews) && identity(pr?.author?.login)
  for (const review of Array.isArray(pr?.reviews) ? pr.reviews : []) {
    const login = review?.author?.login
    const time = typeof review?.submittedAt === 'string' ? Date.parse(review.submittedAt) : NaN
    if (
      !identity(login) ||
      !Number.isFinite(time) ||
      !sha(review?.commit?.oid) ||
      !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED', 'PENDING'].includes(
        review?.state,
      )
    ) {
      reviewSourceValid = false
      continue
    }
    // A comment or an unfinished review does not dismiss an existing review decision.
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue
    const previous = latest.get(login)
    if (previous && previous.time === time) {
      reviewSourceValid = false
      continue
    }
    if (!previous || time > previous.time) latest.set(login, { review, time })
  }
  const current = [...latest.values()]
    .map((value) => value.review)
    .filter((review) => review.commit.oid === headOid)
  const changesRequested =
    pr?.reviewDecision === 'CHANGES_REQUESTED' ||
    [...latest.values()].some(({ review }) => review.state === 'CHANGES_REQUESTED')
  const approvals = current.filter(
    (review) =>
      review.state === 'APPROVED' &&
      review.author.login !== pr?.author?.login &&
      ['WRITE', 'MAINTAIN', 'ADMIN'].includes(review.authorPermission),
  )
  const independentApproval = approvals.length > 0
  const humanApproval = approvals.some((review) => human(review.author))

  // An optional host source resolver supports sealed role evidence (including explicitly
  // selected standard self-review). It is not a JSON attestation accepted by the CLI.
  let receipt = null
  if (typeof resolveReviewEvidence === 'function' && headOid) {
    try {
      receipt = resolveReviewEvidence({ pr: structuredClone(pr), headOid })
      if (receipt && typeof receipt.then === 'function') {
        Promise.resolve(receipt).catch(() => {})
        receipt = null
      }
    } catch {
      receipt = null
    }
  }
  const trusted =
    receipt?.verified === true &&
    receipt.headOid === headOid &&
    receipt.decision === 'approved' &&
    identity(receipt.reviewerId) &&
    identity(receipt.sourceRef) &&
    ['WRITE', 'MAINTAIN', 'ADMIN'].includes(receipt.reviewerPermission)
  const trustedIndependent =
    trusted && receipt.independent === true && receipt.reviewerId !== pr?.author?.login
  const trustedSelfReview = trusted && allowSelfReview === true && requireHumanApproval === false
  const reviewPasses =
    reviewSourceValid &&
    (!pr?.reviewDecision || pr.reviewDecision === 'APPROVED') &&
    !changesRequested &&
    (independentApproval || trustedIndependent || trustedSelfReview)
  gate(
    'review',
    reviewPasses,
    changesRequested ? 'current-changes-requested' : 'verified-current-head-review-required',
  )
  gate(
    'humanApproval',
    requireHumanApproval === false ||
      (reviewSourceValid &&
        !changesRequested &&
        (humanApproval || (trustedIndependent && receipt.human === true))),
    'verified-independent-current-head-human-approval-required',
  )
  return { ready: failedGates.length === 0, headOid, gates, failedGates }
}
