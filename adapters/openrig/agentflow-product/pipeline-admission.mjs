// Pipeline admission and priority governance for OpenRig handoff bridge (#511).
// Uses only Node built-ins so it runs standalone in ~/.openrig/specs/agentflow-product/.

export const PHASE_PRIORITY_ORDER = Object.freeze([8, 6, 5, 4, 3, 2, 1, 0])

export const DEFAULT_HOT_FILE_DENYLIST = Object.freeze([
  'Cargo.lock',
  'Cargo.toml',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'migrations/',
  'schema/',
])

/**
 * Compare queue priority between two items following Finish-Closest-to-Done ordering.
 * Order:
 * 1. Unblocked items sort before blocked items.
 * 2. Higher phase number sorts first (Phase 8 > 6 > 5 > 4 > 3 > 2 > 1 > 0).
 * 3. Within the same phase, higher reworkRound sorts first.
 * 4. Lower numeric priority sorts first (e.g. 10 before 50).
 * 5. Earlier createdAt sorts first.
 */
export function compareQueuePriority(itemA = {}, itemB = {}) {
  const aBlocked = Boolean(itemA.blocked)
  const bBlocked = Boolean(itemB.blocked)
  if (aBlocked !== bBlocked) {
    return aBlocked ? 1 : -1
  }

  const phaseA = itemA.phase ?? -1
  const phaseB = itemB.phase ?? -1
  if (phaseA !== phaseB) {
    return phaseB - phaseA
  }

  const reworkA = itemA.reworkRound ?? 0
  const reworkB = itemB.reworkRound ?? 0
  if (reworkA !== reworkB) {
    return reworkB - reworkA
  }

  const priorityA = itemA.priority ?? 50
  const priorityB = itemB.priority ?? 50
  if (priorityA !== priorityB) {
    return priorityA - priorityB
  }

  const timeA = itemA.createdAt ? new Date(itemA.createdAt).getTime() : 0
  const timeB = itemB.createdAt ? new Date(itemB.createdAt).getTime() : 0
  if (timeA !== timeB) {
    if (!timeA) return 1
    if (!timeB) return -1
    return timeA - timeB
  }

  return 0
}

/**
 * Normalizes glob prefixes by stripping trailing /**, /*, or /.
 */
export function normalizeGlob(glob) {
  let s = String(glob ?? '').trim()
  while (s.endsWith('/**') || s.endsWith('/*') || (s.length > 1 && s.endsWith('/'))) {
    if (s.endsWith('/**')) s = s.slice(0, -3)
    else if (s.endsWith('/*')) s = s.slice(0, -2)
    else if (s.endsWith('/')) s = s.slice(0, -1)
  }
  return s
}

/**
 * Checks if two path globs overlap.
 * Globs overlap if they are equal, or one is a prefix directory of the other, or either is '*'.
 */
export function globOverlap(globA, globB) {
  const a = normalizeGlob(globA)
  const b = normalizeGlob(globB)
  if (!a || !b) return false
  if (a === '*' || b === '*' || a === '**' || b === '**') return true
  if (a === b) return true
  return a.startsWith(b + '/') || b.startsWith(a + '/')
}

function touchesHotFile(touchSurface = [], hotFileDenylist = DEFAULT_HOT_FILE_DENYLIST) {
  for (const touch of touchSurface) {
    for (const denylistEntry of hotFileDenylist) {
      if (globOverlap(touch, denylistEntry)) return true
    }
  }
  return false
}

/**
 * Evaluates admission of a candidate slice into the multi-writer execution pipeline.
 */
export function evaluateMultiWriterAdmission({
  candidate = {},
  activeSlices = [],
  maxWriters = 3,
  hotFileDenylist = DEFAULT_HOT_FILE_DENYLIST,
} = {}) {
  const activeWriters = activeSlices.filter((s) => s.phase === 4 && s.goal !== candidate.goal)

  // Check dependsOn: if any dependency matches an unintegrated active slice, block admission
  const dependsOn = Array.isArray(candidate.dependsOn) ? candidate.dependsOn : []
  if (dependsOn.length > 0) {
    const blockingGoals = []
    for (const dep of dependsOn) {
      const depStr = String(dep)
      const match = activeSlices.find((s) => {
        const matchesDep =
          String(s.goal) === depStr ||
          String(s.id) === depStr ||
          String(s.issue) === depStr ||
          String(s.goal) === `#${depStr}` ||
          `#${String(s.goal)}` === depStr
        const isIntegrated = Boolean(s.integrated || s.status === 'integrated' || s.phase === 8)
        return matchesDep && !isIntegrated
      })
      if (match) {
        blockingGoals.push(match.goal ?? match.id ?? dep)
      }
    }
    if (blockingGoals.length > 0) {
      return { admitted: false, status: 'BLOCKED_DEPENDENCY', blockingGoals }
    }
  }

  if (candidate.phase === 4) {
    if (activeWriters.length >= maxWriters) {
      return {
        admitted: false,
        status: 'MAX_WRITERS_REACHED',
        activeWriters: activeWriters.length,
        maxWriters,
      }
    }

    const candidateTouchesHot = touchesHotFile(candidate.touchSurface, hotFileDenylist)
    if (candidateTouchesHot) {
      const otherSlices = activeSlices.filter((s) => s.goal !== candidate.goal)
      const anyOtherTouchesHot = otherSlices.some((s) =>
        touchesHotFile(s.touchSurface ?? [], hotFileDenylist),
      )
      if (anyOtherTouchesHot) {
        return {
          admitted: false,
          status: 'SERIALIZED_HOT_FILE',
          reason: 'hotFileDenylist overlap',
        }
      }
    }

    const candidateSurface = candidate.touchSurface ?? []
    if (candidateSurface.length === 0) {
      return { admitted: false, status: 'TOUCH_SURFACE_OVERLAP' }
    }

    for (const writer of activeWriters) {
      const writerSurface = writer.touchSurface ?? []
      if (writerSurface.length === 0) {
        return { admitted: false, status: 'TOUCH_SURFACE_OVERLAP' }
      }
      for (const globA of candidateSurface) {
        for (const globB of writerSurface) {
          if (globOverlap(globA, globB)) {
            return { admitted: false, status: 'TOUCH_SURFACE_OVERLAP' }
          }
        }
      }
    }
  }

  return { admitted: true, status: 'ADMITTED', activeWriters: activeWriters.length }
}

/**
 * Evaluates the rebase integration gate when base sha changes.
 */
export function evaluateRebaseIntegrationGate({
  oldBaseSha,
  newBaseSha,
  oldHeadSha,
  newHeadSha,
  phase5ReexecutedOnNewSha = false,
  rangeDiffOutput = '',
} = {}) {
  if (!oldBaseSha || oldBaseSha === newBaseSha) {
    return { ok: true, status: 'NO_REBASE_NEEDED', deltaReviewRequired: false }
  }
  if (!phase5ReexecutedOnNewSha) {
    return {
      ok: false,
      status: 'PHASE5_REPROOF_REQUIRED',
      deltaReviewRequired: Boolean(String(rangeDiffOutput).trim()),
    }
  }
  if (String(rangeDiffOutput).trim().length > 0) {
    return {
      ok: false,
      status: 'delta-review-required',
      deltaReviewRequired: true,
      rangeDiff: String(rangeDiffOutput).trim(),
    }
  }
  return { ok: true, status: 'REBASE_INTEGRATION_OK', deltaReviewRequired: false }
}
