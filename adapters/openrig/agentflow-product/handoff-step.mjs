// Atomic outbox handoff step and pointer envelope parser (#511).
// Uses only Node built-ins so it runs standalone in ~/.openrig/specs/agentflow-product/.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export class HandoffStepError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'HandoffStepError'
    this.exitCode = exitCode
  }
}

/**
 * Formats a deterministic pointer-only envelope header block,
 * explicitly stripping any freeform builder prose.
 */
export function formatPointerEnvelope({
  goal,
  phase,
  status = 'pass',
  worktree,
  epoch = 1,
  baseSha,
  candidateSha,
  oracleDigest,
  proofArtifactRef,
  transitionUri = null,
  transition,
} = {}) {
  const trans = transitionUri ?? transition ?? ''
  return [
    'Envelope-Version: pointer-v1',
    `Goal: ${goal ?? ''}`,
    `Phase: ${phase ?? ''}`,
    `Status: ${status ?? 'pass'}`,
    `Worktree: ${worktree ?? ''}`,
    `Epoch: ${epoch ?? 1}`,
    `Base-SHA: ${baseSha ?? ''}`,
    `Candidate-SHA: ${candidateSha ?? ''}`,
    `Oracle-Digest: ${oracleDigest ?? ''}`,
    `Proof-Artifact: ${proofArtifactRef ?? ''}`,
    `Transition: ${trans ?? ''}`,
  ].join('\n')
}

/**
 * Dual-format envelope parser: parses structured pointer-v1 envelopes or legacy narrative queue bodies.
 */
export function parseQueueEnvelope(body = '') {
  const str = String(body ?? '')
  const isPointerV1 =
    str.includes('Envelope-Version: pointer-v1') ||
    (str.includes('Candidate-SHA:') && str.includes('Oracle-Digest:'))

  if (isPointerV1) {
    const fields = {}
    for (const line of str.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
      if (match) {
        fields[match[1]] = match[2].trim()
      }
    }
    return {
      format: 'pointer-v1',
      warning: null,
      goal: fields['Goal'] || null,
      phase:
        fields['Phase'] !== undefined && fields['Phase'] !== '' ? Number(fields['Phase']) : null,
      status: fields['Status'] || null,
      worktree: fields['Worktree'] || null,
      epoch: fields['Epoch'] !== undefined && fields['Epoch'] !== '' ? Number(fields['Epoch']) : 1,
      baseSha: fields['Base-SHA'] || null,
      candidateSha: fields['Candidate-SHA'] || null,
      oracleDigest: fields['Oracle-Digest'] || null,
      proofArtifactRef: fields['Proof-Artifact'] || null,
      transition: fields['Transition'] || null,
    }
  }

  const goalMatch = str.match(/^Goal:\s*(.+)$/m)
  const transMatch = str.match(/^Transition:\s*(.+)$/m)
  return {
    format: 'legacy',
    warning: 'LEGACY_ENVELOPE',
    goal: goalMatch ? goalMatch[1].trim() : null,
    transition: transMatch ? transMatch[1].trim() : null,
    rawBody: body,
  }
}

/**
 * Validates that an incoming envelope epoch meets or exceeds the minimum required epoch.
 */
export function validateEpochFence({ goal, epoch, minimumEpochByGoal = {} } = {}) {
  const minEpoch = minimumEpochByGoal[goal] ?? 1
  if (Number(epoch) < Number(minEpoch)) {
    return {
      ok: false,
      status: 'STALE_EPOCH_FENCED',
      goal,
      epoch: Number(epoch),
      minimumEpoch: Number(minEpoch),
    }
  }
  return { ok: true, status: 'EPOCH_OK', goal, epoch: Number(epoch) }
}

/**
 * Executes an outbox-backed atomic phase append and queue handoff step.
 */
