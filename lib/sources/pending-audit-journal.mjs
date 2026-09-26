import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { requireDeliveryRecord } from '../core/delivery-record.mjs'

export const BUSINESS_CAPACITY = 8 * 1024 * 1024
export const SAFETY_CAPACITY = 64 * 1024
const SLOT_BYTES = 4096,
  HEADER_BYTES = 73
const hash = (value) => createHash('sha256').update(value).digest('hex')
const error = (code, message) => Object.assign(new Error(message), { code })
const validId = (id) =>
  typeof id === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/.test(id) &&
  !['__proto__', 'constructor', 'prototype'].includes(id)
const same = (a, b) => a.event.runId === b.runId && a.event.id === b.id

/** Local pending evidence, never an authoritative source acknowledgment. */
export function createPendingAuditJournal({ directory, verifyAcknowledgment, fault = () => {} }) {
  if (typeof directory !== 'string' || !directory) throw new Error('Journal directory required')
  const root = resolve(directory)
  let directoryFsync = 'not-attempted'
  const path = (name) => join(root, name)
  function assertContained() {
    let current = root
    while (true) {
      if (existsSync(current) && lstatSync(current).isSymbolicLink())
        throw error('JOURNAL_PATH', 'Journal ancestors must not be symlinks or junctions')
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (realpathSync(root).toLowerCase() !== root.toLowerCase())
      throw error('JOURNAL_PATH', 'Journal real path changed')
    for (const name of readdirSync(root)) {
      const stat = lstatSync(path(name))
      if (stat.isSymbolicLink() || !stat.isFile())
        throw error('JOURNAL_PATH', 'Journal contains a non-regular entry')
    }
  }
  function syncDirectory() {
    let fd
    try {
      fd = openSync(root, 'r')
      fsyncSync(fd)
      directoryFsync = 'supported'
    } catch (e) {
      if (
        process.platform === 'win32' &&
        ['EPERM', 'EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(e.code)
      )
        directoryFsync = 'unsupported-on-this-host'
      else throw e
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  function lockOwner() {
    try {
      return JSON.parse(readFileSync(path('writer.lock'), 'utf8'))
    } catch {
      return null
    }
  }
  function acquire() {
    assertContained()
    if (existsSync(path('recovery.lock')))
      throw error('JOURNAL_LOCKED', 'Journal lock recovery is in progress')
    const owner = { version: 1, pid: process.pid, host: hostname(), token: randomUUID() }
    let fd
    try {
      fd = openSync(path('writer.lock'), 'wx', 0o600)
    } catch (e) {
      if (e.code === 'EEXIST')
        throw Object.assign(
          error('JOURNAL_LOCKED', 'Journal writer lock requires release or explicit recovery'),
          { owner: lockOwner() },
        )
      throw e
    }
    try {
      writeFileSync(fd, JSON.stringify(owner))
      fsyncSync(fd)
      syncDirectory()
    } catch (e) {
      closeSync(fd)
      throw e
    }
    return () => {
      closeSync(fd)
      if (lockOwner()?.token !== owner.token)
        throw error('JOURNAL_LOCKED', 'Journal writer lock identity changed')
      unlinkSync(path('writer.lock'))
      syncDirectory()
    }
  }
  function initialize() {
    if (!existsSync(path('safety.reserve'))) {
      const fd = openSync(path('safety.reserve'), 'wx', 0o600)
      try {
        writeFileSync(fd, Buffer.alloc(SAFETY_CAPACITY))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      syncDirectory()
    }
    if (lstatSync(path('safety.reserve')).size !== SAFETY_CAPACITY)
      throw error('JOURNAL_CORRUPT', 'Safety reserve has an invalid size')
  }
  function load() {
    initialize()
    if (
      existsSync(path('pending.json')) &&
      lstatSync(path('pending.json')).size > BUSINESS_CAPACITY
    )
      throw error('JOURNAL_CORRUPT', 'Pending file exceeds bounded capacity')
    const value = existsSync(path('pending.json'))
      ? JSON.parse(readFileSync(path('pending.json'), 'utf8'))
      : { version: 1, entries: [], acknowledgments: [] }
    if (
      value.version !== 1 ||
      !Array.isArray(value.entries) ||
      !Array.isArray(value.acknowledgments)
    )
      throw error('JOURNAL_VERSION', 'Unsupported pending journal version')
    const seen = new Set()
    for (const entry of value.entries) {
      validate(entry.event, entry.state)
      if (!Number.isSafeInteger(entry.reservedBytes) || entry.reservedBytes < 0)
        throw error('JOURNAL_CORRUPT', 'Invalid reserved capacity')
      const key = JSON.stringify([entry.event.runId, entry.event.id])
      if (seen.has(key)) throw error('JOURNAL_CORRUPT', 'Duplicate journal identity')
      seen.add(key)
    }
    for (const ack of value.acknowledgments) {
      const key = JSON.stringify([ack.runId, ack.eventId])
      if (
        !validId(ack.runId) ||
        !validId(ack.eventId) ||
        !/^[a-f0-9]{64}$/.test(ack.eventDigest) ||
        typeof ack.sourceRevision !== 'string' ||
        !ack.sourceRevision ||
        !Number.isSafeInteger(ack.reservedBytes) ||
        ack.reservedBytes < 0 ||
        seen.has(key)
      )
        throw error('JOURNAL_CORRUPT', 'Invalid acknowledgment tombstone')
      seen.add(key)
    }
    if (usage(value) > BUSINESS_CAPACITY)
      throw error('JOURNAL_CORRUPT', 'Business journal exceeds capacity')
    return value
  }
  function safetyRecords() {
    const buffer = readFileSync(path('safety.reserve')),
      records = []
    for (let index = 0; index < SAFETY_CAPACITY / SLOT_BYTES; index++) {
      const slot = buffer.subarray(index * SLOT_BYTES, (index + 1) * SLOT_BYTES)
      if (slot.every((byte) => byte === 0)) continue
      if (![1, 2].includes(slot[0]))
        throw error(
          'JOURNAL_CORRUPT',
          `Uncommitted safety slot ${index}; retain evidence and reconcile`,
        )
      const length = Number(slot.subarray(1, 9).toString('ascii'))
      if (!Number.isSafeInteger(length) || length < 1 || length > SLOT_BYTES - HEADER_BYTES)
        throw error('JOURNAL_CORRUPT', 'Invalid safety frame length')
      const body = slot.subarray(HEADER_BYTES, HEADER_BYTES + length)
      if (hash(body) !== slot.subarray(9, HEADER_BYTES).toString('ascii'))
        throw error('JOURNAL_CORRUPT', 'Safety frame checksum mismatch')
      const entry = JSON.parse(body.toString('utf8'))
      validate(entry.event, entry.state)
      records.push({ ...entry, slot: index, acknowledged: slot[0] === 2 })
    }
    return records
  }
  function validate(event, state) {
    const seen = new Set()
    const visit = (value) => {
      if (typeof value === 'number' && !Number.isFinite(value))
        throw error('JOURNAL_INPUT', 'Audit event must contain finite JSON')
      if (value && typeof value === 'object') {
        if (seen.has(value)) throw error('JOURNAL_INPUT', 'Audit event cannot contain cycles')
        seen.add(value)
        if (
          !Array.isArray(value) &&
          Object.getPrototypeOf(value) !== Object.prototype &&
          Object.getPrototypeOf(value) !== null
        )
          throw error('JOURNAL_INPUT', 'Audit event must contain plain JSON')
        for (const child of Object.values(value)) visit(child)
        seen.delete(value)
      } else if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null)
        throw error('JOURNAL_INPUT', 'Audit event must contain JSON values')
    }
    visit(event)
    requireDeliveryRecord(event, 'run-event')
    if (!validId(event.id) || !validId(event.runId) || !['pending', 'unknown'].includes(state))
      throw error('JOURNAL_INPUT', 'Invalid pending event identity/state')
  }
  const usage = (value) =>
    Buffer.byteLength(JSON.stringify(value)) +
    [...value.entries, ...value.acknowledgments].reduce((n, e) => n + e.reservedBytes, 0)
  function save(value) {
    if (readdirSync(root).some((name) => /^pending-.*\.tmp$/.test(name)))
      throw error(
        'JOURNAL_RECOVERY',
        'Unpromoted audit stage must be reconciled before another snapshot write',
      )
    if (usage(value) > BUSINESS_CAPACITY)
      throw error(
        'JOURNAL_FULL',
        'Pending audit business capacity exhausted; no new effects permitted',
      )
    const staged = path(`pending-${randomUUID()}.tmp`),
      bytes = JSON.stringify(value)
    const fd = openSync(staged, 'wx', 0o600)
    try {
      writeFileSync(fd, bytes)
      fsyncSync(fd)
      fault('business.after-fsync')
    } finally {
      closeSync(fd)
    }
    renameSync(staged, path('pending.json'))
    fault('business.after-rename')
    syncDirectory()
  }
  async function locked(fn) {
    const release = acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
  const receipt = (entry, kind) => ({
    local: true,
    authoritativeAcknowledgment: false,
    kind,
    eventId: entry.event.id,
    eventDigest: entry.event.digest,
    state: entry.state,
    durability: { fileFsync: true, directoryFsync },
  })
  return {
    async put(
      suppliedEvent,
      { state = 'pending', kind = 'business', reservedBytes = 0, reservationId = null } = {},
    ) {
      const event = structuredClone(suppliedEvent)
      validate(event, state)
      if (
        !['business', 'safety'].includes(kind) ||
        !Number.isSafeInteger(reservedBytes) ||
        reservedBytes < 0
      )
        throw error('JOURNAL_INPUT', 'Invalid pending capacity request')
      return locked(() => {
        const value = load(),
          safety = safetyRecords()
        const acknowledged = value.acknowledgments.find(
          (a) => a.runId === event.runId && a.eventId === event.id,
        )
        if (acknowledged) {
          if (acknowledged.eventDigest !== event.digest)
            throw error('JOURNAL_CONFLICT', 'Reconciled event identity has a conflicting digest')
          return {
            local: true,
            authoritativeAcknowledgment: false,
            kind: 'business',
            eventId: event.id,
            eventDigest: event.digest,
            state: 'acknowledged',
            previouslyReconciled: true,
          }
        }
        const existing =
          value.entries.find((e) => same(e, event)) ?? safety.find((e) => same(e, event))
        if (existing) {
          if (existing.event.digest !== event.digest)
            throw error('JOURNAL_CONFLICT', 'Journal event identity has a conflicting digest')
          if (state === 'unknown' && existing.state !== 'unknown') {
            if (kind === 'safety' || 'slot' in existing)
              throw error(
                'JOURNAL_INPUT',
                'Safety state is immutable; persist a distinct stop event',
              )
            existing.state = 'unknown'
            save(value)
          }
          return receipt(existing, 'slot' in existing ? 'safety' : 'business')
        }
        const entry = { event, state, reservedBytes }
        if (kind === 'safety') {
          if (
            reservedBytes ||
            reservationId ||
            !['checkpoint', 'delegation-safety', 'paused', 'blocked'].includes(event.kind)
          )
            throw error(
              'JOURNAL_INPUT',
              'Safety reserve accepts only bounded stop/checkpoint events',
            )
          const body = Buffer.from(JSON.stringify(entry))
          if (body.length > SLOT_BYTES - HEADER_BYTES)
            throw error('JOURNAL_FULL', 'Stop record exceeds bounded safety slot')
          const used = new Set(safety.map((e) => e.slot))
          const index = Array.from({ length: SAFETY_CAPACITY / SLOT_BYTES }, (_, i) => i).find(
            (i) => !used.has(i),
          )
          if (index === undefined)
            throw error('JOURNAL_FULL', 'Safety reserve exhausted; retain existing audit evidence')
          const slot = Buffer.alloc(SLOT_BYTES)
          slot.write(String(body.length).padStart(8, '0'), 1, 'ascii')
          slot.write(hash(body), 9, 'ascii')
          body.copy(slot, HEADER_BYTES)
          const fd = openSync(path('safety.reserve'), 'r+')
          try {
            writeSync(fd, slot, 0, slot.length, index * SLOT_BYTES)
            fsyncSync(fd)
            fault('safety.after-payload-fsync')
            writeSync(fd, Buffer.from([1]), 0, 1, index * SLOT_BYTES)
            fsyncSync(fd)
            fault('safety.after-commit-fsync')
          } finally {
            closeSync(fd)
          }
          return receipt(entry, kind)
        }
        if (readdirSync(root).some((name) => /^pending-.*\.tmp$/.test(name)))
          throw error(
            'JOURNAL_RECOVERY',
            'Unpromoted audit stage requires explicit inspection; business writes blocked',
          )
        if (reservationId !== null) {
          const parent =
            value.entries.find(
              (e) => e.event.id === reservationId && e.event.runId === event.runId,
            ) ??
            value.acknowledgments.find(
              (a) => a.eventId === reservationId && a.runId === event.runId,
            )
          const cost = Buffer.byteLength(JSON.stringify(entry)) + 1
          if (!parent || parent.reservedBytes < cost)
            throw error('JOURNAL_FULL', 'Required audit reservation is missing or insufficient')
          parent.reservedBytes -= cost
        }
        value.entries.push(entry)
        save(value)
        return receipt(entry, kind)
      })
    },
    async list() {
      return locked(() => {
        const value = load(),
          safety = safetyRecords()
        const unpromotedStages = readdirSync(root).filter((name) => /^pending-.*\.tmp$/.test(name))
        return {
          version: 1,
          authoritative: false,
          entries: [
            ...value.entries.map((e) => ({ ...e, kind: 'business' })),
            ...safety.map((e) => ({ ...e, kind: 'safety' })),
          ],
          acknowledgments: value.acknowledgments,
          unpromotedStages,
          recoveryRequired: unpromotedStages.length > 0,
          businessBytes: usage(value),
          businessCapacity: BUSINESS_CAPACITY,
          safetySlotsUsed: safety.length,
          safetySlotsCapacity: SAFETY_CAPACITY / SLOT_BYTES,
          durability: { fileFsync: true, directoryFsync },
        }
      })
    },
    async ack(id, eventDigest, suppliedReceipt, { runId } = {}) {
      const sourceReceipt = structuredClone(suppliedReceipt)
      if (typeof verifyAcknowledgment !== 'function')
        throw error('JOURNAL_ACK', 'Authoritative source acknowledgment verifier required')
      return locked(async () => {
        const value = load(),
          safety = safetyRecords()
        const previous = value.acknowledgments.filter(
          (a) => a.eventId === id && (runId === undefined || a.runId === runId),
        )
        if (previous.length === 1 && previous[0].eventDigest === eventDigest)
          return { localCompaction: true, alreadyCompacted: true, ...previous[0] }
        const matches = [...value.entries, ...safety].filter(
          (e) => e.event.id === id && (runId === undefined || e.event.runId === runId),
        )
        if (matches.length !== 1 || matches[0].event.digest !== eventDigest)
          throw error('JOURNAL_ACK', 'Exact pending event identity required')
        const entry = matches[0]
        const verified = await verifyAcknowledgment({
          event: structuredClone(entry.event),
          sourceReceipt,
        })
        if (
          verified?.acknowledged !== true ||
          verified.eventId !== id ||
          verified.eventDigest !== eventDigest ||
          typeof verified.sourceRevision !== 'string' ||
          !verified.sourceRevision
        )
          throw error('JOURNAL_ACK', 'Source has not acknowledged this exact event')
        if ('slot' in entry) {
          const fd = openSync(path('safety.reserve'), 'r+')
          try {
            writeSync(fd, Buffer.from([2]), 0, 1, entry.slot * SLOT_BYTES)
            fsyncSync(fd)
          } finally {
            closeSync(fd)
          }
        } else {
          value.entries = value.entries.filter((e) => !same(e, entry.event))
          value.acknowledgments.push({
            runId: entry.event.runId,
            eventId: id,
            eventDigest,
            sourceRevision: verified.sourceRevision,
            reservedBytes: entry.reservedBytes,
          })
          save(value)
        }
        return {
          localCompaction: true,
          eventId: id,
          eventDigest,
          sourceRevision: verified.sourceRevision,
          safetySlotRetained: 'slot' in entry,
        }
      })
    },
    async recoverLock(expectedOwner) {
      const expected = structuredClone(expectedOwner)
      assertContained()
      const fd = openSync(path('recovery.lock'), 'wx', 0o600)
      try {
        const current = lockOwner()
        if (
          !current ||
          current.version !== 1 ||
          current.host !== hostname() ||
          current.token !== expected?.token ||
          current.pid !== expected?.pid ||
          !Number.isSafeInteger(current.pid) ||
          current.pid <= 0
        )
          throw error('JOURNAL_LOCKED', 'Lock ownership/liveness is unknown; recovery refused')
        try {
          process.kill(current.pid, 0)
          throw error('JOURNAL_LOCKED', 'Lock owner is still alive')
        } catch (e) {
          if (e.code !== 'ESRCH')
            throw error('JOURNAL_LOCKED', 'Lock owner is alive or liveness is unknown')
        }
        unlinkSync(path('writer.lock'))
        syncDirectory()
        return { recovered: true, owner: current }
      } finally {
        closeSync(fd)
        unlinkSync(path('recovery.lock'))
        syncDirectory()
      }
    },
  }
}
