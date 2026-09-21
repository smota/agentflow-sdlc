import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveConfigAuthority } from './authority.mjs'
import { loadSdlcConfig, validateSdlcConfigShape } from '../sdlc-state.mjs'
import { checkPostureCapability } from '../posture-check.mjs'
import { inspectHarnessIntelligence } from './harness-intelligence.mjs'
import {
  loadMethodCatalog,
  loadRoleCatalog,
  validateRoleCatalog,
  validateRoleMethodConfig,
} from '../role-catalog.mjs'
import { validateConfiguredExtensionPacks } from '../extension-packs.mjs'
import { adapterStatus } from '../skill-adapters.mjs'
import { roleAdapterStatus } from '../role-adapters.mjs'
import { pluginStatus, validatePluginManifests } from '../plugin-manifests.mjs'
import { harnessSettingsStatus } from '../structural-merge.mjs'

export function runConfigDoctor({ packageRoot, targetDir = process.cwd() } = {}) {
  const root = resolve(targetDir)
  const pkgRoot = packageRoot ? resolve(packageRoot) : root
  const blockers = []
  const warnings = []
  const passedChecks = []

  // 1. Config Authority
  let authorityCheck = { ok: true, errors: [], warnings: [] }
  try {
    const authority = resolveConfigAuthority(root)
    authorityCheck = {
      ok: authority.validation.ok,
      errors: authority.validation.errors,
      warnings: authority.validation.warnings,
      domainPath: authority.domainPath,
      workflowPath: authority.workflowPath,
    }
    if (!authority.validation.ok) {
      blockers.push(...authority.validation.errors.map((e) => `Authority: ${e}`))
    }
    if (authority.validation.warnings.length) {
      warnings.push(...authority.validation.warnings.map((w) => `Authority: ${w}`))
    }
    if (authority.validation.ok && authority.validation.warnings.length === 0) {
      passedChecks.push('Config authority separation')
    }
  } catch (error) {
    blockers.push(`Authority check failed: ${error.message}`)
    authorityCheck.ok = false
    authorityCheck.errors.push(error.message)
  }

  // 2. Workflow Config (Execution Adapter)
  const workflowPath = join(root, 'agent-workflow.config.json')
  let workflowConfig = null
  let workflowCheck = { ok: true, exists: false, errors: [] }
  if (!existsSync(workflowPath)) {
    workflowCheck.ok = false
    workflowCheck.errors.push(
      'agent-workflow.config.json is missing; run `agentflow-sdlc init` to initialize',
    )
    blockers.push('Workflow config: agent-workflow.config.json is missing')
  } else {
    workflowCheck.exists = true
    try {
      workflowConfig = JSON.parse(readFileSync(workflowPath, 'utf8'))
      passedChecks.push('Workflow configuration JSON validity')
    } catch (error) {
      workflowCheck.ok = false
      workflowCheck.errors.push(
        `agent-workflow.config.json does not parse as JSON: ${error.message}`,
      )
      blockers.push(`Workflow config: JSON parse error (${error.message})`)
    }
  }

  // 3. SDLC Domain Config
  let sdlcCheck = { ok: true, findings: [] }
  try {
    const domainConfig = loadSdlcConfig(root)
    const shape = validateSdlcConfigShape(domainConfig)
    sdlcCheck = {
      ok: shape.findings.filter((f) => f.severity === 'high').length === 0,
      findings: shape.findings,
      profile: shape.profile,
    }
    for (const f of shape.findings) {
      if (f.severity === 'high') blockers.push(`SDLC config: ${f.code} - ${f.message}`)
      else warnings.push(`SDLC config: ${f.code} - ${f.message}`)
    }
    if (shape.findings.length === 0) {
      passedChecks.push('SDLC domain configuration shape')
    }
  } catch (error) {
    blockers.push(`SDLC domain config check failed: ${error.message}`)
    sdlcCheck.ok = false
  }

  // 4. Autonomy Posture Capability
  let postureCheck = { ok: true, posture: 'assisted', warnings: [] }
  try {
    const configuredPosture = workflowConfig?.posture || 'assisted'
    const postureResult = checkPostureCapability({ posture: configuredPosture, root })
    postureCheck = {
      ok: true, // Advisory only per D3 contract
      posture: postureResult.posture,
      warnings: postureResult.warnings,
      advisoryOnly: true,
    }
    for (const w of postureResult.warnings) {
      warnings.push(`Posture advisory (${postureResult.posture}): ${w.message}`)
    }
    if (postureResult.warnings.length === 0) {
      passedChecks.push(`Posture capability (${postureResult.posture})`)
    }
  } catch (error) {
    warnings.push(`Posture check error: ${error.message}`)
  }

  // 5. Harness Intelligence (4 pillars)
  let harnessCheck = { ok: true, configuredCount: 0, totalPillars: 4, status: {} }
  try {
    const harnessResult = inspectHarnessIntelligence(root)
    harnessCheck = {
      ok: harnessResult.configuredCount > 0,
      configuredCount: harnessResult.configuredCount,
      totalPillars: harnessResult.totalPillars,
      status: harnessResult.status,
    }
    if (harnessResult.configuredCount < harnessResult.totalPillars) {
      warnings.push(
        `Harness intelligence: ${harnessResult.configuredCount}/${harnessResult.totalPillars} pillars configured in .agentflow/ (using defaults for unconfigured)`,
      )
    } else {
      passedChecks.push('Harness intelligence pillars (4/4 configured)')
    }
  } catch (error) {
    warnings.push(`Harness intelligence check error: ${error.message}`)
  }

  // 6. Role & Method Catalog
  let rolesCheck = { ok: true, findings: [] }
  try {
    const roleCatResult = validateRoleCatalog({ packageRoot: pkgRoot })
    const methodCat = loadMethodCatalog(pkgRoot)
    const roleCat = loadRoleCatalog(pkgRoot)
    const methodConfigResult = validateRoleMethodConfig({
      config: workflowConfig || {},
      packageRoot: pkgRoot,
      catalog: roleCat,
      methodCatalog: methodCat,
    })
    const combinedFindings = [...roleCatResult.findings, ...methodConfigResult.findings]
    rolesCheck = {
      ok: roleCatResult.ok && methodConfigResult.ok,
      findings: combinedFindings,
    }
    for (const f of combinedFindings) {
      if (f.severity === 'high') blockers.push(`Roles/methods: ${f.code} - ${f.message}`)
      else warnings.push(`Roles/methods: ${f.code} - ${f.message}`)
    }
    if (combinedFindings.length === 0) {
      passedChecks.push('Role catalog and method bindings')
    }
  } catch (error) {
    warnings.push(`Role catalog validation error: ${error.message}`)
  }

  // 7. Extensions
  let extensionsCheck = { ok: true, errors: [], packs: [] }
  try {
    const extResult = validateConfiguredExtensionPacks(root, { runValidators: false })
    const extErrors = extResult.results.flatMap((r) => r.errors)
    extensionsCheck = {
      ok: extErrors.length === 0,
      errors: extErrors,
      packs: extResult.results.map((r) => r.pack.relativeDir),
    }
    for (const err of extErrors) {
      blockers.push(`Extension error: ${err}`)
    }
    if (extErrors.length === 0) {
      passedChecks.push('Extension packs validation')
    }
  } catch (error) {
    warnings.push(`Extensions check error: ${error.message}`)
  }

  // 8. Harness Adapters Synchronization
  let adaptersCheck = {
    ok: true,
    staleSkills: [],
    staleRoles: [],
    stalePlugins: [],
    staleSettings: [],
  }
  try {
    const plugins = validatePluginManifests({ packageRoot: pkgRoot, harness: 'all' }).manifests
    const skillsStatus = adapterStatus({ packageRoot: pkgRoot, targetDir: root, harness: 'all' })
    const rolesStatus = roleAdapterStatus({ packageRoot: pkgRoot, targetDir: root, harness: 'all' })
    const plugStatus = pluginStatus({ packageRoot: pkgRoot, targetDir: root, harness: 'all' })
    const settStatus = harnessSettingsStatus({
      packageRoot: pkgRoot,
      targetDir: root,
      harness: 'all',
      pluginManifests: plugins,
    })

    adaptersCheck = {
      ok:
        skillsStatus.stale.length === 0 &&
        rolesStatus.stale.length === 0 &&
        plugStatus.stale.length === 0 &&
        settStatus.stale.length === 0,
      staleSkills: skillsStatus.stale.map((e) => `${e.harness}:${e.skill}`),
      staleRoles: rolesStatus.stale.map((e) => e.target),
      stalePlugins: plugStatus.stale.map((e) => `${e.harness}:${e.status}`),
      staleSettings: settStatus.stale.map((e) => `${e.harness}:${e.status}`),
    }

    const totalStale =
      adaptersCheck.staleSkills.length +
      adaptersCheck.staleRoles.length +
      adaptersCheck.stalePlugins.length +
      adaptersCheck.staleSettings.length

    if (totalStale > 0) {
      warnings.push(
        `Harness adapters: ${totalStale} items out of sync (run \`agentflow-sdlc config sync --apply\`)`,
      )
    } else {
      passedChecks.push('Harness adapters synchronization')
    }
  } catch (error) {
    warnings.push(`Harness adapters status check error: ${error.message}`)
  }

  const ok = blockers.length === 0

  return {
    ok,
    targetDir: root,
    checks: {
      authority: authorityCheck,
      workflow: workflowCheck,
      sdlc: sdlcCheck,
      posture: postureCheck,
      harnessIntelligence: harnessCheck,
      rolesAndMethods: rolesCheck,
      extensions: extensionsCheck,
      adapters: adaptersCheck,
    },
    passedChecks,
    warnings,
    blockers,
    summary: {
      totalChecks: 8,
      passedCount: passedChecks.length,
      warningCount: warnings.length,
      blockerCount: blockers.length,
    },
  }
}
