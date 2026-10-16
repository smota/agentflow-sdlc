// Async host boundary for already-advanced native source runs. This module never
// starts a run, advances a phase, transfers a writer, issues a grant, or owns a ledger.
import { operationDigest, normalizeOperation, safeKey } from '../../lib/core/delegation-grant.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
import { requireOracleCustodyReceipt } from '../../lib/core/oracle-custody.mjs'
import { resolveOracleDispatch } from './agentflow-product/oracle-admission.mjs'
import { evaluateOperationalPreflight } from './operational-preflight.mjs'
const equal = (a, b) => recordDigest({ value: a }) === recordDigest({ value: b })
const evidenceBinding = (snapshot, operation) => ({
  runId: snapshot.state.runId,
  runRevision: snapshot.revision,
  sourceRevision: snapshot.sourceRevision ?? snapshot.revision,
  generation: snapshot.state.generation,
  revocationEpoch: snapshot.state.revocationEpoch,
  operationDigest: operationDigest(operation),
})
async function bounded(fn, input, timeout = 1000) {
  let timer
  try {
    return structuredClone(
      await Promise.race([
        Promise.resolve().then(() => fn(structuredClone(input))),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Host port timeout')), timeout)
        }),
      ]),
    )
  } finally {
    clearTimeout(timer)
  }
}
function custody(snapshot) {
  const { state, events } = snapshot
  if (!state.oracleDigest) return []
  if (state.oraclePin?.oracleDigest !== state.oracleDigest) throw new Error('Oracle pin unverified')
  const receipts = Object.values(state.oracleCustody ?? {})
  if (!receipts.length) throw new Error('Oracle custody missing')
  for (const receipt of receipts) {
    const event = events.find(
      (e) => e.kind === 'oracle-custody-recorded' && e.payload.receipt?.digest === receipt.digest,
    )
    if (!event || !equal(event.payload.receipt, receipt))
      throw new Error('Oracle custody source missing')
    requireOracleCustodyReceipt(receipt, event.payload.request)
    if (
      receipt.runId !== state.runId ||
      receipt.goalRef !== state.goalRef ||
      receipt.oracleDigest !== state.oracleDigest ||
      receipt.candidateDigest !== state.candidateDigest ||
      receipt.generation !== state.generation ||
      receipt.revocationEpoch !== state.revocationEpoch ||
      event.previousDigest !== receipt.runRevision
    )
      throw new Error('Oracle custody stale')
  }
  return receipts.map((r) => r.digest).sort()
}
export async function executeNativeHandoff({
  service,
  operation,
  body,
  authority,
  grantId,
  host = {},
  nowMs,
  clock = Date.now,
  portTimeoutMs = 1000,
} = {}) {
  const result = (status, reason, extra = {}) => ({
    status: status === 'held' && sourceWriteStarted ? 'unknown' : status,
    accepted: false,
    reason,
    obligation: {
      owner: 'human/operator',
      action: 'reconcile-native-handoff',
      deadlineAt: Number.isFinite(nowMs) ? nowMs + 900000 : null,
    },
    ...extra,
  })
  let op,
    digest,
    snapshot,
    admitted = false,
    sourceWriteStarted = false
  try {
    const replayIdentity = operation?.id
    let suppliedOperation, suppliedAuthority
    try {
      suppliedOperation = structuredClone(operation)
      suppliedAuthority = structuredClone(authority)
    } catch {
      /* Discover any prior effect before rejecting malformed replay input. */
    }
    // Observe prior effects before validating mutable replay inputs or host ports.
    // Invalid new input cannot erase an existing source-owned obligation.
    if (typeof service?.read === 'function' && safeKey(replayIdentity)) {
      // A failed source read cannot prove absence of a prior admitted effect.
      sourceWriteStarted = true
      const prior = await service.read()
      sourceWriteStarted =
        !!prior.state?.admissions?.[replayIdentity] ||
        !!prior.state?.operations?.[replayIdentity] ||
        prior.events?.some(
          (event) =>
            event.kind === 'checkpoint' &&
            event.payload.kind === 'native-handoff-intent' &&
            event.payload.operationId === replayIdentity,
        )
    }
    op = normalizeOperation(suppliedOperation)
    authority = suppliedAuthority
    digest = operationDigest(op)
    const args = op.arguments
    if (
      !Number.isFinite(nowMs) ||
      !Number.isFinite(portTimeoutMs) ||
      portTimeoutMs < 1 ||
      portTimeoutMs > 30000 ||
      op.action !== 'queue:create' ||
      !op.capabilities.includes('queue:create') ||
      typeof body !== 'string' ||
      !body.trim() ||
      !safeKey(grantId) ||
      !service?.read ||
      typeof host.resolveTask !== 'function' ||
      typeof host.dispatchQueue !== 'function' ||
      typeof host.resolveOperationalPreflightInput !== 'function'
    )
      return result('held', 'native-handoff-ports-unavailable')
    const read = async () => {
      const current = await service.read(),
        state = current.state
      const event = current.events.find((e) => e.id === args.transitionId)
      if (
        !state ||
        state.status !== 'active' ||
        authority?.owner !== state.owner ||
        authority?.generation !== state.generation ||
        args.protocol !== 'native-handoff-v1' ||
        args.runId !== state.runId ||
        args.goalRef !== state.goalRef ||
        args.generation !== state.generation ||
        args.revocationEpoch !== state.revocationEpoch ||
        !Number.isSafeInteger(state.generation) ||
        state.generation < 0 ||
        !Number.isSafeInteger(state.revocationEpoch) ||
        state.revocationEpoch < 0 ||
        !event ||
        event.kind !== 'advanced' ||
        event.digest !== args.transitionDigest ||
        event.generation !== state.generation ||
        event.payload.from !== args.fromPhase ||
        event.payload.to !== args.toPhase ||
        state.phase !== args.toPhase ||
        op.candidateDigest !== state.candidateDigest ||
        event.payload.candidateDigest !== state.candidateDigest ||
        args.bodyDigest !== recordDigest({ body }) ||
        args.oracleDigest !== (state.oracleDigest ?? null) ||
        !equal(args.custodyDigests, custody(current))
      )
        throw new Error('Native source binding mismatch')
      return current
    }
    const inspect = async (current) => {
      const source = await bounded(
          host.resolveTask,
          { snapshot: current, operation: op },
          portTimeoutMs,
        ),
        task = source?.task,
        state = current.state
      if (
        source?.verified !== true ||
        !source.sourceRef ||
        source.sourceRevision !== (current.sourceRevision ?? current.revision) ||
        !task ||
        task.protocol !== 'run-v1' ||
        task.goal !== state.goalRef ||
        task.runId !== state.runId ||
        task.runRevision !== current.revision ||
        task.sourceRevision !== source.sourceRevision ||
        task.owner !== state.owner ||
        task.generation !== state.generation ||
        task.revocationEpoch !== state.revocationEpoch ||
        task.destination !== args.destination ||
        !equal(task.touchSurface?.slice().sort(), op.paths.slice().sort())
      )
        throw new Error('Native task binding mismatch')
      const resolvedAuthority =
        source.assignment && typeof host.resolveOracleAuthority === 'function'
          ? await bounded(
              host.resolveOracleAuthority,
              { task, assignment: source.assignment },
              portTimeoutMs,
            )
          : null
      const oracleNow = clock()
      if (!Number.isFinite(oracleNow) || oracleNow < nowMs)
        throw new Error('Oracle admission clock unverified')
      const admission = resolveOracleDispatch({
        deps: {
          resolveOracleTask: () => source,
          resolveOracleAuthority: () => resolvedAuthority,
        },
        request: { goal: state.goalRef, to: args.destination, oracleAssignment: source.assignment },
        now: new Date(oracleNow).toISOString(),
      })
      if (!admission.admitted) throw new Error('Oracle task admission held')
      if (
        admission.assignment &&
        (admission.assignment.custody.oracleDigest !== state.oracleDigest ||
          state.oracleCustody?.assignment?.identity !== admission.assignment.identity)
      )
        throw new Error('Oracle assignment differs from current native custody')
      const evidence = await bounded(
        host.resolveOperationalPreflightInput,
        { snapshot: current, operation: op, task },
        portTimeoutMs,
      )
      if (!evidence?.sourceRef || !equal(evidence.binding, evidenceBinding(current, op)))
        throw new Error('Runtime evidence belongs to different native source')
      const input = evidence.input
      const observedNow = clock()
      if (!Number.isFinite(observedNow) || observedNow < nowMs)
        throw new Error('Runtime evidence clock unverified')
      const [seat, rigName, ...other] = String(args.destination).split('@')
      if (
        other.length ||
        !seat ||
        !rigName ||
        input?.task?.rigName !== rigName ||
        input?.task?.owner !== state.owner ||
        !equal(input?.task?.requiredSeats, [seat]) ||
        !evaluateOperationalPreflight({ ...input, now: new Date(observedNow).toISOString() })
          .admitted
      )
        throw new Error('Runtime admission unverified')
      const latest = await service.read()
      if (
        latest.revision !== current.revision ||
        (latest.sourceRevision ?? latest.revision) !== source.sourceRevision
      )
        throw new Error('Source changed during admission')
      const expiry = admission.assignment ? Date.parse(source.assignment.expiresAt) : Infinity
      const finalNow = clock()
      if (
        !Number.isFinite(finalNow) ||
        finalNow < oracleNow ||
        (admission.assignment && (!Number.isFinite(expiry) || expiry <= finalNow))
      )
        throw new Error('Oracle assignment expired during admission')
      return expiry
    }
    snapshot = await read()
    sourceWriteStarted ||= !!snapshot.state.admissions[op.id]
    await inspect(snapshot)
    const existing = snapshot.state.admissions[op.id]
    if (existing && (existing.operationDigest !== digest || existing.grantId !== grantId))
      return result('held', 'operation-identity-conflict')
    const grant = await service.resolveGrant(grantId)
    if (!grant) return result('held', 'typed-queue-grant-unavailable')
    const anchors = snapshot.events.filter(
      (e) =>
        e.kind === 'checkpoint' &&
        e.payload.kind === 'native-handoff-intent' &&
        e.payload.operationId === op.id,
    )
    if (
      anchors.length > 1 ||
      anchors.some((e) => e.payload.operationDigest !== digest || e.payload.grantId !== grantId)
    )
      return result('held', 'handoff-anchor-conflict')
    if (!anchors.length) {
      if (existing) return result('held', 'handoff-anchor-missing')
      sourceWriteStarted = true
      await service.record(
        'checkpoint',
        {
          kind: 'native-handoff-intent',
          operationId: op.id,
          operationDigest: digest,
          grantId,
          transitionId: args.transitionId,
          transitionDigest: args.transitionDigest,
        },
        { expectedRevision: snapshot.revision, authority },
      )
    }
    snapshot = await read()
    await inspect(snapshot)
    if (!snapshot.state.admissions[op.id]) {
      sourceWriteStarted = true
      const dispatch = await service.executeDelegatedOperation(
        op,
        { expectedRevision: snapshot.revision, authority, grantId },
        async (persisted, receipt) => {
          const current = await read()
          const validUntil = await inspect(current)
          const ack = await bounded(
            (input) => {
              const dispatchNow = clock()
              if (!Number.isFinite(dispatchNow) || dispatchNow < nowMs || dispatchNow >= validUntil)
                throw new Error('Oracle assignment expired before dispatch')
              return host.dispatchQueue(input)
            },
            { operation: persisted, admission: receipt, body },
            portTimeoutMs,
          )
          if (
            ack?.qitemId !== op.id ||
            ack.destinationSession !== args.destination ||
            ack.createWarning
          )
            throw new Error('Queue outcome uncertain')
          return { qitemId: op.id }
        },
      )
      admitted = true
      if (dispatch.replayed)
        return result('unknown', 'admitted-operation-requires-reconciliation', {
          operationId: op.id,
        })
      const afterDispatch = await read()
      if (!['submitted', 'confirmed'].includes(afterDispatch.state.operations[op.id]?.state))
        return result('unknown', 'source-dispatch-state-unverified', { operationId: op.id })
      await inspect(afterDispatch)
      return result('submitted', 'queue-submitted-successor-unverified', { operationId: op.id })
    }
    admitted = true
    const reconciliation = await service.reconcileDelegatedOperation({
      operationId: op.id,
      authority,
    })
    if (reconciliation.state !== 'confirmed')
      return result(
        reconciliation.state === 'failed' && reconciliation.reconciliation?.queueAbsent === true
          ? 'held'
          : 'unknown',
        'queue-outcome-unverified',
        { operationId: op.id },
      )
    snapshot = await read()
    await inspect(snapshot)
    if (typeof host.verifySuccessorAcceptance !== 'function')
      return result('submitted', 'successor-acceptance-unverified', { operationId: op.id })
    const receipt = await bounded(
      host.verifySuccessorAcceptance,
      { snapshot, operation: op, operationDigest: digest },
      portTimeoutMs,
    )
    const checkedAt = clock()
    const at = Date.parse(receipt?.observedAt)
    if (
      receipt?.verified !== true ||
      receipt.accepted !== true ||
      receipt.operationId !== op.id ||
      receipt.qitemId !== op.id ||
      !equal(receipt.binding, evidenceBinding(snapshot, op)) ||
      receipt.operationDigest !== digest ||
      receipt.destination !== args.destination ||
      receipt.runId !== args.runId ||
      receipt.generation !== args.generation ||
      receipt.revocationEpoch !== args.revocationEpoch ||
      receipt.oracleDigest !== args.oracleDigest ||
      !equal(receipt.custodyDigests, args.custodyDigests) ||
      !Number.isFinite(at) ||
      !Number.isFinite(checkedAt) ||
      checkedAt < nowMs ||
      at > checkedAt ||
      checkedAt - at > 60000
    )
      return result('submitted', 'successor-acceptance-unverified', { operationId: op.id })
    const current = await read()
    if (
      current.revision !== snapshot.revision ||
      (current.sourceRevision ?? current.revision) !==
        (snapshot.sourceRevision ?? snapshot.revision)
    )
      return result('held', 'source-changed-before-acceptance')
    await inspect(current)
    const recorded = snapshot.events.filter(
      (e) =>
        e.kind === 'checkpoint' &&
        e.payload.kind === 'native-handoff-accepted' &&
        e.payload.operationId === op.id,
    )
    if (!recorded.length)
      await service.record(
        'checkpoint',
        { kind: 'native-handoff-accepted', operationId: op.id, operationDigest: digest, receipt },
        { expectedRevision: snapshot.revision, authority },
      )
    else if (
      recorded.length !== 1 ||
      recorded[0].payload.operationDigest !== digest ||
      ![
        'operationId',
        'operationDigest',
        'destination',
        'runId',
        'generation',
        'revocationEpoch',
        'oracleDigest',
        'custodyDigests',
      ].every((key) => equal(recorded[0].payload.receipt?.[key], receipt[key]))
    )
      return result('held', 'successor-acceptance-conflict')
    return result('accepted', 'successor-custody-verified', {
      accepted: true,
      operationId: op.id,
      obligation: null,
    })
  } catch {
    // A service append may have succeeded even when its acknowledgement failed.
    // The next invocation inspects the existing operation ID, never retries blindly.
    return result(
      admitted || sourceWriteStarted ? 'unknown' : 'held',
      'native-handoff-requires-source-reconciliation',
      { ...(op ? { operationId: op.id } : {}) },
    )
  }
}
