import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileSourceReceiptStore } from '../sources/receipt-store.mjs'

describe('durable source receipt store', () => {
  const targets = []
  afterEach(() => {
    for (const target of targets.splice(0)) rmSync(target, { recursive: true, force: true })
  })

  it('persists idempotency keys across adapter process lifetimes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-source-receipts-'))
    targets.push(root)
    const path = join(root, 'receipts.json')
    const receipt = { idempotencyKey: 'same-operation', receiptToken: 'receipt-1' }
    await createFileSourceReceiptStore(path).put(receipt)
    await createFileSourceReceiptStore(path).put({
      idempotencyKey: 'same-operation',
      receiptToken: 'duplicate',
    })
    expect(await createFileSourceReceiptStore(path).get('same-operation')).toEqual(receipt)
    expect(JSON.parse(readFileSync(path, 'utf8')).receipts).toEqual([receipt])
  })

  it('recovers a hard interruption between backup and promotion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-source-receipts-'))
    targets.push(root)
    const path = join(root, 'receipts.json')
    const first = { idempotencyKey: 'first', receiptToken: 'receipt-1' }
    await createFileSourceReceiptStore(path).put(first)
    const moduleUrl = new URL('../sources/receipt-store.mjs', import.meta.url).href
    const child = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { createFileSourceReceiptStore } from ${JSON.stringify(moduleUrl)};
       await createFileSourceReceiptStore(${JSON.stringify(path)}, {
         fault(checkpoint) { if (checkpoint === 'source.after-backup') process.exit(93) }
       }).put({ idempotencyKey: 'second', receiptToken: 'receipt-2' });`,
    ])

    expect(child.status).toBe(93)
    const recovered = createFileSourceReceiptStore(path)
    expect(await recovered.get('first')).toEqual(first)
    expect(await recovered.get('second')).toBeNull()
    expect(readdirSync(root).filter((name) => name.includes('.agentflow.'))).toEqual([])
  })

  it('fails closed when another writer holds the store lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-source-receipts-'))
    targets.push(root)
    const path = join(root, 'receipts.json')
    let competingWrite
    const store = createFileSourceReceiptStore(path, {
      fault(checkpoint) {
        if (checkpoint === 'source.after-journal') {
          competingWrite = createFileSourceReceiptStore(path).put({
            idempotencyKey: 'competing',
            receiptToken: 'receipt-2',
          })
        }
      },
    })
    await store.put({ idempotencyKey: 'primary', receiptToken: 'receipt-1' })

    await expect(competingWrite).rejects.toThrow('locked by another writer')
    expect(await createFileSourceReceiptStore(path).get('primary')).not.toBeNull()
  })

  it('serializes stale-lock reclamation against competing writers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-source-receipts-'))
    targets.push(root)
    const path = join(root, 'receipts.json')
    writeFileSync(`${path}.agentflow.lock`, '{"version":1,"pid":2147483647,"id":"stale"}\n')
    let competingRead
    const store = createFileSourceReceiptStore(path, {
      fault(checkpoint) {
        if (checkpoint === 'source.after-stale-lock-unlink') {
          competingRead = createFileSourceReceiptStore(path).get('missing')
        }
      },
    })

    expect(await store.get('missing')).toBeNull()
    await expect(competingRead).rejects.toThrow('recovery is already in progress')
    expect(readdirSync(root).filter((name) => name.includes('.agentflow.'))).toEqual([])
  })
})
