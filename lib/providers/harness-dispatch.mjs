import { recordDigest } from '../core/record-digest.mjs'
import { safePath } from '../core/delegation-grant.mjs'

export const MAX_CONTROL_CONTEXT_BYTES = 32 * 1024
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024 // 10 MiB per artifact

export class HarnessContractError extends Error {
  constructor(message, { code = 'HARNESS_CONTRACT_ERROR', details = null } = {}) {
    super(message)
    this.name = 'HarnessContractError'
    this.code = code
    this.details = details
  }
}

export async function preflightHarnessCapability({
  provider,
  requiredCapabilities = [],
  executionTarget,
  requestedModel = null,
}) {
  if (!provider) {
    throw new HarnessContractError('Provider is required', {
      code: 'INVALID_PROVIDER',
    })
  }

  if (typeof provider.inspect === 'function') {
    const inspection = await provider.inspect()
    if (inspection?.availability === 'unavailable') {
      throw new HarnessContractError(`Provider unavailable: ${inspection.reason}`, {
        code: 'PROVIDER_UNAVAILABLE',
        details: inspection,
      })
    }
  }

  if (executionTarget && Array.isArray(provider.targets) && !provider.targets.includes(executionTarget)) {
    throw new HarnessContractError(
      `Provider does not support executionTarget: ${executionTarget}`,
      { code: 'UNSUPPORTED_TARGET', details: { supported: provider.targets, requested: executionTarget } },
    )
  }

  const declaredIntents = provider.intentSupport?.map((i) => i.id) ?? []
  for (const cap of requiredCapabilities) {
    if (!declaredIntents.includes(cap)) {
      throw new HarnessContractError(`Provider lacks required capability: ${cap}`, {
        code: 'MISSING_CAPABILITY',
        details: { capability: cap, declared: declaredIntents },
      })
    }
  }

  return { ok: true, executionTarget, requestedModel }
}

export function validateDispatchContext(context) {
  if (context === undefined || context === null) return
  const serialized = typeof context === 'string' ? context : JSON.stringify(context)
  const byteLength = Buffer.byteLength(serialized)
  if (byteLength > MAX_CONTROL_CONTEXT_BYTES) {
    throw new HarnessContractError(
      `Control context exceeds bounded limit of ${MAX_CONTROL_CONTEXT_BYTES} bytes (actual: ${byteLength} bytes)`,
      { code: 'CONTEXT_BUDGET_EXCEEDED', details: { actual: byteLength, max: MAX_CONTROL_CONTEXT_BYTES } },
    )
  }
}

