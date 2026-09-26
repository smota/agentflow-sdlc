import crypto from 'node:crypto'

export const ARTIFACT_TYPES = Object.freeze({
  TERMINAL_LOG: 'terminal_log',
  HTTP_RESPONSE: 'http_response',
  SCREENSHOT: 'screenshot',
})

export function computeArtifactDigest(content) {
  if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
    content = JSON.stringify(content || '')
  }
  return crypto.createHash('sha256').update(content).digest('hex')
}

export function verifyQAEvidenceContract({
  testVerdict,
  acceptanceCriteria = [],
  executionArtifacts = [],
  invokedTools = [],
  toolPolicy = null,
} = {}) {
  const errors = []
  const warnings = []

  // 1. Separation of Duties Policy Check (NFR-01)
  if (toolPolicy) {
    const deniedTools = new Set(toolPolicy.deniedTools || [])
    for (const tool of invokedTools) {
      if (deniedTools.has(tool)) {
        errors.push(
          `VIOLATION_SEPARATION_OF_DUTIES: Tool '${tool}' is prohibited for role '${toolPolicy.role || 'tester'}'. Tester cannot modify or inspect source code.`,
        )
      }
    }
  }

  // 2. Acceptance Criteria & Evidence Check
  if (testVerdict === 'passed') {
    if (!acceptanceCriteria || acceptanceCriteria.length === 0) {
      warnings.push(
        'NO_ACCEPTANCE_CRITERIA_DECLARED: No acceptance criteria specified for QA pass.',
      )
    }

    if (!executionArtifacts || executionArtifacts.length === 0) {
      errors.push(
        'REJECTED_MISSING_EXECUTION_EVIDENCE: QA pass rejected. At least one verifiable execution artifact is mandatory.',
      )
    }

    // Verify criterion coverage
    const coveredCriteria = new Set()
    for (const artifact of executionArtifacts || []) {
      if (artifact.criterionId) {
        coveredCriteria.add(artifact.criterionId)
      }
    }

    for (const criterion of acceptanceCriteria) {
      const criterionId = typeof criterion === 'string' ? criterion : criterion.id
      if (criterionId && !coveredCriteria.has(criterionId)) {
        errors.push(
          `UNCOVERED_ACCEPTANCE_CRITERION: Acceptance criterion '${criterionId}' lacks required execution evidence artifact.`,
        )
      }
    }
  }

  // 3. Cryptographic Evidence Digest Verification (NFR-03)
  const verifiedArtifacts = []
  for (const artifact of executionArtifacts || []) {
    if (!artifact.type || !Object.values(ARTIFACT_TYPES).includes(artifact.type)) {
      errors.push(
        `INVALID_ARTIFACT_TYPE: Artifact '${artifact.id || 'unnamed'}' has invalid type '${artifact.type}'. Must be terminal_log, http_response, or screenshot.`,
      )
      continue
    }

    const calculatedDigest = computeArtifactDigest(artifact.content)
    if (artifact.digest && artifact.digest !== calculatedDigest) {
      errors.push(
        `TAMPERED_ARTIFACT_DIGEST: Artifact '${artifact.id || 'unnamed'}' digest mismatch. Expected ${artifact.digest} but computed ${calculatedDigest}.`,
      )
    } else {
      verifiedArtifacts.push({
        ...artifact,
        digest: calculatedDigest,
        verified: true,
      })
    }
  }

  return {
    ok: errors.length === 0,
    testVerdict,
    errors,
    warnings,
    verifiedArtifacts,
  }
}
