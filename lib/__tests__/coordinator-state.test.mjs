import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  coordinatorStatePath,
  dispatchAllowed,
  readCoordinatorState,
  writeCoordinatorState,
} from '../runtime/coordinator-state.mjs'

let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coordinator-state-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('coordinator state', () => {
  it('reads as paused when no state file exists', () => {
    expect(readCoordinatorState(root)).toEqual({
      state: 'paused',
      since: null,
      reason: 'not initialized',
    })
    expect(dispatchAllowed(root).allowed).toBe(false)
  })

  it('writes and reads each state, and only running allows dispatch', () => {
    const now = new Date('2026-11-25T12:00:00Z')
    expect(writeCoordinatorState(root, { state: 'running', now })).toEqual({
      state: 'running',
      since: '2026-11-25T12:00:00.000Z',
      reason: null,
    })
    expect(dispatchAllowed(root).allowed).toBe(true)
    writeCoordinatorState(root, { state: 'killed', reason: 'drill' })
    expect(readCoordinatorState(root)).toMatchObject({ state: 'killed', reason: 'drill' })
    expect(dispatchAllowed(root).allowed).toBe(false)
  })

  it('rejects an unknown state when writing and when reading', () => {
    expect(() => writeCoordinatorState(root, { state: 'draining' })).toThrow(/Unknown/)
    mkdirSync(join(root, '.agentflow'), { recursive: true })
    writeFileSync(coordinatorStatePath(root), JSON.stringify({ state: 'go' }))
    expect(() => readCoordinatorState(root)).toThrow(/Unknown coordinator state/)
  })
})
