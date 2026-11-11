import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    const adapter = createFilesystemSourceAdapter({ root: tempRoot(), writer: 'w' })
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
    const adapter = createFilesystemSourceAdapter({ root, writer: 'agentflow-bot' })
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
    const adapter = createFilesystemSourceAdapter({ root, writer: 'w' })
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
    const adapter = createFilesystemSourceAdapter({ root, writer: 'w' })
    expect(() => createFilesystemWorkItem(root, { id: '../escape', title: 'x' })).toThrow('invalid')
    expect(() => adapter.toReference({ system: 'github', scope: 'local', id: '1' })).toThrow()
    expect(() =>
      adapter.toReference({ system: 'filesystem', scope: 'local', id: '../x' }),
    ).toThrow()
  })
})
