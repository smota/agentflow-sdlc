import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

export const ROLE_CONTINUITY_CLASSES = Object.freeze({
  'dev.build-jr': 'ephemeral-slice',
  'dev.build': 'ephemeral-slice',
  'dev.build-sr': 'ephemeral-slice',
  'dev.qa': 'ephemeral-slice',
  'dev.test-eng': 'ephemeral-slice',
  'rev.review': 'isolated-review',
  'orch.arch': 'stateful-lead',
  'pm.manager': 'stateful-lead',
  'pm.analyst': 'stateful-lead',
})

export const DEFAULT_PHASE_BUDGETS = Object.freeze({
  0: 15000,
  1: 20000,
  2: 25000,
  3: 35000,
  4: 45000,
  5: 30000,
  6: 25000,
  8: 20000,
})

export const REQUIRED_RESTORE_PACKET_FIELDS = Object.freeze([
  'goalUri',
  'activeSlices',
  'phasePositions',
  'unmergedAcceptedBranches',
  'oracleDigestsByGoal',
  'touchSurfaceLocks',
  'minimumEpochByGoal',
  'reworkCountsByGoal',
  'supervisorHealthState',
  'lastHeartbeatAt',
  'activePlatformBindings',
  'pendingHandoffOutbox',
  'architecturalInvariants',
  'openFollowUps',
  'predecessorSessionId',
  'createdAt',
])

export function evaluatePrePhaseHeadroom({
  seat,
  nextPhase,
  remainingTokens,
  contextLimit = 200000,
  reworkRounds = 0,
  currentSlicePhase = null,
  phaseBudgets = DEFAULT_PHASE_BUDGETS,
} = {}) {
  const continuityClass = ROLE_CONTINUITY_CLASSES[seat] ?? 'ephemeral-slice'
  const expectedPhaseBudget = phaseBudgets?.[nextPhase] ?? 30000
  const requiredHeadroom = Math.ceil(1.5 * expectedPhaseBudget)
  const lowHeadroom = Number.isFinite(remainingTokens) && remainingTokens < requiredHeadroom
  const hasReworkResidue = Number(reworkRounds) >= 1

  if (continuityClass === 'isolated-review') {
    return {
      action: 'ISOLATED_REVIEW_SESSION',
      continuityClass,
      seat,
      reason: 'zero-confirmation-bias-per-review',
      requiredHeadroom,
      remainingTokens,
    }
  }

  if (continuityClass === 'stateful-lead') {
    if (lowHeadroom || hasReworkResidue) {
      return {
        action: 'PLANNED_HANDOVER_RESTORE_PACKET',
        continuityClass,
        seat,
        reason: lowHeadroom ? 'insufficient-phase-headroom' : 'rework-residue',
        requiredHeadroom,
        remainingTokens,
      }
    }
    return {
      action: 'CONTINUE_SESSION',
      continuityClass,
      seat,
      requiredHeadroom,
      remainingTokens,
    }
  }

  // Class A: ephemeral-slice (builders and test engineers)
  if (currentSlicePhase !== null && currentSlicePhase >= 6) {
    return {
      action: 'REBUILD_EPHEMERAL_SEAT',
      continuityClass,
      seat,
      reason: 'slice-completed-phase-6-plus',
      requiredHeadroom,
      remainingTokens,
    }
  }

  if (lowHeadroom || hasReworkResidue) {
    return {
      action: 'REBUILD_AT_PHASE_BOUNDARY',
      continuityClass,
      seat,
      reason: lowHeadroom ? 'insufficient-phase-headroom' : 'rework-residue',
      requiredHeadroom,
      remainingTokens,
    }
  }

  return {
    action: 'CONTINUE_SESSION',
    continuityClass,
    seat,
    requiredHeadroom,
    remainingTokens,
  }
}

