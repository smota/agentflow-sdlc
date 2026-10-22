// Builder rung definitions, consequence floor detection, sticky return affinity,
// and bounded admission flow for the OpenRig execution adapter.

export const BUILDER_RUNGS = Object.freeze({
  P0: 'dev.build-jr',
  P1: 'dev.build',
  P2: 'dev.build-sr',
  P3: 'dev.build-sr',
  P4: 'dev.build-sr',
})

export const LEAN_BUILDER_RUNGS = Object.freeze({
  P0: 'dev.build',
  P1: 'dev.build',
  P2: 'dev.build',
  P3: 'dev.build',
  P4: 'dev.build',
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
  squadPreset = 'classic-6-seat',
} = {}) {
  if (
    touchesOracles === true ||
    (Array.isArray(touchSurface) &&
      touchSurface.some((p) => /(^|\/)tests\/(?:.*\/)?oracles\//.test(String(p))))
  ) {
    throw new Error('Builders (P0-P4) are barred from modifying tests/oracles/**')
  }

  const isLeanSquad = squadPreset === 'lean-4-seat'
  const rungMap = isLeanSquad ? LEAN_BUILDER_RUNGS : BUILDER_RUNGS

  const highConsequence =
    consequenceFloor === 'high-consequence' ||
    consequenceFloor === 'standard-high' ||
    workflowProfile === 'high-assurance' ||
    (Array.isArray(touchSurface) && touchSurface.some((p) => CONSEQUENCE_FLOOR_RE.test(String(p))))

  if (workflowProfile === 'high-assurance' || collaborationClass === 'human-gated') {
    return {
      rung: 'P4',
      seat: rungMap.P4,
      reason: 'high-assurance / human-gated',
      ...(isLeanSquad ? { subagentDelegation: true, recommendedEffort: 'high' } : {}),
    }
  }

  if (
    highConsequence ||
    collaborationClass === 'council' ||
    capabilityTier === 'architect-lead' ||
    capabilityTier === 'deep-reasoning'
  ) {
    return {
      rung: 'P2',
      seat: rungMap.P2,
      reason: highConsequence ? 'consequence-floor' : 'council/deep-reasoning',
      ...(isLeanSquad ? { subagentDelegation: true, recommendedEffort: 'medium' } : {}),
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
    return {
      rung: 'P0',
      seat: rungMap.P0,
      reason: 'bounded-lightweight',
      ...(isLeanSquad ? { subagentDelegation: true, recommendedEffort: 'low' } : {}),
    }
  }

  return {
    rung: 'P1',
    seat: rungMap.P1,
    reason: 'standard-balanced',
    ...(isLeanSquad ? { subagentDelegation: true, recommendedEffort: 'medium' } : {}),
  }
}

export function resolveBuilderSeat(options = {}) {
  return resolveBuilderRung(options).seat
}

export function resolvePhaseCompression({
  rung = 'P1',
  squadPreset = 'lean-4-seat',
  touchesOracles = false,
} = {}) {
  if (touchesOracles) {
    return {
      compositePass: false,
      phases: [3],
      externalGatePhases: [4, 5, 6, 7, 8],
      reason: 'oracle-boundary-requires-explicit-phase-separation',
    }
  }

  if (rung === 'P0' || rung === 'P1') {
    return {
      compositePass: true,
      phases: [3, 4, 5],
      externalGatePhases: [6, 7, 8],
      squadPreset,
      reason:
        rung === 'P0' ? 'bounded-composite-builder-pass' : 'standard-bilateral-composite-pass',
    }
  }

  return {
    compositePass: false,
    phases: [3],
    externalGatePhases: [4, 5, 6, 7, 8],
    squadPreset,
    reason: 'high-consequence-requires-explicit-phase-separation',
  }
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

const PASS_VERDICTS = new Set(['pass', 'passed', 'approved', 'delivered', 'ok'])
const FAIL_VERDICTS = new Set([
  'concrete_blocker',
  'repeated_failure',
  'returned',
  'blocked',
  'fail',
  'failed',
  'rejected',
  'rework_required',
  'changes_requested',
])

function classifyEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return { present: false, passed: false, repeatedFailure: false, label: 'missing' }
  }
  const candidates = [envelope.verdict, envelope.outcome, envelope.status]
    .filter((v) => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.trim().toLowerCase())

  const repeatedFailure =
    candidates.includes('repeated_failure') ||
    envelope.repeatedFailure === true ||
    envelope.fenceTripped === true

  const failed =
    repeatedFailure || candidates.some((c) => FAIL_VERDICTS.has(c)) || envelope.ok === false

  const passed = !failed && (candidates.some((c) => PASS_VERDICTS.has(c)) || envelope.ok === true)

  const label = envelope.reason || envelope.summary || candidates[0] || (passed ? 'pass' : 'failed')

  return {
    present: true,
    passed,
    failed: !passed,
    repeatedFailure,
    label,
  }
}

export function joinParallelVerdicts({
  qaEnvelope = null,
  reviewEnvelope = null,
  sliceTier = 'P2',
  builderSeat = 'dev.build',
  reworkRounds = 0,
  maxReworkRounds = 2,
} = {}) {
  const qa = classifyEnvelope(qaEnvelope)
  const review = classifyEnvelope(reviewEnvelope)

  if (!qa.present || !review.present) {
    const missing = []
    if (!qa.present) missing.push('dev.qa')
    if (!review.present) missing.push('rev.review')
    return {
      ok: false,
      status: 'pending',
      outcome: 'awaiting_parallel_verdicts',
      nextSeat: null,
      sliceTier,
      commitSha:
        qaEnvelope?.commitSha ??
        qaEnvelope?.sha ??
        reviewEnvelope?.commitSha ??
        reviewEnvelope?.sha ??
        null,
      reasons: [`awaiting parallel verdict from ${missing.join(', ')}`],
    }
  }

  const qaSha = qaEnvelope.commitSha ?? qaEnvelope.sha ?? null
  const reviewSha = reviewEnvelope.commitSha ?? reviewEnvelope.sha ?? null
  if ((qaSha || reviewSha) && (!qaSha || !reviewSha || qaSha !== reviewSha)) {
    return {
      ok: false,
      status: 'sha_mismatch',
      outcome: 'stale_verdict_rejected',
      nextSeat: builderSeat,
      sliceTier,
      commitSha: null,
      qaCommitSha: qaSha,
      reviewCommitSha: reviewSha,
      reasons: [
        `commit SHA mismatch between dev.qa (${qaSha ?? 'missing'}) and rev.review (${reviewSha ?? 'missing'})`,
      ],
    }
  }

  const commitSha = qaSha ?? reviewSha ?? null

  if (qa.passed && review.passed) {
    return {
      ok: true,
      status: 'approved',
      outcome: 'ready_for_integration',
      nextSeat: 'orch.arch',
      sliceTier,
      commitSha,
      reasons: [],
    }
  }

  const reasons = []
  if (!qa.passed) reasons.push(`dev.qa: ${qa.label}`)
  if (!review.passed) reasons.push(`rev.review: ${review.label}`)

  const effectiveReworkRounds = Math.max(
    Number(reworkRounds) || 0,
    Number(qaEnvelope.reworkRounds) || 0,
    Number(reviewEnvelope.reworkRounds) || 0,
  )
  const fenceTripped =
    qa.repeatedFailure ||
    review.repeatedFailure ||
    (effectiveReworkRounds > 0 && effectiveReworkRounds >= maxReworkRounds)

  if (fenceTripped) {
    return {
      ok: false,
      status: 'blocked',
      outcome: 'escalate_to_steer',
      nextSeat: 'steer.lead',
      sliceTier,
      commitSha,
      reasons,
    }
  }

  return {
    ok: false,
    status: 'rework_required',
    outcome: 'return_to_builder',
    nextSeat: builderSeat,
    sliceTier,
    commitSha,
    reasons,
  }
}
