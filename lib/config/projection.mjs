import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { loadAuthoritativeConfigs, validateConfigAuthority } from './authority.mjs'

export const DEFAULT_ORCHESTRATION_MODEL = {
  lifecycle: 'dual-gate',
  preCodeReview: {
    enabled: true,
    gate: 'specification-sparring',
    targetPhases: ['architect', 'implementation-planner'],
    blockingSeverity: ['blocker', 'structural'],
  },
  concurrency: {
    maxWriters: 1,
    maxAdvisors: 3,
    isolatedWorktreeRequired: true,
  },
}

export const DEFAULT_EXECUTION_POLICY = {
  escalation: {
    maxAttemptsPerTier: 2,
    tierProgression: ['balanced', 'deep-reasoning', 'architect-lead'],
    suspendOnRepeatedRejections: 2,
  },
  fallbackCascade: {
    primary: 'external-cli',
    onQuotaExhausted: 'human-gate',
    onSubagentExhausted: 'human-gate',
    recordDegradationInEvidence: true,
  },
}

export const DEFAULT_MODEL_CATALOG = {
  tiers: {
    'architect-lead': {
      capabilities: ['high-context', 'formal-logic', 'deep-reasoning'],
      defaultEffort: 'medium',
      fallbacks: ['antigravity/gemini-4-argon', 'claude-opus-4-6', 'o1'],
      highEffortMaxContextTokens: 30000,
      preferredModel: 'grok-4.7',
      recommended2026Model: 'gpt-6.1-sol',
    },
    'deep-reasoning': {
      capabilities: ['adversarial-audit', 'security-analysis'],
      defaultEffort: 'medium',
      fallbacks: ['antigravity/gemini-3.1-pro', 'claude-opus-4-6', 'o3-mini'],
      highEffortMaxContextTokens: 35000,
      preferredModel: 'grok-4.7',
      recommended2026Model: 'gpt-6-astra',
    },
    balanced: {
      capabilities: ['fast-implementation', 'unit-testing', 'subagent-coordination'],
      defaultEffort: 'medium',
      fallbacks: ['claude-sonnet-4-6', 'gpt-6-astra', 'gpt-4o', 'grok-composer-2.5-fast'],
      highEffortMaxContextTokens: 40000,
      preferredModel: 'claude-sonnet-4-5',
      recommended2026Model: 'antigravity/gemini-4-argon',
    },
    lightweight: {
      capabilities: ['fixtures', 'formatting', 'inventory', 'fast-verification'],
      defaultEffort: 'low',
      fallbacks: [
        'antigravity/gemini-3.8-flash',
        'gpt-5.3-codex-spark',
        'claude-haiku-4-5',
        'claude-haiku-3-5',
        'gpt-4o-mini',
        'd3-flash',
      ],
      highEffortMaxContextTokens: 120000,
      preferredModel: 'grok-fast',
      recommended2026Model: 'antigravity/gemini-3.8-flash',
    },
  },
  roleAssignments: {
    coordinator: 'architect-lead',
    architect: 'architect-lead',
    'adversarial-reviewer': 'deep-reasoning',
    reviewer: 'deep-reasoning',
    developer: 'balanced',
    'developer-jr': 'lightweight',
    tester: 'deep-reasoning',
    'fixture-builder': 'lightweight',
  },
}

export const DEFAULT_HARNESS_PARAMETERS = {
  shellRunner: {
    windowsStrategy: 'cmd-type-stream',
    posixStrategy: 'direct-pipe',
    stdinTimeoutMs: 15000,
  },
  limits: {
    envelopeByteCapKb: 48,
    maxReviewIterations: 12,
    largeFileScriptThresholdLines: 800,
  },
  scratchPath: '.agent-runs/scratch',
}

export function sortRecursively(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortRecursively)
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortRecursively(v)]),
  )
}

export function deterministicJson(value) {
  return `${JSON.stringify(sortRecursively(value), null, 2)}\n`
}

export function hashString(str) {
  return createHash('sha256').update(str).digest('hex')
}

export function computeProjections(config = {}) {
  const orchestration = {
    lifecycle: config.orchestration?.lifecycle ?? DEFAULT_ORCHESTRATION_MODEL.lifecycle,
    preCodeReview: {
      ...DEFAULT_ORCHESTRATION_MODEL.preCodeReview,
      ...(config.orchestration?.preCodeReview ?? {}),
    },
    concurrency: {
      ...DEFAULT_ORCHESTRATION_MODEL.concurrency,
      ...(config.orchestration?.concurrency ?? {}),
    },
  }

  const execution = {
    escalation: {
      ...DEFAULT_EXECUTION_POLICY.escalation,
      ...(config.execution?.escalation ?? {}),
    },
    fallbackCascade: {
      ...DEFAULT_EXECUTION_POLICY.fallbackCascade,
      ...(config.execution?.fallbackCascade ?? {}),
    },
  }

  const models = {
    tiers: {
      ...DEFAULT_MODEL_CATALOG.tiers,
      ...(config.models?.tiers ?? {}),
    },
    roleAssignments: {
      ...DEFAULT_MODEL_CATALOG.roleAssignments,
      ...(config.models?.roleAssignments ?? {}),
    },
  }

  const harness = {
    shellRunner: {
      ...DEFAULT_HARNESS_PARAMETERS.shellRunner,
      ...(config.harness?.shellRunner ?? {}),
    },
    limits: {
      ...DEFAULT_HARNESS_PARAMETERS.limits,
      ...(config.harness?.limits ?? {}),
    },
    scratchPath: config.harness?.scratchPath ?? DEFAULT_HARNESS_PARAMETERS.scratchPath,
  }

  const projections = {
    '.agentflow/orchestration-model.json': deterministicJson(orchestration),
    '.agentflow/execution-policy.json': deterministicJson(execution),
    '.agentflow/model-catalog.json': deterministicJson(models),
    '.agentflow/harness-parameters.json': deterministicJson(harness),
  }

  if (config.adapters?.openrig) {
    projections['adapters/openrig/rig.yaml'] = deterministicJson(config.adapters.openrig)
  }

  return projections
}

