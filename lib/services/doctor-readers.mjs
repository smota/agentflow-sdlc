import { existsSync, readFileSync, statSync, lstatSync, realpathSync, readdirSync } from 'node:fs'
import { join, resolve, delimiter, isAbsolute, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { resolveConfigAuthority } from '../config/authority.mjs'
import { loadSdlcConfig, validateSdlcConfigShape } from '../sdlc-state.mjs'
import { inspectHarnessIntelligence } from '../config/harness-intelligence.mjs'
import { adapterStatus } from '../skill-adapters.mjs'
import { roleAdapterStatus } from '../role-adapters.mjs'
import { pluginStatus } from '../plugin-manifests.mjs'
import { harnessSettingsStatus } from '../structural-merge.mjs'
import { validateAdoptionLock } from '../adoption/lock-validation.mjs'

export const MAX_FILE_SIZE = 10 * 1024 * 1024
export const MAX_AGGREGATE_SIZE = 64 * 1024 * 1024
export const MAX_ENTRIES = 2048
export const MAX_DETAILED_FINDINGS = 512

export function isSafePath(root, target) {
  try {
    const resolvedRoot = resolve(root)
    const resolvedTarget = resolve(root, target)
    const rel = relative(resolvedRoot, resolvedTarget)
    return !rel.startsWith('..') && !isAbsolute(rel)
  } catch {
    return false
  }
}

export function safeReadFileUtf8(root, relativeOrFullPath, maxBytes = MAX_FILE_SIZE) {
  try {
    const resolvedRoot = resolve(root)
    const fullPath = isAbsolute(relativeOrFullPath)
      ? relativeOrFullPath
      : join(resolvedRoot, relativeOrFullPath)
    const rel = relative(resolvedRoot, fullPath)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return { ok: false, error: 'path-escapes-root' }
    }
    if (!existsSync(fullPath)) {
      return { ok: false, error: 'not-found' }
    }
    const lstat = lstatSync(fullPath)
    if (lstat.isSymbolicLink()) {
      const real = realpathSync(fullPath)
      const relReal = relative(resolvedRoot, real)
      if (relReal.startsWith('..') || isAbsolute(relReal)) {
        return { ok: false, error: 'symlink-escapes-root' }
      }
    }
    const stat = statSync(fullPath)
    if (!stat.isFile()) {
      return { ok: false, error: 'not-a-file' }
    }
    if (stat.size > maxBytes) {
      return { ok: false, error: 'exceeds-max-size' }
    }
    return { ok: true, content: readFileSync(fullPath, 'utf8') }
  } catch {
    return { ok: false, error: 'read-error' }
  }
}

export function hashFileSha256(filePath, maxBytes = MAX_FILE_SIZE) {
  try {
    const lstat = lstatSync(filePath)
    if (lstat.isSymbolicLink()) {
      const real = realpathSync(filePath)
      const stat = statSync(real)
      if (!stat.isFile() || stat.size > maxBytes) return null
      return createHash('sha256').update(readFileSync(real)).digest('hex')
    }
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size > maxBytes) return null
    return createHash('sha256').update(readFileSync(filePath)).digest('hex')
  } catch {
    return null
  }
}

