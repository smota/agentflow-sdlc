// Multi-item filesystem source adapter (#580). It implements SourceAdapter version 1 with every
// optional capability, so it runs the contract suite and backs local and test setups. It is not
// the single-goal filesystem medium (lib/sources/filesystem-medium.mjs), whose contract differs.
//
// Layout under root:
//   items/<id>/item.json   { id, title, body, labels, lifecycle, status, partOf, changeClass }
//   items/<id>/log.jsonl   append-only { seq, at, writer, type: comment|claim|release, body?|entry?, key? }
//   items/<id>/claim.lock  claim mirror { holder, at }: written, never used to decide a claim
//   watch.jsonl            global change feed { ref, at }; the cursor is a line count
//   receipts-<writer>.json default durable mutation receipt store, one per writer so writers never
//                          contend on it; a log entry's `key` is the authority for log mutations
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { recordDigest } from '../core/record-digest.mjs'
import { parseRolePassComment } from '../core/role-pass-evidence.mjs'
import {
  claimEntry,
  claimEntryProblems,
  ownersEqual,
  releaseEntry,
  resolveClaim,
} from '../core/source-claim.mjs'
import {
  READY_PREDICATE_KINDS,
  SOURCE_CAPABILITIES,
  createSourceMutationPlan,
  createSourceMutationReceipt,
  sourceMutationIdempotencyKey,
  validateSourceMutationPlan,
} from '../core/source-adapter.mjs'
import { formatSourceRef } from '../core/source-ref.mjs'
import { createFileSourceReceiptStore, processIsAlive } from './receipt-store.mjs'

const SYSTEM = 'filesystem'
const SCOPE = 'local'
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const LIFECYCLES = ['open', 'closed', 'merged']
const LOCK_WAIT_MS = 5
const LOCK_ATTEMPTS = 400
const LOCK_STALE_MS = 30_000
const MAX_STALE_RETRIES = 3
const GATE_MARKER = /<!-- agentflow-gate:(waiting|closed):([^\s>]+) -->/g
const OPERATIONS = {
  'add-comment': 'mutate-comments',
  'append-claim-entry': 'mutate-comments',
  'update-item': 'mutate-artifacts',
  'set-lifecycle': 'mutate-lifecycle',
}
const ITEM_FIELDS = ['title', 'body', 'labels', 'status', 'partOf', 'changeClass']
const LOG_OPERATIONS = new Set(['add-comment', 'append-claim-entry'])

function itemsDir(root) {
  return join(root, 'items')
}

function itemDir(root, id) {
  if (!ITEM_ID.test(id ?? '')) throw new Error(`invalid filesystem item id: ${id}`)
  return join(itemsDir(root), id)
}

