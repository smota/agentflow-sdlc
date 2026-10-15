import { resolveTwoLevelFallback } from './platform-fallback.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const safeId = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(value)
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const tupleFields = ['runtime', 'providerRoute', 'model', 'effort', 'profile']
const tuple = (value) =>
  value && tupleFields.every((key) => typeof value[key] === 'string' && value[key].length > 0)
const sameTuple = (left, right) =>
  tuple(left) && tuple(right) && tupleFields.every((key) => left[key] === right[key])
const artifacts = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0 &&
  Object.entries(value).every(([key, value]) => safeId(key) && digest(value))

// Only structured error identity/status is classification evidence. Usage metadata and prose
// may repeat historical failures, so neither is searched for error-looking substrings.
export function classifyExecutionFailure({
  structuredError = {},
  responseHeaders = {},
  nowMs,
} = {}) {
  const error = structuredError?.error ?? structuredError ?? {}
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : ''
  const status = error.status ?? error.statusCode ?? structuredError?.status
  let classification = 'unknown'
  if (
    [
      'insufficient_quota',
      'quota_exceeded',
      'quota_exhausted',
      'billing_hard_limit_reached',
    ].includes(code)
  )
    classification = 'quota-exhausted'
  else if (
    ['invalid_api_key', 'authentication_error', 'unauthorized', 'token_expired'].includes(code) ||
    status === 401
  )
    classification = 'authentication'
  else if (['model_not_found', 'model_unavailable', 'unsupported_model'].includes(code))
    classification = 'model-unavailable'
  else if (
    ['entry_not_found', 'session_not_found', 'restore_integrity', 'generation_mismatch'].includes(
      code,
    )
  )
    classification = 'restore-integrity'
  else if (['eacces', 'eperm'].includes(code)) classification = 'local-permission'
  else if (code === 'enoent') classification = 'local-path'
  else if (['rate_limit_exceeded', 'too_many_requests'].includes(code) || status === 429)
    classification = 'temporary-rate-limit'
  else if (
    ['overloaded', 'provider_unavailable'].includes(code) ||
    [500, 502, 503, 504].includes(status)
  )
    classification = 'provider-unavailable'
  const retryHeader = Object.entries(responseHeaders ?? {}).find(
    ([name]) => name.toLowerCase() === 'retry-after',
  )?.[1]
  let retryAt = null
  if (finite(nowMs) && typeof retryHeader === 'string') {
    if (/^\d+(?:\.\d+)?$/.test(retryHeader.trim())) retryAt = nowMs + Number(retryHeader) * 1000
    else if (/^[A-Za-z]{3},/.test(retryHeader)) retryAt = Date.parse(retryHeader)
    if (!finite(retryAt) || retryAt < nowMs) retryAt = null
  }
  return { classification, retryAt, providerResetUnknown: retryAt === null }
}

