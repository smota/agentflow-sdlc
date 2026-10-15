// Builder rung definitions, consequence floor detection, sticky return affinity,
// and bounded admission flow for the OpenRig execution adapter.

export const BUILDER_RUNGS = Object.freeze({
  P0: 'dev.build-jr',
  P1: 'dev.build',
  P2: 'dev.build-sr',
  P3: 'dev.build-sr',
  P4: 'dev.build-sr',
})

export const CONSEQUENCE_FLOOR_RE =
  /(?:storage|lock|locking|alias|aliasing|security|auth|crypto|migration|schema|persistence|toctou)/i

export function resolveBuilderRung({
  workflowProfile = 'standard',
  collaborationClass = 'bilateral',
  capabilityTier = 'balanced',
  consequenceFloor = 'standard',
  touchSurface = [],
  fileCount = null,
  touchesOracles = false,
} = {}) {
  if (
    touchesOracles === true ||
    (Array.isArray(touchSurface) &&
      touchSurface.some((p) => /(^|\/)tests\/(?:.*\/)?oracles\//.test(String(p))))
  ) {
    throw new Error('Builders (P0-P4) are barred from modifying tests/oracles/**')
  }

  const highConsequence =
    consequenceFloor === 'high-consequence' ||
    consequenceFloor === 'standard-high' ||
    workflowProfile === 'high-assurance' ||
    (Array.isArray(touchSurface) && touchSurface.some((p) => CONSEQUENCE_FLOOR_RE.test(String(p))))

  if (workflowProfile === 'high-assurance' || collaborationClass === 'human-gated') {
    return { rung: 'P4', seat: 'dev.build-sr', reason: 'high-assurance / human-gated' }
  }

  if (
    highConsequence ||
    collaborationClass === 'council' ||
    capabilityTier === 'architect-lead' ||
    capabilityTier === 'deep-reasoning'
  ) {
    return {
      rung: 'P2',
      seat: 'dev.build-sr',
      reason: highConsequence ? 'consequence-floor' : 'council/deep-reasoning',
    }
  }

  const effectiveFileCount =
    fileCount !== null && fileCount !== undefined
      ? fileCount
      : Array.isArray(touchSurface) && touchSurface.length > 0
        ? touchSurface.length
        : null

  if (
    (workflowProfile === 'bounded' || workflowProfile === 'light') &&
    (collaborationClass === 'linear' || collaborationClass === 'single-agent') &&
    capabilityTier === 'lightweight' &&
    (effectiveFileCount === null || effectiveFileCount <= 2)
  ) {
    return { rung: 'P0', seat: 'dev.build-jr', reason: 'bounded-lightweight' }
  }

  return { rung: 'P1', seat: 'dev.build', reason: 'standard-balanced' }
}

export function resolveBuilderSeat(options = {}) {
  return resolveBuilderRung(options).seat
}

export function resolveStickyBuilderOnReturn({
  previousSeat,
  previousRung = 'P0',
  updatedConsequenceFloor = 'standard',
  updatedTouchSurface = [],
  previousTouchSurface = [],
  maxRungCeilingFiles = 2,
} = {}) {
  // Preserves sticky builder affinity across Phase 4 -> 3 -> 4 rework loops (AC-1)
  if (previousSeat === 'dev.build-jr' || previousSeat === 'dev.build') {
    const consequenceWidened =
      updatedConsequenceFloor === 'high-consequence' ||
      updatedConsequenceFloor === 'standard-high' ||
      (Array.isArray(updatedTouchSurface) &&
        updatedTouchSurface.some((p) => CONSEQUENCE_FLOOR_RE.test(String(p))))

    const touchWidened =
      previousRung === 'P0' &&
      Array.isArray(updatedTouchSurface) &&
      updatedTouchSurface.length > maxRungCeilingFiles &&
      (!Array.isArray(previousTouchSurface) ||
        updatedTouchSurface.length > previousTouchSurface.length)

    if (consequenceWidened) {
      return {
        seat: 'dev.build-sr',
        rung: 'P2',
        sticky: false,
        escalated: true,
        reason: 'consequence-floor-widened',
      }
    }

    if (touchWidened) {
      return {
        seat: 'dev.build',
        rung: 'P1',
        sticky: false,
        escalated: true,
        reason: 'touch-surface-widened',
      }
    }

    return {
      seat: previousSeat,
      rung: previousRung,
      sticky: true,
      escalated: false,
    }
  }

  return {
    seat: previousSeat || 'dev.build-sr',
    rung: previousRung || 'P2',
    sticky: true,
    escalated: false,
  }
}

export function countUnmergedAccepted(boardRecords = []) {
  if (!Array.isArray(boardRecords)) return 0

  let count = 0
  for (const record of boardRecords) {
    if (!record || typeof record !== 'object') continue

    // Check if integrated:
    const isIntegrated =
      Boolean(record.integrated) ||
      record.state === 'Delivered' ||
      (Array.isArray(record.labels) &&
        record.labels.some((l) => String(l).startsWith('integrated:')))

    if (isIntegrated) continue

    // Check if accepted/delivered on branch:
    // (phase 8 pass or state === 'Delivered (Awaiting-Integration)' or (state === 'WIP' && currentPhase === 8))
    const currentPhase = record.currentPhase ?? record.phase
    const isPhase8Pass =
      (currentPhase === 8 && (record.status === 'pass' || record.phaseStatus === 'pass')) ||
      record.phase8 === 'pass' ||
      record.phase8Pass === true ||
      (Array.isArray(record.transitions) &&
        ((record.transitions[record.transitions.length - 1]?.phase === 8 &&
          record.transitions[record.transitions.length - 1]?.status === 'pass') ||
          record.transitions.some((t) => t.phase === 8 && t.status === 'pass')))

    const isAwaitingIntegration = record.state === 'Delivered (Awaiting-Integration)'
    const isWipPhase8 = record.state === 'WIP' && currentPhase === 8

    if (isPhase8Pass || isAwaitingIntegration || isWipPhase8) {
      count++
    }
  }

  return count
}

export function canAdmitNextSlice({
  boardRecords = [],
  maxUnmergedAccepted = 2,
  supervisorReachable = true,
} = {}) {
  const unmergedAccepted = countUnmergedAccepted(boardRecords)
  if (!supervisorReachable && unmergedAccepted >= 1) {
    return {
      ok: false,
      status: 'SUPERVISOR_UNREACHABLE',
      unmergedAccepted,
      maxUnmergedAccepted,
    }
  }
  if (unmergedAccepted >= maxUnmergedAccepted) {
    return {
      ok: false,
      status: 'PIPELINE_FULL',
      unmergedAccepted,
      maxUnmergedAccepted,
    }
  }
  return {
    ok: true,
    status: 'ADMIT_OK',
    unmergedAccepted,
    maxUnmergedAccepted,
  }
}