export function executeHandoffStep(deps = {}, options = {}) {
  const home = deps.home ?? homedir()
  const run =
    deps.run ??
    ((cmd, args, opts) =>
      spawnSync(cmd, args, {
        encoding: 'utf8',
        env: deps.env ?? process.env,
        shell: false,
        ...opts,
      }))
  const now = deps.now ? deps.now() : new Date()

  const outboxDir = join(home, '.openrig', 'state', 'handoff-outbox')
  const safeGoalKey = String(options.goal ?? options.issue ?? 'default').replace(
    /[^A-Za-z0-9._-]/g,
    '_',
  )
  const phaseKey = options.phase !== undefined ? options.phase : 'unknown'
  const outboxFile = join(outboxDir, `${safeGoalKey}-phase-${phaseKey}.json`)
  const bodyFile = join(outboxDir, `${safeGoalKey}-phase-${phaseKey}.body.txt`)

  let record
  let target = options.to
  let envelopeBody = options.body
  const transitionUri = options.transitionUri ?? options.transition ?? null

  if (!options.handoffOnly) {
    // 1. Run Core phase append
    if (typeof deps.appendPhase === 'function') {
      const res = deps.appendPhase(options)
      if (res?.error || (res?.status !== undefined && res.status !== 0)) {
        const msg = res?.error?.message || res?.stderr || res?.stdout || 'phase append failed'
        throw new HandoffStepError(`phase append failed: ${msg}`, 1)
      }
    } else {
      const cli = deps.cliPath || process.execPath
      const phaseArgs = ['phase', 'append']
      if (options.phase !== undefined) phaseArgs.push('--phase', String(options.phase))
      if (options.status) phaseArgs.push('--status', String(options.status))
      if (options.seat) phaseArgs.push('--seat', String(options.seat))
      if (options.key) phaseArgs.push('--key', String(options.key))
      if (options.medium) phaseArgs.push('--medium', String(options.medium))
      if (options.root) phaseArgs.push('--root', String(options.root))
      if (options.repo) phaseArgs.push('--repo', String(options.repo))
      if (options.issue !== undefined) phaseArgs.push('--issue', String(options.issue))
      if (options.title) phaseArgs.push('--title', String(options.title))
      if (options.body) phaseArgs.push('--body', String(options.body))
      if (options.reason) phaseArgs.push('--reason', String(options.reason))
      if (options.kind) phaseArgs.push('--kind', String(options.kind))
      if (options.parent) phaseArgs.push('--parent', String(options.parent))
      if (options.changeClass) phaseArgs.push('--change-class', String(options.changeClass))
      if (options.gateFile) phaseArgs.push('--gate-file', String(options.gateFile))
      if (options.attestationFile)
        phaseArgs.push('--attestation-file', String(options.attestationFile))

      const res = run(cli, phaseArgs)
      if (res.error || res.status !== 0) {
        const msg = res.error?.message || res.stderr || res.stdout || 'phase append failed'
        throw new HandoffStepError(`phase append failed: ${msg}`, 1)
      }
    }

    if (!envelopeBody) {
      envelopeBody = formatPointerEnvelope({
        goal: options.goal,
        phase: options.phase,
        status: options.status ?? 'pass',
        worktree: options.worktree,
        epoch: options.epoch ?? 1,
        baseSha: options.baseSha ?? null,
        candidateSha: options.candidateSha ?? null,
        oracleDigest: options.oracleDigest ?? null,
        proofArtifactRef: options.proofArtifactRef ?? null,
        transitionUri,
      })
    }

    record = {
      goal: options.goal,
      phase: options.phase,
      status: options.status,
      to: options.to,
      epoch: options.epoch ?? 1,
      baseSha: options.baseSha ?? null,
      candidateSha: options.candidateSha ?? null,
      oracleDigest: options.oracleDigest ?? null,
      proofArtifactRef: options.proofArtifactRef ?? null,
      transitionUri,
      envelopeBody,
      state: 'phase-appended',
      createdAt: now.toISOString(),
    }

    mkdirSync(outboxDir, { recursive: true })
    writeFileSync(outboxFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  } else {
    // Read existing outboxFile
    if (!existsSync(outboxFile)) {
      throw new HandoffStepError(`Outbox record not found for recovery: ${outboxFile}`, 1)
    }
    record = JSON.parse(readFileSync(outboxFile, 'utf8'))
    target = target ?? record.to
    envelopeBody = envelopeBody ?? record.envelopeBody
  }

  if (!target) {
    throw new HandoffStepError('Destination seat (--to) is required.', 1)
  }

  // 2. Prepare envelope body file and dispatch queue handoff
  mkdirSync(outboxDir, { recursive: true })
  writeFileSync(bodyFile, envelopeBody, 'utf8')

  const queueResult = run('rig', [
    'queue',
    'create',
    '--destination',
    target,
    '--body-file',
    bodyFile,
  ])

  if (queueResult.error || queueResult.status !== 0) {
    // Keep outboxFile on disk
    const goalIdentifier = options.goal ?? safeGoalKey
    const phaseIdentifier = options.phase ?? record.phase ?? 'unknown'
    const recoveryCmd = `agentflow-sdlc handoff step --handoff-only --goal ${goalIdentifier} --phase ${phaseIdentifier}`
    const detail =
      queueResult.error?.message || queueResult.stderr || queueResult.stdout || 'rig queue failed'
    throw new HandoffStepError(`Queue delivery failed: ${detail}. Recover with: ${recoveryCmd}`, 1)
  }

  // 3. Clean up on success
  if (existsSync(outboxFile)) {
    try {
      unlinkSync(outboxFile)
    } catch {
      // Ignore cleanup error if already removed
    }
  }
  if (existsSync(bodyFile)) {
    try {
      unlinkSync(bodyFile)
    } catch {
      // Ignore cleanup error if already removed
    }
  }

  return {
    status: 'completed',
    goal: options.goal ?? record.goal,
    phase: Number(options.phase ?? record.phase),
    to: target,
    recovered: Boolean(options.handoffOnly),
    envelope: envelopeBody,
  }
}
