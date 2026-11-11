// The rig bridge (#582): moves ready source work into the OpenRig queue and returns evidence to
// the source. It is source-agnostic: it talks to a SourceAdapter (#580) and a QueuePort only.
//
// Invariants (SDD §1): the source is the truth and every operation re-reads it; queue rows carry a
// reference and derived ids, never artifact content; no polling loop, one pass per call. Only
// role-pass evidence written by a trusted evidence writer counts for any decision.
//
// Liveness never comes from a bounded queue listing. An item's own rows are its intake chain
// (the stable id and its generation ids, read one by one with `show`) and the frontier packets of
// workflow instances tagged `af:<stable id>`. Escalation and notice rows are not work.
//
// Extension points, all optional injected ports:
//   admission({ workItem, stableId, rig })  → { admit: true } | { admit: false, reason }
//                                             backpressure (#586); default admits everything
//   claim({ adapter, reference, owner })    → { won, holder } | capability-absent result
//                                             source claim before work (#586); default claimOrYield
//   worktrees.prepare({ slice, stableId, workItem }) → { path }   on start (#584b)
//   worktrees.cleanup({ slice, stableId, workItem }) → result     on merged (#584b)
//   worktrees.sweep({ openSlices })                  → result     on reconcile (#584b)
//   notifier.deliver({ kind, ref, stableId, reason, evidenceRef }) → result  (#585/#586)
import { createHash } from 'node:crypto'
import { allowedNext } from '../core/phase-graph.mjs'
import {
  callSourceCapability,
  describeSourceLimits,
  isCapabilityAbsent,
  sourceCapability,
} from '../core/source-adapter.mjs'
import { evaluateReadyPredicate } from '../core/ready-predicate.mjs'
import { claimOrYield } from '../core/source-claim.mjs'
import { formatRolePassComment } from '../core/role-pass-evidence.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { entryPhaseFor } from './config.mjs'
import { buildRolePassRecord, findRecordedRetry, trustedTransitions } from './evidence.mjs'
import { formatIntakeBody, parseIntakeBody } from './intake-body.mjs'
import {
  LIVE_ROW_STATES,
  generationId,
  isLiveInstance,
  isLiveRow,
  itemTag,
  mergeGate,
  replayGate,
  reviewGate,
  sessionForSeat,
  sliceIdFor,
  stableIdFromTags,
  stableQueueId,
  tierForChangeClass,
} from './queue-id.mjs'

export class BridgeError extends Error {
  constructor(message, { status = 'failed', exitCode = 1, detail = null } = {}) {
    super(message)
    this.status = status
    this.exitCode = exitCode
    this.detail = detail
  }
}

const MAX_GENERATIONS = 1000
// Reconcile lists the bridge's own live rows to find strays. A full page means the answer may be
// truncated, which is an error, never a smaller answer.
export const STRAY_LIST_LIMIT = 10000
const REVIEW_PHASE = 6
const BUILD_PHASE = 4
const LAST_PHASE = 8
const PUSHED_FIELDS = {
  title: (item) => item.title,
  labels: (item) => [...item.labels].sort(),
  lifecycle: (item) => item.lifecycle,
  state: (item) => item.lifecycle,
  status: (item) => item.status,
}

const openAdmission = async () => ({ admit: true })

function defaultNotifier(queue, config) {
  return {
    async deliver({ kind, ref, stableId, reason, evidenceRef }) {
      const destination = config.escalateTo ?? `human@${config.rigs.control}`
      // One row per item, kind and reason: a repeated escalation is a re-delivery, not a new ask.
      const digest = createHash('sha256')
        .update(String(reason ?? ''))
        .digest('hex')
        .slice(0, 8)
      return queue.create({
        id: `${stableId}-${kind}-${digest}`,
        destination,
        source: `agentflow-bridge@${config.rigs.control}`,
        summary: `AgentFlow needs a person for ${ref}: ${kind}`,
        body: `agentflow-escalation/v1\nref=${ref}\nstable_id=${stableId}\nkind=${kind}\nreason=${String(reason ?? '').replace(/\s+/g, ' ')}\n`,
        tags: [`af-notice:${stableId}`],
        humanIntent: 'decision',
        evidenceRef: evidenceRef ?? ref,
      })
    },
  }
}