export function readProjectConfigs({ targetDir }) {
  const root = resolve(targetDir)
  const findings = []

  // 1. Authority separation
  try {
    const authority = resolveConfigAuthority(root)
    if (!authority.validation.ok) {
      findings.push({
        id: 'config.authority',
        dimension: 'project-configs',
        target: 'sdlc.config.json',
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'Config authority validation failed.',
        proposedChange:
          'Repair configuration authority separation between domain and workflow policy.',
        preservedPaths: ['AGENTS.md'],
        evidence: { errors: authority.validation.errors },
      })
    } else {
      findings.push({
        id: 'config.authority',
        dimension: 'project-configs',
        target: 'sdlc.config.json',
        structural: 'valid',
        alignment: 'unknown',
        reason: 'Config authority separation is valid and satisfied.',
        proposedChange: null,
        preservedPaths: ['sdlc.config.json', 'agent-workflow.config.json'],
        evidence: {
          domainPath: authority.domainPath,
          workflowPath: authority.workflowPath,
        },
      })
    }
  } catch {
    findings.push({
      id: 'config.authority',
      dimension: 'project-configs',
      target: 'sdlc.config.json',
      structural: 'invalid',
      alignment: 'unknown',
      reason: 'Config authority resolution error.',
      proposedChange: 'Define canonical configuration authority.',
      preservedPaths: [],
      evidence: { error: 'resolution-error' },
    })
  }

  // 2. agent-workflow.config.json
  const workflowRead = safeReadFileUtf8(root, 'agent-workflow.config.json')
  if (!workflowRead.ok) {
    if (workflowRead.error === 'not-found') {
      findings.push({
        id: 'config.workflow',
        dimension: 'project-configs',
        target: 'agent-workflow.config.json',
        structural: 'missing',
        alignment: 'unknown',
        reason: 'agent-workflow.config.json is missing.',
        proposedChange: 'Create agent-workflow.config.json with project execution settings.',
        preservedPaths: ['AGENTS.md', '.agentflow/'],
        evidence: { path: 'agent-workflow.config.json' },
      })
    } else if (workflowRead.error === 'symlink-escapes-root') {
      findings.push({
        id: 'config.workflow',
        dimension: 'project-configs',
        target: 'agent-workflow.config.json',
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'agent-workflow.config.json is a symbolic link pointing outside project root.',
        proposedChange: 'Replace escaping symlink with regular configuration file.',
        preservedPaths: ['AGENTS.md'],
        evidence: { error: 'symlink-escapes-root' },
      })
    } else if (workflowRead.error === 'exceeds-max-size') {
      findings.push({
        id: 'config.workflow',
        dimension: 'project-configs',
        target: 'agent-workflow.config.json',
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'agent-workflow.config.json exceeds maximum file size limit (10MiB).',
        proposedChange: 'Reduce configuration file size.',
        preservedPaths: ['AGENTS.md'],
        evidence: { error: 'exceeds-max-size' },
      })
    } else {
      findings.push({
        id: 'config.workflow',
        dimension: 'project-configs',
        target: 'agent-workflow.config.json',
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'agent-workflow.config.json could not be safely read.',
        proposedChange: 'Ensure configuration file is accessible.',
        preservedPaths: ['AGENTS.md'],
        evidence: { error: workflowRead.error },
      })
    }
  } else {
    try {
      const parsed = JSON.parse(workflowRead.content)
      const validPostures = ['assisted', 'autonomous', 'human']
      const posture = validPostures.includes(parsed?.posture) ? parsed.posture : 'assisted'
      const hasInvalidPosture = parsed?.posture && !validPostures.includes(parsed.posture)
      if (hasInvalidPosture) {
        findings.push({
          id: 'config.workflow',
          dimension: 'project-configs',
          target: 'agent-workflow.config.json',
          structural: 'invalid',
          alignment: 'unknown',
          reason: 'agent-workflow.config.json contains invalid posture setting.',
          proposedChange: 'Set valid posture: assisted, autonomous, or human.',
          preservedPaths: ['AGENTS.md'],
          evidence: { error: 'invalid-posture' },
        })
      } else {
        findings.push({
          id: 'config.workflow',
          dimension: 'project-configs',
          target: 'agent-workflow.config.json',
          structural: 'valid',
          alignment: 'unknown',
          reason: 'agent-workflow.config.json is valid JSON.',
          proposedChange: null,
          preservedPaths: ['agent-workflow.config.json'],
          evidence: { posture },
        })
      }
    } catch {
      findings.push({
        id: 'config.workflow',
        dimension: 'project-configs',
        target: 'agent-workflow.config.json',
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'agent-workflow.config.json JSON parse error.',
        proposedChange: 'Fix syntax error in agent-workflow.config.json.',
        preservedPaths: ['AGENTS.md'],
        evidence: { error: 'SyntaxError' },
      })
    }
  }

  // 3. sdlc.config.json
  const sdlcPath = join(root, 'sdlc.config.json')
  const agentflowSdlcPath = join(root, '.agentflow/sdlc.config.json')
  if (!existsSync(sdlcPath) && !existsSync(agentflowSdlcPath)) {
    findings.push({
      id: 'config.sdlc',
      dimension: 'project-configs',
      target: 'sdlc.config.json',
      structural: 'missing',
      alignment: 'unknown',
      reason:
        'sdlc.config.json is missing; packaged defaults do not substitute for project confirmation.',
      proposedChange: 'Initialize sdlc.config.json with confirmed SDLC profile.',
      preservedPaths: ['agent-workflow.config.json'],
      evidence: { path: 'sdlc.config.json' },
    })
  } else {
    try {
      const domainConfig = loadSdlcConfig(root)
      const shape = validateSdlcConfigShape(domainConfig)
      if (shape.findings.some((f) => f.severity === 'high')) {
        findings.push({
          id: 'config.sdlc',
          dimension: 'project-configs',
          target: 'sdlc.config.json',
          structural: 'invalid',
          alignment: 'unknown',
          reason: 'SDLC config shape validation errors.',
          proposedChange: 'Correct schema violations in sdlc.config.json.',
          preservedPaths: ['agent-workflow.config.json'],
          evidence: { findingsCount: shape.findings.length },
        })
      } else {
        findings.push({
          id: 'config.sdlc',
          dimension: 'project-configs',
          target: 'sdlc.config.json',
          structural: 'valid',
          alignment: 'unknown',
          reason: 'sdlc.config.json satisfies domain schema shape.',
          proposedChange: null,
          preservedPaths: ['sdlc.config.json'],
          evidence: { profile: shape.profile },
        })
      }
    } catch {
      findings.push({
        id: 'config.sdlc',
        dimension: 'project-configs',
        target: 'sdlc.config.json',
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'sdlc.config.json could not be loaded or parsed.',
        proposedChange: 'Fix syntax and schema errors in sdlc.config.json.',
        preservedPaths: ['agent-workflow.config.json'],
        evidence: { error: 'load-error' },
      })
    }
  }

  // 4. Pillars (.agentflow/ pillars)
  try {
    const pillars = inspectHarnessIntelligence({ targetDir: root })
    if (pillars.configured.length < pillars.expected.length) {
      findings.push({
        id: 'config.pillars',
        dimension: 'project-configs',
        target: '.agentflow/',
        structural: 'missing',
        alignment: 'unknown',
        reason: 'Missing harness intelligence pillars: ' + pillars.missing.join(', '),
        proposedChange:
          'Scaffold missing harness intelligence pillars using agentflow-sdlc config sync.',
        preservedPaths: ['agent-workflow.config.json'],
        evidence: { missingPillars: pillars.missing },
      })
    } else {
      findings.push({
        id: 'config.pillars',
        dimension: 'project-configs',
        target: '.agentflow/',
        structural: 'valid',
        alignment: 'unknown',
        reason: 'All harness intelligence pillars are configured.',
        proposedChange: null,
        preservedPaths: ['.agentflow/'],
        evidence: { configuredCount: pillars.configured.length },
      })
    }
  } catch {
    findings.push({
      id: 'config.pillars',
      dimension: 'project-configs',
      target: '.agentflow/',
      structural: 'invalid',
      alignment: 'unknown',
      reason: 'Failed to inspect harness intelligence pillars.',
      proposedChange: 'Verify .agentflow directory permissions and structure.',
      preservedPaths: [],
      evidence: { error: 'pillar-inspection-error' },
    })
  }

  return findings
}