function refText(id) {
  return formatSourceRef({ system: SYSTEM, scope: SCOPE, id })
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function writeJsonAtomic(path, value) {
  const staged = `${path}.${process.pid}.tmp`
  writeFileSync(staged, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(staged, path)
}

function normalizeItem(fields) {
  const labels = [...new Set(fields.labels ?? [])]
  if (!labels.every((label) => typeof label === 'string' && label.length > 0)) {
    throw new Error('labels must be non-empty strings')
  }
  if (!LIFECYCLES.includes(fields.lifecycle)) {
    throw new Error(`lifecycle must be one of ${LIFECYCLES.join('|')}`)
  }
  return {
    id: fields.id,
    title: String(fields.title ?? ''),
    body: String(fields.body ?? ''),
    labels,
    lifecycle: fields.lifecycle,
    status: fields.status ?? null,
    partOf: fields.partOf === null || fields.partOf === undefined ? null : String(fields.partOf),
    changeClass: fields.changeClass ?? null,
  }
}

function recordChange(root, id, at) {
  appendFileSync(join(root, 'watch.jsonl'), `${JSON.stringify({ ref: refText(id), at })}\n`)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function lockFacts(path) {
  try {
    const stat = statSync(path)
    return { mtimeMs: stat.mtimeMs, size: stat.size, owner: readJson(path) }
  } catch {
    return null
  }
}

// Whether a lock can be removed. A lock from another host is never stale here: process liveness is
// only known for this host's PID namespace. An owner written on this host is stale when its process
// is gone. A lock with no readable owner (a crash between creating and writing it) is stale only
// once it is older than staleMs.
function lockIsStale(facts, staleMs, now = Date.now()) {
  if (!facts) return false
  const { owner } = facts
  if (owner?.pid) {
    if (owner.host && owner.host !== hostname()) return false
    return !processIsAlive(owner.pid)
  }
  return now - facts.mtimeMs > staleMs
}

const sameLock = (a, b) =>
  Boolean(a && b) &&
  (a.owner?.id
    ? a.owner.id === b.owner?.id
    : !b.owner && a.mtimeMs === b.mtimeMs && a.size === b.size)

// Stale locks are removed under a recovery guard, the same discipline as the file receipt store. A
// guard left by a crash during recovery is itself removed once it is older than staleMs.
function recoverStaleLock(lock, staleMs) {
  const recovery = `${lock}.recovery`
  const guardFacts = lockFacts(recovery)
  if (guardFacts) {
    if (Date.now() - guardFacts.mtimeMs <= staleMs) return
    rmSync(recovery, { force: true })
  }
  const current = lockFacts(lock)
  if (!lockIsStale(current, staleMs)) return
  let guard
  try {
    guard = openSync(recovery, 'wx', 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') return
    throw error
  }
  try {
    const again = lockFacts(lock)
    if (sameLock(current, again) && lockIsStale(again, staleMs)) rmSync(lock, { force: true })
  } finally {
    closeSync(guard)
    rmSync(recovery, { force: true })
  }
}

function lockHeldError(lock) {
  const facts = lockFacts(lock)
  const holder = facts?.owner?.pid
    ? `pid ${facts.owner.pid} on host ${facts.owner.host ?? 'unknown'}`
    : 'no readable owner'
  const error = new Error(
    `filesystem source item lock ${lock} is still held (${holder}). If no process using this ` +
      `source root is running, delete ${lock} and ${lock}.recovery, then retry.`,
  )
  error.code = 'source-lock-held'
  return error
}

// Exclusive per-item guard so log seq numbers and item rewrites never interleave.
function withItemLock(
  root,
  id,
  operation,
  { staleMs = LOCK_STALE_MS, attempts = LOCK_ATTEMPTS } = {},
) {
  const lock = join(itemDir(root, id), '.log.lock')
  const owner = { pid: process.pid, host: hostname(), id: randomUUID() }
  let descriptor
  for (let attempt = 0; descriptor === undefined; attempt += 1) {
    try {
      descriptor = openSync(lock, 'wx', 0o600)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      recoverStaleLock(lock, staleMs)
      if (attempt >= attempts) throw lockHeldError(lock)
      sleep(LOCK_WAIT_MS)
    }
  }
  try {
    writeFileSync(descriptor, JSON.stringify(owner))
    return operation()
  } finally {
    closeSync(descriptor)
    if (readJson(lock)?.id === owner.id) rmSync(lock, { force: true })
  }
}

// A trailing line without its newline is a write cut short by a crash: it is not an entry yet and
// is skipped. A malformed line before the end is corruption and throws.
function readLog(root, id) {
  const path = join(itemDir(root, id), 'log.jsonl')
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').split('\n')
  return lines
    .slice(0, -1)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

// Under the item lock: cut a torn trailing line so the next entry starts on its own line.
function dropTornTail(path) {
  if (!existsSync(path)) return
  const content = readFileSync(path)
  if (content.length === 0 || content[content.length - 1] === 0x0a) return
  truncateSync(path, content.lastIndexOf(0x0a) + 1)
}

function writerStoreName(writer) {
  const slug = writer
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const hash = createHash('sha256').update(writer).digest('hex').slice(0, 8)
  return `receipts-${slug ? `${slug}-` : ''}${hash}.json`
}

function readItem(root, id) {
  const path = join(itemDir(root, id), 'item.json')
  if (!existsSync(path)) throw new Error(`filesystem item ${id} not found`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function contentRevision(item) {
  return recordDigest({
    title: item.title,
    body: item.body,
    lifecycle: item.lifecycle,
    labels: [...item.labels].sort(),
    status: item.status,
  })
}

export function createFilesystemWorkItem(
  root,
  {
    id,
    title,
    body = '',
    labels = [],
    lifecycle = 'open',
    status = null,
    partOf = null,
    changeClass = null,
  } = {},
) {
  const base = resolve(root)
  const dir = itemDir(base, id)
  const item = normalizeItem({ id, title, body, labels, lifecycle, status, partOf, changeClass })
  mkdirSync(itemsDir(base), { recursive: true })
  mkdirSync(dir)
  writeJsonAtomic(join(dir, 'item.json'), item)
  writeFileSync(join(dir, 'log.jsonl'), '', { flag: 'wx' })
  recordChange(base, id, new Date().toISOString())
  return refText(id)
}

export function createFilesystemSourceAdapter({
  root,
  writer,
  trustedWriters,
  receiptStore,
  clock = () => new Date(),
  lockStaleMs = LOCK_STALE_MS,
  lockAttempts = LOCK_ATTEMPTS,
} = {}) {
  if (!root) throw new Error('filesystem source root is required')
  if (typeof writer !== 'string' || !writer) throw new Error('filesystem source writer is required')
  const base = resolve(root)
  // Claim resolution trusts exactly this list. A default of [writer] would let two writers on one
  // root each ignore the other and both win, so the list is required.
  if (!Array.isArray(trustedWriters) || trustedWriters.length === 0) {
    throw new Error(
      'filesystem source requires trustedWriters: the writers whose claims count, shared by every writer on the root',
    )
  }
  const store = receiptStore ?? createFileSourceReceiptStore(join(base, writerStoreName(writer)))
  const trusted = [...trustedWriters]
  const locking = { staleMs: lockStaleMs, attempts: lockAttempts }
  const applied = new Map()
  const flushed = new Set()
  const now = () => clock().toISOString()
  const idOf = (reference) => {
    if (!reference || typeof reference.id !== 'string') {
      throw new Error('filesystem source reference must be { id }')
    }
    itemDir(base, reference.id)
    return reference.id
  }

  function append(id, line) {
    return withItemLock(
      base,
      id,
      () => {
        const path = join(itemDir(base, id), 'log.jsonl')
        dropTornTail(path)
        const log = readLog(base, id)
        const at = now()
        const row = { seq: (log.at(-1)?.seq ?? 0) + 1, at, writer, ...line }
        appendFileSync(path, `${JSON.stringify(row)}\n`)
        recordChange(base, id, at)
        return row
      },
      locking,
    )
  }

  function rowUri(id, seq) {
    return `${refText(id)}/log/${seq}`
  }

  function claimRows(id) {
    return readLog(base, id)
      .filter((row) => row.type === 'claim' || row.type === 'release')
      .map((row) => ({
        entry: row.entry,
        writer: row.writer,
        position: row.seq,
        uri: rowUri(id, row.seq),
      }))
  }

  function readMirror(id) {
    const path = join(itemDir(base, id), 'claim.lock')
    if (!existsSync(path)) return { present: false, value: null }
    try {
      return { present: true, value: JSON.parse(readFileSync(path, 'utf8')) }
    } catch {
      return { present: true, value: null }
    }
  }

  function writeMirror(id, state) {
    const path = join(itemDir(base, id), 'claim.lock')
    if (state.status === 'held') writeJsonAtomic(path, { holder: state.holder, at: now() })
    else rmSync(path, { force: true })
  }

  function claimState(id) {
    const state = resolveClaim(claimRows(id), { trustedWriters: trusted })
    // The mirror is reported for people and repair; it never changes status or holder.
    const mirror = readMirror(id)
    const diverged =
      state.status === 'held' ? !ownersEqual(mirror.value?.holder, state.holder) : mirror.present
    return { ...state, mirror: { value: mirror.value, diverged } }
  }

  async function mutate(operation, parameters) {
    let lastError
    for (let attempt = 0; attempt < MAX_STALE_RETRIES; attempt += 1) {
      const plan = await adapter.previewMutation({
        operation,
        parameters,
        actionBoundary: { effective: 'external-action' },
      })
      let receipt
      try {
        receipt = await adapter.applyMutation(plan, { confirm: plan.token })
      } catch (error) {
        if (error?.code !== 'source-plan-stale') throw error
        lastError = error
        continue
      }
      try {
        await adapter.flushReceipt(receipt)
      } catch (error) {
        // The log entry carries the idempotency key, so a committed log mutation stays recoverable
        // without its receipt; failing here would report an error for an entry that landed.
        const committed = readLog(base, parameters.id).some(
          (row) => row.key === plan.idempotencyKey,
        )
        if (!LOG_OPERATIONS.has(operation) || !committed) throw error
      }
      return receipt
    }
    throw lastError
  }

  async function appendClaimEntry(id, entry) {
    await mutate('append-claim-entry', { id, entry })
    const state = claimState(id)
    writeMirror(id, state)
    return claimState(id)
  }

  function workItem(id) {
    const item = readItem(base, id)
    const transitions = []
    const waiting = new Set()
    const closed = new Set()
    for (const row of readLog(base, id)) {
      if (row.type !== 'comment') continue
      const record = parseRolePassComment(row.body, {
        writer: row.writer,
        uri: rowUri(id, row.seq),
      })
      if (record) {
        transitions.push({
          phase: record.phase,
          status: record.status,
          seat: record.seat,
          role: record.role,
          idempotencyKey: record.idempotencyKey,
          uri: record.uri,
          writer: record.writer,
          executedBy: record.executedBy,
          launcher: record.launcher,
          executor: record.executor,
          transport: record.transport,
          delegationBoundary: record.delegationBoundary,
          model: record.model,
        })
      }
      for (const [, state, gate] of String(row.body ?? '').matchAll(GATE_MARKER)) {
        ;(state === 'waiting' ? waiting : closed).add(gate)
      }
    }
    return {
      version: 1,
      ref: refText(id),
      system: SYSTEM,
      scope: SCOPE,
      id,
      kind: 'item',
      title: item.title,
      lifecycle: item.lifecycle,
      labels: item.labels,
      status: item.status,
      partOf: item.partOf,
      changeClass: item.changeClass,
      revision: contentRevision(item),
      transitions,
      openGates: [...waiting].filter((gate) => !closed.has(gate)).length,
    }
  }

  function artifactRef(item) {
    return {
      kind: 'goal',
      system: SYSTEM,
      uri: refText(item.id),
      authority: 'authoritative',
      relationship: 'observes',
      scope: SCOPE,
      revision: contentRevision(item),
    }
  }

  function execute(plan) {
    const { id } = plan.parameters
    const key = plan.idempotencyKey
    if (plan.operation === 'add-comment') {
      if (typeof plan.parameters.body !== 'string') throw new Error('add-comment requires body')
      const row = append(id, { type: 'comment', body: plan.parameters.body, key })
      return { uri: rowUri(id, row.seq), seq: row.seq }
    }
    if (plan.operation === 'append-claim-entry') {
      const { entry } = plan.parameters
      const problems = claimEntryProblems(entry)
      if (problems.length) throw new Error(`invalid claim entry: ${problems.join('; ')}`)
      const row = append(id, { type: entry.type, entry, key })
      return { uri: rowUri(id, row.seq), seq: row.seq }
    }
    return withItemLock(
      base,
      id,
      () => {
        const current = readItem(base, id)
        const next =
          plan.operation === 'set-lifecycle'
            ? normalizeItem({ ...current, lifecycle: plan.parameters.lifecycle })
            : normalizeItem({
                ...current,
                ...Object.fromEntries(
                  ITEM_FIELDS.filter((field) => field in plan.parameters).map((field) => [
                    field,
                    plan.parameters[field],
                  ]),
                ),
              })
        writeJsonAtomic(join(itemDir(base, id), 'item.json'), next)
        recordChange(base, id, now())
        return { uri: refText(id) }
      },
      locking,
    )
  }

  const adapter = {
    version: 1,
    id: 'filesystem',
    system: SYSTEM,
    scope: SCOPE,
    writer,
    capabilities: [...SOURCE_CAPABILITIES],
    readyPredicateKinds: [...READY_PREDICATE_KINDS],
    claimMirror: 'lock-file',

    toReference({ system, scope, id } = {}) {
      if (system !== SYSTEM || scope !== SCOPE) {
        throw new Error(`filesystem source cannot resolve ${system}:${scope}`)
      }
      itemDir(base, id)
      return { id }
    },

    async readArtifact(reference) {
      const item = readItem(base, idOf(reference))
      return { artifact: item, ref: artifactRef(item) }
    },

    async listArtifacts() {
      return (await adapter.listWorkItems({ lifecycle: null })).map((item) => ({
        artifact: readItem(base, item.id),
        ref: artifactRef(readItem(base, item.id)),
      }))
    },

    async readWorkItem(reference) {
      return workItem(idOf(reference))
    },

    // lifecycle null lists every item.
    async listWorkItems({ lifecycle = 'open' } = {}) {
      if (!existsSync(itemsDir(base))) return []
      return readdirSync(itemsDir(base))
        .filter((id) => ITEM_ID.test(id) && existsSync(join(itemDir(base, id), 'item.json')))
        .sort()
        .map(workItem)
        .filter((item) => lifecycle === null || item.lifecycle === lifecycle)
    },

    async previewMutation({ operation, parameters, actionBoundary, idempotencyKey }) {
      const capability = OPERATIONS[operation]
      if (!capability) throw new Error(`unsupported filesystem mutation: ${operation}`)
      const id = idOf({ id: parameters?.id })
      return createSourceMutationPlan({
        adapter: this,
        scope: SCOPE,
        capability,
        operation,
        parameters,
        actionBoundary,
        expectedRevision: contentRevision(readItem(base, id)),
        idempotencyKey: idempotencyKey ?? sourceMutationIdempotencyKey(operation, parameters),
      })
    },

    async applyMutation(plan, { confirm } = {}) {
      validateSourceMutationPlan(plan, this, confirm)
      if (applied.has(plan.idempotencyKey)) return applied.get(plan.idempotencyKey)
      const id = idOf({ id: plan.parameters?.id })
      // For a log mutation the log key is the authority; only other mutations need the store.
      if (!LOG_OPERATIONS.has(plan.operation)) {
        const stored = await store.get(plan.idempotencyKey)
        if (stored) return stored
      }
      const existing = LOG_OPERATIONS.has(plan.operation)
        ? readLog(base, id).find((row) => row.key === plan.idempotencyKey)
        : null
      let result
      if (existing) {
        result = { recovered: true, uri: rowUri(id, existing.seq), seq: existing.seq }
      } else {
        if (contentRevision(readItem(base, id)) !== plan.expectedRevision) {
          const error = new Error('filesystem mutation plan is stale; the item changed')
          error.code = 'source-plan-stale'
          throw error
        }
        result = execute(plan)
      }
      const receipt = createSourceMutationReceipt(plan, result, contentRevision(readItem(base, id)))
      applied.set(plan.idempotencyKey, receipt)
      return receipt
    },

    async flushReceipt(receipt) {
      if (flushed.has(receipt.receiptToken)) return { status: 'already-flushed', receipt }
      await store.put(receipt)
      flushed.add(receipt.receiptToken)
      return { status: 'flushed', receipt }
    },

    // Idempotent per owner: when the owner already holds the item, nothing is appended. Any other
    // state (free, or held by another owner) appends, so a loser that never yielded can claim
    // again once the item is free.
    async claim(reference, owner) {
      const id = idOf(reference)
      if (ownersEqual(claimState(id).holder, owner)) {
        const state = claimState(id)
        writeMirror(id, state)
        return claimState(id)
      }
      return appendClaimEntry(id, claimEntry({ owner, at: now() }))
    },

    async release(reference, owner) {
      const id = idOf(reference)
      return appendClaimEntry(id, releaseEntry({ owner, at: now() }))
    },

    async readClaim(reference) {
      return claimState(idOf(reference))
    },

    async watch(cursor) {
      const path = join(base, 'watch.jsonl')
      const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : []
      const complete = lines.slice(0, -1)
      const start = cursor === null || cursor === undefined ? 0 : Number(cursor)
      if (!Number.isInteger(start) || start < 0) throw new Error(`invalid watch cursor: ${cursor}`)
      const refs = [...new Set(complete.slice(start).map((line) => JSON.parse(line).ref))]
      return { cursor: String(Math.max(start, complete.length)), refs }
    },

    async resolveHumans(writers) {
      return [...new Set(writers ?? [])].map((name) => ({
        writer: name,
        handle: { system: SYSTEM, login: name },
      }))
    },
  }
  return adapter
}
