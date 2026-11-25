#!/usr/bin/env node
// `agentflow-sdlc coordinator <status|pause|resume|kill>` (design item W0-14).
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCoordinatorState, writeCoordinatorState } from '../lib/runtime/coordinator-state.mjs'
import { killProcessTree } from '../lib/qa/process-supervisor.mjs'
import { readActiveRun } from './guarded-run.mjs'

const VERBS = ['status', 'pause', 'resume', 'kill']

export async function coordinator(verb, { root, reason = null, verifyMs = 8000 }) {
  if (!VERBS.includes(verb)) throw new Error(`Usage: coordinator <${VERBS.join('|')}>`)
  if (verb === 'status') return { ...readCoordinatorState(root), activeRun: readActiveRun(root) }
  if (verb === 'pause') return writeCoordinatorState(root, { state: 'paused', reason })
  if (verb === 'resume') return writeCoordinatorState(root, { state: 'running', reason })
  // kill: record the state first, so a guarded run that is starting refuses, then stop the
  // active run's process tree.
  const state = writeCoordinatorState(root, { state: 'killed', reason })
  const active = readActiveRun(root)
  if (!active?.pid) return { ...state, stoppedRun: active?.runId ?? null, stopVerified: true }
  // Kill, then confirm the process is gone; retry once a second for up to `verifyMs`.
  const until = Date.now() + verifyMs
  while (alive(active.pid) && Date.now() < until) {
    await killProcessTree(active.pid)
    await new Promise((done) => setTimeout(done, 1000))
  }
  return { ...state, stoppedRun: active.runId, stopVerified: !alive(active.pid) }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export async function main(argv) {
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  const valued = new Set(['--target', '--reason'])
  const verb = argv.find((arg, i) => !arg.startsWith('--') && !valued.has(argv[i - 1]))
  const root = resolve(flag('--target') ?? process.cwd())
  const result = await coordinator(verb, { root, reason: flag('--reason') ?? null })
  process.stdout.write(
    argv.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : `${result.state}\n`,
  )
  // A kill that could not confirm the run stopped is a failure the person must see.
  return result.stopVerified === false ? 1 : 0
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
