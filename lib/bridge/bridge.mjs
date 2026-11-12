// The rig bridge (#582): moves ready source work into the OpenRig queue and returns evidence to
// the source. It is source-agnostic: it talks to a SourceAdapter (#580) and a QueuePort only.
//
// Invariants (SDD §1): the source is the truth and every operation re-reads it; queue rows carry a
// reference and derived ids, never artifact content; no polling loop, one pass per call. Only
// role-pass evidence written by a trusted evidence writer counts for any decision.
//
// Liveness: an item's live intake rows are found by listing the bridge's own live rows (source
// `agentflow-bridge@<control rig>`, an explicit limit; a full page is an error) and reading each
// row's intake body, on every rig's port. Ids are never guessed from the current configuration,
// so removing or re-adding a delivery rig hides nothing. Live workflow instances tagged
// `af:<stable id>` count too. Escalation and notice rows are not work.
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
//   gateEntries(reference) → [{ writer, body, uri, edited|createdAt/updatedAt }]  source log entries
//                                             for roster gate decisions; default source.readLogEntries
//   candidateHead({ workItem, slice }) → sha | null   the candidate under review (PR or slice branch
//                                             head); default workItem.candidateHead
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
import { claimOrYield, ownersEqual } from '../core/source-claim.mjs'
import { formatRolePassComment } from '../core/role-pass-evidence.mjs'
import { callerSeat } from '../core/seat-claim.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { botWritersFromBridge, formatGateId, gateDecisionState } from '../roster/authority.mjs'
import { deliveryRigProblems, entryPhaseFor } from './config.mjs'
import { buildRolePassRecord, findRecordedRetry, trustedTransitions } from './evidence.mjs'
import { gateResolutionRefusal } from './gate-guard.mjs'
import {
  formatGateMarker,
  gateMarkerKey,
  gateMarkerName,
  openGateMarkers,
  stableIdFromGate,
} from './gate-markers.mjs'
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
const defaultCandidateHead = async ({ workItem }) =>
  typeof workItem?.candidateHead === 'string' && workItem.candidateHead
    ? workItem.candidateHead
    : null
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

