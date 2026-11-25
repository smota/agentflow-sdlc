#!/usr/bin/env node
// The week-0 guarded runner (design item W0-14). It checks the coordinator state and the run cap
// under one admission lock, starts one agent command inside the configured sandbox command with a
// credential-free environment, enforces a timeout, records start and stop, stops when the
// coordinator is killed, and tears the sandbox down afterwards. The launcher replaces it at the
// M1 exit.
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dispatchAllowed, readCoordinatorState } from '../lib/runtime/coordinator-state.mjs'
import { admitRun } from '../lib/runtime/run-cap.mjs'
import { killProcessTree } from '../lib/qa/process-supervisor.mjs'

const BASE_ENVIRONMENT = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'SystemRoot']
// The only extra variables a sandbox may receive: none of them carries a credential value.
export const APPROVED_EXTRA_ENVIRONMENT = Object.freeze([
  'ComSpec',
  'PATHEXT',
  'windir',
  'SystemDrive',
  'LOCALAPPDATA',
  'APPDATA',
  'ProgramData',
  'ProgramFiles',
  'LANG',
  'LC_ALL',
  'TERM',
  'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME',
  'DOCKER_HOST',
  'DOCKER_CONFIG',
])
const LOCK_STALE_MS = 30_000
const KILL_RETRY_MS = 2_000

export const runsDirectory = (root) => join(root, '.agentflow', 'runs')
export const activeRunPath = (root) => join(runsDirectory(root), 'active.json')
export const sandboxConfigPath = (root) => join(root, '.agentflow', 'sandbox.json')
const lockPath = (root) => join(runsDirectory(root), 'admission.lock')

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function writeAtomically(path, text) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, text)
  renameSync(temporary, path)
}

// An active record counts only while its process lives and its own deadline (plus a minute) has
// not passed, which bounds the window in which a reused PID could be mistaken for the run.
export function readActiveRun(root, now = Date.now()) {
  if (!existsSync(activeRunPath(root))) return null
  let run
  try {
    run = JSON.parse(readFileSync(activeRunPath(root), 'utf8'))
  } catch {
    return null
  }
  if (run?.pid === null && Date.parse(run.startedAt) + LOCK_STALE_MS > now) return run
  const expiresAt = Date.parse(run?.startedAt) + (run?.timeoutSeconds ?? 0) * 1000 + 60_000
  return alive(run?.pid) && expiresAt > now ? run : null
}

// `.agentflow/sandbox.json`:
// `{ "startCommand": [...], "command": [...], "stopCommand": [...], "envAllowlist": [...] }`.
// The command lines come from the week-0 `sbx` spike (ADR 020). `startCommand` creates the run's
// sandbox, the agent command is appended to `command`, and `stopCommand` removes the sandbox after
// every run, including a killed one: stopping the host process alone leaves the agent running
// inside the sandbox. `{name}` (one sandbox name per run) and `{workspace}` are filled in.
export function fillCommand(argv, vars) {
  return argv.map((part) =>
    part.replaceAll('{name}', vars.name).replaceAll('{workspace}', vars.workspace),
  )
}

function readSandboxConfig(root) {
  const path = sandboxConfigPath(root)
  if (!existsSync(path)) return null
  const config = JSON.parse(readFileSync(path, 'utf8'))
  const strings = (value) =>
    Array.isArray(value) && value.length > 0 && value.every((p) => typeof p === 'string')
  if (!strings(config?.command)) throw new Error(`${path} needs a non-empty "command" array`)
  for (const key of ['startCommand', 'stopCommand']) {
    if (config[key] !== undefined && !strings(config[key])) {
      throw new Error(`${path}: "${key}" must be a non-empty array of strings`)
    }
  }
  const extra = config.envAllowlist ?? []
  if (!Array.isArray(extra) || extra.some((n) => typeof n !== 'string')) {
    throw new Error(`${path}: "envAllowlist" must be an array of variable names`)
  }
  const unapproved = extra.filter((name) => !APPROVED_EXTRA_ENVIRONMENT.includes(name))
  if (unapproved.length) {
    throw new Error(`${path} may pass only approved variables; not approved: ${unapproved}`)
  }
  return {
    startCommand: config.startCommand ?? null,
    command: config.command,
    stopCommand: config.stopCommand ?? null,
    envAllowlist: extra,
  }
}

export function sandboxEnvironment(source, extra = []) {
  const names = [
    ...BASE_ENVIRONMENT,
    ...extra.filter((n) => APPROVED_EXTRA_ENVIRONMENT.includes(n)),
  ]
  return Object.fromEntries(names.filter((n) => source[n] !== undefined).map((n) => [n, source[n]]))
}

function acquireLock(root) {
  const path = lockPath(root)
  try {
    if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) rmSync(path, { force: true })
  } catch {
    // No lock yet.
  }
  try {
    closeSync(openSync(path, 'wx'))
    return () => rmSync(path, { force: true })
  } catch {
    return null
  }
}

const splitCommand = (argv) => [argv[0], argv.slice(1)]
const record = (root, event) =>
  appendFileSync(join(runsDirectory(root), 'log.jsonl'), `${JSON.stringify(event)}\n`)
const refused = (reason, extra = {}) => ({ status: 'refused', reason, ...extra })

