#!/usr/bin/env node
// The week-0 guarded runner (design item W0-14). It is deliberately small: it checks the coordinator
// state and the run cap, starts one agent command inside the configured sandbox command with a
// credential-free environment, enforces a timeout, records start and stop, and stops when the
// coordinator is killed. The launcher replaces it at the M1 exit.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dispatchAllowed, readCoordinatorState } from '../lib/runtime/coordinator-state.mjs'
import { admitRun } from '../lib/runtime/run-cap.mjs'
import { killProcessTree } from '../lib/qa/process-supervisor.mjs'

const BASE_ENVIRONMENT = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'SystemRoot']
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|KEY|^GH_|^GITHUB_/i

export const runsDirectory = (root) => join(root, '.agentflow', 'runs')
export const activeRunPath = (root) => join(runsDirectory(root), 'active.json')
export const sandboxConfigPath = (root) => join(root, '.agentflow', 'sandbox.json')

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export function readActiveRun(root) {
  if (!existsSync(activeRunPath(root))) return null
  const run = JSON.parse(readFileSync(activeRunPath(root), 'utf8'))
  return Number.isInteger(run?.pid) && alive(run.pid) ? run : null
}

// `.agentflow/sandbox.json`: `{ "command": ["sbx", ...], "envAllowlist": [...] }`. The command line
// comes from the week-0 `sbx` spike (ADR 020); the agent command is appended to it.
function readSandboxConfig(root) {
  const path = sandboxConfigPath(root)
  if (!existsSync(path)) return null
  const config = JSON.parse(readFileSync(path, 'utf8'))
  const command = config?.command
  if (!Array.isArray(command) || !command.length || command.some((p) => typeof p !== 'string')) {
    throw new Error(`${path} needs a non-empty "command" array of strings`)
  }
  const extra = config.envAllowlist ?? []
  const secret = extra.filter((name) => SECRET_NAME.test(name))
  if (secret.length) throw new Error(`${path} may not pass secret-looking variables: ${secret}`)
  return { command, envAllowlist: extra }
}

export function sandboxEnvironment(source, extra = []) {
  const names = [...BASE_ENVIRONMENT, ...extra].filter((name) => !SECRET_NAME.test(name))
  return Object.fromEntries(names.filter((n) => source[n] !== undefined).map((n) => [n, source[n]]))
}

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
  const gate = dispatchAllowed(root)
  if (!gate.allowed) return refused(`coordinator is ${gate.state}`)
  const config = readSandboxConfig(root)
  if (!config) return refused('no sandbox command in .agentflow/sandbox.json; set it from ADR 020')
  if (readActiveRun(root)) return refused('another guarded run is active')
  const runId = randomUUID()
  const cap = admitRun(root, { id: runId })
  if (!cap.admitted) return refused(cap.reason, { cap })

  mkdirSync(runsDirectory(root), { recursive: true })
  const [executable, ...args] = [...config.command, ...command]
  const child = spawn(executable, args, {
    cwd: root,
    env: sandboxEnvironment(environment, config.envAllowlist),
    stdio,
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  const startedAt = new Date().toISOString()
  writeFileSync(activeRunPath(root), `${JSON.stringify({ runId, pid: child.pid, startedAt })}\n`)
  record(root, { event: 'start', runId, pid: child.pid, at: startedAt, executable })

  let reason = 'exited'
  const deadline = Date.now() + timeoutSeconds * 1000
  const exited = new Promise((done) => {
    child.once('exit', (code, signal) => done({ code, signal }))
    child.once('error', (error) => done({ code: null, signal: null, error: error.message }))
  })
  const watch = setInterval(() => {
    if (reason !== 'exited') return
    let state = 'killed'
    try {
      state = readCoordinatorState(root).state
    } catch {
      // An unreadable state file stops the run.
    }
    if (state === 'killed') reason = 'killed'
    else if (Date.now() > deadline) reason = 'timed-out'
    if (reason !== 'exited') killProcessTree(child.pid)
  }, pollMs)
  const result = await exited
  clearInterval(watch)
  rmSync(activeRunPath(root), { force: true })
  record(root, { event: 'stop', runId, at: new Date().toISOString(), reason, ...result })
  const status = reason !== 'exited' ? reason : result.code === 0 ? 'completed' : 'failed'
  return { status, runId, reason, exitCode: result.code, error: result.error ?? null }
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
