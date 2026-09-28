import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJournaledRunStore } from '../sources/journaled-run-store.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { createRunEvent } from '../core/run-state.mjs'

const event = (previousDigest = null, id = 'start') =>
  createRunEvent({
    runId: 'demo',
    id,
    previousDigest,
    generation: 0,
    kind: previousDigest ? 'checkpoint' : 'started',
    payload: previousDigest
      ? { reason: 'test' }
      : { owner: 'writer', goalRef: 'issue:1', profile: 'standard', boundary: 'external-action' },
    timestamp: new Date().toISOString(),
  })
describe('write-ahead source composition', () => {
  it('persists before source append and independently confirms before local ACK', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-journal-'))
    try {
      const source = createMemoryRunStore({ durable: true })
      const wrapped = createJournaledRunStore({ store: source, directory: dir })
      await wrapped.append(event(), null)
      expect((await wrapped.journal.list()).entries).toEqual([])
      expect((await wrapped.journal.list()).acknowledgments).toHaveLength(1)
      expect((await wrapped.read()).events).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('a fresh instance reconciles lost ACK without redispatching or duplicating', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-journal-'))
    try {
      const memory = createMemoryRunStore({ durable: true })
      let calls = 0
      const source = {
        ...memory,
        append: async (...args) => {
          calls++
          await memory.append(...args)
          throw new Error('lost ACK')
        },
      }
      const first = createJournaledRunStore({ store: source, directory: dir })
      await expect(first.append(event(), null)).rejects.toThrow('lost ACK')
      expect((await first.journal.list()).entries[0].state).toBe('unknown')
      const fresh = createJournaledRunStore({ store: source, directory: dir })
      expect(await fresh.reconcileJournal()).toEqual({ state: 'acknowledged' })
      expect(calls).toBe(1)
      expect((await memory.read()).events).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('source outage preserves pending evidence and blocks another mutation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-journal-'))
    try {
      const memory = createMemoryRunStore({ durable: true })
      const start = event()
      await memory.append(start, null)
      let calls = 0
      const source = {
        ...memory,
        append: async () => {
          calls++
          throw new Error('offline')
        },
      }
      const first = createJournaledRunStore({ store: source, directory: dir })
      await expect(first.append(event(start.digest, 'a'), start.digest)).rejects.toThrow('offline')
      const fresh = createJournaledRunStore({ store: source, directory: dir })
      await expect(fresh.append(event(start.digest, 'b'), start.digest)).rejects.toThrow(
        'Pending audit',
      )
      expect(calls).toBe(1)
      expect((await fresh.journal.list()).entries).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('rejects stale expected revision before staging any local journal event', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-journal-'))
    try {
      const source = createMemoryRunStore({ durable: true })
      const start = event()
      await source.append(start, null)
      const wrapped = createJournaledRunStore({ store: source, directory: dir })
      await expect(wrapped.append(event(start.digest, 'stale'), null)).rejects.toMatchObject({
        admissionOutcome: 'not-committed',
      })
      expect((await wrapped.journal.list()).entries).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('retires only a source-verified noncommitment after a competing source advance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-journal-'))
    try {
      const memory = createMemoryRunStore({ durable: true })
      const start = event()
      await memory.append(start, null)
      const competitor = event(start.digest, 'competitor')
      let conflict = true
      const source = {
        ...memory,
        append: async (...args) => {
          if (conflict) {
            conflict = false
            await memory.append(competitor, start.digest)
            throw Object.assign(new Error('CAS conflict'), { admissionOutcome: 'not-committed' })
          }
          return memory.append(...args)
        },
      }
      const wrapped = createJournaledRunStore({ store: source, directory: dir })
      const rejected = event(start.digest, 'rejected')
      await expect(wrapped.append(rejected, start.digest)).rejects.toMatchObject({
        admissionOutcome: 'not-committed',
      })
      const journal = await wrapped.journal.list()
      expect(journal.entries).toHaveLength(0)
      expect(journal.acknowledgments).toHaveLength(0)
      expect(journal.retirements).toMatchObject([
        { eventId: rejected.id, reason: 'source-advanced-not-committed' },
      ])
      await expect(wrapped.journal.put(rejected)).rejects.toMatchObject({ code: 'JOURNAL_RETIRED' })
      await wrapped.append(event(competitor.digest, 'next'), competitor.digest)
      expect((await memory.read()).events).toHaveLength(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('retains unknown evidence when a claimed noncommitment lacks source advance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-journal-'))
    try {
      const memory = createMemoryRunStore({ durable: true })
      const start = event()
      await memory.append(start, null)
      const source = {
        ...memory,
        append: async () => {
          throw Object.assign(new Error('unproven conflict'), { admissionOutcome: 'not-committed' })
        },
      }
      const wrapped = createJournaledRunStore({ store: source, directory: dir })
      await expect(wrapped.append(event(start.digest, 'uncertain'), start.digest)).rejects.toThrow(
        'unproven conflict',
      )
      expect((await wrapped.journal.list()).entries[0].state).toBe('unknown')
      expect((await wrapped.journal.list()).retirements).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('refuses replay while the recorded writer is active or cannot be observed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-journal-'))
    try {
      const source = createMemoryRunStore({ durable: true })
      const start = event()
      await source.append(start, null)
      const staged = event(start.digest, 'staged')
      const authority = { owner: 'writer', generation: 0, execute: true }
      const unobserved = createJournaledRunStore({ store: source, directory: dir })
      await unobserved.journal.put(staged)
      await expect(unobserved.reconcileJournal({ replay: true, authority })).rejects.toThrow(
        /liveness observer/,
      )
      const active = createJournaledRunStore({
        store: source,
        directory: dir,
        observeWriter: async () => ({ stopped: false }),
      })
      await expect(active.reconcileJournal({ replay: true, authority })).rejects.toThrow(/stopped/)
      expect((await source.read()).events).toHaveLength(1)
      expect((await active.journal.list()).entries).toHaveLength(1)
      const stopped = createJournaledRunStore({
        store: source,
        directory: dir,
        observeWriter: async () => ({ stopped: true }),
      })
      expect(await stopped.reconcileJournal({ replay: true, authority })).toEqual({
        state: 'acknowledged',
      })
      expect((await source.read()).events).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
