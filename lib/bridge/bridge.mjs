// The rig bridge (#582): moves ready source work into the OpenRig queue and returns evidence to
// the source. It is source-agnostic: it talks to a SourceAdapter (#580) and a QueuePort only.
//
// Invariants (SDD §1): the source is the truth and every operation re-reads it; queue rows carry a
// reference and derived ids, never artifact content; no polling loop, one pass per call. Only
// role-pass evidence written by a trusted evidence writer counts for any decision.
//
// Liveness: an item's live intake rows are found by listing the bridge's own live rows on every
// rig's port (an explicit limit; a full page is an error) and reading each row's intake body. The
// listing source is the project's stable bridge session `agentflow-bridge@<project>`, plus the
// legacy per-rig sessions `agentflow-bridge@<rig>` of every configured rig, so neither a renamed
// control rig nor a single→multi upgrade hides rows. Ids are never guessed from the configuration.
// Live workflow instances tagged `af:<stable id>` count too. Escalation and notice rows are not work.
//
// Several delivery rigs (#586): intake offers an item to every delivery rig the partition names
// (one offer row per rig), and the rig whose entry seat claims the item in the source first works
// it; the others yield. Rigs coordinate only through the source. Each rig may have its own queue
// port (`queues[rig]`, default `queue`); delivery-side commands (`start`, `evidence`, `cleanup`)
// use only their own rig's port, never the control rig's.
//
// Extension points, all optional injected ports:
//   admission({ workItem, stableId, rig, openItems, pending }) → { admit } | { admit: false, reason, … }
//                                             backpressure (#586, backpressure.mjs); default admits
//   claim({ adapter, reference, owner })    → { won, holder } | capability-absent result
//                                             source claim before work (#586); default claimOrYield
//   gateEntries(reference) → [{ writer, body, uri, edited, createdAt, updatedAt }]  source log
//                                             entries; default source.readLogEntries
//   candidateHead({ workItem, slice }) → sha | null  the candidate under review when the source has
//                                             no head of its own (the CLI reads the slice branch)
//   worktrees.pathFor({ slice })                     → { path }   the path an intake row names (#584b)
//   worktrees.prepare({ slice, stableId, workItem }) → { path }   on start, before any seat works
//   worktrees.cleanup({ slice, stableId, workItem }) → { status: removed|absent|kept, reasons }
//                                                                 on merged; kept tells a person
//   worktrees.sweep({ openSlices, resolveSlice, dryRun }) → { removed, kept, orphans, … }
//                                                                 on reconcile
//   (lib/bridge/worktrees-port.mjs is the real port; the claim is released once a worktree is gone)
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
import { personById } from '../roster/team-roster.mjs'
import { deliveryRigProblems, entryPhaseFor } from './config.mjs'
import { buildRolePassRecord, findRecordedRetry, trustedTransitions } from './evidence.mjs'
import { gateResolutionRefusal } from './gate-guard.mjs'
import {
  formatGateMarker,
  gateMarkerKey,
  gateMarkerName,
  gateMarkerState,
  parkBase,
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
  startGate,
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
// OpenRig retention can erase closed rows; an erased id reads as missing and cannot be reused. The
// chain scan therefore tolerates gaps: it stops only after this many missing ids in a row.
export const GENERATION_GAP_TOLERANCE = 16
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
// A start holds a lease on its row for this long; `start --resume` refuses a fresher lease.
export const START_LEASE_MS = 15 * 60_000
const LEASE_NOTE = /^agentflow-start-lease session=(\S+) at=(\S+)$/

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

// The digest (64 hex) of what a review gate asks about: the candidate head (the PR head, or the
// slice branch head when the source has none) and the trusted transitions, in source order, up to
// and including the latest phase 6 pass. A commit pushed after an agreement, or a new build and
// review round, changes it.
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
}

