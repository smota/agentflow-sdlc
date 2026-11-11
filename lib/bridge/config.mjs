// Bridge configuration (#582): `adapters.openrig.bridge` in the project configuration. The rig is
// optional; with no bridge or no rig configured every bridge command is a no-op that says so.
import { PHASES } from '../core/phase-graph.mjs'
import { readyPredicateProblems } from '../core/ready-predicate.mjs'
import { loadAuthoritativeConfigs } from '../config/authority.mjs'

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

// Normalizes a configured bridge. `rig` is shorthand for { control: rig, delivery: [rig] }.
export function normalizeBridgeConfig(raw) {
  const delivery = deliveryRigs(raw)
  const control = nonEmpty(raw?.rigs?.control) ? raw.rigs.control : delivery[0]
  return {
    rig: delivery[0],
    rigs: { control, delivery },
    source: raw?.source ?? null,
    ready: raw?.ready ?? DEFAULT_READY_PREDICATE,
    entrySeat: raw?.entrySeat ?? DEFAULT_ENTRY_SEAT,
    workflowSpec: raw?.workflowSpec ?? DEFAULT_WORKFLOW_SPEC,
    worktrees: raw?.worktrees ?? null,
    escalateTo: raw?.escalateTo ?? null,
    maxOpenGates: raw?.maxOpenGates ?? null,
  }
}

export function bridgeConfigProblems(config) {
  const problems = []
  if (!config.rig) problems.push('adapters.openrig.bridge.rig is required')
  // Several delivery rigs on one project need the offer and claim rules of #586.
  if (config.rigs.delivery.length > 1) {
    problems.push(
      'several delivery rigs (adapters.openrig.bridge.rigs.delivery) are not supported yet; configure one rig',
    )
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
