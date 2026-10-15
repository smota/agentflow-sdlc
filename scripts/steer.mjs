#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluateMergeReadiness } from '../lib/core/steering-merge-policy.mjs'
import { evaluateSteeringBinding } from '../lib/core/steering-binding.mjs'
import { recordDigest } from '../lib/core/record-digest.mjs'
import {
  UNFREEZE_RESOLUTIONS,
  createUnfreezeResolution,
  unfreezeLedger,
  isAuthorizedUnfreezeActor,
  isInRigSeat,
} from '../lib/core/role-collaboration.mjs'
import {
  ALLOWED_DECIDER_TASKS,
  triageQueueOrdering,
  triageIssueDedupe,
  triageNudgeLevel,
} from '../lib/providers/decider-port.mjs'

export const STEER_USAGE = `Usage: agentflow-sdlc steer <subcommand> [options]

Supervisory steering verbs for out-of-rig governance and merge verification.

Subcommands:
  assign       Format and dispatch durable queue brief to pm.manager (or allowed seat)
  unfreeze     Format and seal unfreeze resolution with next epoch fencing token
  triage       Connect to decider port with sanitized payloads for heuristic triage
  merge-check  Verify review digest, green CI status, and human approval before merging PR
  liveness     Evaluate supervisory liveness circuit breaker and slice admission hold
  btw          Non-disruptive Human BTW read-only status query with zero worker nudges

Options:
  --help, -h   Show help for steer or any subcommand
  --json       Emit machine-readable JSON output
`

export const ASSIGN_USAGE = `Usage: agentflow-sdlc steer assign --destination <seat> --brief <file> [options]

Dispatches a durable work item to an authorized entry seat (pm.manager, orch.arch, human).

Options:
  --destination, --to <seat>   Target seat session (e.g. pm.manager, pm-manager@rig, orch.arch, human)
  --brief, --body-file <file>  Path to admitted task brief or specification packet
  --summary <text>             Optional summary string (defaults to title in brief)
  --goal <uri>                 Optional goal URI reference
  --transition <uri>           Optional transition URI reference
  --no-nudge                   Buffer brief for next boundary without interrupting active turns
  --dry-run                    Preview queue item creation without dispatching
  --json                       Emit JSON result
`

export const LIVENESS_USAGE = `Usage: agentflow-sdlc steer liveness [options]

Evaluates external supervisory steering liveness circuit breaker and slice admission hold.

Options:
  --last-heartbeat <iso>       Last recorded supervisor heartbeat timestamp (ISO-8601 or epoch ms)
  --unmerged-count <n>         Number of unmerged accepted slices pending integration (default: 0)
  --stale-timeout <ms>         Timeout threshold in milliseconds (default: 1800000 / 30m)
  --json                       Emit JSON result
`

export const BTW_USAGE = `Usage: agentflow-sdlc steer btw [options]

Non-disruptive human BTW query inspecting board and steering state with zero worker nudges.

Options:
  --goal <uri>                 Optional goal URI reference to inspect
  --json                       Emit JSON result
`

export const UNFREEZE_USAGE = `Usage: agentflow-sdlc steer unfreeze --ledger <file> --resolution <type> --rationale <text> [options]

Previews a sealed unfreeze resolution. Application requires an authenticated host steering adapter;\nstandalone CLI declarations cannot authenticate authority.

Options:
  --ledger <file>              Path to frozen role collaboration rework ledger JSON
  --resolution <type>          Resolution type: re-scope | slice-split | person-waiver | abandonment
  --rationale <text>           Detailed rationale explaining why unfreeze is justified
  --actor <seat>               Explicit authoring steering identity (required)
  --human-approval <ref>       Human authorization reference (required for waiver or abandonment)
  --dry-run                    Verify resolution and next ledger without writing file
  --no-apply                   Do not write updated ledger back to disk
  --json                       Emit JSON result
`

export const TRIAGE_USAGE = `Usage: agentflow-sdlc steer triage --task <task> [options]

Connects to decider port with sanitized payloads and deterministic fallbacks.

Tasks:
  queue-ordering               Order queued candidate tasks by priority and rework rounds
  issue-dedupe                 Determine if finding duplicates an open backlog issue
  nudge-level                  Select calibrated nudge urgency (gentle | standard | interrupt)

Options:
  --task <task>                One of: queue-ordering, issue-dedupe, nudge-level
  --payload <json>             Inline JSON payload for decider triage
  --payload-file <file>        File path containing JSON payload
  --seat-target <seat>         Target seat for nudge-level task
  --idle <seconds>             Idle duration in seconds for nudge-level task
  --rework-round <n>           Rework count for nudge-level task
  --last-state <state>         Last observed state for nudge-level task
  --seat <seat>                Authorizing steering seat (defaults to steer.lead)
  --plane <plane>              Steering plane (defaults to external-steering)
  --endpoint <url>             Local decider service URL (default: http://127.0.0.1:8002/v1/decide)
  --json                       Emit JSON result
`

