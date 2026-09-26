#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateEnvironment, inspectEnvironment } from '../lib/environment.mjs'
import { adapterStatus, syncSkillAdapters } from '../lib/skill-adapters.mjs'
import { loadSkillCatalog, validateSkillCatalog } from '../lib/skill-catalog.mjs'
import { roleAdapterStatus, syncRoleAdapters } from '../lib/role-adapters.mjs'
import {
  loadMethodCatalog,
  loadRoleCatalog,
  resolveRoleContract,
  roleByIdentity,
  validateMethodCatalog,
  validateRoleCatalog,
  validateRoleHandoff,
  validateRoleMethodConfig,
} from '../lib/role-catalog.mjs'
import {
  buildPluginManifests,
  pluginStatus,
  validatePluginManifests,
} from '../lib/plugin-manifests.mjs'
import {
  harnessSettingsStatus,
  mergeHarnessSettings,
  validateSettingsManifest,
} from '../lib/structural-merge.mjs'
import { buildReleasePlan } from '../lib/release-versioning.mjs'
import {
  buildExtensionRegistry,
  resolveExtensionPack,
  setExtensionPackEnabled,
  validateConfiguredExtensionPacks,
} from '../lib/extension-packs.mjs'
import { COMPOSITION_PROFILES } from '../lib/adoption/profiles.mjs'
import {
  applyAdoption,
  planAdoption,
  recoverAdoption,
  rollbackAdoption,
} from '../lib/adoption/transaction.mjs'
import { runInit } from '../lib/init.mjs'
import {
  inspectHarnessIntelligence,
  scaffoldHarnessIntelligence,
} from '../lib/config/harness-intelligence.mjs'
import { runConfigDoctor } from '../lib/config/doctor.mjs'
import { runConfigSync } from '../lib/config/sync.mjs'
import { inspectEffectiveConfig } from '../lib/config/inspect.mjs'
import { formatContinuousConfigPrompt } from '../lib/config/prompt.mjs'
import { setupGitHubGovernance } from '../lib/github-setup.mjs'
import { handleOnboarding } from '../lib/onboarding/cli.mjs'
import { formatOnboardingPrompt } from '../lib/onboarding/prompt.mjs'
import os from 'node:os'
import { createHandoffPacket, resumeHandoff } from '../lib/runtime/handover-protocol.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function getFlag(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  return args[index + 1] ?? fallback
}

function printReport(title, report) {
  process.stdout.write(`${title}\n`)
  for (const [key, list] of Object.entries(report)) {
    if (!Array.isArray(list) || list.length === 0) continue
    process.stdout.write(`  ${key} (${list.length}):\n`)
    for (const item of list) {
      process.stdout.write(`    - ${item}\n`)
    }
  }
}

function printEnvironmentReport(report) {
  process.stdout.write(`Environment validation\n`)
  process.stdout.write(`${report.note}\n\n`)
  for (const required of [true, false]) {
    process.stdout.write(`${required ? 'Required' : 'Optional'}:\n`)
    for (const tool of report.tools.filter((item) => item.required === required)) {
      process.stdout.write(
        `  - ${tool.name}: ${tool.found ? `found ${tool.version}` : 'missing'}\n`,
      )
      process.stdout.write(`    Why: ${tool.why}\n`)
      if (!tool.found) {
        process.stdout.write(`    Install options:\n`)
        for (const option of tool.installOptions) process.stdout.write(`      - ${option}\n`)
      }
    }
    process.stdout.write(`\n`)
  }
}

function printReleasePlan(plan) {
  process.stdout.write(`Release plan preview\n`)
  process.stdout.write(`${plan.message}\n\n`)
  process.stdout.write(`Strategy: ${plan.strategy}\n`)
  process.stdout.write(`Bump: ${plan.bump}\n`)
  process.stdout.write(`Current version: ${plan.currentVersion}\n`)
  process.stdout.write(`Next version: ${plan.nextVersion}\n`)
  process.stdout.write(`Tag: ${plan.tag}\n`)
  if (plan.previousTag) process.stdout.write(`Previous tag: ${plan.previousTag}\n`)
  process.stdout.write(`Release notes draft: ${plan.notesPath}\n`)
  process.stdout.write(`Approval required: ${plan.approvalRequired ? 'yes' : 'no'}\n`)
}

function printInitReport(result) {
  if (result.status === 'skipped') {
    process.stdout.write(`${result.reason}\n`)
    return
  }
  if (result.status === 'blocked') {
    process.stdout.write(`Init blocked by conflicts:\n`)
    for (const conflict of result.conflicts) process.stdout.write(`  - ${conflict}\n`)
    return
  }
  process.stdout.write(`Initialized ${result.adapterPath}\n`)
  process.stdout.write(
    `  branch: ${result.facts.branch.detected ? result.facts.branch.value : 'not detected (assumed default)'}\n`,
  )
  process.stdout.write(
    `  test command: ${result.facts.testCommand.detected ? result.facts.testCommand.value : 'not detected (none written)'}\n`,
  )
  process.stdout.write(
    `  candidate inputs: ${result.facts.candidateInputs.value.length ? result.facts.candidateInputs.value.join(', ') : 'not detected (none written)'}\n`,
  )
  if (result.posture) {
    process.stdout.write(`  posture: ${result.posture}\n`)
  }
  if (result.harnessIntelligence && result.harnessIntelligence.created.length > 0) {
    process.stdout.write(
      `  harness intelligence: scaffolded ${result.harnessIntelligence.created.length} pillars in ${result.harnessIntelligence.agentflowDir}\n`,
    )
  }
  if (result.syncedAdapters) {
    process.stdout.write(
      `  synced adapters: ${result.syncedAdapters.summary.skillsCount} skills, ${result.syncedAdapters.summary.rolesCount} roles, ${result.syncedAdapters.summary.pluginsCount} plugins, ${result.syncedAdapters.summary.settingsCount} settings\n`,
    )
  }
  if (result.assumptions.length) {
    if (result.skillInstruction) process.stdout.write(`${result.skillInstruction}\n`)
    process.stdout.write(`Assumptions:\n`)
    for (const note of result.assumptions) process.stdout.write(`  - ${note}\n`)
  }
}

