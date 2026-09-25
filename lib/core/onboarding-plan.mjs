import { recordDigest, hasCurrentDigest } from './record-digest.mjs'

export { recordDigest, hasCurrentDigest }

export function buildOnboardingPlan({
  inventory,
  runtime,
  projectPlan,
  choices = {},
  runtimeRequest,
  packageRoot,
} = {}) {
  const options = {
    resolutions: choices?.resolutions ? { ...choices.resolutions } : {},
    config: choices?.config ? { ...choices.config } : {},
    migrateLegacy: Boolean(choices?.migrateLegacy),
  }

  const missingChoices = []
  const blockers = []
  if (!projectPlan) blockers.push('Project transaction could not be planned; inspect diagnostics')

  if (inventory?.pendingJournal) {
    blockers.push('Pending journal requires recovery before onboarding')
  }
  if (inventory?.config?.status === 'invalid') {
    blockers.push('Config file is invalid or malformed')
  }
  if (inventory?.lock?.format === 'unknown') {
    blockers.push('Lockfile format is unknown or malformed')
  }

  if (inventory?.classification === 'legacy') {
    if (!options.migrateLegacy) {
      missingChoices.push('migrateLegacy')
      blockers.push('Legacy lockfile requires explicit migrateLegacy choice')
    }
  }

  const projectActions = projectPlan?.actions ? [...projectPlan.actions] : []
  const conflictTargets = new Set()

  if (Array.isArray(projectPlan?.conflicts)) {
    for (const target of projectPlan.conflicts) {
      conflictTargets.add(target)
    }
  }
  for (const action of projectActions) {
    if (action.action === 'conflict') {
      conflictTargets.add(action.target)
    }
  }

  for (const target of conflictTargets) {
    const resolution = options.resolutions[target]
    if (resolution !== 'preserve' && resolution !== 'replace') {
      missingChoices.push(`resolution:${target}`)
      blockers.push(`Unresolved project conflict for ${target}`)
    }
  }

  if (
    inventory?.classification === 'unknown' &&
    !blockers.some((b) => b.includes('Lockfile') || b.includes('Config'))
  ) {
    blockers.push('Project inventory classification is unknown')
  }

  missingChoices.sort()
  blockers.sort()

  const isProjectReady =
    blockers.length === 0 &&
    missingChoices.length === 0 &&
    Boolean(projectPlan && !projectPlan.blocked) &&
    !projectActions.some((a) => ['create', 'update', 'seed'].includes(a.action))

  const sharedRequests = Array.isArray(runtime?.proposals) ? [...runtime.proposals] : []

  const effectiveRuntimeRequest =
    runtimeRequest ??
    runtime?.request ??
    (runtime?.requestId ? { requestId: runtime.requestId, runtimeId: runtime.runtimeId } : null)

  const planPayload = {
    schemaVersion: 1,
    operation: 'onboarding',
    target: inventory?.target ?? projectPlan?.target ?? null,
    rootIdentity: inventory?.rootIdentity ?? null,
    inventoryDigest: inventory ? recordDigest(inventory) : null,
    runtimeDigest: runtime ? recordDigest(runtime) : null,
    options,
    runtimeRequest: effectiveRuntimeRequest,
    changes: projectActions,
    sharedRequests,
    missingChoices,
    blockers,
    readyToApply:
      blockers.length === 0 &&
      missingChoices.length === 0 &&
      Boolean(projectPlan && !projectPlan.blocked),
    readiness: {
      runtime: Boolean(runtime?.runtimeReady),
      project: isProjectReady,
      governedChange: false,
    },
    governedChangeExplanation: 'Needs issue contract and actual verification',
    projectPlan: projectPlan ?? null,
    packageRoot: packageRoot ?? null,
  }

  const digest = recordDigest(planPayload)

  return {
    ...planPayload,
    digest,
  }
}