export const MERGE_CHECK_USAGE = `Usage: agentflow-sdlc steer merge-check <pr-number> [options]

Verifies bilateral review digest, green CI status, and recorded human approval before calling gh pr merge.

Options:
  <pr-number>                  Pull request number to inspect and verify
  --check-only, --dry-run      Verify merge readiness without calling gh pr merge
  --execute, --merge           Request publication (requires authenticated host approval)
  --repo <owner/repo>          Optional GitHub repository override
  --auto-merge                 Treat PR as configured for auto-merge
  --human-approval <login>     Informational reference; cannot authorize publication
  --json                       Emit JSON result
`

export function getFlag(args, names, fallback = null) {
  const flags = Array.isArray(names) ? names : [names]
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i])) {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        return args[i + 1]
      }
      return true
    }
  }
  return fallback
}

export function hasFlag(args, names) {
  const flags = Array.isArray(names) ? names : [names]
  return args.some((arg) => flags.includes(arg))
}

export function validateSteerDestination(destination) {
  if (typeof destination !== 'string' || !destination.trim()) {
    throw new Error('Destination seat is required for steer assign')
  }
  const raw = destination.trim()
  const lower = raw.toLowerCase()
  if (lower === 'human') return raw

  const seatPart = lower.includes('@') ? lower.split('@')[0] : lower

  const prohibitedPatterns = [
    /^(?:dev[-.]build(?:-jr|-sr)?|builder(?:-jr|-sr|-pi)?|build)$/i,
    /^(?:dev[-.]qa|qa)$/i,
    /^(?:dev[-.]test[-.]eng|test[-.]eng(?:-pi)?)$/i,
    /^(?:rev[-.]review|reviewer)$/i,
    /^(?:pm[-.]analyst|analyst)$/i,
  ]

  for (const pattern of prohibitedPatterns) {
    if (pattern.test(seatPart)) {
      throw new Error(
        `Destination "${raw}" is prohibited. Supervisory steering plane communicates exclusively with pm.manager, orch.arch, or human. Routing directly to in-rig execution seats (builders, testers, reviewers, analysts) is barred.`,
      )
    }
  }

  const allowedPatterns = [/^(?:pm[-.]manager|manager)$/i, /^(?:orch[-.]arch|architect)$/i]

  const isAllowed = allowedPatterns.some((pattern) => pattern.test(seatPart))
  if (!isAllowed) {
    throw new Error(
      `Destination "${raw}" is not an authorized steering target. Allowed targets: pm.manager (goal intake), orch.arch (delivery sync / defect triage), or human (escalations).`,
    )
  }

  return raw
}

export async function steerAssign({
  destination,
  briefFile,
  summary,
  goal,
  transition,
  dryRun = false,
  noNudge = false,
  targetDir = process.cwd(),
  spawnFn = spawnSync,
  fs = { existsSync, readFileSync, writeFileSync, mkdirSync },
} = {}) {
  const validatedDest = validateSteerDestination(destination)
  if (!briefFile) {
    throw new Error('Brief file is required for steer assign (--brief <file>)')
  }
  const briefPath = resolve(targetDir, briefFile)
  if (!fs.existsSync(briefPath)) {
    throw new Error(`Brief file not found: ${briefFile}`)
  }

  const briefContent = fs.readFileSync(briefPath, 'utf8')
  let derivedSummary = summary
  if (!derivedSummary) {
    const firstLine = briefContent
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0)
    if (firstLine && firstLine.startsWith('# ')) {
      derivedSummary = `Task brief: ${firstLine.slice(2).trim()}`
    } else {
      derivedSummary = `Task brief: ${briefFile}`
    }
  }

  const command = [
    'rig',
    'queue',
    'create',
    '--destination',
    validatedDest,
    '--body-file',
    briefPath,
    '--summary',
    derivedSummary,
  ]

  if (noNudge) {
    command.push('--no-nudge')
  }

  if (dryRun) {
    return {
      ok: true,
      dispatched: false,
      dryRun: true,
      destination: validatedDest,
      briefFile: briefPath,
      summary: derivedSummary,
      ...(noNudge ? { noNudge: true } : {}),
      command,
    }
  }

  const result = spawnFn('rig', command.slice(1), { encoding: 'utf8' })
  if (result.status === 0) {
    if (!noNudge && (goal || transition)) {
      const msg = `Goal: ${goal || 'unspecified'} | Transition: ${transition || 'unspecified'} | Brief: ${briefPath}`
      spawnFn('rig', ['send', validatedDest, msg], { encoding: 'utf8' })
    }
    return {
      ok: true,
      dispatched: true,
      destination: validatedDest,
      briefFile: briefPath,
      summary: derivedSummary,
      ...(noNudge ? { noNudge: true } : {}),
      output: result.stdout?.trim(),
    }
  }

  if (result.error?.code === 'ENOENT') {
    const fallbackDir = resolve(targetDir, '.agent-runs', 'steer', 'queue')
    fs.mkdirSync(fallbackDir, { recursive: true })
    const queueId = `qitem-${Date.now()}`
    const itemPath = join(fallbackDir, `${queueId}.json`)
    const itemData = {
      id: queueId,
      destination: validatedDest,
      briefFile: briefPath,
      summary: derivedSummary,
      goal: goal || null,
      transition: transition || null,
      ...(noNudge ? { noNudge: true } : {}),
      createdAt: new Date().toISOString(),
    }
    fs.writeFileSync(itemPath, JSON.stringify(itemData, null, 2))
    return {
      ok: true,
      dispatched: true,
      source: 'local-queue-fallback',
      destination: validatedDest,
      briefFile: briefPath,
      summary: derivedSummary,
      ...(noNudge ? { noNudge: true } : {}),
      queueFile: itemPath,
      note: 'rig CLI not in PATH; brief persisted into local queue directory',
    }
  }

  throw new Error(`Failed to dispatch queue brief via rig CLI: ${result.stderr || result.stdout}`)
}