function handleInit(rest, targetDir) {
  const json = rest.includes('--json')
  const force = rest.includes('--force')
  const profile = getFlag(rest, '--profile', undefined)
  const posture = getFlag(rest, '--posture', undefined)
  const scaffoldHarness = !rest.includes('--no-harness')
  const syncAdapters = rest.includes('--sync')
  const result = runInit({
    packageRoot,
    targetDir,
    force,
    ...(profile ? { profile } : {}),
    ...(posture ? { posture } : {}),
    scaffoldHarness,
    syncAdapters,
  })
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else printInitReport(result)
  return result.status === 'blocked' ? 1 : 0
}

function printConfigDoctorReport(report) {
  process.stdout.write(
    `AgentFlow project configuration doctor (${report.ok ? 'READY' : 'BLOCKED'})\n`,
  )
  process.stdout.write(`Target: ${report.targetDir}\n\n`)
  process.stdout.write(
    `Passed checks (${report.passedChecks.length}/${report.summary.totalChecks}):\n`,
  )
  for (const item of report.passedChecks) {
    process.stdout.write(`  ✓ ${item}\n`)
  }
  process.stdout.write(`\n`)
  if (report.warnings.length) {
    process.stdout.write(`Warnings (${report.warnings.length}):\n`)
    for (const item of report.warnings) {
      process.stdout.write(`  ! ${item}\n`)
    }
    process.stdout.write(`\n`)
  }
  if (report.blockers.length) {
    process.stdout.write(`Blockers (${report.blockers.length}):\n`)
    for (const item of report.blockers) {
      process.stdout.write(`  ✗ ${item}\n`)
    }
    process.stdout.write(`\n`)
  }
  process.stdout.write(
    `Summary: ${report.summary.passedCount} passed, ${report.summary.warningCount} warnings, ${report.summary.blockerCount} blockers\n`,
  )
}

function printConfigSyncReport(report) {
  process.stdout.write(`AgentFlow configuration sync (${report.mode})\n`)
  process.stdout.write(`Target: ${report.targetDir}\n`)
  process.stdout.write(`  Skills: ${report.summary.skillsCount} entries\n`)
  process.stdout.write(`  Roles: ${report.summary.rolesCount} entries\n`)
  process.stdout.write(`  Plugins: ${report.summary.pluginsCount} manifests\n`)
  process.stdout.write(`  Settings: ${report.summary.settingsCount} merged\n`)
  if (!report.ok) {
    process.stdout.write(`Sync completed with issues.\n`)
  } else {
    process.stdout.write(
      `Result: ${report.mode === 'applied' ? 'ALL ADAPTERS IN SYNC' : 'PREVIEW ONLY'}\n`,
    )
  }
}

function handleConfig(rest, targetDir) {
  const [subcommand] = positionalArgs(rest)
  const json = rest.includes('--json')
  const harness = getFlag(rest, '--harness', 'all')

  if (subcommand === 'doctor' || subcommand === 'check' || !subcommand) {
    const report = runConfigDoctor({ packageRoot, targetDir })
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else printConfigDoctorReport(report)
    return report.ok ? 0 : 1
  }

  if (subcommand === 'sync') {
    const write = rest.includes('--apply') && !rest.includes('--dry-run')
    const result = runConfigSync({ packageRoot, targetDir, harness, write })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else printConfigSyncReport(result)
    return result.ok ? 0 : 1
  }

  if (subcommand === 'inspect') {
    const result = inspectEffectiveConfig({ targetDir })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  }

  if (subcommand === 'prompt') {
    process.stdout.write(formatContinuousConfigPrompt(targetDir))
    return 0
  }

  process.stderr.write(`Usage:
  agentflow-sdlc config <doctor|check|sync|inspect|prompt> [--target <dir>] [--harness <name>] [--dry-run|--apply] [--json]
`)
  return 2
}

function printExtensionRegistry(registry) {
  process.stdout.write('Extension packs\n')
  for (const pack of registry.discovered) {
    const enabled = registry.configured.includes(pack.relativeDir) ? 'enabled' : 'disabled'
    process.stdout.write(
      `${pack.relativeDir}\t${pack.manifest.id}\t${pack.manifest.kind}\t${enabled}\n`,
    )
  }
  if (registry.enabledMissing.length) {
    process.stdout.write(`Missing enabled packs:\n`)
    for (const item of registry.enabledMissing) process.stdout.write(`  - ${item}\n`)
  }
  if (registry.duplicateIds.length) {
    process.stdout.write(`Duplicate ids:\n`)
    for (const item of registry.duplicateIds) process.stdout.write(`  - ${item}\n`)
  }
}

