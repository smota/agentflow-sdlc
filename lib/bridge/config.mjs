// Bridge configuration (#582): `adapters.openrig.bridge` in the project configuration. The rig is
// optional; with no bridge or no rig configured every bridge command is a no-op that says so.
import { PHASES } from '../core/phase-graph.mjs'
import { readyPredicateProblems } from '../core/ready-predicate.mjs'
import { loadAuthoritativeConfigs } from '../config/authority.mjs'
import { describeSourceLimits } from '../core/source-adapter.mjs'
import { partitionProblems } from './partition.mjs'

export const NO_RIG_MESSAGE =
  'No OpenRig rig is configured for this project (adapters.openrig.bridge.rig). Nothing was queued.'
export const DEFAULT_READY_PREDICATE = {
  all: [
    { kind: 'label', has: 'agentflow:ready' },
    { kind: 'lifecycle', state: 'open' },
  ],
}
export const DEFAULT_ENTRY_SEAT = 'pm.analyst'
export const DEFAULT_WORKFLOW_SPEC =
  'adapters/openrig/agentflow/workflows/agentflow-delivery.workflow.yaml'

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

// The raw bridge object, or null. Reading never constructs a source adapter and never calls rig.
export function readBridgeSection(targetDir) {
  const loaded = loadAuthoritativeConfigs(targetDir)
  const bridge = loaded.adapters?.openrig?.bridge
  return bridge && typeof bridge === 'object' && !Array.isArray(bridge) ? bridge : null
}

function deliveryRigs(raw) {
  const rigs = raw?.rigs?.delivery
  if (Array.isArray(rigs) && rigs.length) return rigs.filter(nonEmpty)
  return nonEmpty(raw?.rig) ? [raw.rig] : []
}

// "No rig configured" ⇔ bridge absent, or both `rig` and `rigs.delivery` empty.
export function isRigConfigured(raw) {
  return Boolean(raw) && deliveryRigs(raw).length > 0
}

export function entryPhaseFor(seat) {
  return PHASES.find((spec) => (spec.seats ?? [spec.seat]).includes(seat))?.phase ?? null
}

function evidenceWriters(source) {
  for (const list of [source?.evidenceWriters, source?.claimWriters]) {
    if (Array.isArray(list) && list.length) return list.filter(nonEmpty)
  }
  return []
}

// Normalizes a configured bridge. `rig` is shorthand for { control: rig, delivery: [rig] }.
export function normalizeBridgeConfig(raw) {
  const delivery = deliveryRigs(raw)
  const control = nonEmpty(raw?.rigs?.control) ? raw.rigs.control : delivery[0]
  return {
    rig: delivery[0],
    rigs: { control, delivery },
    source: raw?.source ?? null,
    // Writers whose role-pass evidence counts. Defaults to the claim writers; with neither, no
    // evidence is trusted and every decision starts from none.
    evidenceWriters: evidenceWriters(raw?.source),
    ready: raw?.ready ?? DEFAULT_READY_PREDICATE,
    entrySeat: raw?.entrySeat ?? DEFAULT_ENTRY_SEAT,
    workflowSpec: raw?.workflowSpec ?? DEFAULT_WORKFLOW_SPEC,
    worktrees: raw?.worktrees ?? null,
    escalateTo: raw?.escalateTo ?? null,
    // Several delivery rigs (#586): which rigs an item is offered to, and the open-gate cap used
    // when the project has no team roster.
    partition: raw?.partition ?? null,
    maxOpenGates: raw?.maxOpenGates ?? null,
  }
}

export function bridgeConfigProblems(config) {
  const problems = []
  if (!config.rig) problems.push('adapters.openrig.bridge.rig is required')
  if (new Set(config.rigs.delivery).size !== config.rigs.delivery.length) {
    problems.push('adapters.openrig.bridge.rigs.delivery lists a rig more than once')
  }
  for (const problem of partitionProblems(config.partition, config.rigs.delivery)) {
    problems.push(`adapters.openrig.bridge.partition: ${problem}`)
  }
  if (
    config.maxOpenGates !== null &&
    (!Number.isInteger(config.maxOpenGates) || config.maxOpenGates < 1)
  ) {
    problems.push('adapters.openrig.bridge.maxOpenGates must be an integer of at least 1')
  }
  if (!config.source || !nonEmpty(config.source.adapter)) {
    problems.push('adapters.openrig.bridge.source.adapter is required')
  }
  for (const problem of readyPredicateProblems(config.ready)) {
    problems.push(`adapters.openrig.bridge.ready: ${problem}`)
  }
  if (entryPhaseFor(config.entrySeat) === null) {
    problems.push(`adapters.openrig.bridge.entrySeat ${config.entrySeat} owns no phase`)
  }
  return problems
}

// { status: 'no-rig' } | { status: 'invalid', problems } | { status: 'configured', config }
export function loadBridgeConfig(targetDir) {
  const raw = readBridgeSection(targetDir)
  if (!isRigConfigured(raw)) return { status: 'no-rig' }
  const config = normalizeBridgeConfig(raw)
  const problems = bridgeConfigProblems(config)
  return problems.length
    ? { status: 'invalid', problems, config }
    : { status: 'configured', config }
}

// Several delivery rigs coordinate only through source claims, so the source must declare `claim`
// (#586). Checked once the adapter exists; [] when the configuration is fine for this source.
export function deliveryRigProblems(config, source) {
  if (config.rigs.delivery.length <= 1) return []
  const limits = describeSourceLimits(source)
  if (limits.maxDeliveryRigs === null || limits.maxDeliveryRigs >= config.rigs.delivery.length) {
    return []
  }
  return [
    `${config.rigs.delivery.length} delivery rigs are configured but the source allows ${limits.maxDeliveryRigs}: ${limits.reasons.join('; ')}`,
  ]
}
