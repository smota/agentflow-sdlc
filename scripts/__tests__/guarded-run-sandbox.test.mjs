import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCoordinatorState } from '../../lib/runtime/coordinator-state.mjs'
import { coordinator } from '../coordinator.mjs'
import { activeRunPath, fillCommand, guardedRun, sandboxConfigPath } from '../guarded-run.mjs'

// Fake sbx pieces: `start` and `stop` append their arguments to a log; `exec` runs the agent
// command (`sleep <ms>` or `exit <code>`).
const FAKE = `
const fs = require('node:fs')
const [, , log, step, ...rest] = process.argv
fs.appendFileSync(log, JSON.stringify([step, ...rest]) + '\\n')
if (step === 'start' && rest[0] === 'fail') process.exitCode = 4
if (step === 'exec') {
  const [action, value] = rest.slice(-2)
  if (action === 'sleep') setTimeout(() => {}, Number(value))
  if (action === 'exit') process.exitCode = Number(value)
}
`

let root
let log
const lines = () =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : []
const configure = (start = ['start', '{name}', '{workspace}']) =>
  writeFileSync(
    sandboxConfigPath(root),
    JSON.stringify({
      startCommand: [process.execPath, join(root, 'fake.cjs'), log, ...start],
      command: [process.execPath, join(root, 'fake.cjs'), log, 'exec', '{name}'],
      stopCommand: [process.execPath, join(root, 'fake.cjs'), log, 'stop', '{name}'],
    }),
  )
const run = (command, options = {}) =>
  guardedRun({ root, command, pollMs: 100, stdio: 'ignore', ...options })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'guarded-sbx-'))
  log = join(root, 'calls.log')
  mkdirSync(join(root, '.agentflow'), { recursive: true })
  writeFileSync(join(root, 'fake.cjs'), FAKE)
  writeCoordinatorState(root, { state: 'running' })
  configure()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('guarded run with one sandbox per run', () => {
  it('fills the placeholders', () => {
    expect(
      fillCommand(['sbx', 'run', '--name', '{name}', '{workspace}'], {
        name: 'af-1',
        workspace: '/w',
      }),
    ).toEqual(['sbx', 'run', '--name', 'af-1', '/w'])
  })

  it('creates the sandbox, runs in it and removes it, all under the same per-run name', async () => {
    const result = await run(['exit', '0'])
    expect(result).toMatchObject({ status: 'completed', teardown: 0 })
    const [start, exec, stop] = lines()
    expect(start[0]).toBe('start')
    expect(start[1]).toMatch(/^af-[0-9a-f]{8}$/)
    expect(start[2]).toBe(root)
    expect(exec.slice(0, 2)).toEqual(['exec', start[1]])
    expect(stop).toEqual(['stop', start[1]])
  })

  it('stops with failed-to-start when the start command fails, and still tears down', async () => {
    configure(['start', 'fail'])
    const result = await run(['exit', '0'])
    expect(result).toMatchObject({ status: 'failed-to-start', exitCode: 4 })
    expect(lines().map((l) => l[0])).toEqual(['start', 'stop'])
    expect(existsSync(activeRunPath(root))).toBe(false)
  })

  it('removes the sandbox after a kill, because killing the host process alone leaves the agent running', async () => {
    const running = run(['sleep', '60000'])
    const until = Date.now() + 5000
    while (Date.now() < until) {
      const active = existsSync(activeRunPath(root))
        ? JSON.parse(readFileSync(activeRunPath(root), 'utf8'))
        : null
      if (active?.pid) break
      await new Promise((done) => setTimeout(done, 50))
    }
    await coordinator('kill', { root })
    expect((await running).status).toBe('killed')
    expect(lines().map((l) => l[0])).toEqual(['start', 'exec', 'stop'])
  }, 30000)
})