export async function steerUnfreeze({
  ledgerFile,
  resolution,
  rationale,
  actor,
  humanApproval,
  approvalRef,
  steeringBinding,
  steeringRequest,
  verifySteeringEndpoint,
  resolveSteeringSubject,
  nowMs = Date.now(),
  clock = Date.now,
  dryRun = false,
  apply = true,
  targetDir = process.cwd(),
  fs = { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync },
} = {}) {
  if (!ledgerFile) throw new Error('--ledger <file> is required')
  if (!resolution) {
    throw new Error(`--resolution <${UNFREEZE_RESOLUTIONS.join('|')}> is required`)
  }
  if (!rationale) throw new Error('--rationale <text> is required')

  const ledgerPath = resolve(targetDir, ledgerFile)
  if (!fs.existsSync(ledgerPath)) {
    throw new Error(`Ledger file not found: ${ledgerFile}`)
  }

  const rawLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  if (rawLedger?.frozen !== true) {
    throw new Error(`Ledger at ${ledgerFile} is not frozen`)
  }

  const effectiveActor = actor
  if (!effectiveActor) throw new Error('An explicit authenticated steering actor is required')
  if (isInRigSeat(effectiveActor)) {
    throw new Error(
      `in-rig execution seat "${effectiveActor}" cannot author an unfreeze resolution; steering plane only`,
    )
  }
  if (!isAuthorizedUnfreezeActor(effectiveActor)) {
    throw new Error(
      `actor "${effectiveActor}" is not an authorized steering identity (steer.lead, steer-lead@<rig>, or human:<login>)`,
    )
  }

  if (
    !Number.isSafeInteger(rawLedger.fencingToken) ||
    rawLedger.fencingToken < 0 ||
    rawLedger.fencingToken >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('A valid current legacy fencing token is required')
  const currentToken = rawLedger.fencingToken
  const nextToken = currentToken + 1

  const effectiveApproval = humanApproval || approvalRef
  const resolutionRecord = createUnfreezeResolution({
    resolution,
    actor: effectiveActor,
    rationale,
    fencingToken: nextToken,
    humanApproval: effectiveApproval,
    approvalRef: effectiveApproval,
  })

  const nextLedger = unfreezeLedger(rawLedger, resolutionRecord)

  let cleanupRequired = false
  let authority = { authorized: false, reachable: false, status: 'STEERING_PREVIEW_UNVERIFIED' }
  if (apply && !dryRun) {
    const binding = structuredClone(steeringBinding ?? {})
    const request = structuredClone(steeringRequest ?? {})
    let subject
    try {
      subject =
        typeof resolveSteeringSubject === 'function'
          ? resolveSteeringSubject({ ledgerPath, subjectDigest: recordDigest(rawLedger) })
          : null
    } catch {
      subject = null
    }
    if (
      !subject ||
      subject.verified !== true ||
      subject.subjectDigest !== recordDigest(rawLedger) ||
      subject.subjectId !== request.subjectId ||
      subject.goal !== request.goal ||
      subject.task !== request.task
    )
      return {
        ok: false,
        applied: false,
        authorized: false,
        status: 'STEERING_SUBJECT_UNVERIFIED',
        obligation: {
          owner: 'human/operator',
          action: 'verify-steering-authority',
          deadlineAt: Number.isFinite(nowMs) ? nowMs + 900000 : null,
        },
      }
    if (
      binding.authorityId !== effectiveActor ||
      request.power !== 'unfreeze' ||
      request.subjectDigest !== recordDigest(rawLedger) ||
      request.actionDigest !==
        recordDigest({
          resolution,
          rationale,
          humanApproval: effectiveApproval ?? null,
          actor: effectiveActor,
          subjectDigest: recordDigest(rawLedger),
          subjectId: subject.subjectId,
          goal: subject.goal,
          task: subject.task,
          nextToken,
        })
    )
      throw new Error(
        'Steering authority must bind the actor, unfreeze power, source identity and exact decision digests',
      )
    authority = evaluateSteeringBinding({
      binding,
      request,
      verifyEndpoint: verifySteeringEndpoint,
      nowMs,
    })
    if (!authority.authorized) return { ok: false, applied: false, ...authority }
    const lockPath = `${ledgerPath}.agentflow-steer.lock`
    let descriptor
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600)
    } catch {
      return {
        ok: false,
        applied: false,
        authorized: false,
        status: 'STEERING_LEDGER_LOCKED',
        obligation: {
          owner: 'human/operator',
          action: 'reconcile-steering-ledger-lock',
          deadlineAt: nowMs + 900000,
        },
      }
    }
    const temporaryPath = `${ledgerPath}.agentflow-${randomUUID()}.tmp`
    try {
      const currentLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
      if (recordDigest(currentLedger) !== request.subjectDigest)
        throw new Error('Steering ledger changed during authority verification')
      const finalTime = clock()
      if (!Number.isFinite(finalTime) || finalTime < nowMs || finalTime >= authority.validUntil)
        throw new Error('Steering authority expired before application')
      const currentSubject = resolveSteeringSubject({
        ledgerPath,
        subjectDigest: recordDigest(currentLedger),
      })
      if (
        currentSubject?.verified !== true ||
        ['subjectId', 'goal', 'task', 'subjectDigest'].some(
          (field) => currentSubject[field] !== subject[field],
        )
      )
        throw new Error('Steering subject changed before application')
      fs.writeFileSync(temporaryPath, JSON.stringify(nextLedger, null, 2), {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      })
      fs.renameSync(temporaryPath, ledgerPath)
    } finally {
      try {
        fs.closeSync(descriptor)
      } catch {
        cleanupRequired = true
      }
      try {
        fs.unlinkSync(lockPath)
      } catch {
        cleanupRequired = true
      }
      try {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
      } catch {
        cleanupRequired = true
      }
    }
  }

  return {
    ok: true,
    applied: apply && !dryRun,
    authorized: authority.authorized,
    cleanupRequired,
    storageGuarantee: 'cooperative-file-lock-and-atomic-rename',
    status: apply && !dryRun ? 'STEERING_APPLIED' : 'STEERING_PREVIEW_UNVERIFIED',
    ledgerPath,
    fencingToken: nextToken,
    resolution: resolutionRecord,
    ledger: nextLedger,
  }
}

