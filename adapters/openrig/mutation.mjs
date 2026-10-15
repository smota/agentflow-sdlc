// Bounded rig mutation adapter. Durable operation state remains exclusively in
// the existing run service; host readers/dispatchers must bind real source data.
import { createHash } from 'node:crypto'
import { planRigExecution } from './execution-plan.mjs'
import {
  requireDeliveryRecord,
  sealDeliveryRecord,
  requireDigest,
  requireText,
} from '../../lib/core/delivery-record.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
import { operationDigest, normalizeOperation } from '../../lib/core/delegation-grant.mjs'
import { fingerprintCandidate } from '../../lib/verification/workspace.mjs'
import { inspectProcessRuntime } from '../../lib/verification/process-collector.mjs'

export const REQUIRED_RUNTIME_MUTATION_GUARDS = Object.freeze([
  'source-revision-cas',
  'occupant-cas',
  'executor-digest',
])
const FIELDS = [
  'runtime',
  'executionTarget',
  'providerRoute',
  'providerFamily',
  'model',
  'effort',
  'profile',
  'capabilityTier',
]
const textDigest = (text) => createHash('sha256').update(text).digest('hex')
export function fingerprintRigMutationHost({ root, executable, inputs, context = {} }) {
  return {
    workspaceDigest: fingerprintCandidate(root, { inputs, context }).digest,
    executorIdentity: inspectProcessRuntime(root, { executable }).identity,
  }
}
function frozen(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen)
    Object.freeze(value)
  }
  return value
}
function tuple(contract) {
  return Object.fromEntries(FIELDS.map((field) => [field, contract?.[field] ?? null]))
}
function preservation(workflow) {
  if (workflow?.protocol !== 'run-v1')
    throw new Error('Supported current run-v1 workflow source binding required')
  for (const field of ['runId', 'owner', 'revision', 'sourceRevision'])
    requireText(workflow[field], `workflow.${field}`)
  for (const field of ['generation', 'revocationEpoch'])
    if (!Number.isSafeInteger(workflow[field]) || workflow[field] < 0)
      throw new Error(`Invalid native workflow ${field}`)
  if (!Array.isArray(workflow.publicationHolds))
    throw new Error('Source publication holds must be explicit')
  if (!Object.hasOwn(workflow, 'oracleDigest') || !Object.hasOwn(workflow, 'custody'))
    throw new Error(
      'Source oracle/custody state must be explicit; pin role does not establish custody',
    )
  if (workflow.oracleDigest !== null) {
    requireDigest(workflow.oracleDigest, 'oracleDigest')
    if (
      !workflow.custody ||
      typeof workflow.custody !== 'object' ||
      Array.isArray(workflow.custody) ||
      Object.keys(workflow.custody).some((key) => !['author', 'assignment'].includes(key))
    )
      throw new Error('Pinned oracle custody remains unknown or malformed')
    const receipts = Object.entries(workflow.custody).filter(([, receipt]) => receipt !== null)
    if (!receipts.length) throw new Error('Pinned oracle custody has no source receipt')
    for (const [kind, receipt] of receipts) {
      requireDeliveryRecord(receipt, 'oracle-custody-receipt')
      const mode = kind === 'author' ? 'historical-author' : 'prospective-assignment'
      if (
        receipt.mode !== mode ||
        !receipt.identity ||
        (kind === 'author' ? receipt.authorIdentity : receipt.assigneeIdentity) !==
          receipt.identity ||
        receipt.runId !== workflow.runId ||
        receipt.generation !== workflow.generation ||
        receipt.revocationEpoch !== workflow.revocationEpoch ||
        receipt.oracleDigest !== workflow.oracleDigest
      )
        throw new Error('Oracle custody receipt does not match native workflow identity')
    }
  } else if (workflow.custody !== null) {
    throw new Error('Oracle custody must be explicitly absent when no oracle is pinned')
  }
  requireDigest(workflow.checkpointDigest, 'checkpointDigest')
  return structuredClone(
    Object.fromEntries(
      [
        'protocol',
        'runId',
        'owner',
        'generation',
        'revocationEpoch',
        'oracleDigest',
        'custody',
        'checkpointDigest',
        'publicationHolds',
      ].map((field) => [field, workflow[field]]),
    ),
  )
}
function makePlan({
  rigName,
  installed,
  afterRigText,
  afterContracts,
  workflow,
  executorIdentity = null,
  mode = 'apply',
  originalPlanDigest = null,
}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(rigName ?? ''))
    throw new Error('Stable rig name required')
  if (
    typeof installed?.rigText !== 'string' ||
    !Array.isArray(installed.contracts) ||
    typeof afterRigText !== 'string' ||
    !Array.isArray(afterContracts)
  )
    throw new Error('Installed and desired rig text/contracts required')
  requireText(installed.sourceRevision, 'installed.sourceRevision')
  if (executorIdentity !== null) requireDeliveryRecord(executorIdentity, 'execution-context')
  const previous = new Map(installed.contracts.map((contract) => [contract.seat, contract]))
  const next = new Map(afterContracts.map((contract) => [contract.seat, contract]))
  if (previous.size !== installed.contracts.length || next.size !== afterContracts.length)
    throw new Error('Duplicate contract seat')
  const changes = []
  const admissionHolds = []
  let preserved = null
  try {
    preserved = preservation(workflow)
  } catch (error) {
    admissionHolds.push({ code: 'WORKFLOW_SOURCE_UNAVAILABLE', reason: error.message })
  }
  if (!executorIdentity)
    admissionHolds.push({
      code: 'EXECUTOR_OBSERVATION_UNSUPPORTED',
      reason: 'Read-only preview: actual mutation executable has not been fingerprinted',
    })
  for (const seat of [...new Set([...previous.keys(), ...next.keys()])].sort()) {
    const before = previous.get(seat),
      after = next.get(seat)
    const fields = {}
    for (const field of FIELDS)
      if ((before?.[field] ?? null) !== (after?.[field] ?? null))
        fields[field] = { before: before?.[field] ?? null, after: after?.[field] ?? null }
    if (Object.keys(fields).length || !before || !after)
      changes.push({
        seat,
        fields,
        before: before ? tuple(before) : null,
        after: after ? tuple(after) : null,
        previousOccupant: structuredClone(installed.occupants?.[seat] ?? null),
      })
  }
  return frozen(
    sealDeliveryRecord('rig-mutation-plan', {
      rigName,
      mode,
      originalPlanDigest,
      specPath: `.openrig/specs/${rigName}/rig.yaml`,
      sourceRevision: installed.sourceRevision,
      workflowAnchor: workflow
        ? { revision: workflow.revision ?? null, sourceRevision: workflow.sourceRevision ?? null }
        : null,
      preservation: preserved,
      admissionHolds,
      beforeDigest: textDigest(installed.rigText),
      afterDigest: textDigest(afterRigText),
      beforeRigText: installed.rigText,
      afterRigText,
      beforeContracts: structuredClone(installed.contracts),
      afterContracts: structuredClone(afterContracts),
      changes,
      affectedSeats: changes.map((change) => change.seat),
      restarts: changes.filter((change) => change.after).map((change) => change.seat),
      requiredActions: ['rig:mutate'],
      requiredPermissions: ['write-installed-spec', 'stop-bound-writer', 'restart-affected-seats'],
      requiredRuntimeGuards: [...REQUIRED_RUNTIME_MUTATION_GUARDS],
      executorIdentity: structuredClone(executorIdentity),
      effects: [],
      rollback: {
        strategy: 'separately-authorized-compensating-operation',
        restoresWorkflowHistory: false,
        restoreConfigDigest: textDigest(installed.rigText),
        preserveCurrentAuthorityAndCustody: true,
      },
      operationalStatus: executorIdentity
        ? 'host-source-and-runtime-readers-required'
        : 'unsupported-executor-observation',
    }),
  )
}
export function planRigMutation({
  rigName,
  desired,
  installed,
  workflow,
  executorIdentity = null,
}) {
  const resolved = planRigExecution(desired)
  if (!resolved.ok)
    throw new Error(
      `Execution contract invalid: ${resolved.diagnostics.map((item) => item.message).join('; ')}`,
    )
  return makePlan({
    rigName,
    installed,
    afterRigText: resolved.rigText,
    afterContracts: resolved.contracts,
    workflow,
    executorIdentity,
  })
}
export function planRigRollback({ originalPlan, installed, workflow, executorIdentity = null }) {
  requireDeliveryRecord(originalPlan, 'rig-mutation-plan')
  return makePlan({
    rigName: originalPlan.rigName,
    installed,
    afterRigText: originalPlan.beforeRigText,
    afterContracts: originalPlan.beforeContracts,
    workflow,
    executorIdentity,
    mode: 'rollback',
    originalPlanDigest: originalPlan.digest,
  })
}
function mutationArguments(plan) {
  return {
    rigName: plan.rigName,
    mode: plan.mode,
    mutationPlanDigest: plan.digest,
    originalPlanDigest: plan.originalPlanDigest,
    expectedConfigDigest: plan.beforeDigest,
    desiredConfigDigest: plan.afterDigest,
    desiredContractsDigest: recordDigest({
      contracts: plan.afterContracts.map((contract) => ({
        seat: contract.seat,
        ...tuple(contract),
      })),
    }),
    affectedSeats: [...plan.affectedSeats],
    restarts: [...plan.restarts],
    preservationDigest: recordDigest({ preservation: plan.preservation }),
    executorIdentityDigest: plan.executorIdentity?.digest ?? null,
    expectedSourceRevision: plan.sourceRevision,
    expectedOccupants: Object.fromEntries(
      plan.changes.map((change) => [change.seat, change.previousOccupant]),
    ),
  }
}
export function createRigMutationOperation({ plan, ...envelope }) {
  requireDeliveryRecord(plan, 'rig-mutation-plan')
  return normalizeOperation({
    ...envelope,
    action: 'rig:mutate',
    planDigest: plan.digest,
    paths: [plan.specPath],
    capabilities: ['rig:mutate'],
    arguments: mutationArguments(plan),
  })
}
function validateOperation(plan, operation) {
  requireDeliveryRecord(plan, 'rig-mutation-plan')
  normalizeOperation(operation)
  if (
    operation.action !== 'rig:mutate' ||
    operation.planDigest !== plan.digest ||
    recordDigest({ paths: operation.paths }) !== recordDigest({ paths: [plan.specPath] }) ||
    recordDigest({ args: operation.arguments }) !== recordDigest({ args: mutationArguments(plan) })
  )
    throw new Error('Mutation operation does not match the exact sealed plan and destination')
}
async function inspectCurrent({ plan, runService, inspectContext, operation }) {
  if (typeof inspectContext !== 'function')
    throw new Error('Trusted current host source inspector required')
  const context = await inspectContext({
    plan: structuredClone(plan),
    operation: structuredClone(operation),
  })
  const snapshot = await runService.read()
  const state = snapshot.state
  if (
    context?.verified !== true ||
    !context.sourceRef ||
    !context.sourceRevision ||
    !state ||
    context.workflow?.revision !== snapshot.revision ||
    context.workflow?.sourceRevision !== snapshot.sourceRevision ||
    context.workflow?.runId !== state.runId ||
    context.workflow?.owner !== state.owner ||
    context.workflow?.generation !== state.generation ||
    context.workflow?.revocationEpoch !== state.revocationEpoch ||
    context.workflow?.oracleDigest !== state.oracleDigest
  )
    throw new Error('Current host source/workflow binding unavailable or changed')
  if (context.workspaceDigest !== operation.workspaceDigest)
    throw new Error('Current artifact/workspace fingerprint changed or is unknown')
  if (
    recordDigest({ custody: context.workflow.custody }) !==
    recordDigest({ custody: state.oracleCustody ?? null })
  )
    throw new Error('Oracle custody differs from the canonical source run projection')
  if (
    context.sourceRevision !== plan.sourceRevision ||
    typeof context.installedRigText !== 'string' ||
    textDigest(context.installedRigText) !== plan.beforeDigest
  )
    throw new Error('Installed configuration changed; mutation plan is stale')
  if (
    recordDigest({ preservation: preservation(context.workflow) }) !==
    recordDigest({ preservation: plan.preservation })
  )
    throw new Error('Workflow authority/custody/publication holds changed; replan')
  if (
    context.checkpoint?.verified !== true ||
    context.checkpoint.digest !== plan.preservation.checkpointDigest ||
    !context.checkpoint.sourceRef ||
    context.priorWriters?.stopped !== true ||
    !context.priorWriters.sourceRef
  )
    throw new Error('Verified checkpoint/custody and stopped prior writer evidence required')
  if (!plan.executorIdentity || !context.executorIdentity)
    throw new Error('Executor observation unsupported; preview only')
  requireDeliveryRecord(context.executorIdentity, 'execution-context')
  if (context.executorIdentity.digest !== plan.executorIdentity.digest)
    throw new Error('Mutation executable changed; replan')
  for (const change of plan.changes)
    if (
      change.before &&
      change.after &&
      (!change.previousOccupant?.sessionId || change.previousOccupant.generation === undefined)
    )
      throw new Error('Previous occupant observation unavailable; preview only')
  for (const change of plan.changes) {
    const current = context.occupants?.[change.seat] ?? null
    if (recordDigest({ occupant: current }) !== recordDigest({ occupant: change.previousOccupant }))
      throw new Error('Current incumbent occupant changed; replan')
  }
  const guards = context.runtimeGuards
  if (
    !guards?.sourceRef ||
    !guards.sourceRevision ||
    !guards.version ||
    !Array.isArray(guards.capabilities) ||
    REQUIRED_RUNTIME_MUTATION_GUARDS.some((guard) => !guards.capabilities.includes(guard))
  )
    throw new Error('Atomic runtime mutation guard capabilities unavailable; preview only')
  return snapshot
}
export async function applyRigMutation({
  plan,
  runService,
  operation,
  authority,
  grantId,
  inspectContext,
  dispatch,
}) {
  plan = structuredClone(plan)
  operation = structuredClone(operation)
  authority = structuredClone(authority)
  validateOperation(plan, operation)
  if (plan.admissionHolds?.length || !plan.preservation)
    throw new Error('Mutation preview is held: source workflow/executor observation unavailable')
  if (typeof dispatch !== 'function') throw new Error('Bounded host mutation dispatcher required')
  const snapshot = await runService.read()
  const admitted = snapshot.state?.admissions?.[operation.id]
  if (admitted) {
    if (admitted.operationDigest !== operationDigest(operation))
      throw new Error('Conflicting mutation operation ID')
    return {
      status: 'reconciliation-required',
      operationId: operation.id,
      effects: [],
      replayed: true,
    }
  }
  if (plan.mode === 'rollback') {
    const originals = Object.values(snapshot.state?.admissions ?? {}).filter(
      (entry) =>
        entry.operation?.action === 'rig:mutate' &&
        entry.operation.planDigest === plan.originalPlanDigest &&
        entry.operation.arguments.rigName === plan.rigName,
    )
    if (
      !originals.length ||
      originals.some(
        (entry) =>
          !['confirmed', 'failed'].includes(snapshot.state.operations?.[entry.operation.id]?.state),
      )
    )
      throw new Error(
        'Exact original mutation must be reconciled to a terminal state before rollback',
      )
    if (
      originals.some((entry) => entry.operation.arguments.expectedConfigDigest !== plan.afterDigest)
    )
      throw new Error('Rollback target does not match the source original preimage')
  }
  const current = await inspectCurrent({ plan, runService, inspectContext, operation })
  try {
    const result = await runService.executeDelegatedOperation(
      operation,
      { expectedRevision: current.revision, authority, grantId },
      async (persisted, receipt) => {
        validateOperation(plan, persisted)
        await inspectCurrent({ plan, runService, inspectContext, operation: persisted })
        return dispatch(structuredClone(persisted), structuredClone(receipt))
      },
    )
    return {
      status: result.replayed ? 'reconciliation-required' : 'submitted',
      operationId: operation.id,
      requiresObservation: true,
      replayed: result.replayed === true,
    }
  } catch (error) {
    const latest = await runService.read()
    if (!latest.state?.admissions?.[operation.id]) throw error
    return {
      status: 'unknown',
      operationId: operation.id,
      reason: 'Admitted operation requires source reconciliation before retry',
      requiresObservation: true,
    }
  }
}
export function createRigMutationReconciler({
  plan,
  observeRuntime,
  clock = () => new Date().toISOString(),
  maxAgeMs = 60000,
}) {
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1)
    throw new Error('Bounded runtime observation freshness required')
  return async (pending, admission) => {
    if (!plan || typeof observeRuntime !== 'function')
      return { verified: false, state: 'unknown', reason: 'Runtime observation unsupported' }
    validateOperation(plan, admission.operation)
    const observation = await observeRuntime({
      plan: structuredClone(plan),
      operation: structuredClone(admission.operation),
      pending: structuredClone(pending),
    })
    const unknown = (reason) => ({ verified: false, state: 'unknown', reason })
    const age = Date.parse(clock()) - Date.parse(observation?.observedAt)
    if (
      observation?.verified !== true ||
      !observation.sourceRef ||
      !observation.sourceRevision ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > maxAgeMs ||
      observation.rigName !== plan.rigName
    )
      return unknown('Fresh source-bound runtime readback unavailable')
    const operation = admission.operation
    if (
      observation.operationId !== operation.id ||
      observation.payloadDigest !== operationDigest(operation)
    )
      return unknown('Runtime readback is not bound to this exact admitted operation')
    const outcome = {
      verified: true,
      operationId: operation.id,
      payloadDigest: operationDigest(operation),
      candidateDigest: operation.candidateDigest,
      sourceRevision: observation.sourceRevision,
      sourceRef: observation.sourceRef,
      observedAt: observation.observedAt,
      observationDigest: recordDigest({ observation }),
    }
    if (
      observation.outcome === 'failed' &&
      observation.operationId === operation.id &&
      observation.payloadDigest === outcome.payloadDigest
    )
      return {
        ...outcome,
        state: 'failed',
        recovery: plan.mode === 'rollback' ? 'rollback-failed' : 'compensating-operation-required',
        observedEffectsRef: observation.sourceRef,
        observedEffectCount: Array.isArray(observation.effects) ? observation.effects.length : 0,
        observedEffectsDigest: recordDigest({ effects: observation.effects ?? [] }),
      }
    if (
      observation.configDigest !== plan.afterDigest ||
      recordDigest({ preservation: observation.preservation }) !==
        recordDigest({ preservation: plan.preservation }) ||
      !Array.isArray(observation.entries) ||
      observation.complete !== true
    )
      return unknown('Desired config or preserved authority/custody has not been observed')
    if (observation.entries.some((entry) => !entry || typeof entry.seat !== 'string'))
      return unknown('Malformed runtime occupant readback')
    const entries = new Map(observation.entries.map((entry) => [entry.seat, entry]))
    if (entries.size !== observation.entries.length)
      return unknown('Ambiguous duplicate runtime occupants')
    if (
      observation.entries.some(
        (entry) => !plan.afterContracts.some((contract) => contract.seat === entry.seat),
      )
    )
      return unknown('Unexpected unplanned runtime occupant')
    for (const contract of plan.afterContracts) {
      const actual = entries.get(contract.seat)
      if (
        !actual ||
        recordDigest({ tuple: tuple(actual) }) !== recordDigest({ tuple: tuple(contract) }) ||
        !actual.sessionId ||
        actual.generation === undefined ||
        actual.processReady !== true ||
        actual.catchupVerified !== true
      )
        return unknown('Actual execution contract/usable occupant has not been verified')
    }
    for (const change of plan.changes) {
      const actual = entries.get(change.seat)
      if (!change.after && (observation.complete !== true || actual))
        return unknown('Removed seat absence is not established')
      if (
        change.after &&
        change.previousOccupant &&
        actual?.sessionId === change.previousOccupant.sessionId &&
        actual?.generation === change.previousOccupant.generation
      )
        return unknown('Required seat replacement has not been observed')
    }
    return {
      ...outcome,
      state: 'confirmed',
      recovery: plan.mode === 'rollback' ? 'rollback-verified' : 'applied-and-observed',
    }
  }
}
export async function reconcileRigMutation({ plan, runService, operationId, authority }) {
  requireDeliveryRecord(plan, 'rig-mutation-plan')
  const snapshot = await runService.read()
  const admission = snapshot.state?.admissions?.[operationId]
  if (!admission) throw new Error('Admitted source mutation operation required')
  validateOperation(plan, admission.operation)
  const result = await runService.reconcileDelegatedOperation({ operationId, authority })
  return {
    status: result.state,
    operationId,
    recovery:
      result.reconciliation?.recovery ??
      (plan.mode === 'rollback' ? 'rollback-unknown' : 'observation-required'),
    requiresObservation: result.state === 'unknown',
  }
}
