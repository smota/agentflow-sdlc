#!/usr/bin/env node
// `agentflow-sdlc coordinator <status|pause|resume|kill>` (design item W0-14).
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCoordinatorState, writeCoordinatorState } from '../lib/runtime/coordinator-state.mjs'
import { killProcessTree } from '../lib/qa/process-supervisor.mjs'
import { readActiveRun } from './guarded-run.mjs'

const VERBS = ['status', 'pause', 'resume', 'kill']

export async function coordinator(verb, { root, reason = null }) {
  if (!VERBS.includes(verb)) throw new Error(`Usage: coordinator <${VERBS.join('|')}>`)
  if (verb === 'status') return { ...readCoordinatorState(root), activeRun: readActiveRun(root) }
  if (verb === 'pause') return writeCoordinatorState(root, { state: 'paused', reason })
  if (verb === 'resume') return writeCoordinatorState(root, { state: 'running', reason })
  // kill: record the state first, so a guarded run that is starting refuses, then stop the
  // active run's process tree.
  const state = writeCoordinatorState(root, { state: 'killed', reason })
  const active = readActiveRun(root)
  if (active) await killProcessTree(active.pid)
  return { ...state, stoppedRun: active?.runId ?? null }
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
  return 0
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