function runScript(script, args, targetDir) {
  const result = spawnSync(
    process.execPath,
    [resolve(packageRoot, script), ...args, '--target', targetDir],
    {
      stdio: 'inherit',
    },
  )
  return result.status ?? 1
}

function handleSdlc(rest, targetDir) {
  const [subcommand] = positionalArgs(rest)
  const pass = rest.filter((arg) => arg !== subcommand)
  if (subcommand === 'validate' || subcommand === 'validate-config')
    return runScript('scripts/validate-sdlc-config.mjs', pass, targetDir)
  if (subcommand === 'validate-authority')
    return runScript('scripts/validate-config-authority.mjs', pass, targetDir)
  if (subcommand === 'migrate-authority')
    return runScript('scripts/authority-migration.mjs', pass, targetDir)
  if (subcommand === 'validate-issue')
    return runScript('scripts/validate-sdlc-issue.mjs', pass, targetDir)
  if (subcommand === 'validate-role-pass')
    return runScript('scripts/validate-sdlc-role-pass.mjs', pass, targetDir)
  if (subcommand === 'validate-pr')
    return runScript('scripts/validate-sdlc-pr.mjs', pass, targetDir)
  if (subcommand === 'validate-release')
    return runScript('scripts/validate-sdlc-release.mjs', pass, targetDir)
  if (subcommand === 'validate-skill')
    return runScript('scripts/validate-sdlc-skill.mjs', pass, targetDir)
  if (subcommand === 'validate-agent')
    return runScript('scripts/validate-sdlc-agent.mjs', pass, targetDir)
  if (subcommand === 'validate-evidence')
    return runScript('scripts/validate-evidence-contract.mjs', pass, targetDir)
  if (subcommand === 'validate-lifecycle')
    return runScript('scripts/validate-lifecycle-contract.mjs', pass, targetDir)
  if (subcommand === 'derive-metrics')
    return runScript('scripts/derive-outcome-metrics.mjs', pass, targetDir)
  if (subcommand === 'run-evals') return runScript('scripts/run-agent-evals.mjs', pass, targetDir)
  if (subcommand === 'validate-multi-agent')
    return runScript('scripts/validate-multi-agent-acceptance.mjs', pass, targetDir)
  if (subcommand === 'audit') return runScript('scripts/sdlc-audit.mjs', pass, targetDir)
  if (subcommand === 'migrate') return runScript('scripts/sdlc-migrate.mjs', pass, targetDir)
  process.stderr.write(`Usage:
  agentflow-sdlc sdlc validate [--target <dir>] [--json]
  agentflow-sdlc sdlc validate-authority [--target <dir>] [--json]
  agentflow-sdlc sdlc migrate-authority <plan|apply --confirm <plan-token>> [--target <dir>]
  agentflow-sdlc sdlc validate-issue --path <issue.json> [--json]
  agentflow-sdlc sdlc validate-role-pass --path <role-pass.md> [--json]
  agentflow-sdlc sdlc validate-pr --path <pr-body.md> [--json]
  agentflow-sdlc sdlc validate-release --path <issue.json> [--json]
  agentflow-sdlc sdlc validate-skill --path <SKILL.md> [--json]
  agentflow-sdlc sdlc validate-agent --path <AGENT.md> [--json]
  agentflow-sdlc sdlc validate-evidence --type <contract> --path <json> [--json]
  agentflow-sdlc sdlc validate-lifecycle --type <contract> --path <json> [--json]
  agentflow-sdlc sdlc derive-metrics --path <events.json> [--json]
  agentflow-sdlc sdlc run-evals --manifest <manifest.json> [--json]
  agentflow-sdlc sdlc validate-multi-agent [--json]
  agentflow-sdlc sdlc audit [--json]
  agentflow-sdlc sdlc migrate [--json]
`)
  return 2
}

function outsideTarget(targetDir, candidate) {
  const value = relative(targetDir, candidate)
  return value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)
}

