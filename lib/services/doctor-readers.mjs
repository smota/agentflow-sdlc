import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
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

export function hashFileSha256(filePath, maxBytes = MAX_FILE_SIZE) {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size > maxBytes) return null
    return createHash('sha256').update(readFileSync(filePath)).digest('hex')
  } catch {
    return null
  }
}

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
        reason: 'Config authority validation failed: ' + authority.validation.errors.join(', '),
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
        alignment: 'matched',
        reason: 'Config authority separation is valid and satisfied.',
        proposedChange: null,
        preservedPaths: ['sdlc.config.json', 'agent-workflow.config.json'],
        evidence: { domainPath: authority.domainPath, workflowPath: authority.workflowPath },
      })
    }
  } catch (error) {
    findings.push({
      id: 'config.authority',
      dimension: 'project-configs',
      target: 'sdlc.config.json',
      structural: 'invalid',
      alignment: 'unknown',
      reason: 'Config authority resolution error: ' + error.message,
      proposedChange: 'Define canonical configuration authority.',
      preservedPaths: [],
      evidence: { error: error.message },
    })
  }

  // 2. agent-workflow.config.json
  const workflowPath = join(root, 'agent-workflow.config.json')
  let workflowConfig = null
  if (!existsSync(workflowPath)) {
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
  } else {
    try {
      workflowConfig = JSON.parse(readFileSync(workflowPath, 'utf8'))
      findings.push({
        id: 'config.workflow',
        dimension: 'project-configs',
        target: 'agent-workflow.config.json',
        structural: 'valid',
        alignment: 'matched',
        reason: 'agent-workflow.config.json is valid JSON.',
        proposedChange: null,
        preservedPaths: ['agent-workflow.config.json'],
        evidence: { posture: workflowConfig?.posture || 'assisted' },
      })
    } catch (error) {
      findings.push({
        id: 'config.workflow',
        dimension: 'project-configs',
        target: 'agent-workflow.config.json',
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'agent-workflow.config.json JSON parse error: ' + error.message,
        proposedChange: 'Fix syntax error in agent-workflow.config.json.',
        preservedPaths: ['AGENTS.md'],
        evidence: { error: error.message },
      })
    }
  }

  // 3. sdlc.config.json
  const sdlcPath = join(root, 'sdlc.config.json')
  if (!existsSync(sdlcPath) && !existsSync(join(root, '.agentflow/sdlc.config.json'))) {
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
          reason:
            'SDLC config shape errors: ' +
            shape.findings
              .filter((f) => f.severity === 'high')
              .map((f) => f.message)
              .join('; '),
          proposedChange: 'Correct schema violations in sdlc.config.json.',
          preservedPaths: ['agent-workflow.config.json'],
          evidence: { findings: shape.findings },
        })
      } else {
        findings.push({
          id: 'config.sdlc',
          dimension: 'project-configs',
          target: 'sdlc.config.json',
          structural: 'valid',
          alignment: 'matched',
          reason: 'sdlc.config.json satisfies domain schema shape.',
          proposedChange: null,
          preservedPaths: ['sdlc.config.json'],
          evidence: { profile: shape.profile },
        })
      }
    } catch (error) {
      findings.push({
        id: 'config.sdlc',
        dimension: 'project-configs',
        target: 'sdlc.config.json',
        structural: 'invalid',
        alignment: 'unknown',
        reason: 'SDLC config error: ' + error.message,
        proposedChange: 'Repair sdlc.config.json.',
        preservedPaths: [],
        evidence: { error: error.message },
      })
    }
  }

  // 4. Harness intelligence pillars in .agentflow/
  try {
    const harnessResult = inspectHarnessIntelligence(root)
    if (harnessResult.configuredCount < harnessResult.totalPillars) {
      findings.push({
        id: 'config.pillars',
        dimension: 'project-configs',
        target: '.agentflow/',
        structural: 'missing',
        alignment: 'unknown',
        reason:
          'Harness pillars incomplete: ' +
          harnessResult.configuredCount +
          '/' +
          harnessResult.totalPillars +
          ' configured.',
        proposedChange: 'Configure missing harness pillars in .agentflow/.',
        preservedPaths: ['sdlc.config.json'],
        evidence: { status: harnessResult.status },
      })
    } else {
      findings.push({
        id: 'config.pillars',
        dimension: 'project-configs',
        target: '.agentflow/',
        structural: 'valid',
        alignment: 'matched',
        reason: 'All harness intelligence pillars are configured.',
        proposedChange: null,
        preservedPaths: ['.agentflow/'],
        evidence: { configuredCount: harnessResult.configuredCount },
      })
    }
  } catch (error) {
    findings.push({
      id: 'config.pillars',
      dimension: 'project-configs',
      target: '.agentflow/',
      structural: 'invalid',
      alignment: 'unknown',
      reason: 'Harness pillars evaluation error: ' + error.message,
      proposedChange: 'Verify .agentflow/ pillar files.',
      preservedPaths: [],
      evidence: { error: error.message },
    })
  }

  return findings
}

