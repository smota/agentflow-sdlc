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

  it('refuses a secret-looking variable in the sandbox allowlist', async () => {
    writeFileSync(
      sandboxConfigPath(root),
      JSON.stringify({ command: [process.execPath], envAllowlist: ['GITHUB_TOKEN'] }),
    )
    await expect(run(['exit', '0'])).rejects.toThrow(/secret-looking/)
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
    expect(killed.state).toBe('killed')
    const result = await running
    expect(result.status).toBe('killed')
    expect(Date.now() - killedAt).toBeLessThan(10000)
  }, 30000)
})
