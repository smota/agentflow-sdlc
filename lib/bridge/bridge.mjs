// The rig bridge (#582): moves ready source work into the OpenRig queue and returns evidence to
// the source. It is source-agnostic: it talks to a SourceAdapter (#580) and a QueuePort only.
//
// Invariants (SDD §1): the source is the truth and every operation re-reads it; queue rows carry a
// reference and derived ids, never artifact content; no polling loop, one pass per call.
//
// Extension points, all optional injected ports:
//   admission({ workItem, stableId, rig })  → { admit: true } | { admit: false, reason }
//                                             backpressure (#586); default admits everything
//   claim({ adapter, reference, owner })    → { won, holder } | capability-absent result
//                                             claim-before-work (#586); default claimOrYield
//   worktrees.prepare({ slice, stableId, workItem }) → { path }   on start (#584b)
//   worktrees.cleanup({ slice, stableId, workItem }) → result     on merged (#584b)
//   worktrees.sweep({ openSlices })                  → result     on reconcile (#584b)
//   notifier.deliver({ kind, ref, stableId, reason, evidenceRef }) → result  (#585/#586)
import { createHash } from 'node:crypto'
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
import { buildRolePassRecord, findRecordedRetry } from './evidence.mjs'
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
      const id = `${stableId}-${kind}-${digest}`
      return queue.create({
        id,
        destination,
        source: `agentflow-bridge@${config.rigs.control}`,
        summary: `AgentFlow needs a person for ${ref}: ${kind}`,
        body: `agentflow-escalation/v1\nref=${ref}\nstable_id=${stableId}\nkind=${kind}\nreason=${String(reason ?? '').replace(/\s+/g, ' ')}\n`,
        tags: [itemTag(stableId)],
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

// The phase a rebuilt item resumes at: one after the latest passed phase, else the entry phase.
export function resumePhaseFor(transitions, entryPhase) {
  const latest = transitions.filter((item) => item.status === 'pass').at(-1)
  if (!latest) return entryPhase
  return Math.min(Math.max(latest.phase + 1, entryPhase), LAST_PHASE)
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
  const people = notifier ?? defaultNotifier(queue, config)

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

  async function snapshot() {
    const [rows, instances] = await Promise.all([queue.list({}), queue.listWorkflows({})])
    return { rows, instances }
  }

  function liveFor(stableId, { rows, instances }) {
    const tag = itemTag(stableId)
    return {
      rows: rows.filter((row) => row.tags.includes(tag) && isLiveRow(row)),
      instances: instances.filter((item) => item.tags.includes(tag) && isLiveInstance(item)),
    }
  }

  function nextIntakeId(stableId, rows) {
    const used = new Set(rows.map((row) => row.qitemId))
    if (!used.has(stableId)) return stableId
    for (let n = 2; n < MAX_GENERATIONS; n += 1) {
      const id = generationId(stableId, n)
      if (!used.has(id)) return id
    }
    throw new BridgeError(`no free generation id for ${stableId}`)
  }

  async function createIntake({ refText, parsed, workItem, stableId, rows, dryRun = false }) {
    const id = nextIntakeId(stableId, rows)
    const resumePhase = resumePhaseFor(workItem.transitions ?? [], entryPhase)
    const slice = sliceIdFor(parsed)
    const tier = tierForChangeClass(workItem.changeClass)
    if (dryRun) return { qitemId: id, created: false, dryRun: true, resumePhase }
    const body = formatIntakeBody({
      ref: refText,
      stableId,
      slice,
      resumePhase,
      tier,
      workflow: config.workflowSpec,
    })
    const created = await queue.create({
      id,
      destination: intakeDestination,
      source: bridgeSession,
      summary: `AgentFlow intake ${refText}`,
      body,
      tags: [itemTag(stableId)],
      tier,
      priority: 'routine',
      mission: workItem.partOf ?? undefined,
      slice,
    })
    return { ...created, resumePhase }
  }

  async function admit(workItem, stableId) {
    const verdict = await admission({ workItem, stableId, rig })
    return verdict?.admit === false ? verdict : null
  }

  async function intakeReady(refText, pushed) {
    const { parsed, workItem, stableId } = await readItem(refText)
    const ignored = pushedContentIgnored(pushed, workItem)
    const base = { ref: workItem.ref, stableId, pushedContentIgnored: ignored }
    const ready = readiness(workItem)
    if (ready.status === 'not-ready')
      return { ...base, status: 'not-ready', reasons: ready.reasons }
    const state = await snapshot()
    const live = liveFor(stableId, state)
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
    const created = await createIntake({
      refText: workItem.ref,
      parsed,
      workItem,
      stableId,
      ...state,
    })
    return {
      ...base,
      status: created.created ? 'queued' : 'already-queued',
      qitemId: created.qitemId,
      resumePhase: created.resumePhase,
    }
  }

  async function resolveGate(stableId, gate, decision) {
    const rows = await queue.list({ tag: itemTag(stableId), states: ['blocked'] })
    const waiting = rows.filter((row) => row.state === 'blocked' && row.blockedOn === gate)
    for (const row of waiting) await queue.resolve(row.qitemId, { decision })
    return waiting.map((row) => row.qitemId)
  }

  async function reviewDone(refText) {
    const { workItem, stableId } = await readItem(refText)
    const transitions = workItem.transitions ?? []
    const lastIndex = (phase) =>
      transitions.findLastIndex((item) => item.phase === phase && item.status === 'pass')
    const review = lastIndex(REVIEW_PHASE)
    const base = { ref: workItem.ref, stableId }
    if (review === -1 || review < lastIndex(BUILD_PHASE)) {
      return {
        ...base,
        status: 'not-ready',
        reasons: [
          `no phase ${REVIEW_PHASE} pass recorded after the latest phase ${BUILD_PHASE} pass`,
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
    const state = await snapshot()
    const live = liveFor(stableId, state)
    const aborted = []
    for (const instance of live.instances) {
      await queue.abortWorkflow(instance.instanceId, { reason })
      aborted.push(instance.instanceId)
    }
    const canceled = []
    const frontier = new Set(live.instances.flatMap((instance) => instance.frontier))
    for (const row of live.rows.filter((item) => !frontier.has(item.qitemId))) {
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

  // Parks the intake row and tells a person, when a rebuilt item cannot be replayed (risk R5).
  async function parkReplay(row, intake, reason) {
    const gate = replayGate(intake.stableId)
    await queue.block(row.qitemId, {
      on: gate,
      continuation: `replay ${intake.ref} to phase ${intake.resumePhase} by hand, then resolve ${gate}`,
      note: reason,
    })
    const notified = await people.deliver({
      kind: 'reconcile-replay',
      ref: intake.ref,
      stableId: intake.stableId,
      reason,
    })
    return { gate, notified: notified ?? null }
  }

  // Replays already-evidenced phases so a rebuilt item resumes where the source says it is.
  async function fastForward({ instanceId, entryQitemId, workItem, resumePhase, session }) {
    let packetId = entryQitemId
    const replayed = []
    for (let phase = entryPhase; phase < resumePhase; phase += 1) {
      const evidence = (workItem.transitions ?? []).findLast(
        (item) => item.phase === phase && (item.status === 'pass' || item.status === 'skipped'),
      )
      if (!evidence) {
        return { packetId, replayed, problem: `phase ${phase} has no pass evidence in the source` }
      }
      try {
        const next = await queue.projectWorkflow({
          instanceId,
          packetId,
          exit: 'handoff',
          note: `replayed from source ${evidence.uri ?? workItem.ref}`,
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

  return {
    async intake(refText, { event = 'ready', pushed = null } = {}) {
      const handler = EVENTS[event]
      if (!handler) {
        throw new BridgeError(`unknown intake event ${event}`, { status: 'usage', exitCode: 2 })
      }
      return handler(refText, { pushed })
    },

    async start(qitemId, { session } = {}) {
      if (!session)
        throw new BridgeError('start requires the entry seat session', {
          status: 'usage',
          exitCode: 2,
        })
      const row = await queue.show(qitemId)
      const intake = parseIntakeBody(row?.body)
      if (!row || !intake) throw new BridgeError(`qitem ${qitemId} is not an AgentFlow intake row`)
      if (!isLiveRow(row)) return { status: 'already-started', qitemId, state: row.state }
      const { parsed, reference, workItem, stableId } = await readItem(intake.ref)
      const base = { ref: workItem.ref, stableId, qitemId }
      const ready = readiness(workItem)
      if (ready.status === 'not-ready') {
        await queue.update(qitemId, {
          state: 'done',
          closureReason: 'canceled',
          resolution: `not ready: ${ready.reasons.join('; ')}`,
        })
        return { ...base, status: 'canceled', reasons: ready.reasons }
      }
      // Risk R4: `workflow instantiate` is not idempotent, so look before creating.
      const existing = (await queue.listWorkflows({ tag: itemTag(stableId) })).find(isLiveInstance)
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
      const slice = sliceIdFor(parsed)
      const worktree = worktrees?.prepare
        ? await worktrees.prepare({ slice, stableId, workItem })
        : null
      const resumePhase = Number.isInteger(intake.resumePhase) ? intake.resumePhase : entryPhase
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
      const replay = await fastForward({ instanceId, entryQitemId, workItem, resumePhase, session })
      if (replay.problem) {
        const parked = await parkReplay(
          row,
          { ...intake, ref: workItem.ref, stableId, resumePhase },
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
      const transitions = workItem.transitions ?? []
      const retry = findRecordedRetry(input, transitions)
      if (retry) return { ref: workItem.ref, status: 'already-recorded', uri: retry.uri ?? null }
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
      return {
        ref: workItem.ref,
        status: 'recorded',
        idempotencyKey: record.idempotencyKey,
        seatVerified: record.seatVerified,
        uri: receipt.result?.uri ?? null,
      }
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
      const state = await snapshot()
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
        const live = liveFor(stableId, state)
        if (live.rows.length || live.instances.length) {
          report.kept.push({
            ref: workItem.ref,
            stableId,
            qitemIds: live.rows.map((row) => row.qitemId),
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
          refText: workItem.ref,
          parsed,
          workItem,
          stableId,
          rows: state.rows,
          dryRun,
        })
        state.rows.push({ qitemId: created.qitemId, state: 'pending', tags: [itemTag(stableId)] })
        report.restored.push({
          ref: workItem.ref,
          stableId,
          qitemId: created.qitemId,
          resumePhase: created.resumePhase,
        })
      }
      // Live rows whose item is no longer open: settle merged and closed items, report the rest.
      const strays = new Map()
      for (const row of state.rows.filter(isLiveRow)) {
        const stableId = stableIdFromTags(row.tags)
        if (stableId && !openIds.has(stableId)) strays.set(stableId, true)
      }
      for (const instance of state.instances.filter(isLiveInstance)) {
        const stableId = stableIdFromTags(instance.tags)
        if (stableId && !openIds.has(stableId)) strays.set(stableId, true)
      }
      for (const stableId of strays.keys()) {
        const refText = state.rows
          .filter((row) => row.tags.includes(itemTag(stableId)))
          .map((row) => parseIntakeBody(row.body)?.ref)
          .find(Boolean)
        let workItem = null
        if (refText) {
          try {
            workItem = (await readItem(refText)).workItem
          } catch {
            workItem = null
          }
        }
        if (!workItem || workItem.lifecycle === 'open') {
          report.orphans.push({ stableId, ref: refText ?? null })
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
      if (worktrees?.sweep && !dryRun) {
        report.worktrees = await worktrees.sweep({
          openSlices: items.map((item) => sliceIdFor(parseSourceRef(item.ref))),
        })
      }
      return { status: dryRun ? 'dry-run' : 'reconciled', ...report }
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
      return {
        status: 'configured',
        rigs: config.rigs,
        source: source.id,
        limits: describeSourceLimits(source),
        predicate: config.ready,
        entrySeat: config.entrySeat,
        workflowSpec: config.workflowSpec,
        queue: await queue.available(),
        at: clock().toISOString(),
      }
    },
  }
}

export { LIVE_ROW_STATES }