export function validateRestorePacket(packet = {}) {
  const p = packet ?? {}
  const missing = REQUIRED_RESTORE_PACKET_FIELDS.filter(
    (field) => p[field] === undefined || p[field] === null,
  )
  return {
    ok: missing.length === 0,
    missingFields: missing,
    fieldCount: REQUIRED_RESTORE_PACKET_FIELDS.length - missing.length,
  }
}

export function consultRetiredPredecessor({
  predecessorSessionId,
  transcriptPath,
  mode = 'read-transcript',
  wakeRequested = false,
  fs: fsModule = fs,
} = {}) {
  if (wakeRequested === true || mode === 'wake' || mode === 'write') {
    throw new Error(
      'RETIRED_SEAT_WRITE_DENIED: waking a retired predecessor with write or tool permissions is forbidden; use read-only transcript lookup',
    )
  }

  if (!transcriptPath || !fsModule.existsSync(transcriptPath)) {
    return {
      ok: false,
      status: 'TRANSCRIPT_NOT_FOUND',
      predecessorSessionId,
      mode: 'read-only-transcript',
    }
  }

  const content = fsModule.readFileSync(transcriptPath, 'utf8')
  return {
    ok: true,
    status: 'TRANSCRIPT_READ_ONLY',
    predecessorSessionId,
    mode: 'read-only-transcript',
    byteLength: Buffer.byteLength(content, 'utf8'),
    excerpt: content.slice(-2048),
  }
}

export function resolveLineageLedgerPath({
  homeDir = os.homedir(),
  rigName = 'default-rig',
  seat = 'orch.arch',
} = {}) {
  return path.join(homeDir, '.openrig', 'state', 'agentflow-lineage', rigName, `${seat}.jsonl`)
}

export function appendLineageLedgerEntry({
  homeDir = os.homedir(),
  rigName = 'default-rig',
  seat,
  entry = {},
  worktreeDir = null,
  fs: fsModule = fs,
} = {}) {
  if (worktreeDir && String(homeDir).includes('.worktrees/')) {
    throw new Error(
      'LINEAGE_WORKTREE_VIOLATION: lineage ledger must reside in host-side ~/.openrig/state/agentflow-lineage/, never inside .worktrees/*',
    )
  }
  if (String(homeDir).includes('.worktrees/')) {
    throw new Error(
      'LINEAGE_WORKTREE_VIOLATION: lineage ledger must reside in host-side ~/.openrig/state/agentflow-lineage/, never inside .worktrees/*',
    )
  }

  const ledgerPath = resolveLineageLedgerPath({ homeDir, rigName, seat })
  fsModule.mkdirSync(path.dirname(ledgerPath), { recursive: true })
  const record = {
    seat,
    rigName,
    ...entry,
    recordedAt: entry?.recordedAt ?? new Date().toISOString(),
  }
  fsModule.appendFileSync(ledgerPath, JSON.stringify(record) + '\n', 'utf8')
  return { ok: true, ledgerPath }
}

export function writeProofLogArtifact({
  homeDir = os.homedir(),
  goal,
  phase = 5,
  rawLog = '',
  passCount = 0,
  failCount = 0,
  command = 'cargo test',
  exitCode = 0,
  fs: fsModule = fs,
} = {}) {
  const safeGoal = String(goal ?? 'unspecified').replace(/[^A-Za-z0-9._-]/g, '_')
  const proofDir = path.join(homeDir, '.openrig', 'state', 'proofs')
  fsModule.mkdirSync(proofDir, { recursive: true })
  const artifactPath = path.join(proofDir, `${safeGoal}-phase-${phase}.log`)
  const logStr = String(rawLog ?? '')
  fsModule.writeFileSync(artifactPath, logStr, 'utf8')

  const sha256 = crypto.createHash('sha256').update(logStr).digest('hex')
  const rawLines = logStr.length > 0 ? logStr.trim().split(/\r?\n/) : []
  const summaryLines = rawLines.slice(-15)

  return {
    artifactPath,
    sha256,
    command,
    exitCode,
    passCount,
    failCount,
    summaryLines,
  }
}
