import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalSpoolExporter } from '../observability/local-buffer.mjs'

const directory = () => fs.mkdtempSync(join(tmpdir(), 'af-spool-test-'))
const span = () => ({
  name: 'session',
  startTime: [1, 0],
  endTime: [1, 1],
  attributes: { state: 'completed' },
  spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }),
})
const exportOne = (spool) => {
  let result
  spool.export([span()], (value) => {
    result = value
  })
  return result
}
const files = (dir) => fs.readdirSync(dir).filter((name) => name.endsWith('.json'))

describe('bounded advisory telemetry spool', () => {
  it('accounts for serialized bytes, preserves collisions and clears buffered payload on flush', () => {
    const spoolDir = directory()
    const spool = new LocalSpoolExporter({ spoolDir, now: () => 123 })
    expect(exportOne(spool).code).toBe(0)
    const firstBytes = spool.bufferBytes
    spool.flushSync()
    expect(spool.bufferBytes).toBe(0)
    expect(fs.statSync(join(spoolDir, files(spoolDir)[0])).size).toBe(firstBytes)
    exportOne(spool)
    spool.flushSync()
    expect(files(spoolDir)).toHaveLength(2)
    expect(spool.drops).toBe(0)
  })
  it('drops oversized batches before retaining them', () => {
    const spool = new LocalSpoolExporter({ spoolDir: directory(), maxBufferBytes: 32 })
    expect(exportOne(spool).code).toBe(1)
    expect(spool.bufferBytes).toBe(0)
    expect(spool.drops).toBe(1)
  })
  it('enforces spool size and reports exactly the evicted record count', () => {
    const spoolDir = directory()
    const measure = new LocalSpoolExporter({ spoolDir, now: () => 123 })
    exportOne(measure)
    const capacity = measure.bufferBytes
    const spool = new LocalSpoolExporter({ spoolDir, maxSpoolBytes: capacity, now: () => 123 })
    exportOne(spool)
    spool.flushSync()
    exportOne(spool)
    spool.flushSync()
    expect(files(spoolDir)).toHaveLength(1)
    expect(spool.evicted).toBe(1)
    expect(spool.drops).toBe(1)
    expect(fs.statSync(join(spoolDir, files(spoolDir)[0])).size).toBeLessThanOrEqual(capacity)
  })
  it('expires owned records on an idle flush and preserves unknown files', () => {
    const spoolDir = directory()
    let now = 1000
    const spool = new LocalSpoolExporter({ spoolDir, now: () => now })
    exportOne(spool)
    spool.flushSync()
    fs.writeFileSync(join(spoolDir, 'audit.json'), 'mandatory evidence')
    fs.writeFileSync(join(spoolDir, 'spool-old.jsonl'), 'unknown format')
    now += 7 * 86400000
    spool.flushSync()
    expect(spool.expired).toBe(1)
    expect(spool.drops).toBe(1)
    expect(fs.readFileSync(join(spoolDir, 'audit.json'), 'utf8')).toBe('mandatory evidence')
    expect(fs.readFileSync(join(spoolDir, 'spool-old.jsonl'), 'utf8')).toBe('unknown format')
  })
  it('never overwrites or deletes malformed owned-name files', () => {
    const spoolDir = directory()
    const name = 'af-otel-v1-123-00000000-0000-0000-0000-000000000000.json'
    fs.writeFileSync(join(spoolDir, name), 'broken')
    const spool = new LocalSpoolExporter({ spoolDir, maxSpoolBytes: 300 })
    exportOne(spool)
    spool.flushSync()
    expect(fs.readFileSync(join(spoolDir, name), 'utf8')).toBe('broken')
  })
  it('drops on I/O failure without throwing or leaking raw errors', () => {
    const spool = new LocalSpoolExporter({
      spoolDir: directory(),
      io: {
        ...fs,
        writeFileSync() {
          throw new Error('PRIVATE_PATH')
        },
      },
    })
    exportOne(spool)
    expect(() => spool.flushSync()).not.toThrow()
    expect(spool.drops).toBe(1)
    expect(spool.writeFailures).toBe(1)
    expect(spool.bufferBytes).toBe(0)
  })
  it('does not remove another writer lock and refuses new writes while it exists', () => {
    const spoolDir = directory()
    fs.writeFileSync(join(spoolDir, '.writer-lock'), 'other')
    const spool = new LocalSpoolExporter({ spoolDir })
    exportOne(spool)
    spool.flushSync()
    expect(spool.drops).toBe(1)
    expect(fs.readFileSync(join(spoolDir, '.writer-lock'), 'utf8')).toBe('other')
    expect(files(spoolDir)).toHaveLength(0)
  })
})
