// QueuePort (#582): the only way the bridge reaches the OpenRig queue and workflow runtime. The
// bridge never runs `rig` itself; it is handed a port. Two implementations exist:
//   createRigCliQueuePort (here)          calls the `rig` CLI through an injected exec function
//   createMemoryQueuePort (memory-queue)  in-memory, for tests and dry runs
//
// Port methods (all async):
//   available()                         → { ok: true } | { ok: false, reason }
//   create({ id, destination, source, summary, body, tags, tier, priority, humanIntent,
//            evidenceRef, mission, slice })   → { qitemId, state, created }
//   show(id)                            → row | null
//   list({ tag, states })               → rows (every rig, every state unless `states` narrows)
//   update(id, { state, closureReason, closureTarget, note, resolution })
//   block(id, { on, wakeAfter, continuation, note })
//   resolve(id, { decision })
//   instantiateWorkflow({ specPath, rig, slice, mission, tags, entryOwner, createdBy,
//                         rootObjective }) → { instanceId, entryQitemId }
//   listWorkflows({ tag })              → instances
//   projectWorkflow({ instanceId, packetId, exit, note, actorSession, blockedOn })
//                                       → { nextQitemId }
//   abortWorkflow(instanceId, { reason })
//
// A row is { qitemId, state, destination, source, tags, blockedOn, body, summary,
// closureReason, closureTarget }. An instance is { instanceId, status, tags, frontier }.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const QUEUE_PORT_METHODS = [
  'available',
  'create',
  'show',
  'list',
  'update',
  'block',
  'resolve',
  'instantiateWorkflow',
  'listWorkflows',
  'projectWorkflow',
  'abortWorkflow',
]

export function queuePortProblems(port) {
  return QUEUE_PORT_METHODS.filter((name) => typeof port?.[name] !== 'function').map(
    (name) => `queue port is missing ${name}()`,
  )
}

export class QueuePortError extends Error {
  constructor(message, { code = 'queue-failed', detail = null } = {}) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    // Some commands print a JSON document followed by advisories; take the first line that parses.
    for (const line of text.split('\n')) {
      try {
        return JSON.parse(line)
      } catch {
        /* keep looking */
      }
    }
    return null
  }
}

function asArray(value, key) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.[key])) return value[key]
  return []
}

export function normalizeRow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const item = raw.item && typeof raw.item === 'object' ? raw.item : raw
  if (typeof item.qitemId !== 'string') return null
  return {
    qitemId: item.qitemId,
    state: item.state ?? null,
    destination: item.destinationSession ?? item.destination ?? null,
    source: item.sourceSession ?? item.source ?? null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    blockedOn: item.blockedOn ?? null,
    body: typeof item.body === 'string' ? item.body : null,
    summary: item.summary ?? null,
    closureReason: item.closureReason ?? null,
    closureTarget: item.closureTarget ?? null,
  }
}

export function normalizeInstance(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.instanceId !== 'string') return null
  return {
    instanceId: raw.instanceId,
    status: raw.status ?? null,
    tags: raw.scope?.tags ?? raw.tags ?? [],
    frontier: raw.currentFrontier ?? raw.frontier ?? [],
  }
}