export function readLockfile({ targetDir }) {
  const root = resolve(targetDir)
  const candidateNames = ['.agentflow-lock.json', 'agentflow-lock.json']
  let found = null
  for (const name of candidateNames) {
    if (existsSync(join(root, name))) {
      found = name
      break
    }
  }

  if (!found) {
    return [
      {
        id: 'lock.presence',
        dimension: 'lock-integrity',
        target: '.agentflow-lock.json',
        structural: 'missing',
        alignment: 'unknown',
        reason: 'Adoption lockfile is missing.',
        proposedChange: 'Generate adoption lockfile through adoption or refinement.',
        preservedPaths: ['agent-workflow.config.json', 'sdlc.config.json'],
        evidence: { searched: candidateNames },
      },
    ]
  }

  const lockRead = safeReadFileUtf8(root, found)
  if (!lockRead.ok) {
    return [
      {
        id: 'lock.presence',
        dimension: 'lock-integrity',
        target: found,
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'Adoption lockfile ' + found + ' could not be safely read.',
        proposedChange: 'Ensure adoption lockfile is accessible.',
        preservedPaths: ['agent-workflow.config.json'],
        evidence: { error: lockRead.error },
      },
    ]
  }

  try {
    const parsed = JSON.parse(lockRead.content)
    validateAdoptionLock(parsed)
    return [
      {
        id: 'lock.presence',
        dimension: 'lock-integrity',
        target: found,
        structural: 'valid',
        alignment: 'unknown',
        reason:
          'Adoption lockfile ' +
          found +
          ' is structurally valid with ' +
          (parsed.entries?.length || 0) +
          ' entries.',
        proposedChange: null,
        preservedPaths: [found],
        evidence: { target: found, entriesCount: parsed.entries?.length || 0 },
      },
    ]
  } catch (error) {
    return [
      {
        id: 'lock.presence',
        dimension: 'lock-integrity',
        target: found,
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'Adoption lockfile ' + found + ' is invalid: ' + error.message,
        proposedChange: 'Reconstruct adoption lockfile to match verified state.',
        preservedPaths: ['agent-workflow.config.json'],
        evidence: { error: error.message },
      },
    ]
  }
}