export async function steerTriage({
  task,
  payload = {},
  seat,
  plane = 'external-steering',
  endpoint,
  options = {},
} = {}) {
  if (!task) {
    throw new Error(`--task <${ALLOWED_DECIDER_TASKS.join('|')}> is required`)
  }
  if (!ALLOWED_DECIDER_TASKS.includes(task)) {
    throw new Error(
      `Task "${task}" is not permitted on decider port allowlist. Permitted tasks: ${ALLOWED_DECIDER_TASKS.join(', ')}`,
    )
  }

  const effectiveSeat = seat || process.env.OPENRIG_SESSION_NAME || 'steer.lead'
  if (isInRigSeat(effectiveSeat)) {
    throw new Error(
      `In-rig execution seats (${effectiveSeat}) cannot connect to the decider port; steering plane only`,
    )
  }

  const opt = { ...options }
  if (endpoint) opt.endpoint = endpoint

  if (task === 'queue-ordering') {
    const tasks = Array.isArray(payload) ? payload : payload.tasks || []
    return triageQueueOrdering({ tasks, plane, seat: effectiveSeat, options: opt })
  }

  if (task === 'issue-dedupe') {
    const candidate = payload.candidate || {}
    const existingIssues = payload.existingIssues || []
    return triageIssueDedupe({
      candidate,
      existingIssues,
      plane,
      seat: effectiveSeat,
      options: opt,
    })
  }

  if (task === 'nudge-level') {
    const seatTarget = payload.seatTarget || 'unknown'
    const idleSeconds = Number(payload.idleSeconds || 0)
    const reworkRound = Number(payload.reworkRound || 0)
    const lastState = payload.lastState || 'idle'
    return triageNudgeLevel({
      seatTarget,
      idleSeconds,
      reworkRound,
      lastState,
      plane,
      seat: effectiveSeat,
      options: opt,
    })
  }
}

export function verifyMergeGates(pr, options = {}) {
  return evaluateMergeReadiness(pr, options)
}