export function readLockfile({ targetDir }) {
  const root = resolve(targetDir)
  const lockCandidates = ['.agentflow-lock.json', 'agentflow-lock.json']
  const found = lockCandidates.find((name) => existsSync(join(root, name)))

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
        evidence: { searched: lockCandidates },
      },
    ]
  }

  const lockPath = join(root, found)
  try {
    const raw = readFileSync(lockPath, 'utf8')
    const parsed = JSON.parse(raw)
    validateAdoptionLock(parsed)
    return [
      {
        id: 'lock.presence',
        dimension: 'lock-integrity',
        target: found,
        structural: 'valid',
        alignment: 'matched',
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
            receipt = JSON.parse(readFileSync(rPath, 'utf8'))
            break
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

  const mutations = receipt.mutations || []
  let diffCount = 0
  let matchCount = 0

  for (const m of mutations) {
    if (!m.path || typeof m.path !== 'string') continue
    if (!isSafePath(root, m.path)) continue
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
        evidence: { expectedHash: m.afterHash || m.hash },
      })
      continue
    }
    const currentHash = hashFileSha256(full)
    const expectedHash = m.afterHash || m.hash
    if (expectedHash && currentHash !== expectedHash) {
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

  if (diffCount === 0) {
    findings.push({
      id: 'baseline.receipt',
      dimension: 'lock-integrity',
      target: 'baseline',
      structural: 'valid',
      alignment: 'matched',
      reason: 'All ' + matchCount + ' tracked baseline entries match confirmed receipt.',
      proposedChange: null,
      preservedPaths: mutations.map((m) => m.path),
      evidence: { matchCount, receiptToken: receipt.receiptToken || receipt.planToken },
    })
  }

  return findings
}

export function readAdapterBindings({ packageRoot, targetDir, harnesses = ['all'] }) {
  const root = resolve(targetDir)
  const pkgRoot = packageRoot ? resolve(packageRoot) : root
  const findings = []

  const requestedHarness = harnesses[0] || 'all'
  try {
    const skillRes = adapterStatus({
      packageRoot: pkgRoot,
      targetDir: root,
      harness: requestedHarness,
    })
    const roleRes = roleAdapterStatus({
      packageRoot: pkgRoot,
      targetDir: root,
      harness: requestedHarness,
    })
    const pluginRes = pluginStatus({
      packageRoot: pkgRoot,
      targetDir: root,
      harness: requestedHarness,
    })
    const settingRes = harnessSettingsStatus({
      packageRoot: pkgRoot,
      targetDir: root,
      harness: requestedHarness,
    })

    const staleSkills = skillRes.stale || []
    const staleRoles = roleRes.stale || []
    const stalePlugins = pluginRes.stale || []
    const staleSettings = settingRes.stale || []

    const hasDrift =
      staleSkills.length || staleRoles.length || stalePlugins.length || staleSettings.length
    if (hasDrift) {
      findings.push({
        id: 'adapters.sync',
        dimension: 'adapter-bindings',
        target: 'adapters',
        structural: 'valid',
        alignment: 'differing',
        reason:
          'Adapter drift detected: ' +
          staleSkills.length +
          ' stale skills, ' +
          staleRoles.length +
          ' stale roles, ' +
          stalePlugins.length +
          ' stale plugins, ' +
          staleSettings.length +
          ' stale settings.',
        proposedChange: 'Synchronize stale adapter artifacts for configured harnesses.',
        preservedPaths: ['AGENTS.md', 'agent-workflow.config.json'],
        evidence: {
          staleSkills: staleSkills.map((s) => s.skill || s.name),
          staleRoles: staleRoles.map((r) => r.role || r.name),
        },
      })
    } else {
      findings.push({
        id: 'adapters.sync',
        dimension: 'adapter-bindings',
        target: 'adapters',
        structural: 'valid',
        alignment: 'matched',
        reason: 'All configured harness adapter bindings are synchronized.',
        proposedChange: null,
        preservedPaths: ['.claude/', '.codex/', '.agy/', '.pi/'],
        evidence: { harness: requestedHarness },
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

  if (runtimeEvidence && Array.isArray(runtimeEvidence.tools)) {
    for (const ev of runtimeEvidence.tools) {
      findings.push({
        id: 'runtime.evidence.' + ev.name,
        dimension: 'runtime-reachability',
        target: ev.name,
        structural: ev.status === 'ready' ? 'valid' : 'invalid',
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
        evidence: ev,
      })
    }
  }

  return findings
}