export function readBaselineAlignment({ targetDir, baselineReceipt = null }) {
  const root = resolve(targetDir)
  const findings = []

  let receipt = baselineReceipt
  if (!receipt) {
    const txDir = join(root, '.agentflow/transactions')
    if (existsSync(txDir)) {
      try {
        const dirs = readdirSync(txDir)
        for (const dir of dirs.sort().reverse()) {
          const rPath = join(txDir, dir, 'receipt.json')
          if (existsSync(rPath)) {
            const rRead = safeReadFileUtf8(root, rPath)
            if (rRead.ok) {
              receipt = JSON.parse(rRead.content)
              break
            }
          }
        }
      } catch {
        // Read-only
      }
    }
  }

  if (!receipt) {
    findings.push({
      id: 'baseline.receipt',
      dimension: 'lock-integrity',
      target: 'baseline',
      structural: 'unknown',
      alignment: 'unknown',
      reason:
        'No retained applied adoption or refinement receipt found. Baseline alignment is unknown.',
      proposedChange: 'Record adoption or refinement confirmation receipt.',
      preservedPaths: ['sdlc.config.json', 'agent-workflow.config.json'],
      evidence: { receiptPresent: false },
    })
    return findings
  }

  // Schema validation for receipt
  if (
    !receipt ||
    typeof receipt !== 'object' ||
    !Array.isArray(receipt.mutations) ||
    receipt.mutations.length === 0
  ) {
    findings.push({
      id: 'baseline.receipt',
      dimension: 'lock-integrity',
      target: 'baseline',
      structural: 'invalid',
      alignment: 'unknown',
      reason:
        'Adoption receipt contains no valid tracked mutations. Baseline alignment is unknown.',
      proposedChange: 'Record adoption or refinement confirmation receipt with tracked mutations.',
      preservedPaths: ['sdlc.config.json', 'agent-workflow.config.json'],
      evidence: { receiptPresent: true, validMutations: false },
    })
    return findings
  }

  const mutations = receipt.mutations.slice(0, MAX_ENTRIES)
  let diffCount = 0
  let matchCount = 0

  for (const m of mutations) {
    if (!m || typeof m !== 'object') continue
    if (!m.path || typeof m.path !== 'string' || !isSafePath(root, m.path)) {
      diffCount++
      findings.push({
        id: 'baseline.drift.' + (m.path || 'invalid-entry'),
        dimension: 'lock-integrity',
        target: String(m.path || 'invalid-entry'),
        structural: 'invalid',
        alignment: 'differing',
        reason:
          'Baseline entry path ' + (m.path || 'invalid') + ' escapes project root or is invalid.',
        proposedChange: 'Remove or correct escaping baseline entry.',
        preservedPaths: ['agent-workflow.config.json'],
        evidence: { invalidPath: m.path },
      })
      continue
    }

    const expectedHash =
      typeof m.afterHash === 'string' && m.afterHash.length === 64
        ? m.afterHash
        : typeof m.hash === 'string' && m.hash.length === 64
          ? m.hash
          : null

    if (!expectedHash) {
      diffCount++
      findings.push({
        id: 'baseline.drift.' + m.path,
        dimension: 'lock-integrity',
        target: m.path,
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'Baseline entry ' + m.path + ' lacks valid SHA-256 hash.',
        proposedChange: 'Update baseline receipt with valid file hashes.',
        preservedPaths: ['agent-workflow.config.json'],
        evidence: { path: m.path },
      })
      continue
    }

    const full = join(root, m.path)
    if (!existsSync(full)) {
      diffCount++
      findings.push({
        id: 'baseline.drift.' + m.path,
        dimension: 'lock-integrity',
        target: m.path,
        structural: 'missing',
        alignment: 'differing',
        reason: 'Baseline file ' + m.path + ' is missing from workspace.',
        proposedChange: 'Restore ' + m.path + ' from confirmed baseline.',
        preservedPaths: ['agent-workflow.config.json'],
        evidence: { expectedHash },
      })
      continue
    }

    try {
      const lstat = lstatSync(full)
      if (lstat.isSymbolicLink()) {
        const real = realpathSync(full)
        const relReal = relative(root, real)
        if (relReal.startsWith('..') || isAbsolute(relReal)) {
          diffCount++
          findings.push({
            id: 'baseline.drift.' + m.path,
            dimension: 'lock-integrity',
            target: m.path,
            structural: 'invalid',
            alignment: 'differing',
            reason: 'Baseline file ' + m.path + ' is a symlink pointing outside project root.',
            proposedChange: 'Replace escaping symlink with regular file.',
            preservedPaths: ['agent-workflow.config.json'],
            evidence: { expectedHash },
          })
          continue
        }
      }
    } catch {
      diffCount++
      findings.push({
        id: 'baseline.drift.' + m.path,
        dimension: 'lock-integrity',
        target: m.path,
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'Baseline file ' + m.path + ' could not be verified.',
        proposedChange: 'Check permissions and accessibility.',
        preservedPaths: ['agent-workflow.config.json'],
        evidence: { expectedHash },
      })
      continue
    }

    const currentHash = hashFileSha256(full)
    if (currentHash !== expectedHash) {
      diffCount++
      findings.push({
        id: 'baseline.drift.' + m.path,
        dimension: 'lock-integrity',
        target: m.path,
        structural: 'valid',
        alignment: 'differing',
        reason: 'Configuration drift in ' + m.path + ': current hash differs from baseline.',
        proposedChange: 'Realign ' + m.path + ' with confirmed configuration digest.',
        preservedPaths: ['AGENTS.md'],
        evidence: { currentHash, expectedHash },
      })
    } else {
      matchCount++
    }
  }

  if (diffCount === 0 && matchCount > 0) {
    findings.push({
      id: 'baseline.receipt',
      dimension: 'lock-integrity',
      target: 'baseline',
      structural: 'valid',
      alignment: 'matched',
      reason: 'All ' + matchCount + ' tracked baseline entries match confirmed receipt.',
      proposedChange: null,
      preservedPaths: mutations
        .map((m) => m.path)
        .filter((p) => typeof p === 'string' && isSafePath(root, p)),
      evidence: { matchCount, receiptToken: receipt.receiptToken || receipt.planToken },
    })
  } else if (matchCount === 0 && diffCount === 0) {
    findings.push({
      id: 'baseline.receipt',
      dimension: 'lock-integrity',
      target: 'baseline',
      structural: 'invalid',
      alignment: 'unknown',
      reason: 'Baseline receipt contains no verifiable matching entries.',
      proposedChange: 'Record confirmed adoption receipt.',
      preservedPaths: ['agent-workflow.config.json'],
      evidence: { matchCount: 0 },
    })
  }

  return findings
}