// The digest of what a review gate asks about (16 hex): the candidate head (the PR or slice
// branch head) and the trusted transitions, in source order, up to and including the latest
// phase 6 pass. A commit pushed after an agreement, or a new build and review round, changes it.
export function reviewEvidenceDigest(transitions, candidateHead) {
  if (typeof candidateHead !== 'string' || !candidateHead)
    throw new Error('reviewEvidenceDigest requires the candidate head')
  const subject = transitions.map((item) => [
    item.phase,
    item.status,
    item.idempotencyKey ?? null,
    item.uri ?? null,
  ])
  return createHash('sha256')
    .update(JSON.stringify({ head: candidateHead, subject }))
    .digest('hex')
    .slice(0, 16)
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
  candidateHead = defaultCandidateHead,
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
  const canClaim = () => sourceCapability(source, 'claim').available
  const canWriteMarkers = () => sourceCapability(source, 'mutate-comments').available

  function queueFor(rig) {
    const port = queues?.[rig] ?? queue
    if (!port) throw new BridgeError(`no queue port for rig ${rig}`)
    return port
  }
  const controlQueue = () => queueFor(controlRig)
  // Each distinct port once: every delivery rig's, then the control rig's (rigs on one daemon
  // share a port).
  function allPorts() {
    return [...new Set([...deliveryRigs, controlRig].map(queueFor))]
  }
  function deliveryPorts() {
    return [...new Set(deliveryRigs.map(queueFor))]
  }
  function peopleFor(port, rig) {
    return notifier ?? defaultNotifier(port, config, rig)
  }
  // The offer row id of an item on a rig. One rig keeps the plain stable id (#582). Only used to
  // name a new row; existing rows are found by listing.
  const offerBase = (stableId, rig) => (multi ? offerQueueId(stableId, rig) : stableId)

  // Gate-resolving calls (review-done, merged, closed, reconcile, release) must name their caller,
  // and no worker session may make them (decision 9). Sessions are self-asserted; the roster's
  // source decision is the control that does not rely on them.
  function refuseWorkerSession(session) {
    if (typeof session !== 'string' || !session.trim()) {
      throw new BridgeError(
        'name the caller with --session <name> (OPENRIG_SESSION_NAME); gate rows are resolved only by a named caller outside the delivery rigs',
        { status: 'refused' },
      )
    }
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

  const referenceFor = (refText) => source.toReference(parseRef(refText))

  async function listOpenItems() {
    const items = await callSourceCapability(source, 'ready-predicates', 'listWorkItems', {
      lifecycle: 'open',
    })
    return isCapabilityAbsent(items) ? null : items
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

  // A chain on one port: the base id, then -g2, -g3 … until an id is unused. Names new rows only.
  async function intakeChain(port, base) {
    for (let n = 1; n < MAX_GENERATIONS; n += 1) {
      const id = n === 1 ? base : generationId(base, n)
      if (!(await port.show(id))) return { nextId: id }
    }
    throw new BridgeError(`no free generation id for ${base}`)
  }

  async function bridgeRows(port, states) {
    const rows = await port.list({ source: bridgeSession, states, limit: STRAY_LIST_LIMIT })
    if (rows.length >= STRAY_LIST_LIMIT) {
      throw new BridgeError(
        `the queue returned a full page of ${STRAY_LIST_LIMIT} rows; the bridge will not guess at the rest`,
      )
    }
    return rows
  }

  // Every live intake row the bridge created, on every port, by stable id.
  async function liveIndex() {
    const index = new Map()
    for (const port of allPorts()) {
      for (const row of await bridgeRows(port, LIVE_ROW_STATES)) {
        const intake = parseIntakeBody(row.body)
        if (!intake || !isLiveRow(row)) continue
        if (!index.has(intake.stableId)) index.set(intake.stableId, [])
        index.get(intake.stableId).push({ row, port, intake })
      }
    }
    return index
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

  async function liveness(stableId, index = null) {
    const rows = (index ?? (await liveIndex())).get(stableId) ?? []
    const instances = (await instancesFor(stableId)).filter((item) => isLiveInstance(item.instance))
    return { rows, instances }
  }

  // ---- open-gate markers (backpressure counts them from the source) ----

  async function writeMarker(reference, state, name) {
    if (!canWriteMarkers()) return false
    const plan = await source.previewMutation({
      operation: 'add-comment',
      parameters: { ...reference, body: formatGateMarker(state, name) },
      actionBoundary: { effective: 'external-action' },
      idempotencyKey: gateMarkerKey(state, name),
    })
    await source.flushReceipt(await source.applyMutation(plan, { confirm: plan.token }))
    return true
  }

  // Rows parked on a bridge gate, from intake rows and live instances' frontier packets.
  async function parkedRows(index) {
    const parked = []
    for (const entries of index.values()) {
      for (const { row } of entries) {
        if (row.state === 'blocked' && stableIdFromGate(row.blockedOn)) parked.push(row)
      }
    }
    for (const port of allPorts()) {
      for (const instance of (await port.listWorkflows({})).filter(isLiveInstance)) {
        for (const id of instance.frontier ?? []) {
          const row = await port.show(id)
          if (row?.state === 'blocked' && stableIdFromGate(row.blockedOn)) parked.push(row)
        }
      }
    }
    return parked
  }

  // Makes the source's open-gate markers match the rows parked on bridge gates: a waiting marker
  // per parked row; a closed marker for a marker whose row no longer waits (when the source log can
  // be read). Returns true when it wrote anything.
  async function syncGateMarkers(items, index) {
    if (!items || !canWriteMarkers()) return false
    const wanted = new Map()
    for (const row of await parkedRows(index)) {
      const stableId = stableIdFromGate(row.blockedOn)
      if (!wanted.has(stableId)) wanted.set(stableId, new Set())
      wanted.get(stableId).add(gateMarkerName(row.blockedOn, row.qitemId))
    }
    let wrote = false
    for (const item of items) {
      const stableId = stableQueueId(parseSourceRef(item.ref))
      const want = wanted.get(stableId) ?? new Set()
      const reference = referenceFor(item.ref)
      const have =
        typeof source.readLogEntries === 'function'
          ? openGateMarkers(await source.readLogEntries(reference))
          : null
      for (const name of want) {
        if (!have?.has(name)) wrote = (await writeMarker(reference, 'waiting', name)) || wrote
      }
      for (const name of have ?? []) {
        if (!want.has(name)) wrote = (await writeMarker(reference, 'closed', name)) || wrote
      }
    }
    return wrote
  }

  // ---- source claims ----

  // Releases the item's source claim (the holder's, or only `owner`'s when given). Any trusted
  // claim writer may release for the holder. → holder released | null
  async function releaseClaim(reference, { owner = null } = {}) {
    if (!canClaim()) return null
    const state = await callSourceCapability(source, 'claim', 'readClaim', reference)
    if (isCapabilityAbsent(state) || state.status !== 'held') return null
    if (owner && !ownersEqual(owner, state.holder)) return null
    await callSourceCapability(source, 'claim', 'release', reference, state.holder)
    return state.holder
  }

  // ---- offers ----

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

  // `pending`: items already admitted in this pass, counted against capacity (no overshoot within
  // one reconcile).
  async function admit(workItem, stableId, openItems = null, pending = 0) {
    const verdict = await admission({ workItem, stableId, rig: controlRig, openItems, pending })
    if (verdict?.admit !== false) return null
    const { admit: _admit, open: _open, ...rest } = verdict
    return { reason: null, ...rest }
  }

  // The open items with their gate markers brought up to date, for admission.
  async function admissionView(index) {
    const items = await listOpenItems()
    if (!items) return null
    return (await syncGateMarkers(items, index)) ? listOpenItems() : items
  }

  async function intakeReady(refText, pushed) {
    const { parsed, workItem, stableId } = await readItem(refText)
    const ignored = pushedContentIgnored(pushed, workItem)
    const base = withTrust({ ref: workItem.ref, stableId, pushedContentIgnored: ignored })
    const ready = readiness(workItem)
    if (ready.status === 'not-ready')
      return { ...base, status: 'not-ready', reasons: ready.reasons }
    const index = await liveIndex()
    const live = await liveness(stableId, index)
    if (live.rows.length || live.instances.length) {
      return {
        ...base,
        status: 'already-queued',
        qitemId: live.rows[0]?.row.qitemId ?? null,
        instanceId: live.instances[0]?.instance.instanceId ?? null,
      }
    }
    const deferred = await admit(workItem, stableId, await admissionView(index))
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

  // The item's rows that can wait on a gate: its live intake rows and its instances' frontier
  // packets, each with the port it lives on.
  async function itemRows(stableId) {
    const { rows, instances } = await liveness(stableId)
    const packets = []
    for (const { instance, port } of instances) {
      for (const id of instance.frontier ?? []) {
        const row = await port.show(id)
        if (row) packets.push({ row, port })
      }
    }
    return { intakeRows: rows, packets, instances }
  }

  async function resolveGate(reference, stableId, gate, decision) {
    const { intakeRows, packets } = await itemRows(stableId)
    const waiting = [...intakeRows, ...packets].filter(
      ({ row }) => row.state === 'blocked' && row.blockedOn === gate,
    )
    for (const { row, port } of waiting) {
      await port.resolve(row.qitemId, { decision })
      await writeMarker(reference, 'closed', gateMarkerName(gate, row.qitemId))
    }
    return waiting.map(({ row }) => row.qitemId)
  }

  // With a team roster, the review gate opens only on an in-scope person's decision recorded in
  // the source (#585 gateDecisionState); a decision in chat or on a queue row counts for nothing.
  // The gate id binds what is under review: `<ref>:review:<digest>`, the digest over the candidate
  // head and the trusted transitions up to the latest phase 6 pass. A commit pushed after an
  // agreement, or a new build and review round, makes an earlier agreement stale.
  async function rosterReviewDecision(reference, workItem, parsed, reviewed) {
    if (!roster) return { satisfied: true, uri: null, gate: null }
    const read =
      gateEntries ??
      (typeof source.readLogEntries === 'function' ? (ref) => source.readLogEntries(ref) : null)
    if (!read) {
      return {
        satisfied: false,
        gate: { reason: 'source-log-unavailable' },
        reason: `source adapter ${source.id} cannot list its log entries, so no roster decision can be read`,
      }
    }
    const head = await candidateHead({ workItem, slice: sliceIdFor(parsed) })
    if (typeof head !== 'string' || !head) {
      return {
        satisfied: false,
        gate: { reason: 'candidate-head-unknown' },
        reason:
          'the candidate head (PR or slice branch head) is unknown, so no review decision can be bound to it',
      }
    }
    const digest = reviewEvidenceDigest(reviewed, head)
    const gate = {
      id: formatGateId({ ref: workItem.ref, name: 'review', digest }),
      type: 'acceptance-review',
      tier: ROSTER_TIERS.includes(workItem.changeClass) ? workItem.changeClass : 'standard',
      digest,
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
      candidateHead: head,
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
    const { parsed, reference, workItem, stableId } = await readItem(refText)
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
    const person = await rosterReviewDecision(
      reference,
      workItem,
      parsed,
      transitions.slice(0, review + 1),
    )
    const gateField = person.gate ? { gate: person.gate } : {}
    if (!person.satisfied) {
      return { ...base, status: 'not-ready', reasons: [person.reason], ...gateField }
    }
    const decision = person.uri ?? transitions[review].uri ?? `phase ${REVIEW_PHASE} pass`
    const resolved = await resolveGate(reference, stableId, reviewGate(stableId), decision)
    return {
      ...base,
      status: resolved.length ? 'resolved' : 'no-waiting-row',
      resolved,
      decision,
      ...gateField,
    }
  }

  async function merged(workItem, stableId) {
    const reference = referenceFor(workItem.ref)
    const resolved = await resolveGate(
      reference,
      stableId,
      mergeGate(stableId),
      `merged: ${workItem.ref}`,
    )
    const cleanup = worktrees?.cleanup
      ? await worktrees.cleanup({ slice: sliceIdFor(workItem), stableId, workItem })
      : null
    const released = await releaseClaim(reference)
    return { resolved, worktree: cleanup, ...(released ? { released } : {}) }
  }

  async function closed(refText, stableId, reason) {
    const reference = referenceFor(refText)
    const { intakeRows, instances } = await itemRows(stableId)
    const aborted = []
    for (const { instance, port } of instances) {
      await port.abortWorkflow(instance.instanceId, { reason })
      aborted.push(instance.instanceId)
    }
    const canceled = []
    for (const { row, port } of intakeRows) {
      await port.update(row.qitemId, {
        state: 'done',
        closureReason: 'canceled',
        resolution: reason,
      })
      if (row.state === 'blocked' && stableIdFromGate(row.blockedOn)) {
        await writeMarker(reference, 'closed', gateMarkerName(row.blockedOn, row.qitemId))
      }
      canceled.push(row.qitemId)
    }
    const released = await releaseClaim(reference)
    return { aborted, canceled, ...(released ? { released } : {}) }
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
      ...(await closed(workItem.ref, stableId, `source closed: ${workItem.ref}`)),
    }
  }

  const EVENTS = {
    ready: (refText, options) => intakeReady(refText, options.pushed),
    'review-done': reviewDone,
    merged: intakeMerged,
    closed: intakeClosed,
  }

  // Parks a row this rig started on the replay gate, records the open gate in the source, releases
  // the rig's claim (another rig may take the item), and tells a person.
  async function parkRow({ port, rig, owner }, row, intake, reason, kind) {
    const gate = replayGate(intake.stableId)
    await port.block(row.qitemId, {
      on: gate,
      continuation: `fix the cause, then run agentflow-sdlc bridge start ${row.qitemId} again`,
      note: reason,
    })
    const reference = referenceFor(intake.ref)
    await writeMarker(reference, 'waiting', gateMarkerName(gate, row.qitemId))
    const released = owner ? await releaseClaim(reference, { owner }) : null
    const notified = await peopleFor(port, rig).deliver({
      kind,
      ref: intake.ref,
      stableId: intake.stableId,
      reason,
    })
    return { gate, notified: notified ?? null, ...(released ? { released } : {}) }
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

  // Another start of the same item on the same rig that holds its own row (in progress). Each start
  // claims its row before it looks, so of two concurrent starts at most one finds none.
  async function concurrentStart(port, rig, stableId, qitemId) {
    const rows = await bridgeRows(port, ['in-progress'])
    return rows.find(
      (row) =>
        row.qitemId !== qitemId &&
        parseIntakeBody(row.body)?.stableId === stableId &&
        callerSeat(row.destination)?.rig === rig,
    )
  }

  async function settleStrays(openIds, dryRun, report) {
    const strays = new Map()
    for (const port of allPorts()) {
      for (const row of await bridgeRows(port, LIVE_ROW_STATES)) {
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
        const result = await closed(workItem.ref, stableId, `source closed: ${workItem.ref}`)
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
    // `session` is the caller's OpenRig session (OPENRIG_SESSION_NAME or --session). Events that
    // resolve or abort gated work need a named caller that is not a worker (decision 9).
    async intake(refText, { event = 'ready', pushed = null, session = null } = {}) {
      const handler = EVENTS[event]
      if (!handler) {
        throw new BridgeError(`unknown intake event ${event}`, { status: 'usage', exitCode: 2 })
      }
      if (event !== 'ready') refuseWorkerSession(session)
      return handler(refText, { pushed })
    },

    // Run by the entry seat of a delivery rig on its own pending offer row (or a row parked on the
    // replay gate). The queue claim of that row serializes starts of the row; a concurrent start of
    // the same item on the same rig yields; the source claim decides between rigs (#586). Uses only
    // this rig's queue port. `resume`: take over an in-progress row whose start died between the
    // source claim and the workflow instance (only when no start of it is running).
    async start(qitemId, { session, resume = false } = {}) {
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
      const rowRig = callerSeat(row.destination)?.rig ?? null
      // An offer belongs to the rig it was made to, including a rig since removed from the
      // configuration: no other rig starts it.
      if (rowRig && rowRig !== rig) {
        throw new BridgeError(`qitem ${qitemId} is offered to ${rowRig}, not ${rig}`, {
          status: 'refused',
        })
      }
      const claimed = await claimRow(port, qitemId, session)
      if (!claimed && !(resume && row.state === 'in-progress')) {
        return { status: 'already-started', qitemId, state: row.state }
      }
      const { parsed, reference, workItem, stableId } = await readItem(intake.ref)
      const base = withTrust({ ref: workItem.ref, stableId, qitemId, ...(multi ? { rig } : {}) })
      // A row restarted off the replay gate no longer waits on it.
      if (row.state === 'blocked' && stableIdFromGate(row.blockedOn)) {
        await writeMarker(reference, 'closed', gateMarkerName(row.blockedOn, row.qitemId))
      }
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
      // Same-rig re-entrancy is not a win: the rig already holding the claim must not start a
      // second instance from another row of the same item.
      const other = await concurrentStart(port, rig, stableId, qitemId)
      if (other) {
        await port.update(qitemId, {
          state: 'done',
          closureReason: 'superseded',
          closureTarget: other.qitemId,
          resolution: `another start of this item is running on ${rig} (${other.qitemId})`,
        })
        return { ...base, status: 'already-started', concurrentWith: other.qitemId }
      }
      // Claim before work: the earliest trusted claim in the source wins; a losing rig closes its
      // offer and creates nothing (no worktree, no instance).
      const owner = { kind: 'rig', rig, host: 'local' }
      if (canClaim()) {
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
      const parkWith = { port, rig, owner: canClaim() ? owner : null }
      // Re-derive the resume phase: the row may predate newer evidence.
      const transitions = trusted(workItem)
      const resumePhase = resumePhaseFor(transitions, entryPhase)
      if (resumePhase === null) {
        const parked = await parkRow(
          parkWith,
          row,
          { ref: workItem.ref, stableId },
          'the return-cycle limit is reached; a person must decide',
          'return-limit',
        )
        return { ...base, status: 'parked', reason: 'return-cycle limit reached', ...parked }
      }
      const slice = sliceIdFor(parsed)
      let instanceId = null
      let worktree = null
      let replay
      try {
        worktree = worktrees?.prepare
          ? await worktrees.prepare({ slice, stableId, workItem })
          : null
        const instance = await port.instantiateWorkflow({
          specPath: config.workflowSpec,
          rig,
          slice,
          mission: workItem.partOf ?? undefined,
          tags: [itemTag(stableId)],
          entryOwner: session,
          createdBy: session,
          rootObjective: `AgentFlow delivery of ${workItem.ref}`,
        })
        instanceId = instance.instanceId
        replay = await fastForward(port, {
          instanceId,
          entryQitemId: instance.entryQitemId,
          transitions,
          ref: workItem.ref,
          resumePhase,
          session,
        })
      } catch (error) {
        replay = { problem: `start failed after the claim: ${error.message}`, replayed: [] }
      }
      if (replay.problem) {
        // Abort a half-built instance so no later start adopts it, then park and release.
        if (instanceId) await port.abortWorkflow(instanceId, { reason: replay.problem })
        const parked = await parkRow(
          parkWith,
          row,
          { ref: workItem.ref, stableId },
          replay.problem,
          'reconcile-replay',
        )
        return {
          ...base,
          status: 'parked',
          instanceId,
          replayed: replay.replayed,
          reason: replay.problem,
          ...(instanceId ? { aborted: instanceId } : {}),
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
        ...(resume && !claimed ? { resumed: true } : {}),
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
      let items = await listOpenItems()
      if (!items) {
        throw new BridgeError('reconcile requires ready-predicates', {
          status: 'capability-absent',
        })
      }
      const index = await liveIndex()
      if (!dryRun && (await syncGateMarkers(items, index))) items = await listOpenItems()
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
      let admitted = 0
      for (const workItem of items) {
        const parsed = parseSourceRef(workItem.ref)
        const stableId = stableQueueId(parsed)
        openIds.add(stableId)
        const live = await liveness(stableId, index)
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
        const deferred = await admit(workItem, stableId, items, admitted)
        if (deferred) {
          report.deferred.push({ ref: workItem.ref, stableId, status: 'deferred', ...deferred })
          continue
        }
        const created = await createOffers({ parsed, workItem, stableId, dryRun })
        if (created.blocked) {
          report.skipped.push({ ref: workItem.ref, stableId, reasons: [created.blocked] })
          continue
        }
        admitted += 1
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

    // Releases an item's source claim, for example one held by a delivery rig removed from the
    // configuration. A gate-resolving call: needs a named caller that is not a worker.
    async release(refText, { session = null } = {}) {
      refuseWorkerSession(session)
      const { reference, workItem, stableId } = await readItem(refText)
      if (!canClaim()) {
        throw new BridgeError(`source adapter ${source.id} does not declare claim`, {
          status: 'capability-absent',
        })
      }
      const holder = await releaseClaim(reference)
      return { ref: workItem.ref, stableId, status: holder ? 'released' : 'free', holder }
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
