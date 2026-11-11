// In-memory QueuePort (#582) that reproduces the OpenRig id semantics the bridge relies on:
// a repeated create with the same id, destination and source returns the stored row
// (`created: false`, even when terminal); the same id on another route throws `qitem_id_reuse`.
// Workflow instances keep a frontier of packet rows. Tests use rows(), instances() and wipe().
import { QueuePortError } from './queue-port.mjs'

const STATES = ['pending', 'in-progress', 'done', 'blocked', 'failed', 'denied', 'canceled']
const CLOSURE_REASONS = [
  'handed_off_to',
  'denied',
  'canceled',
  'no-follow-on',
  'escalation',
  'superseded',
]
const TYPED_GATE = /^(external|fold|auth):/

function copy(value) {
  return structuredClone(value)
}

// options.refuseProjection(input) → message | null simulates a daemon that refuses to project a
// step on another session's behalf (risk R5, assumption A3).
export function createMemoryQueuePort({ refuseProjection = null } = {}) {
  let rows = new Map()
  let instances = new Map()
  let counter = 0
  const log = []

  function requireRow(id) {
    const row = rows.get(id)
    if (!row) throw new QueuePortError(`qitem ${id} not found`, { code: 'not-found' })
    return row
  }

  function insert(input) {
    const tags = [...(input.tags ?? [])]
    if (input.mission && !tags.includes(`mission:${input.mission}`))
      tags.unshift(`mission:${input.mission}`)
    if (input.slice && !tags.includes(`slice:${input.slice}`)) tags.unshift(`slice:${input.slice}`)
    const row = {
      qitemId: input.id,
      state: 'pending',
      destination: input.destination,
      source: input.source,
      tags,
      blockedOn: null,
      body: input.body ?? '',
      summary: input.summary ?? null,
      tier: input.tier ?? null,
      priority: input.priority ?? 'routine',
      humanIntent: input.humanIntent ?? null,
      evidenceRef: input.evidenceRef ?? null,
      closureReason: null,
      closureTarget: null,
      resolution: null,
      notes: [],
    }
    rows.set(row.qitemId, row)
    return row
  }

  const port = {
    async available() {
      return { ok: true }
    },

    async create(input) {
      log.push(['create', input.id])
      const existing = rows.get(input.id)
      if (existing) {
        if (existing.destination === input.destination && existing.source === input.source) {
          return { qitemId: existing.qitemId, state: existing.state, created: false }
        }
        throw new QueuePortError(`qitem ${input.id} already exists for another route`, {
          code: 'qitem_id_reuse',
        })
      }
      const row = insert(input)
      return { qitemId: row.qitemId, state: row.state, created: true }
    },

    async show(id) {
      return rows.has(id) ? copy(rows.get(id)) : null
    },

    async list({ tag = null, states = null } = {}) {
      return [...rows.values()]
        .filter((row) => !tag || row.tags.includes(tag))
        .filter((row) => !states?.length || states.includes(row.state))
        .map(copy)
    },

    async update(id, { state, closureReason, closureTarget, note, resolution } = {}) {
      log.push(['update', id, state])
      const row = requireRow(id)
      if (state && !STATES.includes(state)) throw new QueuePortError(`invalid state ${state}`)
      if (state === 'done' && !CLOSURE_REASONS.includes(closureReason)) {
        throw new QueuePortError('state=done requires a closure reason')
      }
      if (state) row.state = state
      if (state && state !== 'blocked') row.blockedOn = null
      if (closureReason) row.closureReason = closureReason
      if (closureTarget) row.closureTarget = closureTarget
      if (resolution) row.resolution = resolution
      if (note) row.notes.push(note)
      return copy(row)
    },

    async block(id, { on, wakeAfter, continuation, note } = {}) {
      log.push(['block', id, on])
      const row = requireRow(id)
      if (!on) throw new QueuePortError('block requires --on')
      row.state = 'blocked'
      row.blockedOn = on
      row.wakeAfter = wakeAfter ?? null
      row.continuation = continuation ?? null
      if (note) row.notes.push(note)
      return copy(row)
    },

    async resolve(id, { decision } = {}) {
      log.push(['resolve', id])
      const row = requireRow(id)
      if (row.state !== 'blocked' || !TYPED_GATE.test(row.blockedOn ?? '')) {
        throw new QueuePortError(`qitem ${id} is not parked on a typed gate`)
      }
      if (!decision) throw new QueuePortError('resolve requires a decision')
      row.state = 'in-progress'
      row.blockedOn = null
      row.notes.push(decision)
      return copy(row)
    },

    async instantiateWorkflow(input) {
      log.push(['instantiate', input.slice])
      counter += 1
      const instanceId = `wf-${counter}`
      const packet = insert({
        id: `${instanceId}-p1`,
        destination: input.entryOwner,
        source: input.createdBy,
        body: `workflow ${instanceId} step 1`,
        tags: input.tags,
        mission: input.mission,
        slice: input.slice,
      })
      instances.set(instanceId, {
        instanceId,
        status: 'active',
        tags: [...(input.tags ?? [])],
        frontier: [packet.qitemId],
        hops: 1,
        specPath: input.specPath,
        rig: input.rig,
      })
      return { instanceId, entryQitemId: packet.qitemId }
    },

    async listWorkflows({ tag = null } = {}) {
      return [...instances.values()].filter((item) => !tag || item.tags.includes(tag)).map(copy)
    },

    async projectWorkflow({ instanceId, packetId, exit, note, actorSession }) {
      log.push(['project', instanceId, packetId, exit])
      const instance = instances.get(instanceId)
      if (!instance) throw new QueuePortError(`workflow ${instanceId} not found`)
      if (!instance.frontier.includes(packetId)) {
        throw new QueuePortError(`packet ${packetId} is not on the frontier of ${instanceId}`)
      }
      const refusal = refuseProjection?.({ instanceId, packetId, exit, actorSession }) ?? null
      if (refusal) throw new QueuePortError(refusal, { code: 'projection-refused' })
      const packet = requireRow(packetId)
      packet.state = 'done'
      packet.closureReason = 'handed_off_to'
      if (note) packet.notes.push(note)
      if (exit !== 'handoff') {
        instance.frontier = []
        instance.status = exit === 'done' ? 'completed' : exit === 'failed' ? 'failed' : 'waiting'
        return { nextQitemId: null }
      }
      instance.hops += 1
      const next = insert({
        id: `${instanceId}-p${instance.hops}`,
        destination: packet.destination,
        source: packet.destination,
        body: `workflow ${instanceId} step ${instance.hops}`,
        tags: instance.tags,
      })
      packet.closureTarget = next.qitemId
      instance.frontier = [next.qitemId]
      return { nextQitemId: next.qitemId }
    },

    async abortWorkflow(instanceId) {
      log.push(['abort', instanceId])
      const instance = instances.get(instanceId)
      if (!instance) throw new QueuePortError(`workflow ${instanceId} not found`)
      for (const id of instance.frontier) {
        const row = rows.get(id)
        if (row) {
          row.state = 'canceled'
          row.blockedOn = null
        }
      }
      instance.frontier = []
      instance.status = 'aborted'
      return { status: 'aborted' }
    },

    // Test helpers.
    rows: () => [...rows.values()].map(copy),
    instances: () => [...instances.values()].map(copy),
    calls: () => log.map(copy),
    wipe() {
      rows = new Map()
      instances = new Map()
    },
  }
  return port
}