export function readAdapterBindings({ packageRoot, targetDir, harnesses = ['all'] }) {
  const root = resolve(targetDir)
  const pkgRoot = packageRoot ? resolve(packageRoot) : root
  const findings = []

  const requestedHarnesses = harnesses.includes('all')
    ? ['claude-code', 'agy', 'codex', 'pi']
    : harnesses.filter(Boolean)

  let totalStaleSkills = 0
  let totalStaleRoles = 0
  let totalStalePlugins = 0
  let totalStaleSettings = 0
  const staleSkillNames = new Set()
  const staleRoleNames = new Set()

  try {
    for (const h of requestedHarnesses) {
      const skillRes = adapterStatus({ packageRoot: pkgRoot, targetDir: root, harness: h })
      const roleRes = roleAdapterStatus({ packageRoot: pkgRoot, targetDir: root, harness: h })
      const pluginRes = pluginStatus({ packageRoot: pkgRoot, targetDir: root, harness: h })
      const settingRes = harnessSettingsStatus({
        packageRoot: pkgRoot,
        targetDir: root,
        harness: h,
      })

      const staleSkills = skillRes.stale || []
      const staleRoles = roleRes.stale || []
      const stalePlugins = pluginRes.stale || []
      const staleSettings = settingRes.stale || []

      totalStaleSkills += staleSkills.length
      totalStaleRoles += staleRoles.length
      totalStalePlugins += stalePlugins.length
      totalStaleSettings += staleSettings.length

      for (const s of staleSkills) staleSkillNames.add(s.skill || s.name || s.adapterName)
      for (const r of staleRoles) staleRoleNames.add(r.role || r.name)
    }

    const hasDrift =
      totalStaleSkills > 0 || totalStaleRoles > 0 || totalStalePlugins > 0 || totalStaleSettings > 0
    if (hasDrift) {
      findings.push({
        id: 'adapters.sync',
        dimension: 'adapter-bindings',
        target: 'adapters',
        structural: 'valid',
        alignment: 'differing',
        reason:
          'Adapter drift detected across requested harnesses: ' +
          totalStaleSkills +
          ' stale skills, ' +
          totalStaleRoles +
          ' stale roles, ' +
          totalStalePlugins +
          ' stale plugins, ' +
          totalStaleSettings +
          ' stale settings.',
        proposedChange: 'Synchronize stale adapter artifacts for configured harnesses.',
        preservedPaths: ['AGENTS.md', 'agent-workflow.config.json'],
        evidence: {
          harnesses: requestedHarnesses,
          staleSkillsCount: totalStaleSkills,
          staleRolesCount: totalStaleRoles,
        },
      })
    } else {
      findings.push({
        id: 'adapters.sync',
        dimension: 'adapter-bindings',
        target: 'adapters',
        structural: 'valid',
        alignment: 'matched',
        reason:
          'All configured harness adapter bindings are synchronized across requested harnesses.',
        proposedChange: null,
        preservedPaths: ['.claude/', '.codex/', '.agy/', '.pi/'],
        evidence: { harnesses: requestedHarnesses },
      })
    }
  } catch (error) {
    findings.push({
      id: 'adapters.sync',
      dimension: 'adapter-bindings',
      target: 'adapters',
      structural: 'invalid',
      alignment: 'unknown',
      reason: 'Adapter binding check error: ' + error.message,
      proposedChange: 'Inspect harness adapter configurations.',
      preservedPaths: [],
      evidence: { error: error.message },
    })
  }

  return findings
}