// This is a host integration boundary, not a second recovery controller. The existing run
// service owns writer transfer, source revisions, grants, budgets, and operation reconciliation.
// No deployed OpenRig compact reader can supply these trusted host receipts at present.
export async function recoverExecution({
  service,
  failure,
  policy,
  nowMs,
  owner,
  currentContract,
  replacementContract,
  recovery,
  operation,
  operationOptions,
  inspectRecoveryContext,
  dispatch,
  readback,
} = {}) {
  // Snapshot all caller data before the first asynchronous boundary. Host ports retain no
  // authority to rewrite the selected operation, grant, policy or route through caller aliases.
  const effects = []
  const started = performance.now()
  const currentTime = () => nowMs + performance.now() - started
  const deadline = finite(policy?.deadlineAt)
    ? policy.deadlineAt
    : finite(nowMs)
      ? nowMs + 60000
      : null
  const hold = (reason) => ({
    status: 'held',
    reason,
    obligation: {
      owner: safeId(owner) ? owner : 'operator',
      action: 'verify-recovery-context',
      deadlineAt: deadline,
    },
    effects: [...effects],
  })
  try {
    ;({
      failure,
      policy,
      currentContract,
      replacementContract,
      recovery,
      operation,
      operationOptions,
    } = structuredClone({
      failure,
      policy,
      currentContract,
      replacementContract,
      recovery,
      operation,
      operationOptions,
    }))
  } catch {
    return hold('recovery-input-unverified')
  }
  if (
    !finite(nowMs) ||
    nowMs < 0 ||
    !policy ||
    !Number.isSafeInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 20 ||
    !finite(policy.deadlineAt) ||
    policy.deadlineAt <= nowMs ||
    !finite(policy.backoffMs) ||
    policy.backoffMs < 1 ||
    !finite(policy.portTimeoutMs) ||
    policy.portTimeoutMs < 1 ||
    policy.portTimeoutMs > 60000
  )
    return hold('recovery-budget-invalid-or-expired')
  const bounded = async (callback) => {
    const remaining = policy.deadlineAt - currentTime()
    if (remaining <= 0) throw new Error('deadline')
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(callback),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('port-timeout')),
            Math.min(remaining, policy.portTimeoutMs),
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const classification = classifyExecutionFailure({ ...failure, nowMs })
  if (
    [
      'authentication',
      'model-unavailable',
      'restore-integrity',
      'local-permission',
      'local-path',
      'unknown',
    ].includes(classification.classification)
  )
    return hold(classification.classification)
  if (
    !service ||
    ![
      'read',
      'record',
      'recoveryPlan',
      'resume',
      'executeDelegatedOperation',
      'reconcileDelegatedOperation',
    ].every((method) => typeof service[method] === 'function')
  )
    return hold('source-service-unavailable')
  let snapshot
  try {
    snapshot = await bounded(() => service.read())
  } catch {
    return hold('source-read-unavailable')
  }
  let state = snapshot?.state
  if (!state) return hold('source-run-unavailable')
  const incident = operation?.arguments?.recoveryIncident
  const policyDigest = recordDigest(policy)
  if (
    !safeId(incident) ||
    !safeId(operation?.id) ||
    operation?.action !== 'rig:mutate' ||
    !operation?.capabilities?.includes('rig:mutate') ||
    operation?.arguments?.recoveryPolicyDigest !== policyDigest
  )
    return hold('incident-policy-unbound')
  const prior = Object.values(state.admissions ?? {}).filter(
    (item) => item.operation?.arguments?.recoveryIncident === incident,
  )
  const attempts = (snapshot.events ?? []).filter(
    (event) => event.kind === 'checkpoint' && event.payload?.recoveryIncident === incident,
  )
  if (
    attempts.some((event) => event.payload.recoveryPolicyDigest !== policyDigest) ||
    prior.some((item) => item.operation.arguments.recoveryPolicyDigest !== policyDigest)
  )
    return hold('incident-policy-changed')
  // A persisted admission is never evidence that dispatch did not occur. Reconcile that exact
  // operation first. In particular, a timeout cannot be followed by a second blind dispatch.
  if (state.admissions?.[operation.id]) {
    try {
      const result = await bounded(() =>
        service.reconcileDelegatedOperation({
          operationId: operation.id,
          authority: recovery?.reconciliationAuthority,
        }),
      )
      return hold(
        result.state === 'confirmed'
          ? 'operation-already-confirmed-verify-readback'
          : result.state === 'failed'
            ? 'operation-failed-replan-within-budget'
            : 'operation-outcome-unknown',
      )
    } catch {
      return hold('operation-reconciliation-unavailable')
    }
  }
  if (Math.max(attempts.length, prior.length) >= policy.maxAttempts)
    return hold('incident-attempt-budget-exhausted')
  const persistAttempt = async () => {
    await bounded(() =>
      service.record(
        'checkpoint',
        {
          reason: 'classified-execution-recovery',
          recoveryIncident: incident,
          recoveryPolicyDigest: policyDigest,
          classification: classification.classification,
        },
        { expectedRevision: snapshot.revision, authority: recovery?.checkpointAuthority },
      ),
    )
    effects.push('source-attempt-checkpoint')
    snapshot = await bounded(() => service.read())
    state = snapshot.state
  }
  if (
    classification.classification === 'temporary-rate-limit' ||
    classification.classification === 'provider-unavailable'
  ) {
    const retryAt =
      classification.retryAt ?? nowMs + Math.min(policy.backoffMs * 2 ** attempts.length, 60000)
    if (retryAt >= policy.deadlineAt) return hold('retry-exceeds-deadline')
    try {
      await persistAttempt()
    } catch {
      return hold('attempt-checkpoint-unavailable')
    }
    return {
      status: 'retry-later',
      classification: classification.classification,
      retryAt,
      timingSource: classification.retryAt === null ? 'policy-backoff' : 'provider-retry-after',
      providerResetUnknown: classification.providerResetUnknown,
      obligation: {
        owner: safeId(owner) ? owner : 'operator',
        action: 'recheck-provider-before-retry',
        deadlineAt: policy.deadlineAt,
      },
      effects: [...effects],
    }
  }
  if (
    !tuple(currentContract) ||
    !tuple(replacementContract) ||
    currentContract.providerRoute === replacementContract.providerRoute
  )
    return hold('exhausted-provider-route-ineligible')
  if (
    typeof inspectRecoveryContext !== 'function' ||
    typeof readback !== 'function' ||
    typeof dispatch !== 'function'
  )
    return hold('trusted-host-ports-unavailable')
  // Explicit future writer identity is required. Refreshing a source revision after transfer
  // never authorizes a different principal, generation, operation, grant, or payload.
  if (
    operationOptions?.expectedRevision !== snapshot.revision ||
    operationOptions?.authority?.owner !== recovery?.owner ||
    operationOptions?.authority?.generation !== state.generation + 1
  )
    return hold('recovery-operation-options-stale')
  try {
    await persistAttempt()
  } catch {
    return hold('attempt-checkpoint-unavailable')
  }
  let evidence
  try {
    evidence = await bounded(() =>
      inspectRecoveryContext({
        state: structuredClone(state),
        currentContract: structuredClone(currentContract),
        replacementContract: structuredClone(replacementContract),
        incident,
        policyDigest,
        operation: structuredClone(operation),
      }),
    )
  } catch {
    return hold('recovery-context-unavailable')
  }
  if (
    evidence?.verified !== true ||
    evidence.runId !== state.runId ||
    evidence.revision !== state.revision ||
    evidence.generation !== state.generation ||
    evidence.incident !== incident ||
    evidence.policyDigest !== policyDigest ||
    evidence.operationDigest !== recordDigest(operation) ||
    !finite(evidence.observedAt) ||
    evidence.observedAt > currentTime() ||
    currentTime() - evidence.observedAt > 60000 ||
    evidence.currentContractDigest !== recordDigest(currentContract) ||
    evidence.replacementContractDigest !== recordDigest(replacementContract) ||
    ![
      'authorized',
      'healthy',
      'checkpointVerified',
      'custodyVerified',
      'reviewerIndependenceVerified',
      'capabilityFloorsVerified',
      'costPolicyVerified',
      'quotaIndependent',
    ].every((key) => evidence[key] === true) ||
    !artifacts(evidence.artifactDigests)
  )
    return hold('recovery-context-unverified')
  try {
    const plan = await bounded(() =>
      service.recoveryPlan({
        owner: recovery.owner,
        boundary: recovery.boundary,
        writer: recovery.writer,
      }),
    )
    if (plan.blocked) return hold('source-recovery-blocked')
    // The existing selector runs only after source-owned safe-boundary verification.
    // Unknown health is never passed as the selector's legacy permissive null default.
    if (
      !Array.isArray(evidence.healthyPlatforms) ||
      !policy.fallback ||
      !safeId(policy.fallback.seat)
    )
      return hold('fallback-policy-or-health-unverified')
    const selected = resolveTwoLevelFallback({
      ...policy.fallback,
      healthyPlatforms: evidence.healthyPlatforms,
      atPhaseBoundary: true,
    })
    if (
      !selected.ok ||
      selected.platform !== `${replacementContract.runtime}:${replacementContract.providerRoute}` ||
      ['runtime', 'model', 'effort'].some((key) => selected[key] !== replacementContract[key])
    )
      return hold('fallback-selection-mismatch')
    await bounded(() => service.resume({ plan, authority: recovery.authority }))
    effects.push('source-writer-transfer')
    const resumed = await bounded(() => service.read())
    if (
      resumed.state?.owner !== operationOptions.authority.owner ||
      resumed.state?.generation !== operationOptions.authority.generation
    )
      return hold('replacement-writer-unverified')
    try {
      await bounded(() =>
        service.executeDelegatedOperation(
          operation,
          { ...operationOptions, expectedRevision: resumed.revision },
          dispatch,
        ),
      )
      effects.push('delegated-operation-submitted')
    } catch {
      effects.push('delegated-operation-uncertain')
      /* Source reconciliation owns ambiguous dispatch outcomes, including timeouts. */
    }
    const reconciled = await bounded(() =>
      service.reconcileDelegatedOperation({
        operationId: operation.id,
        authority: operationOptions.authority,
      }),
    )
    if (reconciled.state !== 'confirmed')
      return hold(
        reconciled.state === 'failed'
          ? 'replacement-operation-failed'
          : 'operation-outcome-unknown',
      )
    const final = await bounded(() => service.read())
    const actual = await bounded(() =>
      readback({ state: structuredClone(final.state), incident, operationId: operation.id }),
    )
    if (
      actual?.verified !== true ||
      actual.runId !== final.state.runId ||
      actual.revision !== final.state.revision ||
      actual.generation !== final.state.generation ||
      actual.operationId !== operation.id ||
      actual.incident !== incident ||
      !finite(actual.observedAt) ||
      actual.observedAt > currentTime() ||
      currentTime() - actual.observedAt > 60000 ||
      !sameTuple(actual.contract, replacementContract) ||
      !artifacts(actual.artifactDigests) ||
      recordDigest(actual.artifactDigests) !== recordDigest(evidence.artifactDigests)
    )
      return hold('replacement-readback-unverified')
    return {
      status: 'recovered',
      classification: classification.classification,
      runId: state.runId,
      generation: final.state.generation,
      operationId: operation.id,
      assurance: 'injected-host-source-verified',
      effects: [...effects],
    }
  } catch {
    return hold('source-recovery-or-reconciliation-held')
  }
}