function sortedValue(field, value) {
  return field === 'labels' && Array.isArray(value) ? [...value].sort() : value
}

// Pushed content never decides anything; it is only compared, to tell the pusher what was ignored.
export function pushedContentIgnored(pushed, workItem) {
  if (!pushed || typeof pushed !== 'object') return []
  return Object.keys(PUSHED_FIELDS)
    .filter((field) => Object.hasOwn(pushed, field))
    .filter(
      (field) =>
        JSON.stringify(sortedValue(field, pushed[field])) !==
        JSON.stringify(PUSHED_FIELDS[field](workItem)),
    )
}

// The phase an item resumes at, from trusted transitions in source order: the phase a named
// return points to, else one after the latest applied phase, else the entry phase. Null when the
// return-cycle limit is reached (a person must decide).
export function resumePhaseFor(transitions, entryPhase) {
  const applied = transitions.filter((item) => item.status === 'pass' || item.status === 'skipped')
  const latest = applied.at(-1)
  if (!latest) return entryPhase
  const next = allowedNext(transitions)
  if (next.length === 0) return null
  const back =
    latest.status === 'skipped' && next.length === 1 && next[0] < latest.phase ? next[0] : null
  const phase = back ?? Math.min(latest.phase + 1, LAST_PHASE)
  return Math.max(phase, entryPhase)
}