export function readRuntimeReachability({ runtimeRequest = null, runtimeEvidence = null }) {
  const findings = []
  const coreTools = ['git', 'node', 'pnpm', 'gh']
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean)

  for (const name of coreTools) {
    let located = false
    let executablePath = null

    for (const dir of pathDirs) {
      const candidate = join(dir, process.platform === 'win32' ? name + '.exe' : name)
      try {
        if (existsSync(candidate)) {
          const stat = statSync(candidate)
          if (stat.isFile() && (process.platform === 'win32' || (stat.mode & 0o111) !== 0)) {
            located = true
            executablePath = candidate
            break
          }
        }
      } catch {
        // Read-only
      }
    }

    if (!located) {
      findings.push({
        id: 'runtime.tool.' + name,
        dimension: 'runtime-reachability',
        target: name,
        structural: 'missing',
        alignment: 'unknown',
        reason: 'Runtime tool ' + name + ' is missing from PATH.',
        proposedChange: 'Install ' + name + ' on host system.',
        preservedPaths: [],
        evidence: { located: false },
      })
    } else {
      findings.push({
        id: 'runtime.tool.' + name,
        dimension: 'runtime-reachability',
        target: name,
        structural: 'valid',
        alignment: 'unknown',
        reason:
          'Runtime tool ' +
          name +
          ' is located at ' +
          executablePath +
          '; live reachability/authentication is unknown (read-only invariant).',
        proposedChange: null,
        preservedPaths: [],
        evidence: { located: true, path: executablePath, liveReachability: 'unknown' },
      })
    }
  }

  if (runtimeRequest && (!runtimeEvidence || runtimeEvidence.requestId !== runtimeRequest.id)) {
    findings.push({
      id: 'runtime.request.validation',
      dimension: 'runtime-reachability',
      target: 'runtime-request',
      structural: 'unknown',
      alignment: 'unknown',
      reason: 'Runtime evidence does not match active runtime request id: ' + runtimeRequest.id,
      proposedChange: null,
      preservedPaths: [],
      evidence: { expectedRequestId: runtimeRequest.id },
    })
  }

  if (runtimeEvidence && Array.isArray(runtimeEvidence.tools)) {
    for (const ev of runtimeEvidence.tools) {
      if (!ev || typeof ev !== 'object') continue
      const isDeclaredOnly = ev.provenance === 'declared-only' || !ev.observedAt
      if (isDeclaredOnly) {
        findings.push({
          id: 'runtime.evidence.' + ev.name,
          dimension: 'runtime-reachability',
          target: ev.name,
          structural: 'unknown',
          alignment: 'unknown',
          reason:
            'Caller-supplied runtime evidence for ' +
            ev.name +
            ' is declared-only without live verification.',
          proposedChange: null,
          preservedPaths: [],
          evidence: { name: ev.name, status: ev.status, provenance: 'declared-only' },
        })
      } else {
        const isReady = ev.status === 'ready'
        findings.push({
          id: 'runtime.evidence.' + ev.name,
          dimension: 'runtime-reachability',
          target: ev.name,
          structural: isReady ? 'valid' : 'invalid',
          alignment: 'unknown',
          reason:
            'Caller-supplied runtime evidence: ' +
            ev.name +
            ' is ' +
            ev.status +
            ' (' +
            (ev.provenance || 'observed') +
            ').',
          proposedChange: null,
          preservedPaths: [],
          evidence: { name: ev.name, status: ev.status, provenance: ev.provenance || 'observed' },
        })
      }
    }
  }

  return findings
}
