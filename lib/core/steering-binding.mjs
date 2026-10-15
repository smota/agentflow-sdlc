// The host verifies endpoint identity/authentication. Declarations and heartbeat files cannot
// supply that trust. No network, credentials, notifications or authority store live here.
const text = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/.test(value)
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
export function evaluateSteeringBinding({
  binding = {},
  request = {},
  response = null,
  nowMs,
  verifyEndpoint,
} = {}) {
  binding = binding && typeof binding === 'object' ? binding : {}
  request = request && typeof request === 'object' ? request : {}
  try {
    binding = structuredClone(binding)
    request = structuredClone(request)
    response = structuredClone(response)
  } catch {
    return {
      authorized: false,
      reachable: false,
      status: 'STEERING_INPUT_UNVERIFIED',
      obligation: {
        owner: 'human/operator',
        action: 'verify-steering-authority',
        deadlineAt: null,
      },
      effects: [],
    }
  }
  const mutation = request.power !== 'observe'
  const clockValid = finite(nowMs) && nowMs >= 0
  const deadlineAt = clockValid
    ? Math.min(
        finite(request.deadlineAt) && request.deadlineAt > nowMs
          ? request.deadlineAt
          : nowMs + 900000,
        nowMs + 900000,
      )
    : null
  const hold = (status) => ({
    authorized: false,
    reachable: false,
    status,
    obligation: { owner: 'human/operator', action: 'verify-steering-authority', deadlineAt },
    effects: [],
  })
  if (!clockValid) return hold('STEERING_CLOCK_UNVERIFIED')
  if (
    ![
      binding.authorityId,
      binding.replyRoute,
      binding.goal,
      binding.task,
      request.goal,
      request.task,
      request.power,
      request.challenge,
    ].every(text) ||
    binding.goal !== request.goal ||
    binding.task !== request.task ||
    !Array.isArray(binding.powers) ||
    !binding.powers.includes(request.power)
  )
    return hold('STEERING_SCOPE_UNVERIFIED')
  if (
    !['observe', 'unfreeze', 'assign', 'triage', 'merge', 'accept-and-register'].includes(
      request.power,
    ) ||
    !text(request.challenge) ||
    request.challenge.length < 32
  )
    return hold('STEERING_SCOPE_UNVERIFIED')
  if (
    mutation &&
    (!/^[a-f0-9]{64}$/.test(request.subjectDigest ?? '') ||
      !/^[a-f0-9]{64}$/.test(request.actionDigest ?? '') ||
      !text(request.subjectId))
  )
    return hold('STEERING_DECISION_UNVERIFIED')
  if (
    !finite(binding.expiresAt) ||
    binding.expiresAt <= nowMs ||
    !finite(request.deadlineAt) ||
    request.deadlineAt <= nowMs ||
    request.deadlineAt > nowMs + 900000 ||
    !finite(binding.issuedAt) ||
    binding.issuedAt > nowMs ||
    binding.expiresAt - binding.issuedAt > 3600000 ||
    (binding.issuedAt !== undefined && (!finite(binding.issuedAt) || binding.issuedAt > nowMs))
  )
    return hold('STEERING_BINDING_EXPIRED')
  const expected = {
    authorityId: binding.authorityId,
    replyRoute: binding.replyRoute,
    goal: request.goal,
    task: request.task,
    challenge: request.challenge,
    power: request.power,
    deadlineAt: request.deadlineAt,
    ...(request.subjectId !== undefined ? { subjectId: request.subjectId } : {}),
    ...(request.subjectDigest !== undefined ? { subjectDigest: request.subjectDigest } : {}),
    ...(request.actionDigest !== undefined ? { actionDigest: request.actionDigest } : {}),
  }
  if (response !== null && Object.keys(expected).some((key) => response?.[key] !== expected[key]))
    return hold('STEERING_RESPONSE_MISMATCH')
  if (typeof verifyEndpoint !== 'function') return hold('STEERING_AUTHENTICATION_UNVERIFIED')
  let receipt
  try {
    receipt = verifyEndpoint({ binding, request, response })
    if (receipt && typeof receipt.then === 'function') {
      Promise.resolve(receipt).catch(() => {})
      return hold('STEERING_AUTHENTICATION_UNVERIFIED')
    }
  } catch {
    return hold('STEERING_AUTHENTICATION_UNVERIFIED')
  }
  if (
    !receipt ||
    typeof receipt.then === 'function' ||
    receipt.authenticated !== true ||
    (mutation && (receipt.decision !== 'approve' || receipt.nonceConsumed !== true)) ||
    receipt.reachable !== true ||
    Object.keys(expected).some((key) => receipt[key] !== expected[key]) ||
    !finite(receipt.expiresAt) ||
    receipt.expiresAt <= nowMs ||
    receipt.expiresAt > binding.expiresAt ||
    !finite(receipt.observedAt) ||
    receipt.observedAt > nowMs ||
    nowMs - receipt.observedAt > 60000
  )
    return hold('STEERING_AUTHENTICATION_UNVERIFIED')
  return {
    authorized: true,
    reachable: true,
    status: 'STEERING_AUTHORITY_VERIFIED',
    validUntil: Math.min(binding.expiresAt, request.deadlineAt, receipt.expiresAt),
    observedAt: receipt.observedAt,
    obligation: null,
    effects: [],
  }
}
