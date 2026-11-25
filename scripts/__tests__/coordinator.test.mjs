import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { coordinator } from '../coordinator.mjs'

let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coordinator-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('coordinator command', () => {
  it('starts paused and reports no active run', async () => {
    expect(await coordinator('status', { root })).toMatchObject({
      state: 'paused',
      activeRun: null,
    })
  })

  it('resumes, pauses and kills', async () => {
    expect((await coordinator('resume', { root })).state).toBe('running')
    expect((await coordinator('pause', { root, reason: 'lunch' })).reason).toBe('lunch')
    expect(await coordinator('kill', { root })).toMatchObject({
      state: 'killed',
      stoppedRun: null,
    })
    expect((await coordinator('status', { root })).state).toBe('killed')
  })

  it('rejects an unknown verb', async () => {
    await expect(coordinator('drain', { root })).rejects.toThrow(/Usage: coordinator/)
  })
})
