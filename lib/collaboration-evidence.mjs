export const COLLABORATION_EVIDENCE_MODES = [
  'single-agent',
  'advisory',
  'council',
  'parallel-discovery',
  'spike',
  'human-gated',
]

export function validateCollaborationEvidence(evidence = {}) {
  const errors = []
  const warnings = []
  const mode = evidence.collaborationMode
  if (!mode) errors.push('collaboration evidence must record collaborationMode')
  if (mode && !COLLABORATION_EVIDENCE_MODES.includes(mode)) {
    errors.push(`unsupported collaborationMode: ${mode}`)
  }
  if (!evidence.reason) errors.push('collaboration evidence must record reason')

  const helpers = Array.isArray(evidence.helpers) ? evidence.helpers : []
  if (mode && !['single-agent'].includes(mode) && helpers.length === 0) {
    errors.push(`${mode} collaboration requires at least one helper or gate row`)
  }
  if (['council', 'parallel-discovery'].includes(mode) && helpers.length < 2) {
    errors.push(`${mode} collaboration requires at least two helper rows`)
  }

  const writers = helpers.filter((helper) => helper.permissions === 'writer')
  if (writers.length > 1)
    errors.push('collaboration evidence must not grant writer permission to multiple helpers')
  if (writers.length === 1 && mode !== 'spike') {
    errors.push('helper writer permission is only allowed for spike mode')
  }

  for (const [index, helper] of helpers.entries()) {
    const label = helper.role || `helper[${index}]`
    if (!helper.role) errors.push(`${label} must record role`)
    if (!helper.permissions) errors.push(`${label} must record permissions`)
    if (helper.permissions !== 'human-gate') {
      for (const field of ['executor', 'transport', 'delegationBoundary', 'contextBoundary']) {
        if (!helper[field]) warnings.push(`${label} should record ${field}`)
      }
    }
    if (helper.permissions === 'writer' && helper.singleWriterRule !== true) {
      errors.push(`${label} writer helper must record singleWriterRule: true`)
    }
  }

  if (helpers.length > 0) {
    if (!evidence.synthesis)
      errors.push('helper collaboration requires parent synthesis path or summary')
    if (evidence.rawTranscriptLocalOnly !== true) {
      warnings.push('helper collaboration should record rawTranscriptLocalOnly: true')
    }
  }

  if (Array.isArray(evidence.loops)) {
    for (const [index, loop] of evidence.loops.entries()) {
      if (!Number.isInteger(loop.maxIterations) || loop.maxIterations < 1) {
        errors.push(`loop[${index}] must record maxIterations >= 1`)
      }
      if (!Array.isArray(loop.stopConditions) || loop.stopConditions.length === 0) {
        errors.push(`loop[${index}] must record stopConditions`)
      }
      if (!loop.exitReason) errors.push(`loop[${index}] must record exitReason`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}