function handleAdoption(rest, targetDir) {
  const [subcommand] = positionalArgs(rest)
  const profile = getFlag(rest, '--profile', COMPOSITION_PROFILES.defaultProfile)
  const json = rest.includes('--json')
  const storage = getFlag(rest, '--storage', 'external')
  if (subcommand === 'profiles') {
    const result = {
      defaultProfile: COMPOSITION_PROFILES.defaultProfile,
      profiles: COMPOSITION_PROFILES.profiles,
    }
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else {
      process.stdout.write('AgentFlow install profiles\n')
      for (const [id, item] of Object.entries(result.profiles)) {
        process.stdout.write(`  - ${id}: ${item.description}\n`)
      }
    }
    return 0
  }
  if (subcommand === 'plan') {
    const plan = planAdoption(packageRoot, targetDir, { profile, storage })
    if (json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    else
      printReport(`Adoption preview for ${targetDir} (${plan.blocked ? 'BLOCKED' : 'ready'})`, {
        actions: plan.actions.map((item) => `${item.action} ${item.target}`),
        conflicts: plan.conflicts,
        approvalToken: [plan.token],
      })
    return plan.blocked ? 1 : 0
  }
  if (subcommand === 'apply') {
    const confirm = getFlag(rest, '--confirm', '')
    const receiptInput = getFlag(rest, '--receipt', '')
    if (!confirm) {
      process.stderr.write(
        'Usage: agentflow-sdlc adopt apply --confirm <plan-token> [--receipt <outside-file>] [--profile <id>] [--target <dir>] [--json]\n',
      )
      return 2
    }
    let receiptPath = receiptInput ? resolve(receiptInput) : null
    if (receiptPath && !outsideTarget(targetDir, receiptPath)) {
      throw new Error('Adoption receipt must remain outside the target project')
    }
    if (receiptPath && existsSync(receiptPath))
      throw new Error('Adoption receipt path already exists')
    const plan = planAdoption(packageRoot, targetDir, { profile, storage })
    const receipt = applyAdoption(packageRoot, targetDir, plan, {
      confirm,
      receiptDestination: receiptPath,
    })
    if (receipt.receiptPath) receiptPath = resolve(targetDir, receipt.receiptPath)
    else if (!receiptPath && receipt.externalReceiptDestination)
      receiptPath = resolve(receipt.externalReceiptDestination)
    const result = {
      status: 'applied',
      target: receipt.target,
      profile: receipt.profile,
      planToken: receipt.planToken,
      receiptToken: receipt.receiptToken,
      receiptPath,
      changed: receipt.changed,
    }
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport(`Applied adoption plan to ${targetDir}`, {
        changed: result.changed,
        receipt: [receiptPath],
      })
    return 0
  }
  if (subcommand === 'rollback') {
    const confirm = getFlag(rest, '--confirm', '')
    const receiptInput = getFlag(rest, '--receipt', '')
    if (!confirm || !receiptInput) {
      process.stderr.write(
        'Usage: agentflow-sdlc adopt rollback --confirm <receipt-token> --receipt <outside-file> [--target <dir>] [--json]\n',
      )
      return 2
    }
    const receiptPath = resolve(receiptInput)
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    if (
      !outsideTarget(targetDir, receiptPath) &&
      receiptPath !==
        resolve(targetDir, '.agentflow/transactions', receipt.transactionId, 'receipt.json')
    )
      throw new Error('Contained receipt must use the reserved transaction path')
    const result = rollbackAdoption(targetDir, receipt, { confirm })
    unlinkSync(receiptPath)
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else process.stdout.write(`Rolled back adoption plan ${result.planToken}\n`)
    return 0
  }
  if (subcommand === 'recover') {
    const confirm = getFlag(rest, '--confirm', '')
    if (!confirm) {
      process.stderr.write(
        'Usage: agentflow-sdlc adopt recover --confirm <recovery-token> [--target <dir>] [--json]\n',
      )
      return 2
    }
    const result = recoverAdoption(targetDir, { confirm })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else process.stdout.write(`Recovered unfinished adoption ${result.planToken ?? ''}\n`)
    return 0
  }
  process.stderr.write(
    'Usage: agentflow-sdlc adopt <profiles|plan|apply|rollback|recover> [--profile <id>] [--target <dir>] [--json]\n',
  )
  return 2
}

function handleSkills(rest, targetDir) {
  const [subcommand] = positionalArgs(rest)
  const json = rest.includes('--json')
  const harness = getFlag(rest, '--harness', 'all')
  if (subcommand === 'catalog') {
    const result = loadSkillCatalog(packageRoot)
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport('AgentFlow skill catalog', {
        skills: result.skills.map((skill) => `${skill.qualifiedName}: ${skill.owns.join(', ')}`),
      })
    return 0
  }
  if (subcommand === 'validate') {
    const result = validateSkillCatalog({ packageRoot })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport(`AgentFlow skill catalog (${result.ok ? 'READY' : 'FAILED'})`, {
        findings: result.findings.map((item) => `${item.severity} ${item.code}: ${item.message}`),
      })
    return result.ok ? 0 : 1
  }
  if (subcommand === 'sync') {
    const result = syncSkillAdapters({
      packageRoot,
      targetDir,
      harness,
      write: rest.includes('--apply') || !rest.includes('--dry-run'),
    })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport(`Skill adapter sync (${result.mode})`, {
        entries: result.entries.map(
          (entry) => `${entry.harness}:${entry.skill} -> ${entry.target}`,
        ),
      })
    return 0
  }
  if (subcommand === 'status') {
    const result = adapterStatus({ packageRoot, targetDir, harness })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport('Skill adapter status', {
        stale: result.stale.map((entry) => `${entry.harness}:${entry.skill}`),
      })
    return result.stale.length ? 1 : 0
  }
  process.stderr.write(
    `Usage:\n  agentflow-sdlc skills catalog [--json]\n  agentflow-sdlc skills validate [--json]\n  agentflow-sdlc skills sync [--target <dir>] [--harness all|claude-code,agy,codex,pi] [--dry-run|--apply] [--json]\n  agentflow-sdlc skills status [--target <dir>] [--harness all|claude-code,agy,codex,pi] [--json]\n`,
  )
  return 2
}

function handleRoles(rest, targetDir) {
  const positionals = positionalArgs(rest)
  const [subcommand, identity] = positionals
  const json = rest.includes('--json')
  const harness = getFlag(rest, '--harness', 'all')
  const catalog = loadRoleCatalog(packageRoot)
  if (subcommand === 'catalog' || subcommand === 'list') {
    if (json) process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`)
    else
      printReport('AgentFlow role catalog', {
        roles: catalog.roles.map(
          (role) =>
            `${role.qualifiedName} (${role.kind}${role.phase === null ? '' : ` phase ${role.phase}`}): ${role.purpose}`,
        ),
      })
    return 0
  }
  if (subcommand === 'inspect') {
    const role = roleByIdentity(identity, catalog)
    if (!role) throw new Error(`Unknown role: ${identity ?? ''}`)
    if (json) process.stdout.write(`${JSON.stringify(role, null, 2)}\n`)
    else printReport(role.qualifiedName, { owns: role.owns, doesNotOwn: role.doesNotOwn })
    return 0
  }
  if (subcommand === 'validate') {
    const result = validateRoleCatalog({ packageRoot })
    const configPath = resolve(targetDir, 'agent-workflow.config.json')
    const configResult = validateRoleMethodConfig({
      config: existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {},
      packageRoot,
      catalog: result.catalog,
      methodCatalog: result.methodCatalog,
    })
    result.findings.push(...configResult.findings)
    result.ok = result.ok && configResult.ok
    if (json) process.stdout.write(`${JSON.stringify(result, replacerWithoutCatalogs, 2)}\n`)
    else
      printReport(`AgentFlow role catalog (${result.ok ? 'READY' : 'FAILED'})`, {
        findings: result.findings.map((item) => `${item.severity} ${item.code}: ${item.message}`),
      })
    return result.ok ? 0 : 1
  }
  if (subcommand === 'resolve') {
    const configPath = getFlag(rest, '--config', null)
    const config = configPath
      ? JSON.parse(readFileSync(resolve(configPath), 'utf8'))
      : existsSync(resolve(targetDir, 'agent-workflow.config.json'))
        ? JSON.parse(readFileSync(resolve(targetDir, 'agent-workflow.config.json'), 'utf8'))
        : {}
    const methods = getFlag(rest, '--methods', '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (methods.length) {
      config.roleMethods = config.roleMethods ?? { bindings: {} }
      config.roleMethods.bindings = config.roleMethods.bindings ?? {}
      config.roleMethods.bindings[identity] = methods
    }
    const result = resolveRoleContract({ role: identity, config, packageRoot })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport(`Effective role ${result.role.qualifiedName}`, {
        methods: result.appliedMethods.map((method) => method.id),
        inputs: result.role.inputs,
        outputs: result.role.outputs,
      })
    return 0
  }
  if (subcommand === 'sync') {
    const result = syncRoleAdapters({
      packageRoot,
      targetDir,
      harness,
      write: rest.includes('--apply') && !rest.includes('--dry-run'),
    })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport(`Role adapter sync (${result.mode})`, {
        entries: result.entries.map(
          (entry) => `${entry.harness}:${entry.role ?? 'catalog'} -> ${entry.target}`,
        ),
      })
    return 0
  }
  if (subcommand === 'status') {
    const result = roleAdapterStatus({ packageRoot, targetDir, harness })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else printReport('Role adapter status', { stale: result.stale.map((entry) => entry.target) })
    return result.stale.length ? 1 : 0
  }
  if (subcommand === 'validate-handoff') {
    const path = getFlag(rest, '--path', null)
    if (!path) throw new Error('--path is required')
    const handoff = JSON.parse(readFileSync(resolve(targetDir, path), 'utf8'))
    const result = validateRoleHandoff({ handoff, packageRoot })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport(`Role handoff (${result.ok ? 'READY' : 'FAILED'})`, {
        findings: result.findings.map((item) => item.message),
      })
    return result.ok ? 0 : 1
  }
  process.stderr.write(
    'Usage: agentflow-sdlc roles <catalog|inspect|validate|resolve|sync|status|validate-handoff> [role] [--target <dir>] [--json]\n',
  )
  return 2
}

function handleMethods(rest) {
  const [subcommand] = positionalArgs(rest)
  const json = rest.includes('--json')
  const roleCatalog = loadRoleCatalog(packageRoot)
  const methodCatalog = loadMethodCatalog(packageRoot)
  if (subcommand === 'catalog' || subcommand === 'list') {
    if (json) process.stdout.write(`${JSON.stringify(methodCatalog, null, 2)}\n`)
    else
      printReport('AgentFlow method catalog', {
        methods: methodCatalog.methods.map((method) => `${method.id} -> ${method.role}`),
      })
    return 0
  }
  if (subcommand === 'validate') {
    const result = validateMethodCatalog({ catalog: roleCatalog, methodCatalog })
    if (json) process.stdout.write(`${JSON.stringify(result, replacerWithoutCatalogs, 2)}\n`)
    else
      printReport(`AgentFlow method catalog (${result.ok ? 'READY' : 'FAILED'})`, {
        findings: result.findings.map((item) => item.message),
      })
    return result.ok ? 0 : 1
  }
  process.stderr.write('Usage: agentflow-sdlc methods <catalog|validate> [--json]\n')
  return 2
}

function replacerWithoutCatalogs(key, value) {
  return ['catalog', 'methodCatalog', 'transitionKeys', 'sidecarKeys'].includes(key)
    ? undefined
    : value
}

function handlePlugins(rest, targetDir) {
  const [subcommand] = positionalArgs(rest)
  const json = rest.includes('--json')
  const harness = getFlag(rest, '--harness', 'all')
  if (subcommand === 'build') {
    const result = buildPluginManifests({
      packageRoot,
      targetDir,
      harness,
      write: rest.includes('--apply') && !rest.includes('--dry-run'),
    })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport(`Plugin manifest build (${result.mode})`, {
        entries: result.entries.map((entry) => `${entry.harness} -> ${entry.target}`),
        findings: result.findings.map((item) => item.message),
      })
    return result.ok ? 0 : 1
  }
  if (subcommand === 'validate') {
    const result = validatePluginManifests({ packageRoot, harness })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport('Plugin manifest validation', {
        manifests: result.manifests.map((item) => item.id),
        findings: result.findings.map((item) => item.message),
      })
    return result.ok ? 0 : 1
  }
  if (subcommand === 'status') {
    const result = pluginStatus({ packageRoot, targetDir, harness })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport('Plugin manifest status', {
        stale: result.stale.map((entry) => `${entry.harness}:${entry.status}`),
      })
    return result.stale.length || !result.ok ? 1 : 0
  }
  process.stderr.write(
    `Usage:\n  agentflow-sdlc plugins build [--harness all|claude-code,agy,codex,pi] [--dry-run|--apply] [--json]\n  agentflow-sdlc plugins validate [--harness all|claude-code,agy,codex,pi] [--json]\n  agentflow-sdlc plugins status [--target <dir>] [--harness all|claude-code,agy,codex,pi] [--json]\n`,
  )
  return 2
}

function handleSettings(rest, targetDir) {
  const [subcommand] = positionalArgs(rest)
  const json = rest.includes('--json')
  const harness = getFlag(rest, '--harness', 'all')
  const plugins = validatePluginManifests({ packageRoot, harness }).manifests
  if (subcommand === 'merge') {
    const result = mergeHarnessSettings({
      packageRoot,
      targetDir,
      harness,
      write: rest.includes('--apply') && !rest.includes('--dry-run'),
      pluginManifests: plugins,
    })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport(`Harness settings merge (${result.mode})`, {
        entries: result.entries.map(
          (entry) => `${entry.harness}:${entry.status} -> ${entry.target}`,
        ),
        findings: result.findings.map((item) => item.message),
      })
    return result.ok ? 0 : 1
  }
  if (subcommand === 'status') {
    const result = harnessSettingsStatus({
      packageRoot,
      targetDir,
      harness,
      pluginManifests: plugins,
    })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport('Harness settings status', {
        stale: result.stale.map((entry) => `${entry.harness}:${entry.status}`),
        findings: result.findings.map((item) => item.message),
      })
    return result.stale.length || !result.ok ? 1 : 0
  }
  if (subcommand === 'validate') {
    const result = validateSettingsManifest({ packageRoot, pluginManifests: plugins })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport('Harness settings manifest validation', {
        findings: result.findings.map((item) => item.message),
      })
    return result.ok ? 0 : 1
  }
  process.stderr.write(
    `Usage:\n  agentflow-sdlc settings merge [--harness all|claude-code,agy,codex,pi] [--dry-run|--apply] [--json]\n  agentflow-sdlc settings status [--target <dir>] [--harness all|claude-code,agy,codex,pi] [--json]\n  agentflow-sdlc settings validate [--harness all|claude-code,agy,codex,pi] [--json]\n`,
  )
  return 2
}

function handleCockpit(rest, targetDir) {
  const [subcommand] = positionalArgs(rest)
  const pass = rest.filter((arg) => arg !== subcommand)
  if (subcommand === 'doctor') return runScript('scripts/cockpit-doctor.mjs', pass, targetDir)
  if (!subcommand || subcommand === 'start') {
    const result = spawnSync(
      process.execPath,
      [resolve(packageRoot, 'scripts/cockpit-server.mjs')],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          AGENTFLOW_REPOSITORIES:
            process.env.AGENTFLOW_REPOSITORIES || process.env.COCKPIT_REPOSITORIES || '',
        },
      },
    )
    return result.status ?? 1
  }
  process.stderr.write(
    `Usage:\n  agentflow-sdlc cockpit [start]\n  agentflow-sdlc cockpit doctor [--json]\n`,
  )
  return 2
}

function handleExtensions(rest, targetDir) {
  const [subcommand, selector] = positionalArgs(rest)
  const json = rest.includes('--json')
  const runValidators = rest.includes('--run-validators')

  if (subcommand === 'list') {
    const registry = buildExtensionRegistry(targetDir)
    if (json) process.stdout.write(`${JSON.stringify(registry, null, 2)}\n`)
    else printExtensionRegistry(registry)
    return 0
  }

  if (subcommand === 'inspect') {
    if (!selector) {
      process.stderr.write(
        'Usage: agentflow-sdlc extensions inspect <pack> [--target <dir>] [--json]\n',
      )
      return 2
    }
    const pack = resolveExtensionPack(targetDir, selector)
    const output = { dir: pack.relativeDir, manifest: pack.manifest }
    if (json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    else process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return 0
  }

  if (subcommand === 'enable' || subcommand === 'disable') {
    if (!selector) {
      process.stderr.write(
        `Usage: agentflow-sdlc extensions ${subcommand} <pack> [--target <dir>] [--json]\n`,
      )
      return 2
    }
    const result = setExtensionPackEnabled(targetDir, selector, subcommand === 'enable')
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      process.stdout.write(
        `${subcommand === 'enable' ? 'Enabled' : 'Disabled'} ${result.pack}${result.changed ? '' : ' (unchanged)'}\n`,
      )
    return 0
  }

  if (subcommand === 'validate') {
    const result = validateConfiguredExtensionPacks(targetDir, { runValidators })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      printReport('Extension validation', {
        valid: result.results
          .filter((item) => item.errors.length === 0)
          .map((item) => item.pack.relativeDir),
        errors: result.results.flatMap((item) => item.errors),
      })
    const failures = result.results.reduce((count, item) => count + item.errors.length, 0)
    return failures > 0 ? 1 : 0
  }

  process.stderr.write(`Usage:
  agentflow-sdlc extensions list [--target <dir>] [--json]
  agentflow-sdlc extensions inspect <pack> [--target <dir>] [--json]
  agentflow-sdlc extensions enable <pack> [--target <dir>] [--json]
  agentflow-sdlc extensions disable <pack> [--target <dir>] [--json]
  agentflow-sdlc extensions validate [--target <dir>] [--json]
`)
  return 2
}

function handleHarness(rest, targetDir) {
  const [subcommand] = positionalArgs(rest)
  const json = rest.includes('--json')
  const force = rest.includes('--force')

  if (subcommand === 'inspect' || !subcommand) {
    const result = inspectHarnessIntelligence(targetDir)
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else {
      process.stdout.write(
        `Harness intelligence (${result.configuredCount}/${result.totalPillars} pillars configured)\n`,
      )
      process.stdout.write(`Directory: ${result.agentflowDir}\n`)
      for (const [pillar, info] of Object.entries(result.status)) {
        process.stdout.write(
          `  - ${pillar}: ${info.exists ? 'configured' : 'missing (using defaults)'}\n`,
        )
      }
    }
    return 0
  }

  if (subcommand === 'scaffold' || subcommand === 'init') {
    const result = scaffoldHarnessIntelligence(targetDir, { force })
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else {
      process.stdout.write(`Scaffolded harness intelligence in ${result.agentflowDir}\n`)
      if (result.created.length) {
        process.stdout.write(`  Created:\n`)
        for (const file of result.created) process.stdout.write(`    + ${file}\n`)
      }
      if (result.existing.length) {
        process.stdout.write(`  Skipped existing (use --force to overwrite):\n`)
        for (const file of result.existing) process.stdout.write(`    = ${file}\n`)
      }
    }
    return 0
  }

  process.stderr.write(`Usage:
  agentflow-sdlc harness <inspect|scaffold> [--target <dir>] [--force] [--json]
`)
  return 2
}

function handleGitHub(rest, targetDir) {
  const [subcommand] = positionalArgs(rest)
  const json = rest.includes('--json')
  const write = rest.includes('--apply') && !rest.includes('--dry-run')

  if (subcommand === 'setup' || !subcommand) {
    const result = setupGitHubGovernance({ targetDir, write })
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      process.stdout.write(`GitHub Governance (${result.mode})\n`)
      process.stdout.write(`Target: ${result.targetDir}\n`)
      for (const op of result.operations) {
        process.stdout.write(`  - ${op.filename}: ${op.status}\n`)
      }
      process.stdout.write(
        `Summary: ${result.summary.plannedCount} planned, ${result.summary.unchangedCount} unchanged, ${result.summary.conflictCount} conflicts\n`,
      )
      if (!write && result.summary.plannedCount > 0) {
        process.stdout.write(`\nRun with --apply to write templates and label definitions.\n`)
      }
    }
    return 0
  }

  process.stderr.write(`Usage:
  agentflow-sdlc github setup [--target <dir>] [--dry-run|--apply] [--json]
`)
  return 2
}

function printOnboardingPrompt(targetDir) {
  process.stdout.write(`${formatOnboardingPrompt(targetDir)}\n`)
}

function positionalArgs(args) {
  const result = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--target') {
      index += 1
      continue
    }
    if (!args[index].startsWith('--')) result.push(args[index])
  }
  return result
}

function handleHandoff(rest, targetDir) {
  const toAgent = getFlag(rest, '--to', null)
  if (!toAgent) {
    throw new Error('--to <agent> is required for handoff')
  }
  const issueId = getFlag(rest, '--issue', 'unspecified-issue')
  const fromAgent = getFlag(rest, '--from', 'current-agent')
  const branch = getFlag(rest, '--branch', 'current-branch')
  const json = rest.includes('--json')

  const packet = createHandoffPacket({
    taskId: issueId,
    issueId,
    fromAgent,
    toAgent,
    currentBranch: branch,
    statusSummary: `Handoff requested to ${toAgent}`,
  })

  if (json) {
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
  } else {
    process.stdout.write(`${packet.markdown}\n`)
  }
  return 0
}

function handleResume(rest, targetDir) {
  const issueId = getFlag(rest, '--issue', null)
  if (!issueId) {
    throw new Error('--issue <id> is required for resume')
  }
  const fromAgent = getFlag(rest, '--from', 'previous-agent')
  const targetAgent = getFlag(rest, '--agent', 'current-agent')
  const machineId = getFlag(rest, '--machine', os.hostname())
  const json = rest.includes('--json')

  const mockPacket = {
    taskId: issueId,
    issueId,
    fromAgent,
    toAgent: targetAgent,
    currentBranch: `work/issue-${issueId}`,
    wipBranch: `wip/${issueId}`,
    fencingToken: 1,
  }

  const result = resumeHandoff({
    packet: mockPacket,
    targetAgent,
    machineId,
    repoDir: targetDir,
  })

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(
      `Resumed issue #${issueId} successfully on machine ${machineId} by ${targetAgent}.\n`,
    )
  }
  return 0
}

