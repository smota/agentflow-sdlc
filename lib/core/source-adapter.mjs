import { createHash } from 'node:crypto'

export const SOURCE_ADAPTER_VERSION = 1
export const SOURCE_CAPABILITIES = [
  'read-artifacts',
  'read-lifecycle',
  'mutate-comments',
  'mutate-artifacts',
  'mutate-lifecycle',
  // Optional capabilities added within version 1 (#580). An adapter that does not declare one is
  // still a valid version 1 adapter; callers probe with sourceCapability/callSourceCapability.
  'claim',
  'ready-predicates',
  'watch',
  'resolve-humans',
  // Decision entries for roster review gates (#602): the source's own comment records with the
  // source-authenticated writer and an edit state. Absent means the source cannot attest a
  // decision, so a gate that needs one stays open.
  'log-entries',
]
export const READY_PREDICATE_KINDS = ['label', 'status', 'lifecycle']
export const CAPABILITY_METHODS = {
  claim: ['claim', 'release', 'readClaim'],
  'ready-predicates': ['readWorkItem', 'listWorkItems', 'toReference'],
  watch: ['watch'],
  'resolve-humans': ['resolveHumans'],
  'log-entries': ['readLogEntries'],
}

export function validateSourceAdapter(adapter) {
  const errors = []
  if (adapter?.version !== SOURCE_ADAPTER_VERSION) errors.push('source adapter version must be 1')
  if (!adapter?.id) errors.push('source adapter id is required')
  if (!Array.isArray(adapter?.capabilities))
    errors.push('source adapter capabilities must be an array')
  for (const capability of adapter?.capabilities ?? []) {
    if (!SOURCE_CAPABILITIES.includes(capability))
      errors.push(`unsupported source capability: ${capability}`)
  }
  if (typeof adapter?.readArtifact !== 'function') errors.push('readArtifact() is required')
  if (adapter?.capabilities?.some((item) => item.startsWith('mutate-'))) {
    for (const method of ['previewMutation', 'applyMutation', 'flushReceipt']) {
      if (typeof adapter?.[method] !== 'function')
        errors.push(`${method}() is required for mutation`)
    }
  }
  const declared = Array.isArray(adapter?.capabilities) ? adapter.capabilities : []
  for (const capability of declared) {
    for (const method of CAPABILITY_METHODS[capability] ?? []) {
      if (typeof adapter?.[method] !== 'function')
        errors.push(`${method}() is required for ${capability}`)
    }
  }
  if (declared.includes('ready-predicates')) {
    const kinds = adapter?.readyPredicateKinds
    if (!Array.isArray(kinds) || kinds.length === 0) {
      errors.push('ready-predicates requires a non-empty readyPredicateKinds')
    } else {
      for (const kind of kinds) {
        if (!READY_PREDICATE_KINDS.includes(kind))
          errors.push(`unsupported ready predicate kind: ${kind}`)
      }
    }
  }
  if (declared.includes('claim')) {
    if (!declared.includes('mutate-comments')) errors.push('claim requires mutate-comments')
    if (typeof adapter?.claimMirror !== 'string' || adapter.claimMirror.length === 0)
      errors.push('claim requires a claimMirror name')
  }
  return { ok: errors.length === 0, errors }
}

// Non-throwing probe for an optional capability. Absence is an answer, not a failure: the caller
// decides what to do without it. An unknown capability name is a programming error and throws.
export function sourceCapability(adapter, capability) {
  if (!SOURCE_CAPABILITIES.includes(capability)) {
    throw new Error(`unknown source capability: ${capability}`)
  }
  if (Array.isArray(adapter?.capabilities) && adapter.capabilities.includes(capability)) {
    return { available: true }
  }
  return {
    available: false,
    status: 'capability-absent',
    capability,
    adapter: adapter?.id ?? null,
  }
}

export function isCapabilityAbsent(value) {
  return value?.status === 'capability-absent' && value?.available === false
}

// Calls a capability method. An absent capability returns the capability-absent result; a method
// that throws (the source failed) propagates, so a failure is never mistaken for absence.
export async function callSourceCapability(adapter, capability, method, ...args) {
  const probe = sourceCapability(adapter, capability)
  if (isCapabilityAbsent(probe)) return probe
  const methods = CAPABILITY_METHODS[capability]
  if (methods && !methods.includes(method)) {
    throw new Error(`${method}() is not a ${capability} method`)
  }
  if (typeof adapter[method] !== 'function') {
    throw new Error(`source adapter ${adapter.id} declares ${capability} but has no ${method}()`)
  }
  return adapter[method](...args)
}

// What the adapter allows the rig layer to do. Without a source claim ledger, only one delivery
// rig may take work from this source, because nothing else stops two rigs taking the same item.
export function describeSourceLimits(adapter) {
  if (sourceCapability(adapter, 'claim').available) return { maxDeliveryRigs: null, reasons: [] }
  return {
    maxDeliveryRigs: 1,
    reasons: [`source adapter ${adapter?.id ?? 'unknown'} does not declare claim`],
  }
}

export function requireSourceMutation(adapter, capability, boundary) {
  if (!adapter.capabilities.includes(capability)) {
    throw new Error(`source adapter ${adapter.id} does not provide ${capability}`)
  }
  if (!['open-pr', 'external-action'].includes(boundary?.effective)) {
    throw new Error(`${capability} requires an open-pr or external-action boundary`)
  }
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function createSourceMutationPlan({
  adapter,
  scope,
  capability,
  operation,
  parameters,
  actionBoundary,
  expectedRevision,
  idempotencyKey,
}) {
  requireSourceMutation(adapter, capability, actionBoundary)
  if (!operation || !idempotencyKey) throw new Error('operation and idempotencyKey are required')
  if (!expectedRevision) throw new Error('source mutation preview requires an expected revision')
  const base = {
    version: 1,
    adapter: adapter.id,
    scope,
    capability,
    operation,
    parameters,
    actionBoundary,
    expectedRevision,
    idempotencyKey,
  }
  return { ...base, token: digest(base) }
}

export function validateSourceMutationPlan(plan, adapter, confirm) {
  if (plan?.version !== 1 || plan?.adapter !== adapter.id) {
    throw new Error('source mutation plan does not match the adapter')
  }
  const { token, ...base } = plan
  if (confirm !== token || digest(base) !== token) {
    throw new Error('source mutation confirmation or plan digest is invalid')
  }
  requireSourceMutation(adapter, plan.capability, plan.actionBoundary)
}

export function createSourceMutationReceipt(plan, result, observedRevision) {
  const base = {
    version: 1,
    adapter: plan.adapter,
    scope: plan.scope,
    operation: plan.operation,
    planToken: plan.token,
    idempotencyKey: plan.idempotencyKey,
    expectedRevision: plan.expectedRevision,
    observedRevision,
    result,
    status: 'applied',
  }
  return { ...base, receiptToken: digest(base) }
}

export function sourceMutationIdempotencyKey(operation, parameters) {
  return digest({ operation, parameters })
}