export function parseAndVerifyHarnessOutput(rawOutput, { expectedArtifacts = [] } = {}) {
  if (rawOutput === null || rawOutput === undefined || rawOutput === '') {
    throw new HarnessContractError('Harness returned null or empty output', {
      code: 'EMPTY_OUTPUT',
    })
  }

  // Check truncation markers on object
  if (typeof rawOutput === 'object' && rawOutput.truncated === true) {
    throw new HarnessContractError('Harness output was truncated; rejected to prevent corrupted application', {
      code: 'OUTPUT_TRUNCATED',
    })
  }

  let parsed = rawOutput
  if (typeof rawOutput === 'string') {
    if (rawOutput.includes('[truncated]') || rawOutput.includes('... [truncated]')) {
      throw new HarnessContractError('Harness output was truncated; rejected to prevent corrupted application', {
        code: 'OUTPUT_TRUNCATED',
      })
    }
    try {
      parsed = JSON.parse(rawOutput)
    } catch (err) {
      throw new HarnessContractError(`Malformed harness output JSON: ${err.message}`, {
        code: 'MALFORMED_OUTPUT',
      })
    }
  }

  if (parsed && parsed.truncated === true) {
    throw new HarnessContractError('Harness output was truncated; rejected to prevent corrupted application', {
      code: 'OUTPUT_TRUNCATED',
    })
  }

  if (parsed.status === 'failed' || parsed.error) {
    return {
      status: 'failed',
      error: parsed.error ?? 'Execution failed',
      artifacts: [],
      raw: parsed,
    }
  }

  // Validate and verify returned artifacts / patches
  const returnedArtifacts = Array.isArray(parsed.artifacts) ? parsed.artifacts : []
  const verifiedArtifacts = []

  for (const art of returnedArtifacts) {
    if (!art.path || !safePath(art.path)) {
      throw new HarnessContractError(`Invalid or unsafe artifact path: ${art.path}`, {
        code: 'INVALID_ARTIFACT_PATH',
      })
    }
    if (typeof art.content !== 'string') {
      throw new HarnessContractError(`Artifact ${art.path} missing string content`, {
        code: 'MALFORMED_ARTIFACT',
      })
    }
    const byteLength = Buffer.byteLength(art.content)
    if (byteLength > MAX_ARTIFACT_BYTES) {
      throw new HarnessContractError(`Artifact ${art.path} exceeds max size limit`, {
        code: 'OVERSIZED_ARTIFACT',
      })
    }
    const computedDigest = recordDigest(art.content)
    if (art.digest && art.digest !== computedDigest) {
      throw new HarnessContractError(
        `Artifact ${art.path} digest mismatch: expected ${art.digest}, computed ${computedDigest}`,
        { code: 'ARTIFACT_DIGEST_MISMATCH' },
      )
    }
    verifiedArtifacts.push({
      path: art.path,
      content: art.content,
      digest: computedDigest,
      byteLength,
      type: art.type ?? 'file',
    })
  }

  // If specific expected artifacts were declared, verify all are present
  for (const expected of expectedArtifacts) {
    const found = verifiedArtifacts.find((a) => a.path === expected)
    if (!found) {
      throw new HarnessContractError(`Required expected artifact missing from harness return: ${expected}`, {
        code: 'MISSING_EXPECTED_ARTIFACT',
      })
    }
  }

  return {
    status: 'pass',
    artifacts: verifiedArtifacts,
    metadata: parsed.metadata ?? {},
    raw: parsed,
  }
}

export async function dispatchToHarness({
  provider,
  executionTarget,
  requestedModel = null,
  requiredCapabilities = [],
  context = null,
  timeoutMs = 60_000,
  permissionBoundary = 'observe',
  requestPayload = {},
  expectedArtifacts = [],
}) {
  // 1. Capability preflight
  await preflightHarnessCapability({
    provider,
    requiredCapabilities,
    executionTarget,
    requestedModel,
  })

  // 2. Permission boundary check
  const requiresEdit = requiredCapabilities.some((c) => ['file-edit', 'commit', 'workspace-edit'].includes(c))
  if (requiresEdit && permissionBoundary === 'observe') {
    throw new HarnessContractError('Edit capability requested but permission boundary is observe-only', {
      code: 'BOUNDARY_DENIED',
    })
  }

  // 3. Bounded context check
  validateDispatchContext(context)

  // 4. Construct execution plan
  const plan = provider.plan({
    ...requestPayload,
    model: requestedModel,
    timeoutMs,
    boundary: permissionBoundary,
    context,
  })

  // 5. Execute via provider
  let receipt
  try {
    receipt = await provider.execute(plan, { confirm: plan.token })
  } catch (error) {
    throw new HarnessContractError(`Harness execution threw: ${error.message}`, {
      code: 'EXECUTION_FAILED',
      details: error,
    })
  }

  if (receipt.status !== 'pass') {
    return {
      status: 'failed',
      receipt,
      artifacts: [],
      reason: receipt.output?.stderr || 'Provider execution failed',
    }
  }

  // 6. Verify and retrieve hashed artifacts from receipt output
  const parsedOutput = parseAndVerifyHarnessOutput(
    receipt.output?.stdout || receipt.output || {},
    { expectedArtifacts },
  )

  return {
    status: parsedOutput.status,
    receipt,
    artifacts: parsedOutput.artifacts,
    metadata: parsedOutput.metadata,
  }
}