export function createBridge({
  source,
  queue,
  config,
  clock = () => new Date(),
  admission = openAdmission,
  claim = (input) => claimOrYield(input),
  worktrees = null,
  notifier = null,
}) {
  if (!source || !queue || !config)
    throw new Error('createBridge requires source, queue and config')
  const rig = config.rig
  const entryPhase = entryPhaseFor(config.entrySeat)
  const intakeDestination = sessionForSeat(config.entrySeat, rig)
  const bridgeSession = `agentflow-bridge@${rig}`
  const evidenceWriters = config.evidenceWriters ?? []
  const evidenceTrust = evidenceWriters.length ? null : 'no-evidence-writers-configured'
  const people = notifier ?? defaultNotifier(queue, config)
  const trusted = (workItem) => trustedTransitions(workItem.transitions, evidenceWriters)
  const withTrust = (result) => (evidenceTrust ? { ...result, evidenceTrust } : result)

  function parseRef(refText) {
    const parsed = parseSourceRef(refText)
    if (!parsed) {
      throw new BridgeError(`invalid source reference: ${refText ?? '(none)'}`, {
        status: 'usage',
        exitCode: 2,
      })
    }
    return parsed
  }

  async function readItem(refText) {
    const parsed = parseRef(refText)
    const reference = source.toReference(parsed)
    const workItem = await callSourceCapability(
      source,
      'ready-predicates',
      'readWorkItem',
      reference,
    )
    if (isCapabilityAbsent(workItem)) {
      throw new BridgeError(`source adapter ${source.id} does not declare ready-predicates`, {
        status: 'capability-absent',
        detail: workItem,
      })
    }
    return { parsed, reference, workItem, stableId: stableQueueId(parsed) }
  }

  function readiness(workItem) {
    const result = evaluateReadyPredicate(config.ready, workItem, {
      supportedKinds: source.readyPredicateKinds ?? [],
    })
    if (result.status === 'unsupported') {
      throw new BridgeError(
        `source adapter ${source.id} cannot evaluate ready predicate kinds: ${result.unsupportedKinds.join(', ')}`,
        { status: 'unsupported-predicate', detail: result },
      )
    }
    return result
  }

  // The item's intake chain: the stable id, then -g2, -g3 … until an id is unused.
  async function intakeChain(stableId) {
    const rows = []
    for (let n = 1; n < MAX_GENERATIONS; n += 1) {
      const id = n === 1 ? stableId : generationId(stableId, n)
      const row = await queue.show(id)
      if (!row) return { rows, nextId: id }
      rows.push(row)
    }
    throw new BridgeError(`no free generation id for ${stableId}`)
  }

  async function instancesFor(stableId) {
    return queue.listWorkflows({ tag: itemTag(stableId) })
  }

  async function liveness(stableId) {
    const chain = await intakeChain(stableId)
    const instances = (await instancesFor(stableId)).filter(isLiveInstance)
    return { chain, rows: chain.rows.filter(isLiveRow), instances }
  }

  async function createIntake({ parsed, workItem, stableId, chain, dryRun = false }) {
    const resumePhase = resumePhaseFor(trusted(workItem), entryPhase)
    if (resumePhase === null) {
      return { blocked: 'the return-cycle limit is reached; a person must decide' }
    }
    const slice = sliceIdFor(parsed)
    const tier = tierForChangeClass(workItem.changeClass)
    if (dryRun) return { qitemId: chain.nextId, created: false, dryRun: true, resumePhase }
    const body = formatIntakeBody({
      ref: workItem.ref,
      stableId,
      slice,
      resumePhase,
      tier,
      workflow: config.workflowSpec,
    })
    let id = chain.nextId
    for (let attempt = 0; attempt < MAX_GENERATIONS; attempt += 1) {
      const created = await queue.create({
        id,
        destination: intakeDestination,
        source: bridgeSession,
        summary: `AgentFlow intake ${workItem.ref}`,
        body,
        tags: [itemTag(stableId)],
        tier,
        priority: 'routine',
        mission: workItem.partOf ?? undefined,
        slice,
      })
      // Someone else took this id first. A live row is the item's work; a closed one means the
      // next generation.
      if (created.created || LIVE_ROW_STATES.includes(created.state)) {
        return { ...created, resumePhase }
      }
      id = generationId(stableId, Number(id.match(/-g(\d+)$/)?.[1] ?? 1) + 1)
    }
    throw new BridgeError(`no free generation id for ${stableId}`)
  }

  async function admit(workItem, stableId) {
    const verdict = await admission({ workItem, stableId, rig })
    return verdict?.admit === false ? verdict : null
  }

  async function intakeReady(refText, pushed) {
    const { parsed, workItem, stableId } = await readItem(refText)
    const ignored = pushedContentIgnored(pushed, workItem)
    const base = withTrust({ ref: workItem.ref, stableId, pushedContentIgnored: ignored })
    const ready = readiness(workItem)
    if (ready.status === 'not-ready')
      return { ...base, status: 'not-ready', reasons: ready.reasons }
    const live = await liveness(stableId)
    if (live.rows.length || live.instances.length) {
      return {
        ...base,
        status: 'already-queued',
        qitemId: live.rows[0]?.qitemId ?? null,
        instanceId: live.instances[0]?.instanceId ?? null,
      }
    }
    const deferred = await admit(workItem, stableId)
    if (deferred) return { ...base, status: 'deferred', reason: deferred.reason ?? null }
    const created = await createIntake({ parsed, workItem, stableId, chain: live.chain })
    if (created.blocked) return { ...base, status: 'not-ready', reasons: [created.blocked] }
    return {
      ...base,
      status: created.created ? 'queued' : 'already-queued',
      qitemId: created.qitemId,
      resumePhase: created.resumePhase,
      ...(created.warning ? { warning: created.warning } : {}),
    }
  }

  // The item's rows that can wait on a gate: its intake chain and its instances' frontier packets.
  async function itemRows(stableId) {
    const { chain, instances } = await liveness(stableId)
    const packets = []
    for (const id of instances.flatMap((instance) => instance.frontier ?? [])) {
      const row = await queue.show(id)
      if (row) packets.push(row)
    }
    return { chainRows: chain.rows, packets, instances }
  }

  async function resolveGate(stableId, gate, decision) {
    const { chainRows, packets } = await itemRows(stableId)
    const waiting = [...chainRows, ...packets].filter(
      (row) => row.state === 'blocked' && row.blockedOn === gate,
    )
    for (const row of waiting) await queue.resolve(row.qitemId, { decision })
    return waiting.map((row) => row.qitemId)
  }

  async function reviewDone(refText) {
    const { workItem, stableId } = await readItem(refText)
    const transitions = trusted(workItem)
    const lastIndex = (phase) =>
      transitions.findLastIndex((item) => item.phase === phase && item.status === 'pass')
    const review = lastIndex(REVIEW_PHASE)
    const base = withTrust({ ref: workItem.ref, stableId })
    if (review === -1 || review < lastIndex(BUILD_PHASE)) {
      return {
        ...base,
        status: 'not-ready',
        reasons: [
          `no trusted phase ${REVIEW_PHASE} pass recorded after the latest phase ${BUILD_PHASE} pass`,
        ],
      }
    }
    const decision = transitions[review].uri ?? `phase ${REVIEW_PHASE} pass`
    const resolved = await resolveGate(stableId, reviewGate(stableId), decision)
    return { ...base, status: resolved.length ? 'resolved' : 'no-waiting-row', resolved, decision }
  }

  async function merged(workItem, stableId) {
    const resolved = await resolveGate(stableId, mergeGate(stableId), `merged: ${workItem.ref}`)
    const cleanup = worktrees?.cleanup
      ? await worktrees.cleanup({ slice: sliceIdFor(workItem), stableId, workItem })
      : null
    return { resolved, worktree: cleanup }
  }

  async function closed(stableId, reason) {
    const { chainRows, instances } = await itemRows(stableId)
    const aborted = []
    for (const instance of instances) {
      await queue.abortWorkflow(instance.instanceId, { reason })
      aborted.push(instance.instanceId)
    }
    const canceled = []
    for (const row of chainRows.filter(isLiveRow)) {
      await queue.update(row.qitemId, {
        state: 'done',
        closureReason: 'canceled',
        resolution: reason,
      })
      canceled.push(row.qitemId)
    }
    return { aborted, canceled }
  }

  async function intakeMerged(refText) {
    const { workItem, stableId } = await readItem(refText)
    const base = { ref: workItem.ref, stableId }
    if (workItem.lifecycle !== 'merged') {
      return {
        ...base,
        status: 'not-ready',
        reasons: [`lifecycle is ${workItem.lifecycle}, not merged`],
      }
    }
    const result = await merged(workItem, stableId)
    return { ...base, status: result.resolved.length ? 'resolved' : 'no-waiting-row', ...result }
  }

  async function intakeClosed(refText) {
    const { workItem, stableId } = await readItem(refText)
    const base = { ref: workItem.ref, stableId }
    if (workItem.lifecycle !== 'closed') {
      return {
        ...base,
        status: 'not-ready',
        reasons: [`lifecycle is ${workItem.lifecycle}, not closed`],
      }
    }
    return {
      ...base,
      status: 'aborted',
      ...(await closed(stableId, `source closed: ${workItem.ref}`)),
    }
  }

  const EVENTS = {
    ready: (refText, options) => intakeReady(refText, options.pushed),
    'review-done': reviewDone,
    merged: intakeMerged,
    closed: intakeClosed,
  }

  // A rebuilt item that cannot be replayed (risk R5): abort the half-replayed instance so no later
  // start adopts it, park the intake row and tell a person.
  async function parkReplay(row, intake, instanceId, reason) {
    const gate = replayGate(intake.stableId)
    await queue.abortWorkflow(instanceId, { reason: `replay refused: ${reason}` })
    await queue.block(row.qitemId, {
      on: gate,
      continuation: `fix the cause, then run agentflow-sdlc bridge start ${row.qitemId} again`,
      note: reason,
    })
    const notified = await people.deliver({
      kind: 'reconcile-replay',
      ref: intake.ref,
      stableId: intake.stableId,
      reason,
    })
    return { gate, aborted: instanceId, notified: notified ?? null }
  }

  // Replays already-evidenced phases so a rebuilt item resumes where the source says it is.
  async function fastForward({ instanceId, entryQitemId, transitions, ref, resumePhase, session }) {
    let packetId = entryQitemId
    const replayed = []
    for (let phase = entryPhase; phase < resumePhase; phase += 1) {
      const evidence = transitions.findLast(
        (item) => item.phase === phase && (item.status === 'pass' || item.status === 'skipped'),
      )
      if (!evidence) {
        return {
          packetId,
          replayed,
          problem: `phase ${phase} has no trusted evidence in the source`,
        }
      }
      try {
        const next = await queue.projectWorkflow({
          instanceId,
          packetId,
          exit: 'handoff',
          note: `replayed from source ${evidence.uri ?? ref}`,
          actorSession: session,
        })
        replayed.push(phase)
        packetId = next.nextQitemId
        if (!packetId) return { packetId, replayed, problem: `no next step after phase ${phase}` }
      } catch (error) {
        return { packetId, replayed, problem: `replay of phase ${phase} refused: ${error.message}` }
      }
    }
    return { packetId, replayed, problem: null }
  }

  async function claimRow(qitemId, session) {
    try {
      return await queue.claim(qitemId, { session })
    } catch (error) {
      if (error?.code === 'qitem_not_claimable') return null
      throw error
    }
  }

  async function settleStrays(openIds, dryRun, report) {
    const rows = await queue.list({
      source: bridgeSession,
      states: LIVE_ROW_STATES,
      limit: STRAY_LIST_LIMIT,
    })
    if (rows.length >= STRAY_LIST_LIMIT) {
      throw new BridgeError(
        `the queue returned a full page of ${STRAY_LIST_LIMIT} rows; reconcile will not guess at the rest`,
      )
    }
    const strays = new Map()
    for (const row of rows) {
      const intake = parseIntakeBody(row.body)
      if (intake && isLiveRow(row) && !openIds.has(intake.stableId))
        strays.set(intake.stableId, intake.ref)
    }
    for (const instance of (await queue.listWorkflows({})).filter(isLiveInstance)) {
      const stableId = stableIdFromTags(instance.tags)
      if (stableId && !openIds.has(stableId) && !strays.has(stableId)) strays.set(stableId, null)
    }
    for (const [stableId, refText] of strays) {
      let workItem = null
      if (refText) {
        try {
          workItem = (await readItem(refText)).workItem
        } catch {
          workItem = null
        }
      }
      if (!workItem || workItem.lifecycle === 'open') {
        report.orphans.push({ stableId, ref: refText })
      } else if (dryRun) {
        report.settled.push({
          stableId,
          ref: workItem.ref,
          lifecycle: workItem.lifecycle,
          dryRun: true,
        })
      } else if (workItem.lifecycle === 'merged') {
        report.settled.push({
          stableId,
          ref: workItem.ref,
          lifecycle: 'merged',
          ...(await merged(workItem, stableId)),
        })
      } else {
        const result = await closed(stableId, `source closed: ${workItem.ref}`)
        report.settled.push({
          stableId,
          ref: workItem.ref,
          lifecycle: workItem.lifecycle,
          ...result,
        })
      }
    }
  }

  return {
    async intake(refText, { event = 'ready', pushed = null } = {}) {
      const handler = EVENTS[event]
      if (!handler) {
        throw new BridgeError(`unknown intake event ${event}`, { status: 'usage', exitCode: 2 })
      }
      return handler(refText, { pushed })
    },

    // Run by the entry seat on a pending intake row (or a row parked by a refused replay). The
    // atomic queue claim of that row serializes starts: only the claimant instantiates (risk R4).
    async start(qitemId, { session } = {}) {
      if (!session)
        throw new BridgeError('start requires the entry seat session', {
          status: 'usage',
          exitCode: 2,
        })
      const row = await queue.show(qitemId)
      const intake = parseIntakeBody(row?.body)
      if (!row || !intake) throw new BridgeError(`qitem ${qitemId} is not an AgentFlow intake row`)
      const claimed = await claimRow(qitemId, session)
      if (!claimed) return { status: 'already-started', qitemId, state: row.state }
      const { parsed, reference, workItem, stableId } = await readItem(intake.ref)
      const base = withTrust({ ref: workItem.ref, stableId, qitemId })
      const ready = readiness(workItem)
      if (ready.status === 'not-ready') {
        await queue.update(qitemId, {
          state: 'done',
          closureReason: 'canceled',
          resolution: `not ready: ${ready.reasons.join('; ')}`,
        })
        return { ...base, status: 'canceled', reasons: ready.reasons }
      }
      const existing = (await instancesFor(stableId)).find(isLiveInstance)
      if (existing) {
        await queue.update(qitemId, {
          state: 'done',
          closureReason: 'handed_off_to',
          closureTarget: existing.frontier[0] ?? existing.instanceId,
        })
        return { ...base, status: 'already-started', instanceId: existing.instanceId }
      }
      if (sourceCapability(source, 'claim').available) {
        const owner = { kind: 'rig', rig, host: 'local' }
        const verdict = await claim({ adapter: source, reference, owner })
        if (!isCapabilityAbsent(verdict) && !verdict.won) {
          if (!verdict.holder) {
            throw new BridgeError(
              `claim for ${workItem.ref} was not recorded; is the source writer a trusted claim writer?`,
            )
          }
          await queue.update(qitemId, {
            state: 'done',
            closureReason: 'canceled',
            resolution: `claimed by ${JSON.stringify(verdict.holder)}`,
          })
          return { ...base, status: 'yielded', holder: verdict.holder }
        }
      }
      // Re-derive the resume phase: the row may predate newer evidence.
      const transitions = trusted(workItem)
      const resumePhase = resumePhaseFor(transitions, entryPhase)
      if (resumePhase === null) {
        await queue.block(qitemId, {
          on: replayGate(stableId),
          note: 'the return-cycle limit is reached; a person must decide',
        })
        await people.deliver({
          kind: 'return-limit',
          ref: workItem.ref,
          stableId,
          reason: 'return-cycle limit reached',
        })
        return { ...base, status: 'parked', reason: 'return-cycle limit reached' }
      }
      const slice = sliceIdFor(parsed)
      const worktree = worktrees?.prepare
        ? await worktrees.prepare({ slice, stableId, workItem })
        : null
      const { instanceId, entryQitemId } = await queue.instantiateWorkflow({
        specPath: config.workflowSpec,
        rig,
        slice,
        mission: workItem.partOf ?? undefined,
        tags: [itemTag(stableId)],
        entryOwner: session,
        createdBy: session,
        rootObjective: `AgentFlow delivery of ${workItem.ref}`,
      })
      const replay = await fastForward({
        instanceId,
        entryQitemId,
        transitions,
        ref: workItem.ref,
        resumePhase,
        session,
      })
      if (replay.problem) {
        const parked = await parkReplay(
          row,
          { ref: workItem.ref, stableId },
          instanceId,
          replay.problem,
        )
        return {
          ...base,
          status: 'parked',
          instanceId,
          replayed: replay.replayed,
          reason: replay.problem,
          ...parked,
        }
      }
      await queue.update(qitemId, {
        state: 'done',
        closureReason: 'handed_off_to',
        closureTarget: replay.packetId,
      })
      return {
        ...base,
        status: 'started',
        instanceId,
        packetId: replay.packetId,
        replayed: replay.replayed,
        worktree,
      }
    },

    async recordEvidence(refText, input) {
      const { reference, workItem, stableId } = await readItem(refText)
      if (!sourceCapability(source, 'mutate-comments').available) {
        throw new BridgeError(`source adapter ${source.id} cannot write comments`, {
          status: 'capability-absent',
        })
      }
      const transitions = trusted(workItem)
      const retry = findRecordedRetry(input, transitions)
      if (retry) {
        return withTrust({ ref: workItem.ref, status: 'already-recorded', uri: retry.uri ?? null })
      }
      let record
      try {
        record = buildRolePassRecord(input, {
          transitions,
          callerSession: input.session ?? null,
          stableId,
        })
      } catch (error) {
        throw new BridgeError(error.message, { status: 'refused' })
      }
      const body = formatRolePassComment(record)
      const plan = await source.previewMutation({
        operation: 'add-comment',
        parameters: { ...reference, body },
        actionBoundary: { effective: 'external-action' },
        idempotencyKey: record.idempotencyKey,
      })
      const receipt = await source.applyMutation(plan, { confirm: plan.token })
      await source.flushReceipt(receipt)
      return withTrust({
        ref: workItem.ref,
        status: 'recorded',
        idempotencyKey: record.idempotencyKey,
        seatVerified: record.seatVerified,
        uri: receipt.result?.uri ?? null,
      })
    },

    async reconcile({ dryRun = false } = {}) {
      const items = await callSourceCapability(source, 'ready-predicates', 'listWorkItems', {
        lifecycle: 'open',
      })
      if (isCapabilityAbsent(items)) {
        throw new BridgeError('reconcile requires ready-predicates', {
          status: 'capability-absent',
        })
      }
      const report = {
        restored: [],
        kept: [],
        skipped: [],
        orphans: [],
        settled: [],
        worktrees: null,
      }
      const openIds = new Set()
      for (const workItem of items) {
        const parsed = parseSourceRef(workItem.ref)
        const stableId = stableQueueId(parsed)
        openIds.add(stableId)
        const live = await liveness(stableId)
        if (live.rows.length || live.instances.length) {
          report.kept.push({
            ref: workItem.ref,
            stableId,
            qitemIds: live.rows.map((row) => row.qitemId),
            instanceIds: live.instances.map((instance) => instance.instanceId),
          })
          continue
        }
        const ready = readiness(workItem)
        if (ready.status === 'not-ready') {
          report.skipped.push({ ref: workItem.ref, stableId, reasons: ready.reasons })
          continue
        }
        const deferred = await admit(workItem, stableId)
        if (deferred) {
          report.skipped.push({
            ref: workItem.ref,
            stableId,
            reasons: [`deferred: ${deferred.reason ?? 'admission'}`],
          })
          continue
        }
        const created = await createIntake({
          parsed,
          workItem,
          stableId,
          chain: live.chain,
          dryRun,
        })
        if (created.blocked) {
          report.skipped.push({ ref: workItem.ref, stableId, reasons: [created.blocked] })
          continue
        }
        report.restored.push({
          ref: workItem.ref,
          stableId,
          qitemId: created.qitemId,
          resumePhase: created.resumePhase,
        })
      }
      await settleStrays(openIds, dryRun, report)
      if (worktrees?.sweep && !dryRun) {
        report.worktrees = await worktrees.sweep({
          openSlices: items.map((item) => sliceIdFor(parseSourceRef(item.ref))),
        })
      }
      return withTrust({ status: dryRun ? 'dry-run' : 'reconciled', ...report })
    },

    async escalate(refText, { reason } = {}) {
      if (!reason)
        throw new BridgeError('escalate requires a reason', { status: 'usage', exitCode: 2 })
      const parsed = parseRef(refText)
      const stableId = stableQueueId(parsed)
      const delivered = await people.deliver({ kind: 'escalation', ref: refText, stableId, reason })
      return { ref: refText, stableId, status: 'escalated', delivery: delivered ?? null }
    },

    async status() {
      return withTrust({
        status: 'configured',
        rigs: config.rigs,
        source: source.id,
        limits: describeSourceLimits(source),
        predicate: config.ready,
        entrySeat: config.entrySeat,
        evidenceWriters,
        workflowSpec: config.workflowSpec,
        queue: await queue.available(),
        at: clock().toISOString(),
      })
    },
  }
}

export { LIVE_ROW_STATES }