export function inspectConfigState(repoRoot = process.cwd()) {
  const root = resolve(repoRoot)
  const loaded = loadAuthoritativeConfigs(root)
  const validation = validateConfigAuthority(loaded)

  const configForProjections = loaded.isUnified
    ? loaded.unified
    : {
        orchestration: loaded.orchestration,
        execution: loaded.execution,
        models: loaded.models,
        harness: loaded.harness,
        adapters: loaded.adapters,
      }

  const projections = computeProjections(configForProjections)
  const fileStatuses = []

  let clean = true
  for (const [relativePath, desiredContent] of Object.entries(projections)) {
    const fullPath = resolve(root, relativePath)
    const desiredDigest = hashString(desiredContent)

    if (!existsSync(fullPath)) {
      clean = false
      fileStatuses.push({
        path: relativePath,
        status: 'missing',
        desiredDigest,
        observedDigest: null,
      })
    } else {
      const observedContent = readFileSync(fullPath, 'utf8')
      const observedDigest = hashString(observedContent)
      if (observedDigest === desiredDigest) {
        fileStatuses.push({
          path: relativePath,
          status: 'matched',
          desiredDigest,
          observedDigest,
        })
      } else {
        let isSemanticMatch = false
        try {
          const parsedObs = JSON.parse(observedContent)
          const parsedDes = JSON.parse(desiredContent)
          if (
            hashString(JSON.stringify(sortRecursively(parsedObs))) ===
            hashString(JSON.stringify(sortRecursively(parsedDes)))
          ) {
            isSemanticMatch = true
          }
        } catch {
          // not JSON or parse error
        }

        if (isSemanticMatch) {
          fileStatuses.push({
            path: relativePath,
            status: 'matched',
            desiredDigest,
            observedDigest,
          })
        } else {
          clean = false
          fileStatuses.push({
            path: relativePath,
            status: 'modified',
            desiredDigest,
            observedDigest,
          })
        }
      }
    }
  }

  const planSummary = {
    root,
    isUnified: loaded.isUnified,
    configPath: loaded.configPath,
    files: fileStatuses.map((f) => ({ path: f.path, status: f.status, digest: f.desiredDigest })),
  }
  const planDigest = hashString(JSON.stringify(sortRecursively(planSummary)))

  return {
    ok: validation.ok && clean,
    clean,
    desired: {
      isUnified: loaded.isUnified,
      configPath: loaded.configPath,
      planDigest,
    },
    observed: {
      fileCount: fileStatuses.length,
      matchCount: fileStatuses.filter((f) => f.status === 'matched').length,
      driftCount: fileStatuses.filter((f) => f.status !== 'matched').length,
    },
    files: fileStatuses,
    validation,
    projections,
  }
}

export function applyProjections(repoRoot = process.cwd(), { confirm, plan } = {}) {
  const root = resolve(repoRoot)
  const current = plan ?? inspectConfigState(root)

  if (!confirm || confirm !== current.desired.planDigest) {
    throw new Error('Projection confirmation or plan digest is invalid')
  }

  const writtenFiles = []
  const projections =
    current.projections ?? computeProjections(loadAuthoritativeConfigs(root).unified)

  for (const file of current.files) {
    if (file.status === 'matched') continue

    const fullPath = resolve(root, file.path)
    const parentDir = dirname(fullPath)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    const content = projections[file.path]
    if (!content) continue

    const id = randomUUID()
    const staged = `${fullPath}.agentflow-${id}.tmp`
    const backup = `${fullPath}.agentflow-${id}.bak`

    writeFileSync(staged, content, 'utf8')
    if (existsSync(fullPath)) renameSync(fullPath, backup)

    try {
      renameSync(staged, fullPath)
      if (existsSync(backup)) unlinkSync(backup)
      writtenFiles.push(file.path)
    } catch (err) {
      if (existsSync(staged)) unlinkSync(staged)
      if (existsSync(backup) && !existsSync(fullPath)) renameSync(backup, fullPath)
      throw err
    }
  }

  return {
    ok: true,
    status: 'applied',
    planDigest: current.desired.planDigest,
    writtenFiles,
  }
}