export async function guardedRun({
  root,
  command,
  timeoutSeconds = 900,
  pollMs = 500,
  environment = process.env,
  stdio = 'inherit',
}) {
  if (!command?.length) return refused('no agent command given')
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return refused('timeout must be a finite number of seconds above zero')
  }
  const config = readSandboxConfig(root)
  if (!config) return refused('no sandbox command in .agentflow/sandbox.json; set it from ADR 020')
  mkdirSync(runsDirectory(root), { recursive: true })

  // Admission: state, active run and cap are checked and the run is registered under one lock.
  const release = acquireLock(root)
  if (!release) return refused('another guarded run is being admitted')
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  try {
    const gate = dispatchAllowed(root)
    if (!gate.allowed) return refused(`coordinator is ${gate.state}`)
    if (readActiveRun(root)) return refused('another guarded run is active')
    const cap = admitRun(root, { id: runId })
    if (!cap.admitted) return refused(cap.reason, { cap })
    writeAtomically(
      activeRunPath(root),
      `${JSON.stringify({ runId, pid: null, startedAt, timeoutSeconds })}\n`,
    )
  } finally {
    release()
  }

  const vars = { name: `af-${runId.slice(0, 8)}`, workspace: root }
  const sandboxEnv = sandboxEnvironment(environment, config.envAllowlist)
  const teardownSandbox = () =>
    config.stopCommand
      ? spawnSync(...splitCommand(fillCommand(config.stopCommand, vars)), {
          cwd: root,
          env: sandboxEnv,
          stdio: 'ignore',
          windowsHide: true,
          timeout: 60_000,
        }).status
      : null
  if (config.startCommand) {
    const started = spawnSync(...splitCommand(fillCommand(config.startCommand, vars)), {
      cwd: root,
      env: sandboxEnv,
      stdio: 'ignore',
      windowsHide: true,
      timeout: 300_000,
    })
    if (started.status !== 0) {
      const teardown = teardownSandbox()
      rmSync(activeRunPath(root), { force: true })
      record(root, {
        event: 'stop',
        runId,
        at: new Date().toISOString(),
        reason: 'failed-to-start',
        teardown,
      })
      return {
        status: 'failed-to-start',
        runId,
        reason: 'sandbox start command failed',
        exitCode: started.status,
        teardown,
        error: started.error?.message ?? null,
      }
    }
  }

  const [executable, ...args] = [...fillCommand(config.command, vars), ...command]
  const child = spawn(executable, args, {
    cwd: root,
    env: sandboxEnv,
    stdio,
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  const exited = new Promise((done) => {
    child.once('exit', (code, signal) => done({ code, signal }))
    child.once('error', (error) => done({ code: null, signal: null, error: error.message }))
  })
  let reason = 'exited'
  let lastKill = 0
  const stop = (why) => {
    if (reason === 'exited') reason = why
    if (Date.now() - lastKill >= KILL_RETRY_MS) {
      lastKill = Date.now()
      killProcessTree(child.pid)
    }
  }
  try {
    writeAtomically(
      activeRunPath(root),
      `${JSON.stringify({ runId, pid: child.pid, startedAt, timeoutSeconds })}\n`,
    )
    record(root, { event: 'start', runId, pid: child.pid, at: startedAt, executable })
  } catch (error) {
    stop('failed-to-start')
    await exited
    throw error
  }
  // A kill that landed between admission and spawn is caught here, before the first poll.
  if (readCoordinatorState(root).state === 'killed') stop('killed')

  const deadline = Date.now() + timeoutSeconds * 1000
  const watch = setInterval(() => {
    let state = 'killed'
    try {
      state = readCoordinatorState(root).state
    } catch {
      // An unreadable state file stops the run.
    }
    if (state === 'killed') stop('killed')
    else if (reason !== 'exited') stop(reason)
    else if (Date.now() > deadline) stop('timed-out')
  }, pollMs)
  const result = await exited
  clearInterval(watch)
  // The coordinator may have stopped the tree itself before the next poll.
  if (reason === 'exited' && result.code !== 0 && readCoordinatorState(root).state === 'killed') {
    reason = 'killed'
  }
  // POSIX: the process group outlives its leader, so stop anything the sandbox command left.
  if (process.platform !== 'win32') killProcessTree(child.pid)
  // Remove the sandbox: killing the host process does not stop the agent inside it (ADR 020).
  const teardown = teardownSandbox()
  try {
    if (JSON.parse(readFileSync(activeRunPath(root), 'utf8')).runId === runId) {
      rmSync(activeRunPath(root), { force: true })
    }
  } catch {
    // Already gone.
  }
  record(root, { event: 'stop', runId, at: new Date().toISOString(), reason, teardown, ...result })
  const status = reason !== 'exited' ? reason : result.code === 0 ? 'completed' : 'failed'
  return { status, runId, reason, exitCode: result.code, teardown, error: result.error ?? null }
}

export async function main(argv) {
  const separator = argv.indexOf('--')
  const options = separator === -1 ? argv : argv.slice(0, separator)
  const command = separator === -1 ? [] : argv.slice(separator + 1)
  const flag = (name) => (options.includes(name) ? options[options.indexOf(name) + 1] : undefined)
  const root = resolve(flag('--target') ?? process.cwd())
  const timeoutSeconds = Number(flag('--timeout-seconds') ?? 900)
  const result = await guardedRun({ root, command, timeoutSeconds })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result.status === 'completed' ? 0 : result.status === 'refused' ? 2 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    },
  )
}
