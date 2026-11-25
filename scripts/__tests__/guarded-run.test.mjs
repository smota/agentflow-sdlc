import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCoordinatorState } from '../../lib/runtime/coordinator-state.mjs'
import { runCapPath } from '../../lib/runtime/run-cap.mjs'
import { coordinator } from '../coordinator.mjs'
import { activeRunPath, guardedRun, runsDirectory, sandboxConfigPath } from '../guarded-run.mjs'

// An inline fake `sbx`: the agent command is `env <file>`, `sleep <ms>` or `exit <code>`.
const FAKE_SANDBOX = `
const [, , action, value] = process.argv
if (action === 'env') require('node:fs').writeFileSync(value, JSON.stringify(process.env))
if (action === 'sleep') setTimeout(() => {}, Number(value))
if (action === 'exit') process.exitCode = Number(value)
`

let root
const run = (command, options = {}) =>
  guardedRun({ root, command, pollMs: 100, stdio: 'ignore', ...options })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'guarded-run-'))
  mkdirSync(join(root, '.agentflow'), { recursive: true })
  writeFileSync(join(root, 'fake-sbx.cjs'), FAKE_SANDBOX)
  writeFileSync(
    sandboxConfigPath(root),
    JSON.stringify({ command: [process.execPath, join(root, 'fake-sbx.cjs')] }),
  )
  writeCoordinatorState(root, { state: 'running' })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('guarded run', () => {
  it('refuses while the coordinator is paused or killed', async () => {
    writeCoordinatorState(root, { state: 'paused' })
    expect(await run(['exit', '0'])).toMatchObject({
      status: 'refused',
      reason: 'coordinator is paused',
    })
    writeCoordinatorState(root, { state: 'killed' })
    expect((await run(['exit', '0'])).reason).toBe('coordinator is killed')
  })

  it('refuses when no sandbox command is configured', async () => {
    rmSync(sandboxConfigPath(root))
    expect((await run(['exit', '0'])).reason).toMatch(/no sandbox command/)
  })

  it.each([['GITHUB_TOKEN'], ['DATABASE_URL'], ['AUTHORIZATION']])(
    'refuses %s in the sandbox allowlist, because only approved variables may pass',
    async (name) => {
      writeFileSync(
        sandboxConfigPath(root),
        JSON.stringify({ command: [process.execPath], envAllowlist: [name] }),
      )
      await expect(run(['exit', '0'])).rejects.toThrow(/only approved variables/)
    },
  )

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [0], [-5]])(
    'refuses a timeout of %s',
    async (timeoutSeconds) => {
      expect(await run(['exit', '0'], { timeoutSeconds })).toMatchObject({
        status: 'refused',
        reason: expect.stringMatching(/timeout/),
      })
    },
  )

  it('refuses while another run is being admitted', async () => {
    mkdirSync(runsDirectory(root), { recursive: true })
    writeFileSync(join(runsDirectory(root), 'admission.lock'), '')
    expect((await run(['exit', '0'])).reason).toBe('another guarded run is being admitted')
  })

  it('ignores a stale active record whose process is gone', async () => {
    mkdirSync(runsDirectory(root), { recursive: true })
    writeFileSync(
      activeRunPath(root),
      JSON.stringify({ runId: 'old', pid: 2147483646, startedAt: new Date().toISOString() }),
    )
    expect((await run(['exit', '0'])).status).toBe('completed')
  })

  it('tears the sandbox down with the stop command after every run', async () => {
    const marker = join(root, 'stopped.txt')
    writeFileSync(
      join(root, 'fake-stop.cjs'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`,
    )
    writeFileSync(
      sandboxConfigPath(root),
      JSON.stringify({
        command: [process.execPath, join(root, 'fake-sbx.cjs')],
        stopCommand: [process.execPath, join(root, 'fake-stop.cjs')],
      }),
    )
    expect(await run(['exit', '0'])).toMatchObject({ status: 'completed', teardown: 0 })
    expect(readFileSync(marker, 'utf8')).toBe('ok')
  })

  it('passes an approved extra variable and nothing else', async () => {
    const out = join(root, 'env.json')
    writeFileSync(
      sandboxConfigPath(root),
      JSON.stringify({
        command: [process.execPath, join(root, 'fake-sbx.cjs')],
        envAllowlist: ['LANG'],
      }),
    )
    const environment = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      LANG: 'C.UTF-8',
      DATABASE_URL: 'postgres://u:secret@h/db',
    }
    await run(['env', out], { environment })
    const seen = JSON.parse(readFileSync(out, 'utf8'))
    expect(seen.LANG).toBe('C.UTF-8')
    expect(seen.DATABASE_URL).toBeUndefined()
  })

  it('refuses a run over the cap', async () => {
    writeFileSync(
      runCapPath(root),
      JSON.stringify({ limit: 1, windowHours: 24, runs: [{ id: 'x', at: new Date() }] }),
    )
    expect(await run(['exit', '0'])).toMatchObject({
      status: 'refused',
      reason: 'run cap reached for the current window',
    })
  })

  it('runs with no host secret in the environment and records start and stop', async () => {
    const out = join(root, 'env.json')
    const environment = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      GITHUB_TOKEN: 'ghp_secret',
      GH_TOKEN: 'secret',
      ANTHROPIC_API_KEY: 'secret',
    }
    const result = await run(['env', out], { environment })
    expect(result).toMatchObject({ status: 'completed', exitCode: 0 })
    const seen = JSON.parse(readFileSync(out, 'utf8'))
    expect(seen.GITHUB_TOKEN).toBeUndefined()
    expect(seen.GH_TOKEN).toBeUndefined()
    expect(seen.ANTHROPIC_API_KEY).toBeUndefined()
    expect(existsSync(activeRunPath(root))).toBe(false)
    const events = readFileSync(join(runsDirectory(root), 'log.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events.map((e) => e.event)).toEqual(['start', 'stop'])
    expect(events[1]).toMatchObject({ runId: result.runId, reason: 'exited', code: 0 })
  })

  it('reports a non-zero exit as failed', async () => {
    expect(await run(['exit', '3'])).toMatchObject({ status: 'failed', exitCode: 3 })
  })

  it('stops a run that exceeds its timeout', async () => {
    const result = await run(['sleep', '30000'], { timeoutSeconds: 1 })
    expect(result.status).toBe('timed-out')
  }, 20000)

  it('stops a run within 10 seconds of coordinator kill', async () => {
    const running = run(['sleep', '60000'])
    const startedBy = Date.now() + 5000
    while (!existsSync(activeRunPath(root)) && Date.now() < startedBy) {
      await new Promise((done) => setTimeout(done, 50))
    }
    const killedAt = Date.now()
    const killed = await coordinator('kill', { root, reason: 'drill' })
    expect(killed).toMatchObject({ state: 'killed', stopVerified: true })
    const result = await running
    expect(result.status).toBe('killed')
    expect(Date.now() - killedAt).toBeLessThan(10000)
  }, 30000)

  it('reports killed when the coordinator stops the tree before the runner polls again', async () => {
    const running = run(['sleep', '60000'], { pollMs: 60000 })
    const startedBy = Date.now() + 5000
    while (Date.now() < startedBy) {
      const active = existsSync(activeRunPath(root))
        ? JSON.parse(readFileSync(activeRunPath(root), 'utf8'))
        : null
      if (active?.pid) break
      await new Promise((done) => setTimeout(done, 50))
    }
    await coordinator('kill', { root })
    expect((await running).status).toBe('killed')
  }, 30000)
})
