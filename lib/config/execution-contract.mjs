import { modelFamily } from '../core/model-family.mjs'
import {
  DEFAULT_PLATFORM_CHAINS,
  DEFAULT_TIER_MODEL_MATRIX,
  SEAT_DEFAULT_TIER,
  effectiveTierModels,
} from './execution-defaults.mjs'
import {
  DEFAULT_EXECUTION_TARGET_BY_AGENT,
  EXECUTION_TARGETS_BY_AGENT,
} from '../execution-targets.mjs'

const RUNTIME_AGENTS = Object.freeze({ codex: 'codex', 'claude-code': 'claude', pi: 'pi' })
const NATIVE_ROUTES = Object.freeze({ codex: 'openai-codex', 'claude-code': 'anthropic' })
const EFFORTS = new Set(['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const TUPLE_FIELDS = new Set([
  'runtime',
  'executionTarget',
  'providerRoute',
  'platform',
  'providerFamily',
  'model',
  'effort',
  'profile',
  'capabilityTier',
])
const LOCATOR_PREFIXES = Object.freeze({
  antigravity: 'antigravity',
  grok: 'grok-cli',
  'openai-codex': 'openai-codex',
  munito: 'munito',
  anthropic: 'anthropic',
})

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Contracts contain provider-independent IDs; only the runner locator carries
// the Pi transport prefix. Model namespaces such as qwen/ are not gateways.
export function normalizeContractModel({ runtime, providerRoute, model }) {
  const prefix = LOCATOR_PREFIXES[providerRoute] ?? providerRoute
  return runtime === 'pi' && typeof model === 'string' && prefix && model.startsWith(`${prefix}/`)
    ? model.slice(prefix.length + 1)
    : model
}

export function runnerModelForContract({ runtime, providerRoute, model }) {
  const canonical = normalizeContractModel({ runtime, providerRoute, model })
  const prefix = LOCATOR_PREFIXES[providerRoute] ?? providerRoute
  return runtime === 'pi' && typeof canonical === 'string' && canonical && prefix
    ? `${prefix}/${canonical}`
    : canonical
}

function modelRoute(model) {
  if (typeof model !== 'string') return null
  return (
    Object.entries(LOCATOR_PREFIXES).find(([, prefix]) => model.startsWith(`${prefix}/`))?.[0] ??
    null
  )
}