const ROOT_USAGE =
  'Usage: agentflow-sdlc <init|run|doctor-env|config|adopt|providers|collaboration|sdlc|cockpit|skills|roles|methods|plugins|settings|extensions|harness|github|onboarding|onboarding-prompt|release-plan|handoff|resume> [path] [--target <dir>] [--json]\n'

const COMMAND_USAGE = {
  init: 'Usage: agentflow-sdlc init [--profile <id>] [--posture <posture>] [--no-harness] [--sync] [--target <dir>] [--force] [--json]\n',
  config:
    'Usage: agentflow-sdlc config <doctor|check|sync|inspect|prompt> [--target <dir>] [--harness <name>] [--dry-run|--apply] [--json]\n',
  run: 'Usage: agentflow-sdlc run <source-plan|start|status|next|freeze|verify|advance|checkpoint|pause|resume|publish> <id> [--target <dir>] [--execute] [--plan <file> --confirm <digest>] [--json]\n',
  'doctor-env': 'Usage: agentflow-sdlc doctor-env [--inspect] [--target <dir>] [--json]\n',
  adopt:
    'Usage: agentflow-sdlc adopt <profiles|plan|apply|rollback|recover> [--profile <id>] [--target <dir>] [--json]\n',
  providers:
    'Usage: agentflow-sdlc providers <list|inspect <id>|bind [--provider <id>] [--mode <mode>] [--profile <profile>]> --json\n',
  collaboration:
    'Usage: agentflow-sdlc collaboration <classify|plan|verify|advance|validate> [options] [--target <dir>] [--json]\n',
  roles:
    'Usage: agentflow-sdlc roles <catalog|inspect|validate|resolve|sync|status|validate-handoff> [role] [--json]\n',
  methods: 'Usage: agentflow-sdlc methods <catalog|validate> [--json]\n',
  harness: 'Usage: agentflow-sdlc harness <inspect|scaffold> [--target <dir>] [--force] [--json]\n',
  github: 'Usage: agentflow-sdlc github <setup> [--target <dir>] [--dry-run|--apply] [--json]\n',
  onboarding:
    'Usage: agentflow-sdlc onboarding <inspect|plan|apply|verify|recover|runtime-request> [--target <dir>] [--profile <id>] [--runtime-request <file>] [--runtime-evidence <file>] [--choices <file>] [--plan <file>] [--confirm <digest>] [--json]\n',
  handoff:
    'Usage: agentflow-sdlc handoff --to <agent> [--issue <id>] [--branch <branch>] [--from <agent>] [--target <dir>] [--json]\n',
  resume:
    'Usage: agentflow-sdlc resume --issue <id> [--from <agent>] [--agent <agent>] [--machine <id>] [--target <dir>] [--json]\n',
}

