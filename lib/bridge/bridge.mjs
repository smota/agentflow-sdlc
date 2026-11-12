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
// Several delivery rigs (#586): intake offers an item to every delivery rig the partition names
// (one offer row per rig, `offerQueueId`), and the rig whose entry seat claims the item in the
// source first works it; the others yield. Rigs coordinate only through the source. Each rig may
// have its own queue port (`queues[rig]`, default `queue`); delivery-side commands (`start`,
// `evidence`) use only their own rig's port, never the control rig's.
//
// Extension points, all optional injected ports:
//   admission({ workItem, stableId, rig, openItems }) → { admit: true } | { admit: false, reason, … }
//                                             backpressure (#586, backpressure.mjs); default admits
//   claim({ adapter, reference, owner })    → { won, holder } | capability-absent result
//                                             source claim before work (#586); default claimOrYield
//   gateEntries(reference) → [{ writer, body, uri }]  source log entries for roster gate decisions;
//                                             default source.readLogEntries when the adapter has it
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
import { callerSeat } from '../core/seat-claim.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { botWritersFromBridge, formatGateId, gateDecisionState } from '../roster/authority.mjs'
import { deliveryRigProblems, entryPhaseFor } from './config.mjs'
import { buildRolePassRecord, findRecordedRetry, trustedTransitions } from './evidence.mjs'
import { gateResolutionRefusal } from './gate-guard.mjs'
import { formatIntakeBody, parseIntakeBody } from './intake-body.mjs'
import { partitionTargets } from './partition.mjs'
import {
  LIVE_ROW_STATES,
  generationId,
  isLiveInstance,
  isLiveRow,
  itemTag,
  mergeGate,
  offerQueueId,
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
// The roster tier of an item's review gate, from its change class.
const ROSTER_TIERS = ['bounded', 'standard', 'high-assurance']

// Asks a person through the queue port of `rig` (the control rig for intake-side calls, the
// delivery rig itself for delivery-side calls, so a delivery rig never needs the control rig).
function defaultNotifier(queue, config, rig) {
  return {
    async deliver({ kind, ref, stableId, reason, evidenceRef }) {
      const destination = config.escalateTo ?? `human@${rig}`
      // One row per item, kind and reason: a repeated escalation is a re-delivery, not a new ask.
      const digest = createHash('sha256')
        .update(String(reason ?? ''))
        .digest('hex')
        .slice(0, 8)
      return queue.create({
        id: `${stableId}-${kind}-${digest}`,
        destination,
        source: `agentflow-bridge@${rig}`,
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

// The digest of the evidence a review gate asks about (16 hex): the trusted transitions, in source
// order, up to and including the latest phase 6 pass.
export function reviewEvidenceDigest(transitions) {
  const subject = transitions.map((item) => [
    item.phase,
    item.status,
    item.idempotencyKey ?? null,
    item.uri ?? null,
  ])
  return createHash('sha256').update(JSON.stringify(subject)).digest('hex').slice(0, 16)
}

export function createBridge({
  source,
  queue = null,
  queues = null,
  config,
  clock = () => new Date(),
  admission = openAdmission,
  claim = (input) => claimOrYield(input),
  worktrees = null,
  notifier = null,
  roster = null,
  botWriters = null,
  gateEntries = null,
  seatTable = null,
}) {
  if (!source || !(queue || queues) || !config)
    throw new Error('createBridge requires source, queue (or queues) and config')
  const limitProblems = deliveryRigProblems(config, source)
  if (limitProblems.length) {
    throw new BridgeError(limitProblems.join('; '), {
      status: 'invalid-config',
      detail: describeSourceLimits(source),
    })
  }
  const deliveryRigs = config.rigs.delivery
  const controlRig = config.rigs.control
  const multi = deliveryRigs.length > 1
  const entryPhase = entryPhaseFor(config.entrySeat)
  const bridgeSession = `agentflow-bridge@${controlRig}`
  const evidenceWriters = config.evidenceWriters ?? []
  const evidenceTrust = evidenceWriters.length ? null : 'no-evidence-writers-configured'
  const gateBots = botWriters ?? botWritersFromBridge(config)
  const trusted = (workItem) => trustedTransitions(workItem.transitions, evidenceWriters)
  const withTrust = (result) => (evidenceTrust ? { ...result, evidenceTrust } : result)

  function queueFor(rig) {
    const port = queues?.[rig] ?? queue
    if (!port) throw new BridgeError(`no queue port for rig ${rig}`)
    return port
  }
  const controlQueue = () => queueFor(controlRig)
  // Each distinct port once, in delivery-rig order (rigs on one daemon share a port).
  function deliveryPorts() {
    return [...new Set(deliveryRigs.map(queueFor))]
  }
  function peopleFor(port, rig) {
    return notifier ?? defaultNotifier(port, config, rig)
  }
  // The offer row id of an item on a rig. One rig keeps the plain stable id (#582).
  const offerBase = (stableId, rig) => (multi ? offerQueueId(stableId, rig) : stableId)

  function refuseWorkerSession(session) {
    const refusal = gateResolutionRefusal({ session, rigs: config.rigs, seatTable })
    if (refusal) throw new BridgeError(refusal, { status: 'refused' })
  }

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

  // A chain on one port: the base id, then -g2, -g3 … until an id is unused.
  async function intakeChain(port, base) {
    const rows = []
    for (let n = 1; n < MAX_GENERATIONS; n += 1) {
      const id = n === 1 ? base : generationId(base, n)
      const row = await port.show(id)
      if (!row) return { rows, nextId: id }
      rows.push(row)
    }
    throw new BridgeError(`no free generation id for ${base}`)
  }

  // Every chain the item may have: on each delivery rig's port, its offer chain and the plain
  // stable-id chain (rows queued while the project had one rig stay visible after adding rigs).
  async function chainsFor(stableId) {
    const chains = []
    const seen = new Map()
    for (const rig of deliveryRigs) {
      const port = queueFor(rig)
      if (!seen.has(port)) seen.set(port, new Set())
      for (const base of new Set([offerBase(stableId, rig), stableId])) {
        if (seen.get(port).has(base)) continue
        seen.get(port).add(base)
        chains.push({ rig, port, base, ...(await intakeChain(port, base)) })
      }
    }
    return chains
  }

  async function instancesFor(stableId, ports = deliveryPorts()) {
    const found = []
    const ids = new Set()
    for (const port of ports) {
      for (const instance of await port.listWorkflows({ tag: itemTag(stableId) })) {
        if (ids.has(instance.instanceId)) continue
        ids.add(instance.instanceId)
        found.push({ instance, port })
      }
    }
    return found
  }

  async function liveness(stableId) {
    const chains = await chainsFor(stableId)
    const instances = (await instancesFor(stableId)).filter((item) => isLiveInstance(item.instance))
    const rows = chains.flatMap((chain) =>
      chain.rows.filter(isLiveRow).map((row) => ({ row, port: chain.port, rig: chain.rig })),
    )
    return { chains, rows, instances }
  }

  async function createOffer({ rig, stableId, workItem, body, tier, slice, dryRun }) {
    const port = queueFor(rig)
    const base = offerBase(stableId, rig)
    const chain = await intakeChain(port, base)
    if (dryRun) return { rig, qitemId: chain.nextId, created: false, dryRun: true }
    let id = chain.nextId
    for (let attempt = 0; attempt < MAX_GENERATIONS; attempt += 1) {
      const created = await port.create({
        id,
        destination: sessionForSeat(config.entrySeat, rig),
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
      if (created.created || LIVE_ROW_STATES.includes(created.state)) return { rig, ...created }
      const n = id === base ? 1 : Number(id.slice(base.length + 2))
      id = generationId(base, n + 1)
    }
    throw new BridgeError(`no free generation id for ${stableId}`)
  }

  // One offer row per delivery rig the partition names; the source claim decides among them.
  async function createOffers({ parsed, workItem, stableId, dryRun = false }) {
    const resumePhase = resumePhaseFor(trusted(workItem), entryPhase)
    if (resumePhase === null) {
      return { blocked: 'the return-cycle limit is reached; a person must decide' }
    }
    const slice = sliceIdFor(parsed)
    const tier = tierForChangeClass(workItem.changeClass)
    const body = formatIntakeBody({
      ref: workItem.ref,
      stableId,
      slice,
      resumePhase,
      tier,
      workflow: config.workflowSpec,
    })
    const targets = partitionTargets({ workItem, partition: config.partition, deliveryRigs })
    const offers = []
    for (const rig of targets) {
      offers.push(await createOffer({ rig, stableId, workItem, body, tier, slice, dryRun }))
    }
    return {
      offers,
      resumePhase,
      qitemId: offers[0]?.qitemId ?? null,
      created: offers.some((offer) => offer.created),
      dryRun,
      warning: offers.find((offer) => offer.warning)?.warning ?? null,
    }
  }

  const offerSummary = (offers) =>
    multi ? { offers: offers.map(({ rig, qitemId, created }) => ({ rig, qitemId, created })) } : {}

  async function admit(workItem, stableId, openItems = null) {
    const verdict = await admission({ workItem, stableId, rig: controlRig, openItems })
    if (verdict?.admit !== false) return null
    const { admit: _admit, open: _open, ...rest } = verdict
    return { reason: null, ...rest }
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
        qitemId: live.rows[0]?.row.qitemId ?? null,
        instanceId: live.instances[0]?.instance.instanceId ?? null,
      }
    }
    const deferred = await admit(workItem, stableId)
    if (deferred) return { ...base, status: 'deferred', ...deferred }
    const created = await createOffers({ parsed, workItem, stableId })
    if (created.blocked) return { ...base, status: 'not-ready', reasons: [created.blocked] }
    return {
      ...base,
      status: created.created ? 'queued' : 'already-queued',
      qitemId: created.qitemId,
      resumePhase: created.resumePhase,
      ...offerSummary(created.offers),
      ...(created.warning ? { warning: created.warning } : {}),
    }
  }

  // The item's rows that can wait on a gate: its intake chains and its instances' frontier
  // packets, each with the port it lives on.
  async function itemRows(stableId) {
    const { chains, instances } = await liveness(stableId)
    const packets = []
    for (const { instance, port } of instances) {
      for (const id of instance.frontier ?? []) {
        const row = await port.show(id)
        if (row) packets.push({ row, port })
      }
    }
    const chainRows = chains.flatMap((chain) =>
      chain.rows.map((row) => ({ row, port: chain.port })),
    )
    return { chainRows, packets, instances }
  }

  async function resolveGate(stableId, gate, decision) {
    const { chainRows, packets } = await itemRows(stableId)
    const waiting = [...chainRows, ...packets].filter(
      ({ row }) => row.state === 'blocked' && row.blockedOn === gate,
    )
    for (const { row, port } of waiting) await port.resolve(row.qitemId, { decision })
    return waiting.map(({ row }) => row.qitemId)
  }

  // With a team roster, the review gate opens only on an in-scope person's decision recorded in
  // the source (#585 gateDecisionState); a decision in chat or on a queue row counts for nothing.
  // The gate id binds the evidence under review: `<ref>:review:<digest>`, the digest taken over
  // the trusted transitions up to the latest phase 6 pass. A new build and review round has a new
  // digest, so an agreement from an earlier round is stale.
  async function rosterReviewDecision(reference, workItem, reviewed) {
    if (!roster) return { satisfied: true, uri: null, gate: null }
    const read =
      gateEntries ??
      (typeof source.readLogEntries === 'function' ? (ref) => source.readLogEntries(ref) : null)
    const digest = reviewEvidenceDigest(reviewed)
    const gate = {
      id: formatGateId({ ref: workItem.ref, name: 'review', digest }),
      type: 'acceptance-review',
      tier: ROSTER_TIERS.includes(workItem.changeClass) ? workItem.changeClass : 'standard',
      digest,
    }
    if (!read) {
      return {
        satisfied: false,
        gate: { gateId: gate.id, reason: 'source-log-unavailable' },
        reason: `source adapter ${source.id} cannot list its log entries, so no roster decision can be read`,
      }
    }
    const state = await gateDecisionState({
      entries: await read(reference),
      gate,
      roster,
      adapter: source,
      botWriters: gateBots,
    })
    // Role-pass and other comments are not decisions; only refused decisions are worth reporting.
    const ignored = (state.ignored ?? []).filter((item) => item.reason !== 'not-a-decision')
    const summary = {
      gateId: state.gateId,
      satisfied: state.satisfied,
      ...(state.approvedBy ? { approvedBy: state.approvedBy } : {}),
      ...(state.highAssurance ? { highAssurance: state.highAssurance } : {}),
      ...(ignored.length ? { ignored } : {}),
    }
    if (!state.satisfied) {
      return {
        satisfied: false,
        gate: summary,
        reason: `no in-scope roster decision opens ${gate.id}`,
      }
    }
    const agreed = (state.decisions ?? []).filter((item) => item.decision === 'agree').at(-1)
    return { satisfied: true, uri: agreed?.uri ?? null, gate: summary }
  }

  async function reviewDone(refText) {
    const { reference, workItem, stableId } = await readItem(refText)
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
    const person = await rosterReviewDecision(reference, workItem, transitions.slice(0, review + 1))
    const gateField = person.gate ? { gate: person.gate } : {}
    if (!person.satisfied) {
      return { ...base, status: 'not-ready', reasons: [person.reason], ...gateField }
    }
    const decision = person.uri ?? transitions[review].uri ?? `phase ${REVIEW_PHASE} pass`
    const resolved = await resolveGate(stableId, reviewGate(stableId), decision)
    return {
      ...base,
      status: resolved.length ? 'resolved' : 'no-waiting-row',
      resolved,
      decision,
      ...gateField,
    }
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
    for (const { instance, port } of instances) {
      await port.abortWorkflow(instance.instanceId, { reason })
      aborted.push(instance.instanceId)
    }
    const canceled = []
    for (const { row, port } of chainRows.filter((item) => isLiveRow(item.row))) {
      await port.update(row.qitemId, {
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
  async function parkReplay({ port, rig }, row, intake, instanceId, reason) {
    const gate = replayGate(intake.stableId)
    await port.abortWorkflow(instanceId, { reason: `replay refused: ${reason}` })
    await port.block(row.qitemId, {
      on: gate,
      continuation: `fix the cause, then run agentflow-sdlc bridge start ${row.qitemId} again`,
      note: reason,
    })
    const notified = await peopleFor(port, rig).deliver({
      kind: 'reconcile-replay',
      ref: intake.ref,
      stableId: intake.stableId,
      reason,
    })
    return { gate, aborted: instanceId, notified: notified ?? null }
  }

  // Replays already-evidenced phases so a rebuilt item resumes where the source says it is.
  async function fastForward(
    port,
    { instanceId, entryQitemId, transitions, ref, resumePhase, session },
  ) {
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
        const next = await port.projectWorkflow({
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

  async function claimRow(port, qitemId, session) {
    try {
      return await port.claim(qitemId, { session })
    } catch (error) {
      if (error?.code === 'qitem_not_claimable') return null
      throw error
    }
  }

  // The delivery rig a start runs on: the session's rig. With one delivery rig any session runs
  // on it (#582 behaviour); with several, the session must be on one of them.
  function startRig(session) {
    const caller = callerSeat(session)
    if (caller && deliveryRigs.includes(caller.rig)) return caller.rig
    if (!multi) return deliveryRigs[0]
    throw new BridgeError(
      `start runs on a delivery rig (${deliveryRigs.join(', ')}); session ${session} is not on one`,
      { status: 'refused' },
    )
  }

  const holderName = (holder) =>
    holder?.kind === 'rig' && holder.rig ? holder.rig : JSON.stringify(holder)

  async function settleStrays(openIds, dryRun, report) {
    const strays = new Map()
    for (const port of deliveryPorts()) {
      const rows = await port.list({
        source: bridgeSession,
        states: LIVE_ROW_STATES,
        limit: STRAY_LIST_LIMIT,
      })
      if (rows.length >= STRAY_LIST_LIMIT) {
        throw new BridgeError(
          `the queue returned a full page of ${STRAY_LIST_LIMIT} rows; reconcile will not guess at the rest`,
        )
      }
      for (const row of rows) {
        const intake = parseIntakeBody(row.body)
        if (intake && isLiveRow(row) && !openIds.has(intake.stableId))
          strays.set(intake.stableId, intake.ref)
      }
      for (const instance of (await port.listWorkflows({})).filter(isLiveInstance)) {
        const stableId = stableIdFromTags(instance.tags)
        if (stableId && !openIds.has(stableId) && !strays.has(stableId)) strays.set(stableId, null)
      }
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
    // `session` is the caller's OpenRig session (OPENRIG_SESSION_NAME). Events that resolve or
    // abort gated work refuse a worker's session (decision 9).
    async intake(refText, { event = 'ready', pushed = null, session = null } = {}) {
      const handler = EVENTS[event]
      if (!handler) {
        throw new BridgeError(`unknown intake event ${event}`, { status: 'usage', exitCode: 2 })
      }
      if (event !== 'ready') refuseWorkerSession(session)
      return handler(refText, { pushed })
    },

    // Run by the entry seat of a delivery rig on a pending offer row (or a row parked by a refused
    // replay). The atomic queue claim of that row serializes starts on the rig (risk R4); the
    // source claim decides between rigs (#586). Uses only this rig's queue port.
    async start(qitemId, { session } = {}) {
      if (!session)
        throw new BridgeError('start requires the entry seat session', {
          status: 'usage',
          exitCode: 2,
        })
      const rig = startRig(session)
      const port = queueFor(rig)
      const row = await port.show(qitemId)
      const intake = parseIntakeBody(row?.body)
      if (!row || !intake) throw new BridgeError(`qitem ${qitemId} is not an AgentFlow intake row`)
      const claimed = await claimRow(port, qitemId, session)
      if (!claimed) return { status: 'already-started', qitemId, state: row.state }
      const { parsed, reference, workItem, stableId } = await readItem(intake.ref)
      const base = withTrust({ ref: workItem.ref, stableId, qitemId, ...(multi ? { rig } : {}) })
      const ready = readiness(workItem)
      if (ready.status === 'not-ready') {
        await port.update(qitemId, {
          state: 'done',
          closureReason: 'canceled',
          resolution: `not ready: ${ready.reasons.join('; ')}`,
        })
        return { ...base, status: 'canceled', reasons: ready.reasons }
      }
      const existing = (await instancesFor(stableId, [port]))
        .map((item) => item.instance)
        .find(isLiveInstance)
      if (existing) {
        await port.update(qitemId, {
          state: 'done',
          closureReason: 'handed_off_to',
          closureTarget: existing.frontier[0] ?? existing.instanceId,
        })
        return { ...base, status: 'already-started', instanceId: existing.instanceId }
      }
      // Claim before work: the earliest trusted claim in the source wins; a losing rig closes its
      // offer and creates nothing (no worktree, no instance).
      if (sourceCapability(source, 'claim').available) {
        const owner = { kind: 'rig', rig, host: 'local' }
        const verdict = await claim({ adapter: source, reference, owner })
        if (!isCapabilityAbsent(verdict) && !verdict.won) {
          if (!verdict.holder) {
            throw new BridgeError(
              `claim for ${workItem.ref} was not recorded; is the source writer a trusted claim writer?`,
            )
          }
          await port.update(qitemId, {
            state: 'done',
            closureReason: 'canceled',
            resolution: `claimed by ${holderName(verdict.holder)}`,
          })
          return { ...base, status: 'yielded', holder: verdict.holder }
        }
      }
      // Re-derive the resume phase: the row may predate newer evidence.
      const transitions = trusted(workItem)
      const resumePhase = resumePhaseFor(transitions, entryPhase)
      if (resumePhase === null) {
        await port.block(qitemId, {
          on: replayGate(stableId),
          note: 'the return-cycle limit is reached; a person must decide',
        })
        await peopleFor(port, rig).deliver({
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
      const { instanceId, entryQitemId } = await port.instantiateWorkflow({
        specPath: config.workflowSpec,
        rig,
        slice,
        mission: workItem.partOf ?? undefined,
        tags: [itemTag(stableId)],
        entryOwner: session,
        createdBy: session,
        rootObjective: `AgentFlow delivery of ${workItem.ref}`,
      })
      const replay = await fastForward(port, {
        instanceId,
        entryQitemId,
        transitions,
        ref: workItem.ref,
        resumePhase,
        session,
      })
      if (replay.problem) {
        const parked = await parkReplay(
          { port, rig },
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
      await port.update(qitemId, {
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

    // Writes to the source only; no queue port is touched.
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

    async reconcile({ dryRun = false, session = null } = {}) {
      // Reconcile settles merge gates and aborts closed work: not a worker's call (decision 9).
      refuseWorkerSession(session)
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
        deferred: [],
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
            qitemIds: live.rows.map(({ row }) => row.qitemId),
            instanceIds: live.instances.map(({ instance }) => instance.instanceId),
          })
          continue
        }
        const ready = readiness(workItem)
        if (ready.status === 'not-ready') {
          report.skipped.push({ ref: workItem.ref, stableId, reasons: ready.reasons })
          continue
        }
        const deferred = await admit(workItem, stableId, items)
        if (deferred) {
          report.deferred.push({ ref: workItem.ref, stableId, status: 'deferred', ...deferred })
          continue
        }
        const created = await createOffers({ parsed, workItem, stableId, dryRun })
        if (created.blocked) {
          report.skipped.push({ ref: workItem.ref, stableId, reasons: [created.blocked] })
          continue
        }
        report.restored.push({
          ref: workItem.ref,
          stableId,
          qitemId: created.qitemId,
          resumePhase: created.resumePhase,
          ...offerSummary(created.offers),
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
      const delivered = await peopleFor(controlQueue(), controlRig).deliver({
        kind: 'escalation',
        ref: refText,
        stableId,
        reason,
      })
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
        partition: config.partition ?? null,
        roster: roster ? 'team-roster' : 'single-person',
        queue: await controlQueue().available(),
        at: clock().toISOString(),
      })
    },
  }
}

export { LIVE_ROW_STATES }