// exec(file, args, options) must resolve to { stdout, stderr } and reject with an error carrying
// `code` (e.g. 'ENOENT') and, for a non-zero exit, `stdout`. util.promisify(execFile) fits; the
// port never uses a shell.
export function createRigCliQueuePort({ exec, cwd, env, rigBinary = 'rig' } = {}) {
  if (typeof exec !== 'function') throw new Error('createRigCliQueuePort requires an exec function')
  const options = { encoding: 'utf8', cwd, env, shell: false, maxBuffer: 64 * 1024 * 1024 }

  async function run(args) {
    try {
      const { stdout } = await exec(rigBinary, args, options)
      return parseJson(stdout)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new QueuePortError('rig not found on PATH', { code: 'rig-unavailable' })
      }
      const body = parseJson(error?.stdout)
      const message = body?.message ?? body?.error ?? error?.stderr?.trim() ?? error?.message
      throw new QueuePortError(`rig ${args.slice(0, 2).join(' ')} failed: ${message}`, {
        code: body?.error ?? 'queue-failed',
        detail: body,
      })
    }
  }

  async function withBodyFile(body, operation) {
    const dir = mkdtempSync(join(tmpdir(), 'agentflow-bridge-'))
    const path = join(dir, 'body.txt')
    writeFileSync(path, body ?? '', { mode: 0o600 })
    try {
      return await operation(path)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const port = {
    async available() {
      try {
        await exec(rigBinary, ['--version'], options)
        return { ok: true }
      } catch (error) {
        if (error?.code === 'ENOENT') return { ok: false, reason: 'rig not found on PATH' }
        return { ok: false, reason: error?.message ?? 'rig is not usable' }
      }
    },

    async show(id) {
      try {
        return normalizeRow(await run(['queue', 'show', id, '--full', '--json']))
      } catch (error) {
        if (error instanceof QueuePortError && /not.?found|404/i.test(error.message)) return null
        throw error
      }
    },

    // The daemon treats a repeated --id with the same destination and source as a re-delivery and
    // returns the stored row; it does not say whether it inserted. Reading first gives `created`.
    async create(input) {
      const existing = await port.show(input.id)
      if (existing) {
        if (existing.destination !== input.destination || existing.source !== input.source) {
          throw new QueuePortError(`qitem ${input.id} already exists for another route`, {
            code: 'qitem_id_reuse',
          })
        }
        return { qitemId: existing.qitemId, state: existing.state, created: false }
      }
      return withBodyFile(input.body, async (bodyFile) => {
        const args = ['queue', 'create', '--id', input.id, '--destination', input.destination]
        args.push('--source', input.source, '--body-file', bodyFile)
        if (input.summary) args.push('--summary', input.summary)
        if (input.tags?.length) args.push('--tags', input.tags.join(','))
        if (input.tier) args.push('--tier', input.tier)
        args.push('--priority', input.priority ?? 'routine')
        if (input.humanIntent) args.push('--human-intent', input.humanIntent)
        if (input.evidenceRef) args.push('--evidence-ref', input.evidenceRef)
        if (input.mission) args.push('--mission', String(input.mission))
        if (input.slice) args.push('--slice', input.slice)
        args.push('--json')
        const row = normalizeRow(await run(args))
        return { qitemId: row?.qitemId ?? input.id, state: row?.state ?? 'pending', created: true }
      })
    },

    async list({ tag = null, states = null } = {}) {
      const args = ['queue', 'list', '-a', '-A', '--full', '-o', 'json']
      if (states?.length) args.push('--state', states.join(','))
      const rows = asArray(await run(args), 'items')
        .map(normalizeRow)
        .filter(Boolean)
      return tag ? rows.filter((row) => row.tags.includes(tag)) : rows
    },

    async update(id, { state, closureReason, closureTarget, note, resolution } = {}) {
      const args = ['queue', 'update', id]
      if (state) args.push('--state', state)
      if (closureReason) args.push('--closure-reason', closureReason)
      if (closureTarget) args.push('--closure-target', closureTarget)
      if (note) args.push('--note', note)
      if (resolution) args.push('--resolution', resolution)
      args.push('--json')
      return normalizeRow(await run(args))
    },

    async block(id, { on, wakeAfter, continuation, note } = {}) {
      const args = ['queue', 'block', id, '--on', on]
      if (wakeAfter) args.push('--wake-after', wakeAfter)
      if (continuation) args.push('--continuation', continuation)
      if (note) args.push('--note', note)
      args.push('--json')
      return normalizeRow(await run(args))
    },

    async resolve(id, { decision } = {}) {
      return normalizeRow(await run(['queue', 'resolve', id, '--decision', decision, '--json']))
    },

    async instantiateWorkflow(input) {
      const args = ['workflow', 'instantiate', input.specPath]
      args.push('--root-objective', input.rootObjective, '--created-by', input.createdBy)
      if (input.entryOwner) args.push('--entry-owner', input.entryOwner)
      if (input.rig) args.push('--rig', input.rig)
      if (input.mission) args.push('--mission', String(input.mission))
      if (input.slice) args.push('--slice', input.slice)
      if (input.tags?.length) args.push('--tags', input.tags.join(','))
      args.push('--json')
      const result = await run(args)
      return {
        instanceId: result?.instance?.instanceId ?? result?.instanceId ?? null,
        entryQitemId: result?.entryQitemId ?? null,
      }
    },

    async listWorkflows({ tag = null } = {}) {
      const instances = asArray(await run(['workflow', 'list', '--json']), 'instances')
        .map(normalizeInstance)
        .filter(Boolean)
      return tag ? instances.filter((instance) => instance.tags.includes(tag)) : instances
    },

    async projectWorkflow({ instanceId, packetId, exit, note, actorSession, blockedOn }) {
      const args = ['workflow', 'project', '--instance', instanceId]
      args.push('--current-packet', packetId, '--exit', exit)
      if (note) args.push('--result-note', note)
      if (actorSession) args.push('--actor-session', actorSession)
      if (blockedOn) args.push('--blocked-on', blockedOn)
      args.push('--json')
      const result = await run(args)
      const frontier = result?.instance?.currentFrontier ?? result?.currentFrontier ?? []
      return { nextQitemId: result?.nextQitemId ?? frontier[0] ?? null }
    },

    async abortWorkflow(instanceId, { reason = 'source item closed' } = {}) {
      return run(['workflow', 'abort', instanceId, '--reason', reason, '--json'])
    },
  }
  return port
}