function requestedHelp(args) {
  return args.includes('--help') || args.includes('-h')
}

function main() {
  const [command, ...rest] = process.argv.slice(2)

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(ROOT_USAGE)
    return 0
  }
  if (requestedHelp(rest)) {
    process.stdout.write(COMMAND_USAGE[command] ?? ROOT_USAGE)
    return 0
  }

  const targetDir = resolve(getFlag(rest, '--target', process.cwd()))
  if (command === 'run') return runScript('scripts/run-delivery.mjs', rest, targetDir)

  if (command === 'init') {
    try {
      return handleInit(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'config') {
    try {
      return handleConfig(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'cockpit') {
    return handleCockpit(rest, targetDir)
  }

  if (command === 'adopt') {
    try {
      return handleAdoption(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'providers') {
    return runScript('scripts/provider-status.mjs', rest, targetDir)
  }

  if (command === 'collaboration') {
    return runScript('scripts/role-collaboration.mjs', rest, targetDir)
  }

  if (command === 'plugins') {
    return handlePlugins(rest, targetDir)
  }

  if (command === 'settings') {
    return handleSettings(rest, targetDir)
  }

  if (command === 'skills') {
    return handleSkills(rest, targetDir)
  }

  if (command === 'roles') {
    try {
      return handleRoles(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'methods') {
    try {
      return handleMethods(rest)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'sdlc') {
    return handleSdlc(rest, targetDir)
  }

  if (command === 'extensions') {
    try {
      return handleExtensions(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'harness') {
    try {
      return handleHarness(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'github') {
    try {
      return handleGitHub(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'doctor-env') {
    if (rest.includes('--probe')) return runScript('scripts/probe-environment.mjs', rest, targetDir)
    if (rest.includes('--inspect')) {
      const report = inspectEnvironment(targetDir)
      report.harnessIntelligence = inspectHarnessIntelligence(targetDir)
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return report.readiness === 'blocked' ? 3 : 0
    }
    const report = validateEnvironment(targetDir)
    if (rest.includes('--json')) {
      report.harnessIntelligence = inspectHarnessIntelligence(targetDir)
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      printEnvironmentReport(report)
      const harnessInfo = inspectHarnessIntelligence(targetDir)
      process.stdout.write(
        `Harness intelligence: ${harnessInfo.configuredCount}/${harnessInfo.totalPillars} pillars configured in .agentflow/\n\n`,
      )
    }
    return report.ok ? 0 : 1
  }

  if (command === 'onboarding') {
    try {
      return handleOnboarding(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'onboarding-prompt') {
    printOnboardingPrompt(targetDir)
    return 0
  }

  if (command === 'release-plan') {
    const plan = buildReleasePlan({
      repoRoot: targetDir,
      bump: getFlag(rest, '--bump', 'fix'),
      currentVersion: getFlag(rest, '--current', undefined),
      notesPath: getFlag(rest, '--notes', undefined),
    })
    if (rest.includes('--json')) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    else printReleasePlan(plan)
    return 0
  }

  if (command === 'handoff') {
    try {
      return handleHandoff(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  if (command === 'resume') {
    try {
      return handleResume(rest, targetDir)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  process.stderr.write(ROOT_USAGE)
  return 2
}

// Let pending stdout/stderr writes drain before Node exits.
process.exitCode = main()
