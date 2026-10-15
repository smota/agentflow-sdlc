// Atomic outbox handoff step and pointer envelope parser (#511).
// Uses only Node built-ins so it runs standalone in ~/.openrig/specs/agentflow-product/.
import {
  existsSync,
  openSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
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
  epoch,
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
    `Epoch: ${epoch ?? ''}`,
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
      epoch:
        fields['Epoch'] !== undefined && fields['Epoch'] !== '' ? Number(fields['Epoch']) : null,
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
  const minEpoch = minimumEpochByGoal[goal]
  if (
    !Number.isSafeInteger(epoch) ||
    epoch < 1 ||
    !Number.isSafeInteger(minEpoch) ||
    minEpoch < 1
  ) {
    return { ok: false, status: 'INVALID_EPOCH_BINDING', goal, epoch, minimumEpoch: minEpoch }
  }
  if (epoch < minEpoch)
    return { ok: false, status: 'STALE_EPOCH_FENCED', goal, epoch, minimumEpoch: minEpoch }
  return { ok: true, status: 'EPOCH_OK', goal, epoch }
}

function saveAtomic(file, value) {
  const staged = `${file}.${randomUUID()}.tmp`
  writeFileSync(staged, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', flush: true })
  renameSync(staged, file)
  // Persist the directory entry as well as the bytes before an external effect.
  // Unsupported filesystems fail closed instead of claiming durable custody.
  const directory = openSync(dirname(file), 'r')
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}

// Host injection is a trust boundary, not a caller-supplied approval boolean. It must
// resolve an existing authoritative run, never initialize replacement workflow state.
function resolveBinding(deps, options) {
  const binding = deps.resolveWorkflowBinding?.(options)
  if (
    !binding ||
    binding.verified !== true ||
    binding.goal !== options.goal ||
    !['runId', 'storeRef', 'oracleOwner', 'oracleDigest'].every(
      (key) => typeof binding[key] === 'string' && binding[key],
    ) ||
    !Number.isSafeInteger(binding.fencingToken) ||
    binding.fencingToken < 1 ||
    !validateEpochFence({
      goal: binding.goal,
      epoch: binding.epoch,
      minimumEpochByGoal: { [binding.goal]: binding.minimumEpoch },
    }).ok
  ) {
    throw new HandoffStepError(
      'Authoritative workflow binding unavailable or invalid; source-gap recovery required, existing history preserved.',
    )
  }
  return structuredClone(binding)
}

/**
 * Executes an outbox-backed atomic phase append and queue handoff step.
 */
export function executeHandoffStep(deps = {}, options = {}) {
  // Exclusive cooperative ownership: never delete somebody else's lock by age.
  const home = deps.home ?? homedir()
  const dir = join(home, '.openrig', 'state', 'handoff-outbox')
  const identity = createHash('sha256').update(`${options.goal}:${options.phase}`).digest('hex')
  const lock = join(dir, `${identity}.lock`)
  mkdirSync(dir, { recursive: true })
  try {
    mkdirSync(lock)
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new HandoffStepError(
        `Handoff operation locked at ${lock}; inspect owner.json and verify prior owner stopped before recovery.`,
      )
    throw error
  }
  try {
    writeFileSync(
      join(lock, 'owner.json'),
      JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }),
      { flag: 'wx' },
    )
    return executeLockedStep(deps, options)
  } finally {
    // Unlock failures must not mask an uncertain side effect or its recovery evidence.
    try {
      unlinkSync(join(lock, 'owner.json'))
      rmdirSync(lock)
    } catch {
      /* manual owner reconciliation */
    }
  }
}