// Resolve desired execution only. Inventory is non-secret support evidence, not a
// live health/authentication check, and absence of evidence never means healthy.
export function resolveExecutionContracts({
  rig = {},
  bundleConfig = {},
  preset,
  config = {},
  overrides = {},
  inventory = null,
} = {}) {
  const diagnostics = []
  const contracts = []
  const diagnostic = (severity, code, seat, message) =>
    diagnostics.push({ severity, code, seat, message })
  if (!rig || !Array.isArray(rig.pods) || rig.pods.length === 0) {
    diagnostic('error', 'INVALID_RIG_STRUCTURE', null, 'Rig must contain a non-empty pods array')
    return { ok: false, contracts, diagnostics }
  }
  const activationValue = config.adapters?.openrig?.executionPolicy?.activation
  const activation = activationValue === undefined ? 'active' : activationValue
  if (!['active', 'held'].includes(activation)) {
    diagnostic(
      'error',
      'INVALID_EXECUTION_ACTIVATION',
      null,
      'Execution policy activation must be active or held',
    )
    return { ok: false, activation, contracts, diagnostics }
  }
  if (activation === 'held')
    diagnostic(
      'warning',
      'EXECUTION_ACTIVATION_HELD',
      null,
      'Execution policy activation is held; preview only, installed writes are forbidden',
    )
  const presetName = preset ?? bundleConfig.recommended
  const presetSeats = bundleConfig.presets?.[presetName]
  if (presetName && !presetSeats) {
    diagnostic('error', 'UNKNOWN_PRESET', null, `Unknown preset ${presetName}`)
    return { ok: false, contracts, diagnostics }
  }
  const projectRawSeats = config.adapters?.openrig?.executionPolicy?.seats
  const invocationRawSeats = overrides?.seats
  const projectSeats = projectRawSeats === undefined ? {} : projectRawSeats
  const invocationSeats = invocationRawSeats === undefined ? {} : invocationRawSeats
  if (!isMap(presetSeats ?? {}) || !isMap(projectSeats) || !isMap(invocationSeats)) {
    diagnostic(
      'error',
      'INVALID_EXECUTION_LAYER',
      null,
      'Preset, project and invocation seat policies must be mappings',
    )
    return { ok: false, contracts, diagnostics }
  }
  const validatedTuple = (map, seat, source, allowRuntimeString = false) => {
    if (!Object.hasOwn(map, seat)) return {}
    const value = map[seat]
    if (allowRuntimeString && typeof value === 'string' && value.trim()) return { runtime: value }
    if (!isMap(value)) {
      diagnostic(
        'error',
        'INVALID_EXECUTION_TUPLE',
        seat,
        `${source} execution tuple must be a mapping${allowRuntimeString ? ' or runtime string' : ''}`,
      )
      return {}
    }
    for (const [key, item] of Object.entries(value)) {
      if (!TUPLE_FIELDS.has(key))
        diagnostic(
          'error',
          'UNKNOWN_EXECUTION_FIELD',
          seat,
          `${source} contains unknown execution field ${key}`,
        )
      else if (typeof item !== 'string' || !item.trim())
        diagnostic(
          'error',
          'INVALID_EXECUTION_FIELD',
          seat,
          `${source} execution field ${key} must be a non-empty string`,
        )
    }
    return value
  }
  // Validate all present entries, including those owned by another squad. The
  // topology planner separately checks the union of stable seat identities.
  const parsedPresets = Object.fromEntries(
    Object.keys(presetSeats ?? {}).map((seat) => [
      seat,
      validatedTuple(presetSeats, seat, 'preset', true),
    ]),
  )
  const parsedProject = Object.fromEntries(
    Object.keys(projectSeats).map((seat) => [seat, validatedTuple(projectSeats, seat, 'project')]),
  )
  const parsedInvocation = Object.fromEntries(
    Object.keys(invocationSeats).map((seat) => [
      seat,
      validatedTuple(invocationSeats, seat, 'invocation'),
    ]),
  )
  const seen = new Set()
  const entries = []
  for (const pod of rig.pods ?? []) {
    if (!pod || typeof pod !== 'object' || !Array.isArray(pod.members)) {
      diagnostic('error', 'INVALID_POD_STRUCTURE', null, 'Each pod must contain a members array')
      continue
    }
    for (const member of pod.members) {
      if (!member || typeof member !== 'object') {
        diagnostic('error', 'INVALID_MEMBER_STRUCTURE', null, 'Each member must be an object')
        continue
      }
      const seat = `${pod.id}.${member.id}`
      if (!pod.id || !member.id || seen.has(seat)) {
        diagnostic(
          'error',
          'DUPLICATE_OR_INVALID_SEAT',
          seat,
          'Stable pod/member identities must be present and unique',
        )
        continue
      }
      seen.add(seat)
      entries.push({ seat, member })
    }
  }
  if (!entries.length) diagnostic('error', 'EMPTY_RIG', null, 'Rig contains no materialized seats')
  for (const seat of Object.keys(presetSeats ?? {})) {
    if (!seen.has(seat))
      diagnostic(
        'warning',
        'PRESET_SEAT_ABSENT',
        seat,
        'Preset seat is absent from this rig and will not be created',
      )
  }
  for (const seat of Object.keys(projectSeats)) {
    if (!seen.has(seat))
      diagnostic(
        'warning',
        'PROJECT_SEAT_ABSENT',
        seat,
        'Project seat is absent from this rig; topology-wide validation must verify its ownership',
      )
  }
  for (const seat of Object.keys(invocationSeats)) {
    if (!seen.has(seat))
      diagnostic(
        'error',
        'OVERRIDE_SEAT_ABSENT',
        seat,
        'Explicit execution override names a seat absent from this rig',
      )
  }

  for (const { seat, member } of entries) {
    const provenance = {}
    const layers = [
      { source: 'invocation.overrides', value: parsedInvocation[seat] ?? {} },
      {
        source: 'project.config.adapters.openrig.executionPolicy',
        value: parsedProject[seat] ?? {},
      },
      { source: `preset.${presetName ?? 'none'}`, value: parsedPresets[seat] ?? {} },
    ]
    const choose = (field) => {
      for (const layer of layers) {
        if (Object.hasOwn(layer.value, field))
          return { source: layer.source, value: layer.value[field] }
      }
      return null
    }
    const assign = (field, selected) => {
      provenance[field] = selected
      return selected.value
    }
    const runtime = assign(
      'runtime',
      choose('runtime') ?? { source: 'legacy.rig', value: member.runtime },
    )
    if (!Object.hasOwn(RUNTIME_AGENTS, runtime))
      diagnostic('error', 'UNSUPPORTED_RUNTIME', seat, `Unsupported runtime ${runtime}`)
    const sameRuntime = runtime === member.runtime
    const capabilityTier = assign(
      'capabilityTier',
      choose('capabilityTier') ?? {
        source: config.models?.roleAssignments?.[seat]
          ? 'project.config.models.roleAssignments'
          : member.capabilityTier
            ? 'legacy.rig'
            : 'default.seatTier',
        value:
          config.models?.roleAssignments?.[seat] ??
          member.capabilityTier ??
          SEAT_DEFAULT_TIER[seat] ??
          'balanced',
      },
    )
    const bundleTier = bundleConfig.capability_tiers?.[capabilityTier] ?? {}
    const projectTier = config.models?.tiers?.[capabilityTier] ?? {}
    if (
      !Object.hasOwn(DEFAULT_TIER_MODEL_MATRIX, capabilityTier) &&
      !Object.hasOwn(bundleConfig.capability_tiers ?? {}, capabilityTier) &&
      !Object.hasOwn(config.models?.tiers ?? {}, capabilityTier)
    )
      diagnostic(
        'error',
        'UNKNOWN_CAPABILITY_TIER',
        seat,
        `Unknown capability tier ${capabilityTier}`,
      )
    const matrix = effectiveTierModels(capabilityTier, { bundleConfig, config })
    const policySource = (platform) =>
      projectTier.models?.[platform]
        ? 'project.config.models.tiers'
        : bundleTier.models?.[platform]
          ? 'bundle.capability_tiers'
          : 'default.tierMatrix'
    const explicitModel = choose('model')
    let selectedRoute = choose('providerRoute')
    const explicitPlatform = choose('platform')
    if (explicitPlatform) {
      const [platformRuntime, ...routeParts] = String(explicitPlatform.value).split(':')
      const route = routeParts.join(':')
      if (platformRuntime !== runtime || !route)
        diagnostic(
          'error',
          'INCOMPATIBLE_PLATFORM',
          seat,
          'Explicit platform does not match selected runtime',
        )
      if (selectedRoute && selectedRoute.value !== route)
        diagnostic(
          'error',
          'CONFLICTING_ROUTE',
          seat,
          'Explicit platform and provider route disagree',
        )
      selectedRoute ??= { source: explicitPlatform.source, value: route }
    }
    const pinnedRoute =
      member.providerRoute ?? modelRoute(member.model) ?? NATIVE_ROUTES[member.runtime]
    const explicitModelRoute = modelRoute(explicitModel?.value)
    if (selectedRoute && explicitModelRoute && selectedRoute.value !== explicitModelRoute) {
      diagnostic(
        'error',
        'INCOMPATIBLE_MODEL_ROUTE',
        seat,
        'Model transport prefix conflicts with selected provider route',
      )
    }
    selectedRoute ??= explicitModelRoute
      ? { source: explicitModel.source, value: explicitModelRoute }
      : null
    selectedRoute ??=
      sameRuntime && pinnedRoute ? { source: 'legacy.rig', value: pinnedRoute } : null
    const chains = bundleConfig.fallback_chains?.[seat] ?? DEFAULT_PLATFORM_CHAINS[seat] ?? []
    const candidatePlatforms = [...chains, ...Object.keys(matrix)]
    const policyPlatform = candidatePlatforms.find(
      (platform) => platform.startsWith(`${runtime}:`) && matrix[platform],
    )
    // Route selection may choose a whole policy tuple. It cannot attach an
    // arbitrary explicit/legacy Pi model to an unrelated fallback gateway.
    const retainedUnroutedModel =
      runtime === 'pi' && (explicitModel || (sameRuntime && member.model))
    selectedRoute ??= NATIVE_ROUTES[runtime]
      ? { source: 'default.nativeRoute', value: NATIVE_ROUTES[runtime] }
      : policyPlatform && !retainedUnroutedModel
        ? { source: policySource(policyPlatform), value: policyPlatform.slice(runtime.length + 1) }
        : null
    const providerRoute = assign(
      'providerRoute',
      selectedRoute ?? { source: 'unresolved', value: null },
    )
    const platform = assign('platform', {
      source: 'derived.runtime-and-route',
      value: providerRoute ? `${runtime}:${providerRoute}` : null,
    })
    const policy = matrix[platform] ?? {}
    if (policy.runtime && policy.runtime !== runtime)
      diagnostic(
        'error',
        'INCOMPATIBLE_TIER_RUNTIME',
        seat,
        'Tier policy runtime contradicts its route platform',
      )
    const compatibleLegacy = sameRuntime && (!pinnedRoute || pinnedRoute === providerRoute)
    const selectedModel =
      explicitModel ??
      (compatibleLegacy && member.model
        ? { source: 'legacy.rig', value: member.model }
        : { source: policySource(platform), value: policy.model })
    const locatorRoute = modelRoute(selectedModel.value)
    if (runtime !== 'pi' && locatorRoute)
      diagnostic(
        'error',
        'NATIVE_MODEL_LOCATOR_DENIED',
        seat,
        'Native runtimes require canonical model IDs without Pi provider locators',
      )
    const model = assign('model', {
      source: selectedModel.source,
      value: normalizeContractModel({ runtime, providerRoute, model: selectedModel.value }),
    })
    const routeForModel = locatorRoute
    if (routeForModel && routeForModel !== providerRoute)
      diagnostic(
        'error',
        'INCOMPATIBLE_MODEL_ROUTE',
        seat,
        'Resolved model transport prefix conflicts with provider route',
      )
    if (NATIVE_ROUTES[runtime] && providerRoute !== NATIVE_ROUTES[runtime])
      diagnostic(
        'error',
        'INCOMPATIBLE_RUNTIME_ROUTE',
        seat,
        `Runtime ${runtime} cannot use provider route ${providerRoute}`,
      )
    const inferredFamily = modelFamily(model)
    const nativeFamily =
      runtime === 'codex' ? 'openai' : runtime === 'claude-code' ? 'anthropic' : null
    if (nativeFamily && inferredFamily !== 'unknown' && inferredFamily !== nativeFamily)
      diagnostic(
        'error',
        'INCOMPATIBLE_RUNTIME_MODEL',
        seat,
        `Model family ${inferredFamily} cannot execute through ${runtime}`,
      )
    // Effort is transport-independent: changing runtime must not silently raise
    // a persistent seat from medium/low to a tier's one-shot high recommendation.
    const projectEffort = projectTier.models?.[platform]?.effort
    const effort = assign(
      'effort',
      choose('effort') ??
        (projectEffort
          ? { source: 'project.config.models.tiers', value: projectEffort }
          : member.effort
            ? { source: 'legacy.rig', value: member.effort }
            : {
                source: projectTier.defaultEffort
                  ? 'project.config.models.tiers.defaultEffort'
                  : 'bundle.effort_policy',
                value:
                  projectTier.defaultEffort ??
                  bundleTier.defaultEffort ??
                  bundleConfig.effort_policy?.default_loop_effort ??
                  'medium',
              }),
    )
    if (!EFFORTS.has(effort))
      diagnostic('error', 'UNSUPPORTED_EFFORT', seat, `Unsupported effort ${effort}`)
    const registeredProfile = bundleConfig.seats?.[seat]?.runtimes?.[runtime]
    const explicitProfile = choose('profile')
    const profile = assign(
      'profile',
      explicitProfile ??
        (registeredProfile
          ? { source: 'bundle.seats.runtimes', value: registeredProfile }
          : sameRuntime
            ? { source: 'legacy.rig', value: member.profile }
            : { source: 'unresolved', value: null }),
    )
    if (registeredProfile && explicitProfile && profile !== registeredProfile)
      diagnostic(
        'error',
        'INCOMPATIBLE_PROFILE',
        seat,
        `Profile ${profile} does not match ${runtime} seat profile ${registeredProfile}`,
      )
    const executionTarget = assign(
      'executionTarget',
      choose('executionTarget') ?? {
        source: 'default.runtimeTarget',
        value: DEFAULT_EXECUTION_TARGET_BY_AGENT[RUNTIME_AGENTS[runtime]],
      },
    )
    const allowedTargets = EXECUTION_TARGETS_BY_AGENT[RUNTIME_AGENTS[runtime]] ?? []
    if (!allowedTargets.includes(executionTarget))
      diagnostic(
        'error',
        'INCOMPATIBLE_EXECUTION_TARGET',
        seat,
        'Execution target does not match selected runtime',
      )
    for (const [field, value] of Object.entries({
      runtime,
      providerRoute,
      model,
      profile,
      capabilityTier,
    })) {
      if (typeof value !== 'string' || !value.trim())
        diagnostic(
          'error',
          'UNRESOLVED_EXECUTION_FIELD',
          seat,
          `Execution field ${field} could not be resolved`,
        )
    }
    const match = Array.isArray(inventory)
      ? inventory.find(
          (entry) =>
            entry?.runtime === runtime &&
            entry.providerRoute === providerRoute &&
            entry.model === model,
        )
      : null
    if (match?.efforts && !match.efforts.includes(effort))
      diagnostic(
        'error',
        'INVENTORY_EFFORT_UNSUPPORTED',
        seat,
        'Installed model inventory does not support selected effort',
      )
    if (match?.profiles && !match.profiles.includes(profile))
      diagnostic(
        'error',
        'INVENTORY_PROFILE_UNSUPPORTED',
        seat,
        'Installed model inventory does not support selected profile',
      )
    const matchingPolicyFamily =
      normalizeContractModel({ runtime, providerRoute, model: policy.model }) === model
        ? policy.providerFamily
        : null
    const providerFamily = assign(
      'providerFamily',
      choose('providerFamily') ??
        (match?.providerFamily
          ? { source: 'inventory', value: match.providerFamily }
          : matchingPolicyFamily
            ? { source: policySource(platform), value: matchingPolicyFamily }
            : inferredFamily !== 'unknown'
              ? { source: 'derived.modelFamily', value: inferredFamily }
              : nativeFamily
                ? { source: 'derived.nativeRuntimeFamily', value: nativeFamily }
                : { source: 'unresolved', value: 'unknown' }),
    )
    const knownFamilies = [
      match?.providerFamily,
      matchingPolicyFamily,
      inferredFamily,
      nativeFamily,
    ].filter((value) => value && value !== 'unknown')
    if (knownFamilies.some((family) => family !== providerFamily))
      diagnostic(
        'error',
        'CONFLICTING_PROVIDER_FAMILY',
        seat,
        'Provider family contradicts model or native runtime family evidence',
      )
    const support =
      match?.available === true
        ? 'supported'
        : match?.available === false
          ? 'unavailable'
          : 'unknown'
    const runnerModel = assign('runnerModel', {
      source: 'derived.runtime-route-and-model',
      value: runnerModelForContract({ runtime, providerRoute, model }),
    })
    contracts.push({
      seat,
      runtime,
      executionTarget,
      providerRoute,
      platform,
      providerFamily,
      model,
      runnerModel,
      effort,
      profile,
      capabilityTier,
      support,
      provenance,
    })
  }
  return {
    ok: !diagnostics.some((item) => item.severity === 'error'),
    activation,
    contracts,
    diagnostics,
  }
}
