import { execFile, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { formatRolePassComment, rolePassIdempotencyKey } from '../core/role-pass-evidence.mjs'
import { claimOrYield } from '../core/source-claim.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { validateSourceAdapter } from '../core/source-adapter.mjs'
import {
  createFilesystemSourceAdapter,
  createFilesystemWorkItem,
} from '../sources/filesystem-source.mjs'
import { SECOND_WRITER, describeSourceContract } from './source-contract-suite.mjs'

const roots = []
function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-fs-source-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

let counter = 0
describeSourceContract('filesystem source', async () => {
  const root = tempRoot()
  const trustedWriters = ['contract-writer-a', SECOND_WRITER]
  const make = (writer) => createFilesystemSourceAdapter({ root, writer, trustedWriters })
  return {
    adapter: make('contract-writer-a'),
    adapterAs: make,
    makeItem: (fields) => createFilesystemWorkItem(root, { id: `item-${++counter}`, ...fields }),
    setMirror: (refText, value) =>
      writeFileSync(
        join(root, 'items', parseSourceRef(refText).id, 'claim.lock'),
        JSON.stringify({ ...value, at: 'tampered' }),
      ),
    untrustedAdapter: make('stranger'),
  }
})

describe('filesystem source adapter', () => {
  const rigA = { kind: 'rig', rig: 'rig-a', host: 'local' }
  const rigB = { kind: 'rig', rig: 'rig-b', host: 'local' }

  it('declares every capability and the lock-file mirror', () => {
    const adapter = createFilesystemSourceAdapter({
      root: tempRoot(),
      writer: 'w',
      trustedWriters: ['w'],
    })
    expect(validateSourceAdapter(adapter)).toEqual({ ok: true, errors: [] })
    expect(adapter).toMatchObject({
      id: 'filesystem',
      system: 'filesystem',
      scope: 'local',
      claimMirror: 'lock-file',
      readyPredicateKinds: ['label', 'status', 'lifecycle'],
    })
    expect(adapter.capabilities).toHaveLength(9)
    expect(() => createFilesystemSourceAdapter({ root: tempRoot() })).toThrow('writer')
    expect(() => createFilesystemSourceAdapter({ root: tempRoot(), writer: 'w' })).toThrow(
      'requires trustedWriters',
    )
    expect(() =>
      createFilesystemSourceAdapter({ root: tempRoot(), writer: 'w', trustedWriters: [] }),
    ).toThrow('requires trustedWriters')
  })

  it('serializes interleaved claims by two rigs on one root into one holder', async () => {
    const root = tempRoot()
    const trustedWriters = ['rig-a', 'rig-b']
    const a = createFilesystemSourceAdapter({ root, writer: 'rig-a', trustedWriters })
    const b = createFilesystemSourceAdapter({ root, writer: 'rig-b', trustedWriters })
    const refs = ['one', 'two', 'three'].map((id) =>
      createFilesystemWorkItem(root, { id, title: id }),
    )
    for (const [index, refText] of refs.entries()) {
      const reference = a.toReference(parseSourceRef(refText))
      const order =
        index % 2
          ? [
              () => claimOrYield({ adapter: b, reference, owner: rigB }),
              () => claimOrYield({ adapter: a, reference, owner: rigA }),
            ]
          : [
              () => claimOrYield({ adapter: a, reference, owner: rigA }),
              () => claimOrYield({ adapter: b, reference, owner: rigB }),
            ]
      const results = await Promise.all(order.map((run) => run()))
      expect(results.filter((result) => result.won)).toHaveLength(1)
      const log = readFileSync(join(root, 'items', reference.id, 'log.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(log.map((row) => row.seq)).toEqual(log.map((_, i) => i + 1))
      const winner = results.find((result) => result.won).holder
      const first = log.find((row) => row.type === 'claim')
      expect(first.entry.owner).toEqual(winner)
      const lock = JSON.parse(readFileSync(join(root, 'items', reference.id, 'claim.lock'), 'utf8'))
      expect(lock.holder).toEqual(winner)
    }
  })

  it('reads role-pass comments as transitions and counts open gates', async () => {
    const root = tempRoot()
    const adapter = createFilesystemSourceAdapter({
      root,
      writer: 'agentflow-bot',
      trustedWriters: ['agentflow-bot'],
    })
    createFilesystemWorkItem(root, {
      id: 'g1',
      title: 'Gate item',
      changeClass: 'standard',
      partOf: 578,
    })
    const comment = async (body) => {
      const plan = await adapter.previewMutation({
        operation: 'add-comment',
        parameters: { id: 'g1', body },
        actionBoundary: { effective: 'external-action' },
      })
      return adapter.applyMutation(plan, { confirm: plan.token })
    }
    const key = rolePassIdempotencyKey({ stableId: 'af-filesystem-x-g1', phase: 1, status: 'pass' })
    await comment(
      formatRolePassComment({
        idempotencyKey: key,
        phase: 1,
        role: 'analyst',
        status: 'pass',
        seat: 'pm.analyst',
        executedBy: 'codex',
        launcher: 'codex',
        executor: 'codex-cli',
        transport: 'local-cli',
        delegationBoundary: 'current-session',
        model: null,
        body: 'done',
      }),
    )
    await comment('<!-- agentflow-gate:waiting:review -->')
    await comment('<!-- agentflow-gate:waiting:merge -->')
    await comment('<!-- agentflow-gate:closed:review -->')
    const item = await adapter.readWorkItem({ id: 'g1' })
    expect(item).toMatchObject({
      partOf: '578',
      changeClass: 'standard',
      openGates: 1,
      kind: 'item',
    })
    expect(item.transitions).toEqual([
      {
        phase: 1,
        status: 'pass',
        seat: 'pm.analyst',
        role: 'analyst',
        idempotencyKey: key,
        uri: 'filesystem:local#g1/log/1',
        writer: 'agentflow-bot',
        executedBy: 'codex',
        launcher: 'codex',
        executor: 'codex-cli',
        transport: 'local-cli',
        delegationBoundary: 'current-session',
        model: null,
      },
    ])
  })

  it('changes content only through mutation plans and rejects a stale plan', async () => {
    const root = tempRoot()
    const adapter = createFilesystemSourceAdapter({ root, writer: 'w', trustedWriters: ['w'] })
    createFilesystemWorkItem(root, { id: 'm1', title: 'Before', labels: ['a'] })
    const preview = (operation, parameters) =>
      adapter.previewMutation({
        operation,
        parameters,
        actionBoundary: { effective: 'external-action' },
      })
    const stale = await preview('update-item', { id: 'm1', labels: ['a', 'agentflow:ready'] })
    const close = await preview('set-lifecycle', { id: 'm1', lifecycle: 'closed' })
    const before = (await adapter.readWorkItem({ id: 'm1' })).revision
    await adapter.applyMutation(close, { confirm: close.token })
    const after = await adapter.readWorkItem({ id: 'm1' })
    expect(after.lifecycle).toBe('closed')
    expect(after.revision).not.toBe(before)
    await expect(adapter.applyMutation(stale, { confirm: stale.token })).rejects.toMatchObject({
      code: 'source-plan-stale',
    })
    await expect(
      preview('add-comment', { id: 'm1', body: 'x' }).then((plan) => plan.capability),
    ).resolves.toBe('mutate-comments')
    await expect(
      adapter.previewMutation({
        operation: 'add-comment',
        parameters: { id: 'm1', body: 'x' },
        actionBoundary: { effective: 'observe' },
      }),
    ).rejects.toThrow('requires an open-pr or external-action boundary')
    expect(existsSync(join(root, 'items', 'm1', '.log.lock'))).toBe(false)
  })

  it('rejects unsafe item ids and foreign references', () => {
    const root = tempRoot()
    const adapter = createFilesystemSourceAdapter({ root, writer: 'w', trustedWriters: ['w'] })
    expect(() => createFilesystemWorkItem(root, { id: '../escape', title: 'x' })).toThrow('invalid')
    expect(() => adapter.toReference({ system: 'github', scope: 'local', id: '1' })).toThrow()
    expect(() =>
      adapter.toReference({ system: 'filesystem', scope: 'local', id: '../x' }),
    ).toThrow()
  })
})

const readLogRows = (root, id) =>
  readFileSync(join(root, 'items', id, 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

describe('filesystem source adapter under failure', () => {
  const rigA = { kind: 'rig', rig: 'rig-a', host: 'local' }
  const rigB = { kind: 'rig', rig: 'rig-b', host: 'local' }
  const setup = () => {
    const root = tempRoot()
    const trustedWriters = ['rig-a', 'rig-b']
    createFilesystemWorkItem(root, { id: 'f1', title: 'Failure item' })
    return {
      root,
      make: (writer, extra = {}) =>
        createFilesystemSourceAdapter({ root, writer, trustedWriters, ...extra }),
    }
  }

  it('keeps one receipt store per writer', async () => {
    const { root, make } = setup()
    await make('rig-a').claim({ id: 'f1' }, rigA)
    await make('rig-b').claim({ id: 'f1' }, rigB)
    const stores = readdirSync(root).filter((name) => /^receipts-.*\.json$/.test(name))
    expect(stores).toHaveLength(2)
    expect(stores.some((name) => name.startsWith('receipts-rig-a-'))).toBe(true)
  })

  it('does not fail a claim whose log entry landed when the receipt flush fails', async () => {
    const { make } = setup()
    const broken = {
      get: async () => null,
      put: async () => {
        throw new Error('Source receipt store is locked by another writer')
      },
    }
    const a = make('rig-a', { receiptStore: broken })
    expect(await a.claim({ id: 'f1' }, rigA)).toMatchObject({ status: 'held', holder: rigA })
    expect(await a.release({ id: 'f1' }, rigA)).toMatchObject({ status: 'free' })
  })

  it('removes an item lock left by a process that is gone', async () => {
    const { root, make } = setup()
    const { pid } = spawnSync(process.execPath, ['-e', ''])
    writeFileSync(join(root, 'items', 'f1', '.log.lock'), JSON.stringify({ pid, id: 'dead' }))
    expect(await make('rig-a').claim({ id: 'f1' }, rigA)).toMatchObject({ holder: rigA })
    expect(existsSync(join(root, 'items', 'f1', '.log.lock'))).toBe(false)
  })

  const lockPath = (root) => join(root, 'items', 'f1', '.log.lock')
  const age = (path, seconds) => {
    const then = new Date(Date.now() - seconds * 1000)
    utimesSync(path, then, then)
  }
  const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid

  it('removes an empty lock left by a crash once it is older than the bound', async () => {
    const { root, make } = setup()
    writeFileSync(lockPath(root), '')
    age(lockPath(root), 60)
    expect(await make('rig-a').claim({ id: 'f1' }, rigA)).toMatchObject({ holder: rigA })
    expect(existsSync(lockPath(root))).toBe(false)
  })

  it('keeps a fresh empty lock and names the lock in the error', async () => {
    const { root, make } = setup()
    writeFileSync(lockPath(root), '')
    const a = make('rig-a', { lockAttempts: 3 })
    await expect(a.claim({ id: 'f1' }, rigA)).rejects.toMatchObject({
      code: 'source-lock-held',
      message: expect.stringContaining(`delete ${lockPath(root)}`),
    })
    expect(existsSync(lockPath(root))).toBe(true)
  })

  it('removes a recovery guard left by a crash once it is older than the bound', async () => {
    const { root, make } = setup()
    writeFileSync(lockPath(root), JSON.stringify({ pid: deadPid(), host: hostname(), id: 'x' }))
    writeFileSync(`${lockPath(root)}.recovery`, '')
    age(`${lockPath(root)}.recovery`, 60)
    expect(await make('rig-a').claim({ id: 'f1' }, rigA)).toMatchObject({ holder: rigA })
    expect(existsSync(`${lockPath(root)}.recovery`)).toBe(false)
  })

  it('keeps a fresh recovery guard', async () => {
    const { root, make } = setup()
    writeFileSync(lockPath(root), JSON.stringify({ pid: deadPid(), host: hostname(), id: 'x' }))
    writeFileSync(`${lockPath(root)}.recovery`, '')
    await expect(
      make('rig-a', { lockAttempts: 3 }).claim({ id: 'f1' }, rigA),
    ).rejects.toMatchObject({ code: 'source-lock-held' })
  })

  it('never steals a lock written by another host', async () => {
    const { root, make } = setup()
    writeFileSync(
      lockPath(root),
      JSON.stringify({ pid: deadPid(), host: `${hostname()}-elsewhere`, id: 'x' }),
    )
    age(lockPath(root), 3600)
    await expect(
      make('rig-a', { lockAttempts: 3 }).claim({ id: 'f1' }, rigA),
    ).rejects.toMatchObject({
      code: 'source-lock-held',
      message: expect.stringContaining('-elsewhere'),
    })
    expect(existsSync(lockPath(root))).toBe(true)
  })

  it('skips a torn trailing log line and cuts it before the next append', async () => {
    const { root, make } = setup()
    const a = make('rig-a')
    await a.claim({ id: 'f1' }, rigA)
    appendFileSync(join(root, 'items', 'f1', 'log.jsonl'), '{"seq":2,"at":"20')
    expect(await a.readClaim({ id: 'f1' })).toMatchObject({ holder: rigA })
    expect((await a.readWorkItem({ id: 'f1' })).id).toBe('f1')
    await make('rig-b').claim({ id: 'f1' }, rigB)
    expect(readLogRows(root, 'f1').map((row) => row.seq)).toEqual([1, 2])
  })

  it('refuses a corrupt line before the end of the log', async () => {
    const { root, make } = setup()
    const a = make('rig-a')
    await a.claim({ id: 'f1' }, rigA)
    const path = join(root, 'items', 'f1', 'log.jsonl')
    writeFileSync(path, `garbage\n${readFileSync(path, 'utf8')}`)
    await expect(a.readClaim({ id: 'f1' })).rejects.toThrow()
  })
})

describe('filesystem source adapter across processes', () => {
  const run = promisify(execFile)
  const worker = `
    const [root, writer, writers, items, startAt] = process.argv.slice(1)
    const { createFilesystemSourceAdapter } = await import(${JSON.stringify(
      new URL('../sources/filesystem-source.mjs', import.meta.url).href,
    )})
    const { claimOrYield } = await import(${JSON.stringify(
      new URL('../core/source-claim.mjs', import.meta.url).href,
    )})
    const adapter = createFilesystemSourceAdapter({ root, writer, trustedWriters: JSON.parse(writers) })
    while (Date.now() < Number(startAt)) {}
    const out = []
    for (const id of JSON.parse(items)) {
      const owner = { kind: 'rig', rig: writer, host: 'local' }
      try {
        out.push({ id, ...(await claimOrYield({ adapter, reference: { id }, owner })) })
      } catch (error) {
        out.push({ id, error: String(error?.message ?? error) })
      }
    }
    process.stdout.write(JSON.stringify(out))
  `

  it('gives every item exactly one holder when 8 processes race on 20 items', async () => {
    const root = tempRoot()
    const ids = Array.from({ length: 20 }, (_, i) => `race-${i}`)
    for (const id of ids) createFilesystemWorkItem(root, { id, title: id })
    const writers = Array.from({ length: 8 }, (_, i) => `rig-${i}`)
    const startAt = Date.now() + 1500
    const outputs = await Promise.all(
      writers.map((writer, index) => {
        const order = [
          ...ids.slice((index * 3) % ids.length),
          ...ids.slice(0, (index * 3) % ids.length),
        ]
        return run(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            worker,
            root,
            writer,
            JSON.stringify(writers),
            JSON.stringify(order),
            String(startAt),
          ],
          { timeout: 60000 },
        ).then(({ stdout }) => JSON.parse(stdout).map((result) => ({ ...result, writer })))
      }),
    )
    const results = outputs.flat()
    expect(results.filter((result) => result.error)).toEqual([])
    const reader = createFilesystemSourceAdapter({
      root,
      writer: 'reader',
      trustedWriters: writers,
    })
    for (const id of ids) {
      const forItem = results.filter((result) => result.id === id)
      expect(forItem).toHaveLength(8)
      const winners = forItem.filter((result) => result.won)
      expect(winners).toHaveLength(1)
      const holder = { kind: 'rig', rig: winners[0].writer, host: 'local' }
      expect(forItem.every((result) => result.holder.rig === holder.rig)).toBe(true)
      expect(await reader.readClaim({ id })).toMatchObject({
        status: 'held',
        holder,
        mirror: { diverged: false },
      })
      const rows = readLogRows(root, id)
      expect(rows.map((row) => row.seq)).toEqual(rows.map((_, i) => i + 1))
      for (const loser of forItem.filter((result) => !result.won)) {
        const own = rows.filter((row) => row.entry?.owner?.rig === loser.writer)
        expect(own.at(-1)?.entry.type).toBe('release')
      }
    }
  }, 90000)
})