function executeLockedStep(deps = {}, options = {}) {
  const home = deps.home ?? homedir()
  const run =
    deps.run ??
    ((cmd, args) =>
      spawnSync(cmd, args, {
        encoding: 'utf8',
        env: deps.env ?? process.env,
        shell: false,
        timeout: 30000,
      }))
  if (!options.goal || !Number.isInteger(options.phase) || options.phase < 0 || options.phase > 8)
    throw new HandoffStepError('Goal and valid phase are required.')
  const outboxDir = join(home, '.openrig', 'state', 'handoff-outbox')
  const oldKey = String(options.goal).replace(/[^A-Za-z0-9._-]/g, '_')
  const oldFile = join(outboxDir, `${oldKey}-phase-${options.phase}.json`)
  if (existsSync(oldFile))
    throw new HandoffStepError(
      `Legacy outbox record requires explicit source/custody reconciliation: ${oldFile}`,
    )
  const matching = readdirSync(outboxDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({
      file: join(outboxDir, name),
      record: JSON.parse(readFileSync(join(outboxDir, name), 'utf8')),
    }))
    .filter(
      ({ record }) =>
        record.goal === options.goal &&
        record.phase === options.phase &&
        (!options.key || record.phaseOptions?.key === options.key),
    )
  if (matching.length > 1)
    throw new HandoffStepError(
      'Multiple handoff operations match; supply original --key to reconcile custody',
    )
  let record = matching[0]?.record ?? null
  if (options.handoffOnly && !record)
    throw new HandoffStepError(
      'Outbox record not found for recovery; retain original key and source binding',
    )
  const operationKey = record?.phaseOptions?.key ?? options.key ?? `handoff-phase-${randomUUID()}`
  const identity = createHash('sha256')
    .update(JSON.stringify([options.goal, options.phase, operationKey]))
    .digest('hex')
  const outboxFile = matching[0]?.file ?? join(outboxDir, `${identity}.json`)
  const bodyFile = `${outboxFile}.body.txt`
  if (record && (record.goal !== options.goal || record.phase !== options.phase))
    throw new HandoffStepError('Outbox identity does not match request')
  if (record && options.to && record.to !== options.to)
    throw new HandoffStepError('Recovery destination cannot replace original target')
  if (record && options.body && record.envelopeBody !== options.body)
    throw new HandoffStepError('Recovery body cannot replace original operation')
  if (record) {
    for (const field of [
      'candidateSha',
      'baseSha',
      'oracleDigest',
      'epoch',
      'key',
      'transitionUri',
      'status',
    ]) {
      if (options[field] !== undefined && options[field] !== record.phaseOptions?.[field])
        throw new HandoffStepError(`Recovery ${field} conflicts with original operation`)
    }
  }
  const binding = resolveBinding(deps, { ...record?.phaseOptions, ...options })
  if (record && JSON.stringify(binding) !== JSON.stringify(record.binding))
    throw new HandoffStepError(
      'Authoritative binding/fence changed; reconcile existing handoff before transfer',
    )
  if (!record) {
    if (typeof deps.appendPhase !== 'function')
      throw new HandoffStepError(
        'Authoritative fenced phase append adapter unavailable; source-gap recovery required',
      )
    if (!options.to) throw new HandoffStepError('Destination seat (--to) is required.')
    if (options.epoch !== undefined && options.epoch !== binding.epoch)
      throw new HandoffStepError('Requested epoch contradicts authoritative binding')
    if (options.oracleDigest && options.oracleDigest !== binding.oracleDigest)
      throw new HandoffStepError('Oracle custody binding changed')
    if (
      options.body !== undefined &&
      options.body !==
        formatPointerEnvelope({
          ...options,
          epoch: binding.epoch,
          oracleDigest: binding.oracleDigest,
        })
    )
      throw new HandoffStepError(
        'Supplied envelope must exactly match canonical authoritative phase binding',
      )
    const phaseOptions = {
      ...structuredClone(options),
      epoch: binding.epoch,
      key: operationKey,
      workflowBinding: structuredClone(binding),
    }
    delete phaseOptions.handoffOnly
    record = {
      version: 2,
      goal: options.goal,
      phase: options.phase,
      to: options.to,
      binding,
      phaseOptions,
      queueId: `qitem-${randomUUID()}`,
      state: 'phase-pending',
      envelopeBody:
        options.body ??
        formatPointerEnvelope({
          ...options,
          epoch: binding.epoch,
          oracleDigest: binding.oracleDigest,
        }),
      createdAt: (deps.now?.() ?? new Date()).toISOString(),
      recoveryOwner: binding.recoveryOwner ?? binding.oracleOwner,
    }
    mkdirSync(outboxDir, { recursive: true })
    saveAtomic(outboxFile, record)
  }
  const persist = (state) => {
    record.state = state
    saveAtomic(outboxFile, record)
  }
  if (record.state === 'phase-pending') {
    const options = record.phaseOptions
    if (typeof deps.appendPhase === 'function') {
      const res = deps.appendPhase(options)
      if (res?.error || res?.ok === false || !(res?.status === 0 || res?.ok === true))
        throw new HandoffStepError(
          `phase append failed: ${res?.error?.message || res?.stderr || 'unknown result'}`,
        )
    } else {
      throw new HandoffStepError(
        'Authoritative fenced phase append adapter unavailable; source-gap recovery required',
      )
    }

    persist('phase-appended')
  }
  const freshBinding = resolveBinding(deps, record.phaseOptions)
  if (JSON.stringify(freshBinding) !== JSON.stringify(binding))
    throw new HandoffStepError('Authoritative binding/fence changed before queue dispatch')
  if (record.state !== 'submitted' && record.state !== 'completed') {
    writeFileSync(bodyFile, record.envelopeBody, 'utf8')
    // Persist uncertainty before the call: a crash after persistence must replay
    // exactly this queue identity using the runtime's documented --id mechanism.
    persist('dispatch-unknown')
    let result
    try {
      result = run('rig', [
        'queue',
        'create',
        '--id',
        record.queueId,
        '--destination',
        record.to,
        '--body-file',
        bodyFile,
        '--json',
      ])
    } catch (error) {
      throw new HandoffStepError(
        `Queue delivery outcome unknown: ${error.message}. Recover with: agentflow-sdlc handoff step --handoff-only --goal ${record.goal} --phase ${record.phase}`,
      )
    }
    if (result.error || result.status !== 0)
      throw new HandoffStepError(
        `Queue delivery outcome unknown: ${result.error?.message || result.stderr || 'queue failed'}. Recover with: agentflow-sdlc handoff step --handoff-only --goal ${record.goal} --phase ${record.phase}`,
      )
    let acknowledged
    try {
      acknowledged = JSON.parse(result.stdout ?? '{}')
    } catch {
      acknowledged = null
    }
    if (
      !acknowledged ||
      acknowledged.qitemId !== record.queueId ||
      acknowledged?.createWarning ||
      (acknowledged?.qitemId && acknowledged.qitemId !== record.queueId) ||
      (acknowledged?.destinationSession && acknowledged.destinationSession !== record.to) ||
      (acknowledged?.body && acknowledged.body !== record.envelopeBody)
    )
      throw new HandoffStepError(
        'Queue acknowledgement conflicts with original operation; outcome remains unknown, reconcile retained identity',
      )
    persist('submitted')
  }
  // Queue persistence or a wake receipt is not successor acceptance. Without a
  // host-verified, operation-bound custody receipt the obligation remains owned.
  if (record.state !== 'completed' && typeof deps.verifySuccessorCustody === 'function') {
    const receipt = deps.verifySuccessorCustody(structuredClone(record))
    if (
      receipt?.verified === true &&
      receipt.accepted === true &&
      receipt.queueId === record.queueId &&
      receipt.destination === record.to &&
      receipt.runId === binding.runId &&
      receipt.epoch === binding.epoch &&
      receipt.fencingToken === binding.fencingToken &&
      receipt.oracleOwner === binding.oracleOwner &&
      receipt.oracleDigest === binding.oracleDigest
    ) {
      if (JSON.stringify(resolveBinding(deps, record.phaseOptions)) !== JSON.stringify(binding))
        throw new HandoffStepError(
          'Authoritative binding/fence changed during custody verification',
        )
      record.custodyReceipt = structuredClone(receipt)
      persist('completed')
    }
  }
  return {
    status: record.state,
    custodyVerified: record.state === 'completed',
    goal: record.goal,
    phase: record.phase,
    to: record.to,
    queueId: record.queueId,
    recoveryOwner: record.recoveryOwner,
    recovered: Boolean(options.handoffOnly),
    envelope: record.envelopeBody,
  }
}
