import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_RUN_CAP, admitRun, runCapPath } from '../runtime/run-cap.mjs'

let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-cap-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const seed = (cap) => {
  mkdirSync(join(root, '.agentflow'), { recursive: true })
  writeFileSync(runCapPath(root), JSON.stringify(cap))
}

describe('run cap', () => {
  it('admits with the default cap and records the run', () => {
    const now = new Date('2026-11-25T12:00:00Z')
    expect(admitRun(root, { id: 'r1', now })).toMatchObject({
      admitted: true,
      count: 1,
      limit: DEFAULT_RUN_CAP.limit,
    })
    const file = JSON.parse(readFileSync(runCapPath(root), 'utf8'))
    expect(file.runs).toEqual([{ id: 'r1', at: '2026-11-25T12:00:00.000Z' }])
  })

  it('refuses a run over the limit and does not record it', () => {
    const now = new Date('2026-11-25T12:00:00Z')
    seed({ limit: 1, windowHours: 24, runs: [{ id: 'r1', at: '2026-11-25T11:00:00Z' }] })
    expect(admitRun(root, { id: 'r2', now })).toMatchObject({ admitted: false, count: 1 })
    expect(JSON.parse(readFileSync(runCapPath(root), 'utf8')).runs).toHaveLength(1)
  })

  it('drops runs older than the window', () => {
    const now = new Date('2026-11-25T12:00:00Z')
    seed({ limit: 1, windowHours: 1, runs: [{ id: 'old', at: '2026-11-25T10:00:00Z' }] })
    expect(admitRun(root, { id: 'new', now })).toMatchObject({ admitted: true, count: 1 })
    expect(JSON.parse(readFileSync(runCapPath(root), 'utf8')).runs.map((r) => r.id)).toEqual([
      'new',
    ])
  })

  it.each([
    [{ runs: 'none' }],
    [{ runs: [{ id: 'r1', at: 'not a date' }] }],
    [{ runs: [{ at: '2026-11-25T11:00:00Z' }] }],
  ])('fails closed on a malformed history %j', (cap) => {
    seed({ limit: 5, windowHours: 24, ...cap })
    expect(() => admitRun(root, { id: 'r2' })).toThrow(/Invalid run history/)
  })

  it('rejects an invalid limit or a missing run id', () => {
    seed({ limit: -1 })
    expect(() => admitRun(root, { id: 'r1' })).toThrow(/Invalid run cap limit/)
    expect(() => admitRun(root, {})).toThrow(/run id/)
  })
})
