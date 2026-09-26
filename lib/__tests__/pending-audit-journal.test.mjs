import { describe, it, expect, afterEach } from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  readdirSync,
} from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  createPendingAuditJournal,
  BUSINESS_CAPACITY,
  SAFETY_CAPACITY,
} from '../sources/pending-audit-journal.mjs'
import { createRunEvent } from '../core/run-state.mjs'

const roots = []
const root = () => {
  const d = mkdtempSync(join(realpathSync(tmpdir()), 'af-audit-'))
  roots.push(d)
  return d
}
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})
const event = (id = 'event1', payload = {}, kind = 'operation-admitted', runId = 'run') =>
  createRunEvent({ id, runId, kind, payload, timestamp: '2026-09-25T12:00:00.000Z' })
const verified = async ({ event, sourceReceipt }) => ({
  acknowledged: sourceReceipt.confirmed === true,
  eventId: event.id,
  eventDigest: event.digest,
  sourceRevision: 'source:verified',
})
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('pending audit journal is bounded local evidence, not source acknowledgment', () => {
  it('keeps exact replay tombstones and outcome reservation after source ACK', async () => {
    const directory = root(),
      journal = createPendingAuditJournal({ directory, verifyAcknowledgment: verified }),
      e = event('intent')
    await journal.put(e, { reservedBytes: 2048 })
    await journal.ack(e.id, e.digest, { confirmed: true })
    expect((await journal.ack(e.id, e.digest, { confirmed: true })).alreadyCompacted).toBe(true)
    expect(await journal.put(e)).toMatchObject({
      previouslyReconciled: true,
      authoritativeAcknowledgment: false,
    })
    await expect(journal.put(event('intent', { changed: true }))).rejects.toMatchObject({
      code: 'JOURNAL_CONFLICT',
    })
    await journal.put(event('outcome'), { reservationId: e.id })
    const listed = await journal.list()
    expect(listed.acknowledgments[0].reservedBytes).toBeGreaterThan(0)
    expect(listed.acknowledgments[0].reservedBytes).toBeLessThan(2048)
    expect(listed.entries[0].event.id).toBe('outcome')
  })
  it('bounds physical business data and still permits the preallocated stop record', async () => {
    const directory = root(),
      journal = createPendingAuditJournal({ directory })
    await journal.put(event('large', { evidence: 'x'.repeat(BUSINESS_CAPACITY - 1024) }))
    await expect(
      journal.put(event('overflow', { evidence: 'x'.repeat(1024) })),
    ).rejects.toMatchObject({ code: 'JOURNAL_FULL' })
    expect(readFileSync(join(directory, 'pending.json')).length).toBeLessThanOrEqual(
      BUSINESS_CAPACITY,
    )
    await journal.put(event('stop', { reason: 'business full' }, 'checkpoint'), { kind: 'safety' })
    expect((await journal.list()).safetySlotsUsed).toBe(1)
  })
  it('reports unpromoted evidence and blocks business until explicit recovery while retaining stop capacity', async () => {
    const directory = root(),
      journal = createPendingAuditJournal({
        directory,
        fault: (p) => {
          if (p === 'business.after-fsync') throw new Error('injected interruption')
        },
      })
    await expect(journal.put(event())).rejects.toThrow(/interruption/)
    const fresh = createPendingAuditJournal({ directory })
    const listed = await fresh.list()
    expect(listed.recoveryRequired).toBe(true)
    expect(listed.unpromotedStages).toHaveLength(1)
    await expect(fresh.put(event('next'))).rejects.toMatchObject({ code: 'JOURNAL_RECOVERY' })
    await fresh.put(event('stop', {}, 'checkpoint'), { kind: 'safety' })
    expect((await fresh.list()).safetySlotsUsed).toBe(1)
  })
  it('persists exact pending/unknown identity across fresh instances and preallocates stop capacity', async () => {
    const directory = root(),
      journal = createPendingAuditJournal({ directory }),
      e = event()
    const result = await journal.put(e)
    expect(result).toMatchObject({
      local: true,
      authoritativeAcknowledgment: false,
      eventDigest: e.digest,
    })
    expect(readFileSync(join(directory, 'safety.reserve')).length).toBe(SAFETY_CAPACITY)
    await journal.put(e, { state: 'unknown' })
    const listed = await createPendingAuditJournal({ directory }).list()
    expect(listed.entries[0]).toMatchObject({ event: e, state: 'unknown', kind: 'business' })
    expect(listed.authoritative).toBe(false)
    expect(listed.durability.fileFsync).toBe(true)
  })
  it('is idempotent for the same event and rejects conflicting digests', async () => {
    const journal = createPendingAuditJournal({ directory: root() }),
      e = event()
    await journal.put(e)
    await journal.put(e)
    expect((await journal.list()).entries).toHaveLength(1)
    await expect(journal.put(event('event1', { changed: true }))).rejects.toMatchObject({
      code: 'JOURNAL_CONFLICT',
    })
  })
  it('preserves run identity when event IDs overlap', async () => {
    const journal = createPendingAuditJournal({ directory: root(), verifyAcknowledgment: verified })
    const a = event('same', {}, 'checkpoint', 'one'),
      b = event('same', {}, 'checkpoint', 'two')
    await journal.put(a)
    await journal.put(b)
    await expect(journal.ack('same', a.digest, { confirmed: true })).rejects.toMatchObject({
      code: 'JOURNAL_ACK',
    })
    await journal.ack('same', a.digest, { confirmed: true }, { runId: 'one' })
    expect((await journal.list()).entries.map((e) => e.event.runId)).toEqual(['two'])
  })
  it('refuses blind ACK and retains unacknowledged evidence without TTL or eviction', async () => {
    const directory = root(),
      e = event(),
      journal = createPendingAuditJournal({ directory })
    await journal.put(e)
    await expect(journal.ack(e.id, e.digest, { confirmed: true })).rejects.toMatchObject({
      code: 'JOURNAL_ACK',
    })
    const connected = createPendingAuditJournal({ directory, verifyAcknowledgment: verified })
    await expect(connected.ack(e.id, e.digest, { confirmed: false })).rejects.toMatchObject({
      code: 'JOURNAL_ACK',
    })
    expect((await connected.list()).entries).toHaveLength(1)
    await connected.ack(e.id, e.digest, { confirmed: true })
    expect((await connected.list()).entries).toHaveLength(0)
  })
  it('binds ACK verifier response to exact identity and refuses unavailable source', async () => {
    const directory = root(),
      e = event()
    const journal = createPendingAuditJournal({
      directory,
      verifyAcknowledgment: async () => ({
        acknowledged: true,
        eventId: 'other',
        eventDigest: e.digest,
        sourceRevision: 's',
      }),
    })
    await journal.put(e)
    await expect(journal.ack(e.id, e.digest, {})).rejects.toMatchObject({ code: 'JOURNAL_ACK' })
    expect((await journal.list()).entries).toHaveLength(1)
  })
  it('reserves outcome capacity before business work and permits safety after business fills', async () => {
    const journal = createPendingAuditJournal({ directory: root() })
    const intent = event('intent')
    await journal.put(intent, { reservedBytes: BUSINESS_CAPACITY - 1024 })
    await expect(journal.put(event('new-work', { data: 'x'.repeat(1024) }))).rejects.toMatchObject({
      code: 'JOURNAL_FULL',
    })
    await journal.put(event('outcome', { state: 'unknown' }), { reservationId: intent.id })
    const before = await journal.list()
    expect(before.businessBytes).toBeLessThanOrEqual(BUSINESS_CAPACITY)
    await journal.put(event('stop', { reason: 'audit capacity exhausted' }, 'checkpoint'), {
      kind: 'safety',
    })
    const after = await journal.list()
    expect(after.entries.filter((e) => e.kind === 'safety')).toHaveLength(1)
    expect(after.businessBytes).toBe(before.businessBytes)
  })
  it('does not let fake safety work consume stop slots or exceed the bounded payload', async () => {
    const journal = createPendingAuditJournal({ directory: root() })
    await expect(journal.put(event(), { kind: 'safety' })).rejects.toMatchObject({
      code: 'JOURNAL_INPUT',
    })
    await expect(
      journal.put(event('stop', { data: 'x'.repeat(4096) }, 'checkpoint'), { kind: 'safety' }),
    ).rejects.toMatchObject({ code: 'JOURNAL_FULL' })
    expect((await journal.list()).safetySlotsUsed).toBe(0)
  })
  it('never evicts stop evidence even after reserve is full', async () => {
    const journal = createPendingAuditJournal({ directory: root() })
    for (let i = 0; i < 16; i++)
      await journal.put(event(`stop${i}`, { reason: 'stop' }, 'checkpoint'), { kind: 'safety' })
    await expect(
      journal.put(event('overflow', {}, 'checkpoint'), { kind: 'safety' }),
    ).rejects.toMatchObject({ code: 'JOURNAL_FULL' })
    expect((await journal.list()).entries).toHaveLength(16)
  })
  it('marks source-reconciled safety evidence without erasing its bytes', async () => {
    const directory = root(),
      journal = createPendingAuditJournal({ directory, verifyAcknowledgment: verified }),
      e = event('stop', {}, 'checkpoint')
    await journal.put(e, { kind: 'safety' })
    const before = readFileSync(join(directory, 'safety.reserve'))
    await journal.ack(e.id, e.digest, { confirmed: true })
    const after = readFileSync(join(directory, 'safety.reserve'))
    expect(before.subarray(1)).toEqual(after.subarray(1))
    expect((await journal.list()).entries[0].acknowledged).toBe(true)
  })
  it('serializes concurrent callers while an authoritative ACK is in progress', async () => {
    const directory = root(),
      held = deferred(),
      entered = deferred(),
      e = event()
    const first = createPendingAuditJournal({
      directory,
      verifyAcknowledgment: async (context) => {
        entered.resolve()
        await held.promise
        return verified(context)
      },
    })
    await first.put(e)
    const acknowledging = first.ack(e.id, e.digest, { confirmed: true })
    await entered.promise
    await expect(
      createPendingAuditJournal({ directory }).put(event('other')),
    ).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' })
    held.resolve()
    await acknowledging
    await createPendingAuditJournal({ directory }).put(event('other'))
    expect((await first.list()).entries.map((e) => e.event.id)).toEqual(['other'])
  })
  it('refuses live, malformed, foreign-host and changed lock recovery', async () => {
    const directory = root(),
      journal = createPendingAuditJournal({ directory })
    const owner = { version: 1, pid: process.pid, host: hostname(), token: 'owner' }
    writeFileSync(join(directory, 'writer.lock'), JSON.stringify(owner))
    await expect(journal.recoverLock(owner)).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' })
    await expect(journal.recoverLock({ ...owner, token: 'other' })).rejects.toMatchObject({
      code: 'JOURNAL_LOCKED',
    })
    writeFileSync(join(directory, 'writer.lock'), '{')
    await expect(journal.recoverLock(owner)).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' })
    writeFileSync(
      join(directory, 'writer.lock'),
      JSON.stringify({ ...owner, host: 'other-machine' }),
    )
    await expect(journal.recoverLock(owner)).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' })
  })
  it('rejects traversal IDs, tampered event digests, and managed-file symlinks', async () => {
    const directory = root(),
      journal = createPendingAuditJournal({ directory })
    await expect(journal.put(event('../outside'))).rejects.toMatchObject({ code: 'JOURNAL_INPUT' })
    await expect(journal.put({ ...event(), digest: 'a'.repeat(64) })).rejects.toThrow(/Invalid/)
    const elsewhere = root()
    writeFileSync(join(elsewhere, 'target'), '{}')
    // Directory junction creation is available without Windows symlink elevation.
    symlinkSync(
      elsewhere,
      join(directory, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(journal.list()).rejects.toMatchObject({ code: 'JOURNAL_PATH' })
    expect(readFileSync(join(elsewhere, 'target'), 'utf8')).toBe('{}')
  })
  it('rejects a journal directory that traverses a junction/symlink', async () => {
    const directory = root(),
      elsewhere = root(),
      linked = join(directory, 'linked')
    symlinkSync(elsewhere, linked, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(
      createPendingAuditJournal({ directory: join(linked, 'nested') }).list(),
    ).rejects.toMatchObject({ code: 'JOURNAL_PATH' })
    expect(existsSync(join(elsewhere, 'nested'))).toBe(false)
  })
  it('detects corrupted safety frames without silently forgetting audit', async () => {
    const directory = root(),
      journal = createPendingAuditJournal({ directory })
    await journal.put(event('stop', {}, 'checkpoint'), { kind: 'safety' })
    const bytes = readFileSync(join(directory, 'safety.reserve'))
    bytes[100] ^= 1
    writeFileSync(join(directory, 'safety.reserve'), bytes)
    await expect(journal.list()).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' })
    expect(readFileSync(join(directory, 'safety.reserve'))).toEqual(bytes)
  })
})

describe('child-process interruption boundaries', () => {
  it.each([
    'business.after-fsync',
    'business.after-rename',
    'safety.after-payload-fsync',
    'safety.after-commit-fsync',
  ])('retains conservative evidence after %s', async (point) => {
    const directory = root(),
      moduleUrl = pathToFileURL(join(process.cwd(), 'lib/sources/pending-audit-journal.mjs')).href
    const runUrl = pathToFileURL(join(process.cwd(), 'lib/core/run-state.mjs')).href
    const code = `import {createPendingAuditJournal} from ${JSON.stringify(moduleUrl)}; import {createRunEvent} from ${JSON.stringify(runUrl)}; const j=createPendingAuditJournal({directory:${JSON.stringify(directory)},fault:p=>{if(p===${JSON.stringify(point)}) process.exit(73)}}); const e=createRunEvent({runId:'run',id:'crashed',kind:'checkpoint',payload:{reason:'stop'}}); await j.put(e,{kind:${JSON.stringify(point.startsWith('safety') ? 'safety' : 'business')}});`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
      timeout: 10000,
    })
    expect(result.status, result.stderr).toBe(73)
    const owner = JSON.parse(readFileSync(join(directory, 'writer.lock'), 'utf8'))
    const journal = createPendingAuditJournal({ directory })
    await expect(journal.list()).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' })
    expect(await journal.recoverLock(owner)).toMatchObject({ recovered: true })
    if (point === 'safety.after-payload-fsync') {
      await expect(journal.list()).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' })
    } else {
      const listed = await journal.list()
      expect(listed.entries.length).toBe(point === 'business.after-fsync' ? 0 : 1)
      if (point === 'business.after-fsync')
        expect(readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(true)
    }
  })
})