export async function steerMergeCheck({
  prNumber,
  dryRun = false,
  checkOnly = false,
  execute = false,
  repo,
  autoMerge = false,
  humanApproval = null,
  resolveReviewEvidence,
  steeringBinding,
  steeringRequest,
  verifySteeringEndpoint,
  clock = Date.now,
  spawnFn = spawnSync,
} = {}) {
  const prNum = Number(prNumber)
  if (!Number.isSafeInteger(prNum) || prNum <= 0) throw new Error('Valid PR number required')
  const viewArgs = [
    'pr',
    'view',
    String(prNum),
    '--json',
    'number,title,state,isDraft,mergeable,headRefOid,reviewDecision,author,reviews,statusCheckRollup',
  ]
  if (repo) viewArgs.push('--repo', repo)
  const observePr = () => {
    const viewResult = spawnFn('gh', viewArgs, {
      encoding: 'utf8',
      shell: false,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    })
    if (viewResult.error || viewResult.status !== 0)
      throw new Error('PR source observation unavailable')
    const value = JSON.parse(viewResult.stdout)
    if (value.number !== prNum) throw new Error('Observed PR identity mismatch')
    if (typeof repo === 'string' && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      const permissions = new Map()
      for (const review of value.reviews ?? []) {
        const login = review?.author?.login
        if (typeof login !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(login)) continue
        if (!permissions.has(login)) {
          let permission = null
          try {
            const result = spawnFn(
              'gh',
              ['api', `repos/${repo}/collaborators/${login}/permission`],
              { encoding: 'utf8', shell: false, timeout: 10000, maxBuffer: 65536 },
            )
            if (!result.error && result.status === 0) {
              const record = JSON.parse(result.stdout)
              if (record.user?.login === login && typeof record.permission === 'string')
                permission = record.permission.toUpperCase()
            }
          } catch {
            /* Unknown permission cannot authorize approval. */
          }
          permissions.set(login, permission)
        }
        review.authorPermission = permissions.get(login)
      }
    }
    return value
  }
  const pr = observePr()
  const readiness = verifyMergeGates(pr, { resolveReviewEvidence })
  const common = {
    pr: prNum,
    title: pr.title,
    headOid: readiness.headOid,
    ready: readiness.ready,
    merged: false,
    gates: readiness.gates,
    failedGates: readiness.failedGates,
  }
  if (!readiness.ready)
    return {
      ok: false,
      ...common,
      escalation: readiness.failedGates.some((g) => g.name === 'humanApproval')
        ? { class: 'human-gate', message: 'Current-head human approval required' }
        : null,
    }
  if (dryRun || checkOnly || !execute) return { ok: true, ...common, status: 'MERGE_CHECK_ONLY' }
  const subjectId = `github:${repo}/pull/${prNum}`
  const subjectDigest = recordDigest({
    repository: repo,
    prNumber: prNum,
    headOid: readiness.headOid,
  })
  const actionDigest = recordDigest({
    action: 'merge',
    repository: repo,
    prNumber: prNum,
    headOid: readiness.headOid,
    strategy: 'squash',
    deleteBranch: true,
  })
  const request = structuredClone(steeringRequest ?? {}),
    binding = structuredClone(steeringBinding ?? {})
  if (
    typeof repo !== 'string' ||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo) ||
    request.power !== 'merge' ||
    request.subjectId !== subjectId ||
    request.subjectDigest !== subjectDigest ||
    request.actionDigest !== actionDigest
  )
    return {
      ok: false,
      ...common,
      status: 'MERGE_AUTHORITY_UNVERIFIED',
      obligation: {
        owner: 'human/operator',
        action: 'verify-head-bound-merge-authority',
        deadlineAt: clock() + 900000,
      },
    }
  const authority = evaluateSteeringBinding({
    binding,
    request,
    verifyEndpoint: verifySteeringEndpoint,
    nowMs: clock(),
  })
  if (!authority.authorized)
    return {
      ok: false,
      ...common,
      status: 'MERGE_AUTHORITY_UNVERIFIED',
      obligation: authority.obligation,
    }
  const currentPr = observePr()
  const currentReadiness = verifyMergeGates(currentPr, { resolveReviewEvidence })
  if (!currentReadiness.ready || currentReadiness.headOid !== readiness.headOid)
    return {
      ok: false,
      ...common,
      status: 'MERGE_READINESS_CHANGED',
      failedGates: currentReadiness.failedGates,
    }
  const finalTime = clock()
  if (
    !Number.isFinite(finalTime) ||
    finalTime < authority.observedAt ||
    finalTime >= authority.validUntil
  )
    return { ok: false, ...common, status: 'MERGE_AUTHORITY_EXPIRED' }
  const mergeArgs = [
    'pr',
    'merge',
    String(prNum),
    '--squash',
    '--delete-branch',
    '--match-head-commit',
    readiness.headOid,
    '--repo',
    repo,
  ]
  let result
  try {
    result = spawnFn('gh', mergeArgs, {
      encoding: 'utf8',
      shell: false,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    })
  } catch {
    return { ok: false, ...common, status: 'MERGE_OUTCOME_UNKNOWN', requiresReconciliation: true }
  }
  if (result.error || result.status !== 0)
    return { ok: false, ...common, status: 'MERGE_OUTCOME_UNKNOWN', requiresReconciliation: true }
  let observed
  try {
    const proof = spawnFn(
      'gh',
      [
        'pr',
        'view',
        String(prNum),
        '--repo',
        repo,
        '--json',
        'number,state,headRefOid,mergeCommit',
      ],
      { encoding: 'utf8', shell: false, timeout: 30000, maxBuffer: 1024 * 1024 },
    )
    if (!proof.error && proof.status === 0) observed = JSON.parse(proof.stdout)
  } catch {
    /* Submission stays unresolved without source readback. */
  }
  if (
    observed?.number === prNum &&
    observed.state === 'MERGED' &&
    observed.headRefOid === readiness.headOid &&
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(observed.mergeCommit?.oid ?? '')
  )
    return {
      ok: true,
      ...common,
      merged: true,
      status: 'MERGE_CONFIRMED',
      publicationVerified: true,
      mergeCommit: observed.mergeCommit.oid,
      requiresReconciliation: false,
    }
  return {
    ok: false,
    ...common,
    status: 'MERGE_SUBMITTED',
    publicationVerified: false,
    requiresReconciliation: true,
  }
}

