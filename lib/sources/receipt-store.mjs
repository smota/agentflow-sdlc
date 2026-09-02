import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

export function createMemorySourceReceiptStore(initial = []) {
  const receipts = new Map(initial.map((item) => [item.idempotencyKey, item]))
  return {
    get: async (key) => receipts.get(key) ?? null,
    put: async (receipt) => {
      if (!receipts.has(receipt.idempotencyKey)) receipts.set(receipt.idempotencyKey, receipt)
      return receipts.get(receipt.idempotencyKey)
    },
  }
}

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex')
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function createFileSourceReceiptStore(path, { fault = () => {} } = {}) {
  if (!path) throw new Error('A durable source receipt path is required')
  const target = resolve(path)
  const staged = `${target}.agentflow.tmp`
  const backup = `${target}.agentflow.bak`
  const journal = `${target}.agentflow.journal`
  const lock = `${target}.agentflow.lock`
  const recoveryLock = `${lock}.recovery`
  const load = () =>
    existsSync(target) ? (JSON.parse(readFileSync(target, 'utf8')).receipts ?? []) : []

  const acquire = () => {
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(recoveryLock)) {
      throw new Error('Source receipt store lock recovery is already in progress')
    }
    const owner = { version: 1, pid: process.pid, id: randomUUID() }
    let descriptor
    try {
      descriptor = openSync(lock, 'wx', 0o600)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let recoveryDescriptor
      try {
        recoveryDescriptor = openSync(recoveryLock, 'wx', 0o600)
      } catch (recoveryError) {
        if (recoveryError?.code === 'EEXIST') {
          throw new Error('Source receipt store lock recovery is already in progress')
        }
        throw recoveryError
      }
      writeFileSync(recoveryDescriptor, `${JSON.stringify(owner)}\n`, { flush: true })
      try {
        let current = null
        try {
          current = JSON.parse(readFileSync(lock, 'utf8'))
        } catch {
          // An unreadable lock is not safe to steal.
        }
        if (!current || processIsAlive(current.pid)) {
          throw new Error('Source receipt store is locked by another writer')
        }
        unlinkSync(lock)
        fault('source.after-stale-lock-unlink')
        descriptor = openSync(lock, 'wx', 0o600)
      } finally {
        closeSync(recoveryDescriptor)
        if (existsSync(recoveryLock)) unlinkSync(recoveryLock)
      }
    }
    writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, { flush: true })
    return () => {
      closeSync(descriptor)
      if (existsSync(lock)) {
        const current = JSON.parse(readFileSync(lock, 'utf8'))
        if (current.id === owner.id) unlinkSync(lock)
      }
    }
  }

  const recover = () => {
    if (!existsSync(journal)) return
    const state = JSON.parse(readFileSync(journal, 'utf8'))
    const current = existsSync(target) ? readFileSync(target) : null
    const currentHash = current === null ? null : contentHash(current)
    if (currentHash === state.afterHash) {
      // Promotion completed; only deterministic cleanup was interrupted.
    } else if (currentHash === state.beforeHash) {
      // The target was never moved, so discard the uncommitted stage.
    } else if (current === null && existsSync(backup)) {
      renameSync(backup, target)
    } else if (current === null && state.beforeHash === null) {
      // A new store had not been promoted; discard the uncommitted stage.
    } else {
      throw new Error('Source receipt store recovery refused because the target drifted')
    }
    for (const artifact of [staged, backup, journal]) {
      if (existsSync(artifact)) unlinkSync(artifact)
    }
  }

  const locked = (operation) => {
    const release = acquire()
    try {
      recover()
      return operation()
    } finally {
      release()
    }
  }

  return {
    path: target,
    async get(key) {
      return locked(() => load().find((item) => item.idempotencyKey === key) ?? null)
    },
    async put(receipt) {
      return locked(() => {
        const receipts = load()
        const existing = receipts.find((item) => item.idempotencyKey === receipt.idempotencyKey)
        if (existing) return existing
        receipts.push(receipt)
        const content = Buffer.from(`${JSON.stringify({ version: 1, receipts }, null, 2)}\n`)
        const before = existsSync(target) ? readFileSync(target) : null
        writeFileSync(
          journal,
          `${JSON.stringify({
            version: 1,
            beforeHash: before === null ? null : contentHash(before),
            afterHash: contentHash(content),
          })}\n`,
          { flag: 'wx', mode: 0o600, flush: true },
        )
        fault('source.after-journal')
        try {
          writeFileSync(staged, content, { flag: 'wx', mode: 0o600, flush: true })
          fault('source.after-stage')
          if (before !== null) renameSync(target, backup)
          fault('source.after-backup')
          renameSync(staged, target)
          fault('source.after-promote')
          if (existsSync(backup)) unlinkSync(backup)
          unlinkSync(journal)
          return receipt
        } catch (error) {
          recover()
          throw error
        }
      })
    },
  }
}