// The candidate head as the source reports it: a declared candidate head, the pull request head,
// or the merged head. Null when the source has none.
export function sourceCandidateHead(workItem) {
  for (const key of ['candidateHead', 'head', 'mergedHead']) {
    const value = workItem?.[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}

// The stable bridge session for a project: `agentflow-bridge@<project>`. The project id is
// `bridge.project`, else the control rig's name without a `-control` suffix, so a single-rig
// project (`rig: agentflow-p`) and its multi-rig upgrade (`control: agentflow-p-control`) share it.
export function bridgeSessionFor(config) {
  const project =
    typeof config.project === 'string' && config.project
      ? config.project
      : String(config.rigs.control).replace(/-control$/, '')
  return `agentflow-bridge@${project}`
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
  candidateHead = null,
  seatTable = null,
  startLeaseMs = START_LEASE_MS,
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
  const bridgeSession = bridgeSessionFor(config)
  // Rows from before an upgrade or a rename were created under a rig's own session.
  const listingSources = [
    ...new Set([
      bridgeSession,
      ...[controlRig, ...deliveryRigs].map((rig) => `agentflow-bridge@${rig}`),
    ]),
  ]
  const evidenceWriters = config.evidenceWriters ?? []
  const evidenceTrust = evidenceWriters.length ? null : 'no-evidence-writers-configured'
  const markerWriters = [...new Set([...evidenceWriters, source.writer].filter(Boolean))]
  const gateBots = botWriters ?? botWritersFromBridge(config)
  const trusted = (workItem) => trustedTransitions(workItem.transitions, evidenceWriters)
  const withTrust = (result) => (evidenceTrust ? { ...result, evidenceTrust } : result)
  const canClaim = () => sourceCapability(source, 'claim').available
  const canWriteMarkers = () => sourceCapability(source, 'mutate-comments').available
  const readLog = () =>
    gateEntries ??
    (typeof source.readLogEntries === 'function' ? (ref) => source.readLogEntries(ref) : null)

  function queueFor(rig) {
    const port = queues?.[rig] ?? queue
    if (!port) throw new BridgeError(`no queue port for rig ${rig}`)
    return port
  }
  const controlQueue = () => queueFor(controlRig)
  function allPorts() {
    return [...new Set([...deliveryRigs, controlRig].map(queueFor))]
  }
  function deliveryPorts() {
    return [...new Set(deliveryRigs.map(queueFor))]
  }
  function peopleFor(port, rig) {
    return notifier ?? defaultNotifier(port, config, rig)
  }
  const controlPeople = () => peopleFor(controlQueue(), controlRig)
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

  async function listItems(lifecycle) {
    const items = await callSourceCapability(source, 'ready-predicates', 'listWorkItems', {
      lifecycle,
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

  const idFor = (base, n) => (n === 1 ? base : generationId(base, n))

  // Names a new row: the base id, then -g2, -g3 …, read with show. Erased or missing ids leave
  // gaps, so the scan continues past them and stops after GENERATION_GAP_TOLERANCE misses. A new
  // row goes after the highest generation seen, never into a gap.
  async function intakeChain(port, base) {
    const rows = []
    let highest = 0
    for (let n = 1; n < MAX_GENERATIONS && n - highest <= GENERATION_GAP_TOLERANCE; n += 1) {
      const row = await port.show(idFor(base, n))
      if (!row) continue
      rows.push(row)
      highest = n
    }
    return { rows, nextGeneration: highest + 1, nextId: idFor(base, highest + 1) }
  }

  // The live rows of the id chains the current configuration would use (each delivery rig's
  // offer chain and the plain stable-id chain). Complements the listing for rows whose body does
  // not parse; the listing finds the rows these ids miss.
  async function chainRows(stableId) {
    const found = []
    const seen = new Map()
    for (const rig of deliveryRigs) {
      const port = queueFor(rig)
      if (!seen.has(port)) seen.set(port, new Set())
      for (const base of new Set([offerBase(stableId, rig), stableId])) {
        if (seen.get(port).has(base)) continue
        seen.get(port).add(base)
        for (const row of (await intakeChain(port, base)).rows.filter(isLiveRow)) {
          found.push({ row, port })
        }
      }
    }
    return found
  }

  // The bridge's own rows on a port in the given states, from every listing source.
  async function bridgeRows(port, states) {
    const rows = new Map()
    for (const sessionName of listingSources) {
      const listed = await port.list({ source: sessionName, states, limit: STRAY_LIST_LIMIT })
      if (listed.length >= STRAY_LIST_LIMIT) {
        throw new BridgeError(
          `the queue returned a full page of ${STRAY_LIST_LIMIT} rows; the bridge will not guess at the rest`,
        )
      }
      for (const row of listed) rows.set(row.qitemId, row)
    }
    return [...rows.values()]
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

  // `listed`: Map(port → workflow listing) taken once by the caller (reconcile).
  async function instancesFor(stableId, { listed = null, ports = deliveryPorts() } = {}) {
    const tag = itemTag(stableId)
    const found = []
    const ids = new Set()
    for (const port of ports) {
      const instances = listed?.get(port) ?? (await port.listWorkflows({ tag }))
      for (const instance of instances.filter((item) => item.tags.includes(tag))) {
        if (ids.has(instance.instanceId)) continue
        ids.add(instance.instanceId)
        found.push({ instance, port })
      }
    }
    return found
  }

  async function listAllWorkflows() {
    const listed = new Map()
    for (const port of allPorts()) listed.set(port, await port.listWorkflows({}))
    return listed
  }

  async function liveness(stableId, { index = null, listed = null } = {}) {
    const rows = [...((index ?? (await liveIndex())).get(stableId) ?? [])]
    for (const entry of await chainRows(stableId)) {
      if (!rows.some((item) => item.port === entry.port && item.row.qitemId === entry.row.qitemId))
        rows.push(entry)
    }
    const instances = (await instancesFor(stableId, { listed })).filter((item) =>
      isLiveInstance(item.instance),
    )
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

  async function markerState(reference) {
    const read = readLog()
    if (!read) return null
    return gateMarkerState(await read(reference), markerWriters)
  }

  // A row parked on a bridge gate: a waiting marker for this park, unless one is open already.
  async function markParked(reference, blockedOn, qitemId, state = null) {
    const current = state ?? (await markerState(reference))
    const base = parkBase(blockedOn, qitemId)
    if (current?.open.has(base)) return false
    // Without the log the next number is unknown; the time keeps each park's name distinct.
    const seq = current ? (current.lastSeq.get(base) ?? 0) + 1 : clock().getTime()
    return writeMarker(reference, 'waiting', gateMarkerName(base, seq))
  }

  // The row no longer waits on the gate: close this park's open marker.
  async function markResolved(reference, blockedOn, qitemId, state = null) {
    const current = state ?? (await markerState(reference))
    const name = current?.open.get(parkBase(blockedOn, qitemId))
    return name ? writeMarker(reference, 'closed', name) : false
  }

  // Rows parked on a bridge gate: intake rows and live instances' frontier packets.
  async function parkedRows(index, listed) {
    const parked = []
    for (const entries of index.values()) {
      for (const { row } of entries) {
        if (row.state === 'blocked' && stableIdFromGate(row.blockedOn)) parked.push(row)
      }
    }
    for (const port of allPorts()) {
      for (const instance of (listed?.get(port) ?? (await port.listWorkflows({}))).filter(
        isLiveInstance,
      )) {
        for (const id of instance.frontier ?? []) {
          const row = await port.show(id)
          if (row?.state === 'blocked' && stableIdFromGate(row.blockedOn)) parked.push(row)
        }
      }
    }
    return parked
  }

  // Makes the source's open-gate markers match the rows parked on bridge gates. True when it wrote.
  async function syncGateMarkers(items, index, listed) {
    if (!items || !canWriteMarkers() || !readLog()) return false
    const wanted = new Map()
    for (const row of await parkedRows(index, listed)) {
      const stableId = stableIdFromGate(row.blockedOn)
      if (!wanted.has(stableId)) wanted.set(stableId, new Map())
      wanted.get(stableId).set(parkBase(row.blockedOn, row.qitemId), row)
    }
    let wrote = false
    for (const item of items) {
      const stableId = stableQueueId(parseSourceRef(item.ref))
      const want = wanted.get(stableId) ?? new Map()
      const reference = referenceFor(item.ref)
      const state = await markerState(reference)
      for (const row of want.values()) {
        wrote = (await markParked(reference, row.blockedOn, row.qitemId, state)) || wrote
      }
      for (const [base, name] of state.open) {
        if (!want.has(base)) wrote = (await writeMarker(reference, 'closed', name)) || wrote
      }
    }
    return wrote
  }

  // ---- source claims ----

  // Releases the item's source claim: the holder's, or only `owner`'s when given. Any trusted
  // claim writer may release for the holder. → { released, holder?, reason? } | null
  async function releaseClaim(reference, { owner = null } = {}) {
    if (!canClaim()) return null
    const state = await callSourceCapability(source, 'claim', 'readClaim', reference)
    if (isCapabilityAbsent(state) || state?.status !== 'held') {
      return { released: false, reason: 'not claimed' }
    }
    if (owner && !ownersEqual(owner, state.holder)) {
      return { released: false, reason: 'claimed by another owner' }
    }
    await callSourceCapability(source, 'claim', 'release', reference, state.holder)
    return { released: true, holder: state.holder }
  }

  async function holderOf(reference) {
    if (!canClaim()) return null
    const state = await callSourceCapability(source, 'claim', 'readClaim', reference)
    return !isCapabilityAbsent(state) && state?.status === 'held' ? state.holder : null
  }

  // ---- offers ----

  async function createOffer({ rig, stableId, workItem, body, tier, slice, dryRun }) {
    const port = queueFor(rig)
    const base = offerBase(stableId, rig)
    const chain = await intakeChain(port, base)
    if (dryRun) return { rig, qitemId: chain.nextId, created: false, dryRun: true }
    for (let n = chain.nextGeneration; n < MAX_GENERATIONS; n += 1) {
      const id = idFor(base, n)
      let created
      try {
        created = await port.create({
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
      } catch (error) {
        // Retention erased this id; it can never be used again.
        if (error?.code === 'qitem_erased') continue
        throw error
      }
      // Someone else took this id first. A live row is the item's work; a closed one means the
      // next generation.
      if (created.created || LIVE_ROW_STATES.includes(created.state)) return { rig, ...created }
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
      worktreePath: worktrees?.pathFor?.({ slice })?.path ?? null,
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
      warning: offers.find((offer) => offer.warning)?.warning ?? null,
    }
  }

  const offerSummary = (offers) =>
    multi ? { offers: offers.map(({ rig, qitemId, created }) => ({ rig, qitemId, created })) } : {}

  // `pending`: items already admitted in this pass, counted against capacity.
  async function admit(workItem, stableId, openItems = null, pending = 0) {
    const verdict = await admission({ workItem, stableId, rig: controlRig, openItems, pending })
    if (verdict?.admit !== false) return null
    const { admit: _admit, open: _open, ...rest } = verdict
    return { reason: null, ...rest }
  }

  // The open items with their gate markers brought up to date, for admission.
  async function admissionView(index) {
    const items = await listItems('open')
    if (!items) return null
    return (await syncGateMarkers(items, index, null)) ? listItems('open') : items
  }

  async function intakeReady(refText, pushed) {
    const { parsed, workItem, stableId } = await readItem(refText)
    const ignored = pushedContentIgnored(pushed, workItem)
    const base = withTrust({ ref: workItem.ref, stableId, pushedContentIgnored: ignored })
    const ready = readiness(workItem)
    if (ready.status === 'not-ready')
      return { ...base, status: 'not-ready', reasons: ready.reasons }
    const index = await liveIndex()
    const live = await liveness(stableId, { index })
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
  async function itemRows(stableId, { index = null, listed = null } = {}) {
    const { rows, instances } = await liveness(stableId, { index, listed })
    const packets = []
    for (const { instance, port } of instances) {
      for (const id of instance.frontier ?? []) {
        const row = await port.show(id)
        if (row) packets.push({ row, port })
      }
    }
    return { intakeRows: rows, packets, instances }
  }

  async function resolveGate(reference, stableId, gate, decision, options = {}) {
    const { intakeRows, packets } = await itemRows(stableId, options)
    const waiting = [...intakeRows, ...packets].filter(
      ({ row }) => row.state === 'blocked' && row.blockedOn === gate,
    )
    for (const { row, port } of waiting) {
      await port.resolve(row.qitemId, { decision })
      await markResolved(reference, gate, row.qitemId)
    }
    return waiting.map(({ row }) => row.qitemId)
  }

  // The candidate under review: the source's own head first; a branch head only when the source
  // has none (a seat can move a branch, not the source's record).
  async function candidateFor(workItem, parsed) {
    const fromSource = sourceCandidateHead(workItem)
    if (fromSource) return { head: fromSource, from: 'source' }
    const fromBranch = candidateHead
      ? await candidateHead({ workItem, slice: sliceIdFor(parsed) })
      : null
    return typeof fromBranch === 'string' && fromBranch
      ? { head: fromBranch, from: 'branch' }
      : { head: null, from: null }
  }

  // With a team roster, the review gate opens only on an in-scope person's decision recorded in
  // the source (#585 gateDecisionState); a decision in chat or on a queue row counts for nothing.
  // The gate id `<ref>:review:<digest>` binds the candidate head and the reviewed evidence.
  async function rosterReviewDecision(reference, workItem, parsed, reviewed) {
    if (!roster) return { satisfied: true, uri: null, gate: null }
    const read = readLog()
    if (!read) {
      return {
        satisfied: false,
        gate: { reason: 'source-log-unavailable' },
        reason: `source adapter ${source.id} cannot list its log entries, so no roster decision can be read`,
      }
    }
    const candidate = await candidateFor(workItem, parsed)
    if (!candidate.head) {
      return {
        satisfied: false,
        gate: { reason: 'candidate-head-unknown' },
        reason: 'the candidate head is unknown, so no review decision can be bound to it',
      }
    }
    const digest = reviewEvidenceDigest(reviewed, candidate.head)
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
      candidateHead: candidate.head,
      candidateFrom: candidate.from,
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

  // Removes the slice worktree under the safety rule. Gone (removed or already absent) releases the
  // claim; kept, for any reason including a failure, tells a person why (through `people`).
  async function cleanupWorktree(workItem, stableId, people) {
    if (!worktrees?.cleanup) return null
    let result
    try {
      result = await worktrees.cleanup({
        slice: sliceIdFor(parseSourceRef(workItem.ref)),
        stableId,
        workItem,
      })
    } catch (error) {
      result = { status: 'kept', reasons: [`worktree cleanup failed: ${error.message}`] }
    }
    if (result?.status === 'removed' || result?.status === 'absent') {
      return { ...result, claim: await releaseClaim(referenceFor(workItem.ref)) }
    }
    if (result?.status === 'kept') {
      const reason = `worktree for ${workItem.ref} was kept: ${result.reasons.join('; ')}`
      return {
        ...result,
        notified:
          (await people.deliver({ kind: 'worktree-kept', ref: workItem.ref, stableId, reason })) ??
          null,
      }
    }
    return result
  }

  async function merged(workItem, stableId, options = {}) {
    const reference = referenceFor(workItem.ref)
    const resolved = await resolveGate(
      reference,
      stableId,
      mergeGate(stableId),
      `merged: ${workItem.ref}`,
      options,
    )
    // With worktrees the claim is released once the worktree is gone; without, on merge.
    const worktree = await cleanupWorktree(workItem, stableId, controlPeople())
    const claimResult = worktrees?.cleanup ? null : await releaseClaim(reference)
    return {
      resolved,
      worktree,
      ...(claimResult?.released ? { released: claimResult.holder } : {}),
    }
  }

  async function closed(refText, stableId, reason, options = {}) {
    const reference = referenceFor(refText)
    const { intakeRows, instances } = await itemRows(stableId, options)
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
        await markResolved(reference, row.blockedOn, row.qitemId)
      }
      canceled.push(row.qitemId)
    }
    const claimResult = await releaseClaim(reference)
    return { aborted, canceled, ...(claimResult?.released ? { released: claimResult.holder } : {}) }
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

  // A rebuilt item that cannot be replayed (risk R5): abort the half-replayed instance so no later
  // start adopts it, park the intake row, record the open gate, release this rig's claim once the
  // instance is gone, and tell a person.
  async function parkReplay(ctx, row, intake, instanceId, reason) {
    const { port, rig, owner, people } = ctx
    const gate = replayGate(intake.stableId)
    let abortError = null
    if (instanceId) {
      try {
        await port.abortWorkflow(instanceId, { reason: `replay refused: ${reason}` })
      } catch (error) {
        abortError = error.message
      }
    }
    const told = abortError
      ? `${reason}; abort of workflow ${instanceId} failed (${abortError}): abort it by hand before starting again`
      : reason
    await port.block(row.qitemId, {
      on: gate,
      continuation: abortError
        ? `abort workflow ${instanceId}, then run agentflow-sdlc bridge start ${row.qitemId} again`
        : `fix the cause, then run agentflow-sdlc bridge start ${row.qitemId} again`,
      note: told,
    })
    const reference = referenceFor(intake.ref)
    await markParked(reference, gate, row.qitemId)
    const claimResult = owner && !abortError ? await releaseClaim(reference, { owner }) : null
    const notified = await people.deliver({
      kind: 'reconcile-replay',
      ref: intake.ref,
      stableId: intake.stableId,
      reason: told,
    })
    return {
      gate,
      aborted: abortError || !instanceId ? null : instanceId,
      ...(abortError ? { abortError } : {}),
      ...(claimResult?.released ? { released: claimResult.holder } : {}),
      notified: notified ?? null,
      rig,
    }
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

  // ---- start lease and resume ----

  function latestLease(row) {
    const notes = Array.isArray(row?.notes) ? row.notes : []
    for (let index = notes.length - 1; index >= 0; index -= 1) {
      const match = LEASE_NOTE.exec(String(notes[index]))
      if (match) return { session: match[1], at: match[2] }
    }
    return null
  }

  async function takeLease(port, qitemId, session) {
    await port.update(qitemId, {
      note: `agentflow-start-lease session=${session} at=${clock().toISOString()}`,
    })
  }

  // Takes over an in-progress row whose start died. Refused while another start's lease is fresh;
  // two concurrent resumes race on the queue's atomic claim, so only one proceeds.
  async function resumeRow(port, row, stableId, session) {
    const lease = latestLease(row)
    const age = lease ? clock().getTime() - Date.parse(lease.at) : Infinity
    if (lease && age < startLeaseMs) {
      throw new BridgeError(
        `a start of ${row.qitemId} by ${lease.session} holds its lease since ${lease.at}; resume after ${Math.ceil((startLeaseMs - age) / 1000)} s if it is gone`,
        { status: 'refused' },
      )
    }
    await port.block(row.qitemId, {
      on: startGate(stableId),
      note: `resume by ${session}: the start that held this row is gone`,
    })
    return claimRow(port, row.qitemId, session)
  }

  // Everything start does once it holds the intake row. `progress.instanceId` records whether a
  // workflow instance exists, so a failure can be recovered without losing the row.
  async function startClaimed(ctx) {
    const { port, rig, row, intake, qitemId, session, progress, people } = ctx
    const { parsed, reference, workItem, stableId } = await readItem(intake.ref)
    const base = withTrust({ ref: workItem.ref, stableId, qitemId, ...(multi ? { rig } : {}) })
    const ready = readiness(workItem)
    const restarted = row.state === 'blocked' && stableIdFromGate(row.blockedOn)
    if (ready.status === 'not-ready') {
      await port.update(qitemId, {
        state: 'done',
        closureReason: 'canceled',
        resolution: `not ready: ${ready.reasons.join('; ')}`,
      })
      if (restarted) await markResolved(reference, row.blockedOn, qitemId)
      return { ...base, status: 'canceled', reasons: ready.reasons }
    }
    const existing = (await instancesFor(stableId, { ports: [port] }))
      .map((item) => item.instance)
      .find(isLiveInstance)
    // A row parked by a failed start or replay never adopts the instance that failed.
    const parkedBy = [replayGate(stableId), startGate(stableId)].includes(row.blockedOn)
    if (existing && parkedBy) {
      const reason = `workflow ${existing.instanceId} from a failed start is still live; abort it first`
      await port.block(qitemId, { on: row.blockedOn, note: reason })
      await people.deliver({ kind: 'start-failed', ref: workItem.ref, stableId, reason })
      return { ...base, status: 'parked', instanceId: existing.instanceId, reason }
    }
    // The row no longer waits on the gate it was parked on.
    if (restarted) await markResolved(reference, row.blockedOn, qitemId)
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
      const reason = `another start of this item is running on ${rig} (${other.qitemId})`
      await port.update(qitemId, {
        state: 'done',
        closureReason: 'superseded',
        closureTarget: other.qitemId,
        resolution: reason,
      })
      // Two starts that each see the other both stand down; a person makes sure one runs.
      const notified = await people.deliver({
        kind: 'start-superseded',
        ref: workItem.ref,
        stableId,
        reason: `${qitemId} stood down: ${reason}; if neither started, push the item again`,
      })
      return { ...base, status: 'already-started', concurrentWith: other.qitemId, notified }
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
      progress.claimed = owner
    }
    const parkCtx = { port, rig, owner: canClaim() ? owner : null, people }
    // Re-derive the resume phase: the row may predate newer evidence.
    const transitions = trusted(workItem)
    const resumePhase = resumePhaseFor(transitions, entryPhase)
    if (resumePhase === null) {
      const parked = await parkReplay(
        parkCtx,
        row,
        { ref: workItem.ref, stableId },
        null,
        'the return-cycle limit is reached; a person must decide',
      )
      return { ...base, status: 'parked', reason: 'return-cycle limit reached', ...parked }
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
      rootObjective: `AgentFlow delivery of ${workItem.ref}${worktree?.path ? `\nworktree_path=${worktree.path}` : ''}`,
    })
    progress.instanceId = instanceId
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
        parkCtx,
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
  }

  // After a failed start the claimed row must not stay in progress forever. With nothing
  // instantiated it goes back to pending for the next start and this rig's source claim is
  // released, so another rig may take the item; otherwise it is parked (the open gate recorded)
  // and a person is told, because an instance exists that nobody is driving.
  async function recoverStart({ port, row, intake, qitemId, session, progress, error, people }) {
    const stableId = intake.stableId
    try {
      if (!progress.instanceId) {
        await port.unclaim(qitemId, { session, reason: `start failed: ${error.message}` })
        if (progress.claimed) {
          await releaseClaim(referenceFor(intake.ref), { owner: progress.claimed })
        }
        return
      }
      await port.block(qitemId, {
        on: startGate(stableId),
        continuation: `abort workflow ${progress.instanceId}, then run agentflow-sdlc bridge start ${qitemId} again`,
        note: error.message,
      })
      await markParked(referenceFor(intake.ref), startGate(stableId), qitemId)
    } catch {
      // The person below is told either way.
    }
    if (progress.instanceId) {
      try {
        await people.deliver({
          kind: 'start-failed',
          ref: intake.ref,
          stableId,
          reason: `start of ${row.qitemId} failed after instance ${progress.instanceId}: ${error.message}`,
        })
      } catch {
        // Delivery failure must not hide the original error.
      }
    }
  }

  async function reconcileItem({
    workItem,
    parsed,
    stableId,
    index,
    listed,
    dryRun,
    report,
    pass,
  }) {
    const live = await liveness(stableId, { index, listed })
    if (live.rows.length || live.instances.length) {
      report.kept.push({
        ref: workItem.ref,
        stableId,
        qitemIds: live.rows.map(({ row }) => row.qitemId),
        instanceIds: live.instances.map(({ instance }) => instance.instanceId),
      })
      return
    }
    const ready = readiness(workItem)
    if (ready.status === 'not-ready') {
      report.skipped.push({ ref: workItem.ref, stableId, reasons: ready.reasons })
      return
    }
    const deferred = await admit(workItem, stableId, pass.items, pass.admitted)
    if (deferred) {
      report.deferred.push({ ref: workItem.ref, stableId, status: 'deferred', ...deferred })
      return
    }
    const created = await createOffers({ parsed, workItem, stableId, dryRun })
    if (created.blocked) {
      report.skipped.push({ ref: workItem.ref, stableId, reasons: [created.blocked] })
      return
    }
    pass.admitted += 1
    report.restored.push({
      ref: workItem.ref,
      stableId,
      qitemId: created.qitemId,
      resumePhase: created.resumePhase,
      ...offerSummary(created.offers),
    })
  }

  async function settleStrays(openIds, dryRun, report, listed) {
    const strays = new Map()
    for (const port of allPorts()) {
      for (const row of await bridgeRows(port, LIVE_ROW_STATES)) {
        const intake = parseIntakeBody(row.body)
        if (intake && isLiveRow(row) && !openIds.has(intake.stableId))
          strays.set(intake.stableId, intake.ref)
      }
      for (const instance of (listed.get(port) ?? []).filter(isLiveInstance)) {
        const stableId = stableIdFromTags(instance.tags)
        if (stableId && !openIds.has(stableId) && !strays.has(stableId)) strays.set(stableId, null)
      }
    }
    for (const [stableId, refText] of strays) {
      try {
        await settleStray({ stableId, refText, dryRun, report, listed })
      } catch (error) {
        report.failed.push({ ref: refText, stableId, error: error.message })
      }
    }
  }

  async function settleStray({ stableId, refText, dryRun, report, listed }) {
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
        ...(await merged(workItem, stableId, { listed })),
      })
    } else {
      const result = await closed(workItem.ref, stableId, `source closed: ${workItem.ref}`, {
        listed,
      })
      report.settled.push({
        stableId,
        ref: workItem.ref,
        lifecycle: workItem.lifecycle,
        ...result,
      })
    }
  }

  // Slice → { known, closed, ref, stableId, mergedHead }, from the source: the open items already
  // listed, then its closed and merged items. Read lazily, and a listing that fails or is absent
  // leaves those slices unknown, which lists them and never removes them.
  function sliceResolver(openItems) {
    const bySlice = new Map()
    const add = (item) => {
      const parsed = parseSourceRef(item.ref)
      bySlice.set(sliceIdFor(parsed), {
        known: true,
        closed: item.lifecycle !== 'open',
        lifecycle: item.lifecycle,
        ref: item.ref,
        stableId: stableQueueId(parsed),
        mergedHead: item.mergedHead ?? null,
        mergedInto: item.mergedInto ?? null,
      })
    }
    for (const item of openItems) add(item)
    let loaded = false
    return async (slice) => {
      if (!loaded) {
        loaded = true
        for (const lifecycle of ['closed', 'merged']) {
          try {
            const listed = await listItems(lifecycle)
            if (listed) for (const item of listed) add(item)
          } catch {
            // Slices that depend on this listing stay unknown.
          }
        }
      }
      const state = bySlice.get(slice) ?? { known: false }
      // Listings do not carry merge heads (an adapter may need one request per item), so a merged
      // item that has a worktree is re-read through the adapter. A pushed value is never used.
      if (state.known && state.lifecycle === 'merged' && !state.mergedHead) {
        try {
          const item = (await readItem(state.ref)).workItem
          state.mergedHead = item.mergedHead ?? null
          state.mergedInto = item.mergedInto ?? null
        } catch {
          // Without a merge head the worktree is only removed when it is an ancestor.
        }
      }
      return state
    }
  }

  async function sweepWorktrees({ items, dryRun }) {
    const resolve = sliceResolver(items)
    const result = await worktrees.sweep({
      openSlices: items.map((item) => sliceIdFor(parseSourceRef(item.ref))),
      resolveSlice: resolve,
      dryRun,
    })
    if (!result || dryRun) return result
    const notified = []
    const claims = []
    for (const entry of result.removed ?? []) {
      const state = await resolve(entry.slice)
      if (state.known) {
        claims.push({ slice: entry.slice, ...(await releaseClaim(referenceFor(state.ref))) })
      }
    }
    for (const entry of result.kept ?? []) {
      if (!entry.refused) continue
      const state = await resolve(entry.slice)
      const ref = state.known ? state.ref : entry.slice
      const reason = `worktree for ${ref} was kept: ${entry.reasons.join('; ')}`
      notified.push(
        await controlPeople().deliver({
          kind: 'worktree-kept',
          ref,
          stableId: state.known ? state.stableId : entry.slice,
          reason,
        }),
      )
    }
    return { ...result, claims, notified: notified.filter(Boolean) }
  }

  // The rig the reviewer must be on: with one delivery rig the configured rig; with several, the
  // rig that holds the item's claim (the rig that works it).
  async function reviewRigFor(reference) {
    if (!multi) return config.rig
    const holder = await holderOf(reference)
    return holder?.kind === 'rig' && holder.rig ? holder.rig : `(no rig holds the claim)`
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

    // Run by the entry seat of a delivery rig on its own pending offer row (or a row parked on a
    // bridge gate). The queue claim of the row serializes starts of the row (risk R4); a
    // concurrent start of the same item on the same rig stands down; the source claim decides
    // between rigs (#586). Uses only this rig's queue port. `resume`: take over an in-progress row
    // whose start died, once that start's lease has expired.
    async start(qitemId, { session, resume = false } = {}) {
      if (!session)
        throw new BridgeError('start requires the entry seat session', {
          status: 'usage',
          exitCode: 2,
        })
      const rig = startRig(session)
      const port = queueFor(rig)
      const people = peopleFor(port, rig)
      const row = await port.show(qitemId)
      const intake = parseIntakeBody(row?.body)
      if (!row || !intake) throw new BridgeError(`qitem ${qitemId} is not an AgentFlow intake row`)
      // An offer belongs to the rig it was made to, including a rig since removed from the
      // configuration: no other rig starts it.
      const rowRig = callerSeat(row.destination)?.rig ?? null
      if (rowRig && rowRig !== rig) {
        throw new BridgeError(`qitem ${qitemId} is offered to ${rowRig}, not ${rig}`, {
          status: 'refused',
        })
      }
      let claimed = await claimRow(port, qitemId, session)
      let resumed = false
      if (!claimed && resume && row.state === 'in-progress') {
        claimed = await resumeRow(port, row, intake.stableId, session)
        resumed = Boolean(claimed)
      }
      if (!claimed) return { status: 'already-started', qitemId, state: row.state }
      await takeLease(port, qitemId, session)
      const progress = { instanceId: null, claimed: null }
      try {
        const result = await startClaimed({
          port,
          rig,
          row: resumed ? { ...row, state: 'in-progress', blockedOn: null } : row,
          intake,
          qitemId,
          session,
          progress,
          people,
        })
        return resumed ? { ...result, resumed: true } : result
      } catch (error) {
        await recoverStart({ port, row, intake, qitemId, session, progress, error, people })
        throw error
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
          rig: await reviewRigFor(reference),
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
      let items = await listItems('open')
      if (!items) {
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
        failed: [],
        worktrees: null,
      }
      // One workflow listing and one live-row index per run, reused for every item.
      const listed = await listAllWorkflows()
      const index = await liveIndex()
      if (!dryRun) {
        try {
          if (await syncGateMarkers(items, index, listed)) items = await listItems('open')
        } catch (error) {
          report.failed.push({ stage: 'gate-markers', error: error.message })
        }
      }
      const pass = { items, admitted: 0 }
      const openIds = new Set()
      for (const workItem of items) {
        const parsed = parseSourceRef(workItem.ref)
        const stableId = stableQueueId(parsed)
        openIds.add(stableId)
        try {
          await reconcileItem({ workItem, parsed, stableId, index, listed, dryRun, report, pass })
        } catch (error) {
          report.failed.push({ ref: workItem.ref, stableId, error: error.message })
        }
      }
      await settleStrays(openIds, dryRun, report, listed)
      if (worktrees?.sweep) {
        try {
          report.worktrees = await sweepWorktrees({ items, dryRun })
        } catch (error) {
          report.failed.push({ stage: 'worktree-sweep', error: error.message })
        }
      }
      const status = report.failed.length
        ? 'reconciled-with-errors'
        : dryRun
          ? 'dry-run'
          : 'reconciled'
      return withTrust({ status, ...report })
    },

    // Removes the slice worktree of a merged item under the safety rule and releases the claim.
    // Run on a delivery rig it tells a person through that rig's own queue, never the control rig.
    async cleanup(refText, { session = null } = {}) {
      const { workItem, stableId } = await readItem(refText)
      const base = { ref: workItem.ref, stableId }
      if (workItem.lifecycle !== 'merged') {
        return {
          ...base,
          status: 'not-ready',
          reasons: [`lifecycle is ${workItem.lifecycle}, not merged`],
        }
      }
      if (!worktrees?.cleanup) return { ...base, status: 'no-worktrees' }
      const callerRig = callerSeat(session)?.rig
      const rig = deliveryRigs.includes(callerRig) ? callerRig : controlRig
      const worktree = await cleanupWorktree(workItem, stableId, peopleFor(queueFor(rig), rig))
      const status = worktree?.status === 'kept' ? 'kept' : 'cleaned'
      return { ...base, status, worktree }
    },

    // Releases an item's source claim. A gate-resolving call (a named caller outside the delivery
    // rigs). A claim held by a configured delivery rig is released only for a roster person
    // (`person`, a roster id); a claim held by a rig no longer in rigs.delivery may be released by
    // any such caller, so work held by a removed rig can move on.
    async release(refText, { session = null, person = null } = {}) {
      refuseWorkerSession(session)
      const { reference, workItem, stableId } = await readItem(refText)
      if (!canClaim()) {
        throw new BridgeError(`source adapter ${source.id} does not declare claim`, {
          status: 'capability-absent',
        })
      }
      const holder = await holderOf(reference)
      const base = { ref: workItem.ref, stableId }
      if (!holder) return { ...base, status: 'free', holder: null }
      const configured = holder.kind === 'rig' && deliveryRigs.includes(holder.rig)
      if (configured) {
        if (!person || !roster || !personById(roster, person)) {
          throw new BridgeError(
            `${holderName(holder)} is a configured delivery rig; releasing its claim needs a roster person (--person <roster id>)`,
            { status: 'refused' },
          )
        }
      }
      const result = await releaseClaim(reference)
      return {
        ...base,
        status: result?.released ? 'released' : 'free',
        holder,
        ...(configured ? { releasedFor: person } : {}),
      }
    },

    async escalate(refText, { reason } = {}) {
      if (!reason)
        throw new BridgeError('escalate requires a reason', { status: 'usage', exitCode: 2 })
      const parsed = parseRef(refText)
      const stableId = stableQueueId(parsed)
      const delivered = await controlPeople().deliver({
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
        bridgeSession,
        source: source.id,
        limits: describeSourceLimits(source),
        predicate: config.ready,
        entrySeat: config.entrySeat,
        evidenceWriters,
        workflowSpec: config.workflowSpec,
        worktrees: worktrees?.settings ?? null,
        partition: config.partition ?? null,
        roster: roster ? 'team-roster' : 'single-person',
        queue: await controlQueue().available(),
        at: clock().toISOString(),
      })
    },
  }
}

export { LIVE_ROW_STATES }