export const SUPERVISOR_STALE_TIMEOUT_MS = 30 * 60 * 1000

export function evaluateSupervisorLiveness({
  lastHeartbeatAt = null,
  nowMs = Date.now(),
  staleTimeoutMs = SUPERVISOR_STALE_TIMEOUT_MS,
  unmergedAcceptedCount = 0,
  steeringBinding,
  steeringRequest,
  verifySteeringEndpoint,
} = {}) {
  const validCount = Number.isSafeInteger(unmergedAcceptedCount) && unmergedAcceptedCount >= 0
  const holdNewSliceAdmission = true

  if (!lastHeartbeatAt || !validCount) {
    return {
      reachable: false,
      status: 'SUPERVISOR_UNREACHABLE',
      ageMs: null,
      staleTimeoutMs,
      holdNewSliceAdmission,
    }
  }

  const lastMs = typeof lastHeartbeatAt === 'number' ? lastHeartbeatAt : Date.parse(lastHeartbeatAt)
  const ageMs = Number.isFinite(lastMs) ? Math.max(0, nowMs - lastMs) : null

  if (
    !Number.isFinite(lastMs) ||
    !Number.isFinite(nowMs) ||
    lastMs > nowMs ||
    !Number.isFinite(staleTimeoutMs) ||
    staleTimeoutMs <= 0 ||
    ageMs > staleTimeoutMs
  ) {
    return {
      reachable: false,
      status: 'SUPERVISOR_UNREACHABLE',
      ageMs,
      staleTimeoutMs,
      holdNewSliceAdmission,
    }
  }

  const authority = evaluateSteeringBinding({
    binding: steeringBinding,
    request: steeringRequest,
    verifyEndpoint: verifySteeringEndpoint,
    nowMs,
  })
  if (!authority.authorized || steeringRequest?.power !== 'observe')
    return {
      reachable: false,
      status: 'SUPERVISOR_UNVERIFIED',
      ageMs,
      staleTimeoutMs,
      holdNewSliceAdmission,
      obligation: authority.obligation,
    }
  return {
    reachable: true,
    status: 'SUPERVISOR_HEALTHY',
    ageMs,
    staleTimeoutMs,
    holdNewSliceAdmission: false,
  }
}

export function steerBtwQuery({
  targetDir = process.cwd(),
  goal = null,
  fs = { existsSync, readFileSync },
} = {}) {
  let state = null
  const heartbeatPath = join(targetDir, '.agent-runs', 'steer', 'heartbeat.json')
  const statePath = join(targetDir, '.agentflow', 'state.json')

  if (fs?.existsSync?.(heartbeatPath)) {
    try {
      state = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8'))
    } catch {
      state = null
    }
  } else if (fs?.existsSync?.(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    } catch {
      state = null
    }
  }

  const result = {
    ok: true,
    mode: 'read-only-no-nudge',
    nudgeDispatched: false,
    goal,
    inspectedAt: new Date().toISOString(),
  }

  if (state !== null) {
    result.state = state
  }

  return result
}

