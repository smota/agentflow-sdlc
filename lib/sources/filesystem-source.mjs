// Multi-item filesystem source adapter (#580). It implements SourceAdapter version 1 with every
// optional capability, so it runs the contract suite and backs local and test setups. It is not
// the single-goal filesystem medium (lib/sources/filesystem-medium.mjs), whose contract differs.
//
// Layout under root:
//   items/<id>/item.json   { id, title, body, labels, lifecycle, status, partOf, changeClass }
//   items/<id>/log.jsonl   append-only { seq, at, writer, type: comment|claim|release, body?|entry?, key? }
//   items/<id>/claim.lock  claim mirror { holder, at }: written, never used to decide a claim
//   watch.jsonl            global change feed { ref, at }; the cursor is a line count
//   receipts.json          default durable mutation receipt store
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
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
import { createFileSourceReceiptStore } from './receipt-store.mjs'

const SYSTEM = 'filesystem'
const SCOPE = 'local'
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const LIFECYCLES = ['open', 'closed', 'merged']
const LOCK_WAIT_MS = 5
const LOCK_ATTEMPTS = 400
const MAX_STALE_RETRIES = 3
const GATE_MARKER = /<!-- agentflow-gate:(waiting|closed):([^\s>]+) -->/g
const OPERATIONS = {
  'add-comment': 'mutate-comments',
  'append-claim-entry': 'mutate-comments',
  'update-item': 'mutate-artifacts',
  'set-lifecycle': 'mutate-lifecycle',
}
const ITEM_FIELDS = ['title', 'body', 'labels', 'status', 'partOf', 'changeClass']

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

// Exclusive per-item guard so log seq numbers and item rewrites never interleave.
function withItemLock(root, id, operation) {
  const lock = join(itemDir(root, id), '.log.lock')
  let descriptor
  for (let attempt = 0; descriptor === undefined; attempt += 1) {
    try {
      descriptor = openSync(lock, 'wx', 0o600)
    } catch (error) {
      if (error?.code !== 'EEXIST' || attempt >= LOCK_ATTEMPTS) throw error
      sleep(LOCK_WAIT_MS)
    }
  }
  try {
    return operation()
  } finally {
    closeSync(descriptor)
    unlinkSync(lock)
  }
}

function readLog(root, id) {
  const path = join(itemDir(root, id), 'log.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
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
  trustedWriters = [writer],
  receiptStore,
  clock = () => new Date(),
} = {}) {
  if (!root) throw new Error('filesystem source root is required')
  if (typeof writer !== 'string' || !writer) throw new Error('filesystem source writer is required')
  const base = resolve(root)
  const store = receiptStore ?? createFileSourceReceiptStore(join(base, 'receipts.json'))
  const trusted = [...trustedWriters]
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
    return withItemLock(base, id, () => {
      const log = readLog(base, id)
      const at = now()
      const row = { seq: (log.at(-1)?.seq ?? 0) + 1, at, writer, ...line }
      appendFileSync(join(itemDir(base, id), 'log.jsonl'), `${JSON.stringify(row)}\n`)
      recordChange(base, id, at)
      return row
    })
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
    else if (existsSync(path)) unlinkSync(path)
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
      try {
        const receipt = await adapter.applyMutation(plan, { confirm: plan.token })
        await adapter.flushReceipt(receipt)
        return receipt
      } catch (error) {
        if (error?.code !== 'source-plan-stale') throw error
        lastError = error
      }
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
    return withItemLock(base, id, () => {
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
    })
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
      const stored = await store.get(plan.idempotencyKey)
      if (stored) return stored
      const id = idOf({ id: plan.parameters?.id })
      const existing = readLog(base, id).find((row) => row.key === plan.idempotencyKey)
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

    // Idempotent per owner: when the owner's latest trusted entry is a claim, nothing is appended.
    async claim(reference, owner) {
      const id = idOf(reference)
      const latest = claimRows(id)
        .filter((row) => trusted.includes(row.writer) && !claimEntryProblems(row.entry).length)
        .filter((row) => ownersEqual(row.entry.owner, owner))
        .at(-1)
      if (latest?.entry.type === 'claim') {
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