export async function runSteerCli(rawArgs = []) {
  const args = [...rawArgs]
  const isJson = hasFlag(args, '--json')
  const targetDir = getFlag(args, '--target', process.cwd())

  // Strip --target from command arguments
  const filteredArgs = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target') {
      i++ // skip value
    } else {
      filteredArgs.push(args[i])
    }
  }

  const [subcommand, ...subArgs] = filteredArgs

  if (!subcommand || hasFlag(filteredArgs, ['--help', '-h'])) {
    if (!subcommand) {
      process.stdout.write(STEER_USAGE)
      return 0
    }
    if (subcommand === 'assign') {
      process.stdout.write(ASSIGN_USAGE)
      return 0
    }
    if (subcommand === 'unfreeze') {
      process.stdout.write(UNFREEZE_USAGE)
      return 0
    }
    if (subcommand === 'triage') {
      process.stdout.write(TRIAGE_USAGE)
      return 0
    }
    if (subcommand === 'merge-check') {
      process.stdout.write(MERGE_CHECK_USAGE)
      return 0
    }
    if (subcommand === 'liveness') {
      process.stdout.write(LIVENESS_USAGE)
      return result.holdNewSliceAdmission ? 3 : 0
    }
    if (subcommand === 'btw') {
      process.stdout.write(BTW_USAGE)
      return 0
    }
    process.stdout.write(STEER_USAGE)
    return 0
  }

  try {
    if (subcommand === 'assign') {
      const destination = getFlag(
        subArgs,
        ['--destination', '--to'],
        subArgs[0]?.startsWith('--') ? null : subArgs[0],
      )
      const briefFile = getFlag(
        subArgs,
        ['--brief', '--body-file'],
        subArgs[1]?.startsWith('--') ? null : subArgs[1],
      )
      const summary = getFlag(subArgs, '--summary')
      const goal = getFlag(subArgs, '--goal')
      const transition = getFlag(subArgs, '--transition')
      const dryRun = hasFlag(subArgs, '--dry-run')
      const noNudge = hasFlag(subArgs, '--no-nudge')

      const result = await steerAssign({
        destination,
        briefFile,
        summary,
        goal,
        transition,
        dryRun,
        noNudge,
        targetDir,
      })

      if (isJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      } else {
        process.stdout.write(
          result.dryRun
            ? `[Dry Run] Prepared brief assignment to ${result.destination}:\n  Brief: ${result.briefFile}\n  Summary: ${result.summary}\n`
            : `✓ Brief dispatched to ${result.destination}:\n  Brief: ${result.briefFile}\n  Summary: ${result.summary}\n`,
        )
      }
      return 0
    }

    if (subcommand === 'unfreeze') {
      const ledgerFile = getFlag(subArgs, '--ledger')
      const resolution = getFlag(subArgs, '--resolution')
      const rationale = getFlag(subArgs, '--rationale')
      const actor = getFlag(subArgs, '--actor')
      const humanApproval = getFlag(subArgs, ['--human-approval', '--approval-ref'])
      const dryRun = hasFlag(subArgs, '--dry-run')
      const apply = !hasFlag(subArgs, '--no-apply')

      const result = await steerUnfreeze({
        ledgerFile,
        resolution,
        rationale,
        actor,
        humanApproval,
        dryRun,
        apply,
        targetDir,
      })

      if (isJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      } else if (!result.ok) {
        process.stdout.write(
          `Unfreeze held: ${result.status}; authenticated steering endpoint required\n`,
        )
      } else {
        process.stdout.write(
          `✓ Unfreeze resolution sealed [${result.resolution.digest}]\n` +
            `  Resolution: ${result.resolution.resolution}\n` +
            `  Actor: ${result.resolution.actor}\n` +
            `  Next Epoch Fencing Token: ${result.fencingToken}\n` +
            `  Ledger: ${result.ledgerPath} (${result.applied ? 'updated' : 'preview'})\n`,
        )
      }
      return result.ok ? 0 : 3
    }

    if (subcommand === 'triage') {
      const task = getFlag(subArgs, '--task')
      const payloadFile = getFlag(subArgs, '--payload-file')
      const payloadRaw = getFlag(subArgs, '--payload')
      const seatTarget = getFlag(subArgs, '--seat-target')
      const idle = getFlag(subArgs, '--idle')
      const reworkRound = getFlag(subArgs, '--rework-round')
      const lastState = getFlag(subArgs, '--last-state')
      const seat = getFlag(subArgs, '--seat')
      const plane = getFlag(subArgs, '--plane', 'external-steering')
      const endpoint = getFlag(subArgs, '--endpoint')

      let payload = {}
      if (payloadFile) {
        const fullPath = resolve(targetDir, payloadFile)
        payload = JSON.parse(readFileSync(fullPath, 'utf8'))
      } else if (payloadRaw) {
        payload = JSON.parse(payloadRaw)
      } else if (task === 'nudge-level') {
        payload = {
          seatTarget: seatTarget || 'unknown',
          idleSeconds: idle ? Number(idle) : 0,
          reworkRound: reworkRound ? Number(reworkRound) : 0,
          lastState: lastState || 'idle',
        }
      }

      const result = await steerTriage({
        task,
        payload,
        seat,
        plane,
        endpoint,
      })

      if (isJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      } else {
        process.stdout.write(`Triage [${task}] result (source: ${result.source}):\n`)
        if (task === 'queue-ordering') {
          process.stdout.write(`  Selected Task: ${result.selectedTaskId || 'none'}\n`)
          process.stdout.write(
            `  Order: ${(result.orderedTasks || []).map((t) => t.id).join(' -> ')}\n`,
          )
        } else if (task === 'issue-dedupe') {
          process.stdout.write(`  Duplicate: ${result.isDuplicate ? 'YES' : 'NO'}\n`)
          if (result.duplicateOf) {
            process.stdout.write(`  Duplicate of: #${result.duplicateOf}\n`)
          }
        } else if (task === 'nudge-level') {
          process.stdout.write(`  Nudge Level: ${result.level}\n`)
        }
      }
      return 0
    }

    if (subcommand === 'merge-check') {
      const prArg = subArgs.find((a) => !a.startsWith('--'))
      const prNumber = getFlag(subArgs, '--pr', prArg)
      const checkOnly = hasFlag(subArgs, ['--check-only', '--dry-run'])
      const execute = hasFlag(subArgs, ['--execute', '--merge'])
      const repo = getFlag(subArgs, '--repo')
      const autoMerge = hasFlag(subArgs, '--auto-merge')
      const humanApproval = getFlag(subArgs, '--human-approval')

      const result = await steerMergeCheck({
        prNumber,
        checkOnly,
        execute,
        repo,
        autoMerge,
        humanApproval,
      })

      if (isJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      } else if (result.ok) {
        if (result.merged) {
          process.stdout.write(
            `✓ PR #${result.pr} passed all gates and squashed/merged successfully.\n`,
          )
        } else {
          process.stdout.write(`✓ PR #${result.pr} is ready to merge (all gates passed).\n`)
        }
      } else {
        process.stdout.write(
          `PR #${result.pr} held: ${result.status ?? 'MERGE_READINESS_UNVERIFIED'}\n`,
        )
        if (result.obligation)
          process.stdout.write(`  ${result.obligation.owner}: ${result.obligation.action}\n`)
        for (const failure of result.failedGates || []) {
          process.stdout.write(`  - ${failure.name}: ${failure.reason}\n`)
        }
        if (result.escalation) {
          process.stdout.write(
            `\n⚠️ ESCALATION [${result.escalation.class}]: ${result.escalation.message}\n`,
          )
        }
      }

      if (!result.ok) {
        return result.escalation || result.obligation || result.requiresReconciliation ? 3 : 1
      }
      return 0
    }

    if (subcommand === 'liveness') {
      const lastHeartbeat = getFlag(subArgs, ['--last-heartbeat', '--heartbeat'])
      const unmergedCount = getFlag(subArgs, ['--unmerged-count', '--unmerged'])
      const staleTimeout = getFlag(subArgs, '--stale-timeout')

      const result = evaluateSupervisorLiveness({
        lastHeartbeatAt: lastHeartbeat || null,
        unmergedAcceptedCount: unmergedCount ? Number(unmergedCount) : 0,
        ...(staleTimeout ? { staleTimeoutMs: Number(staleTimeout) } : {}),
      })

      if (isJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      } else {
        if (result.reachable) {
          process.stdout.write(
            `✓ Supervisor healthy (age: ${result.ageMs !== null ? Math.round(result.ageMs / 1000) + 's' : 'unknown'}, status: ${result.status})\n`,
          )
        } else {
          process.stdout.write(
            `✗ Supervisor unreachable (${result.status}, holdNewSliceAdmission: ${result.holdNewSliceAdmission})\n`,
          )
        }
      }
      return result.holdNewSliceAdmission ? 3 : 0
    }

    if (subcommand === 'btw') {
      const goal = getFlag(subArgs, '--goal')
      const result = steerBtwQuery({ targetDir, goal })

      if (isJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      } else {
        process.stdout.write(
          `✓ BTW status query complete (mode: ${result.mode}, nudgeDispatched: ${result.nudgeDispatched})\n`,
        )
      }
      return 0
    }

    process.stderr.write(`Unknown steer subcommand: ${subcommand}\n\n${STEER_USAGE}`)
    return 2
  } catch (err) {
    if (isJson) {
      process.stdout.write(JSON.stringify({ ok: false, error: err.message }, null, 2) + '\n')
    } else {
      process.stderr.write(`Error: ${err.message}\n`)
    }
    return 1
  }
}

// Direct execution entrypoint
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSteerCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
