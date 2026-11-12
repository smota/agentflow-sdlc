#!/usr/bin/env node
// `agentflow-sdlc bridge …` (#582): push ready source work into the OpenRig queue and return
// evidence. See docs/openrig-bridge.md. With no rig configured every subcommand is a no-op that
// exits 0, without constructing the source adapter or calling rig.
import { execFile as nodeExecFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BridgeError, createBridge } from '../lib/bridge/bridge.mjs'
import { NO_RIG_MESSAGE, loadBridgeConfig } from '../lib/bridge/config.mjs'
import { createRigCliQueuePort } from '../lib/bridge/queue-port.mjs'
import { createWorktreesPort } from '../lib/bridge/worktrees-port.mjs'
import { defaultGit } from '../lib/runtime/slice-worktrees.mjs'
import { createSourceAdapter } from '../lib/sources/registry.mjs'

export const BRIDGE_USAGE = `Usage: agentflow-sdlc bridge <intake|start|evidence|reconcile|cleanup|escalate|status> [options] [--target <dir>] [--json]
  bridge intake <ref> [--event ready|review-done|merged|closed] [--payload-file <json>]
  bridge start <qitemId> [--session <seat@rig>]            (defaults to OPENRIG_SESSION_NAME)
  bridge evidence <ref> --phase <n> --status pass|skipped --seat <id> [--reason <text>] --body-file <file>
      --executed-by <slug> --launcher <slug> --executor <target> --transport <t> --delegation-boundary <b> [--model <m>]
  bridge reconcile [--dry-run]
  bridge cleanup <ref>                                     (remove a merged slice's worktree and release its claim)
  bridge escalate <ref> --reason <text>
  bridge status
Exit: 0 done, no rig, not ready, deferred or already queued; 1 source, rig or config failure,
unsupported predicate or refused evidence; 2 usage.
`
const SUBCOMMANDS = ['intake', 'start', 'evidence', 'reconcile', 'cleanup', 'escalate', 'status']
const VALUE_FLAGS = new Set([
  '--event',
  '--payload-file',
  '--session',
  '--phase',
  '--status',
  '--seat',
  '--reason',
  '--body-file',
  '--executed-by',
  '--launcher',
  '--executor',
  '--transport',
  '--delegation-boundary',
  '--model',
  '--target',
])
const FAILURE_STATUSES = new Set([
  'unsupported-predicate',
  'capability-absent',
  'refused',
  'failed',
  'reconciled-with-errors',
])

class UsageError extends Error {}

export function parseBridgeArgs(argv) {
  const flags = {}
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`${arg} needs a value`)
      flags[arg.slice(2)] = value
      index += 1
    } else if (arg.startsWith('--')) {
      flags[arg.slice(2)] = true
    } else {
      positional.push(arg)
    }
  }
  return { subcommand: positional[0] ?? null, args: positional.slice(1), flags }
}

function need(value, name) {
  if (value === undefined || value === null || value === true || value === '') {
    throw new UsageError(`missing ${name}`)
  }
  return value
}

function readFile(cwd, path) {
  return readFileSync(resolve(cwd, path), 'utf8')
}

function render(result) {
  const lines = [`bridge: ${result.status}${result.ref ? ` ${result.ref}` : ''}`]
  for (const [key, value] of Object.entries(result)) {
    if (key === 'status' || key === 'ref' || value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    lines.push(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
  }
  return `${lines.join('\n')}\n`
}

async function run(bridge, { subcommand, args, flags }, { env, cwd }) {
  if (subcommand === 'intake') {
    const ref = need(args[0], '<ref>')
    const pushed = flags['payload-file'] ? JSON.parse(readFile(cwd, flags['payload-file'])) : null
    return bridge.intake(ref, { event: flags.event ?? 'ready', pushed })
  }
  if (subcommand === 'start') {
    const session = flags.session ?? env.OPENRIG_SESSION_NAME
    return bridge.start(need(args[0], '<qitemId>'), { session: need(session, '--session') })
  }
  if (subcommand === 'evidence') {
    const phase = Number(need(flags.phase, '--phase'))
    if (!Number.isInteger(phase)) throw new UsageError('--phase must be an integer')
    return bridge.recordEvidence(need(args[0], '<ref>'), {
      phase,
      status: need(flags.status, '--status'),
      seat: need(flags.seat, '--seat'),
      reason: flags.reason ?? null,
      body: readFile(cwd, need(flags['body-file'], '--body-file')),
      executedBy: need(flags['executed-by'], '--executed-by'),
      launcher: need(flags.launcher, '--launcher'),
      executor: need(flags.executor, '--executor'),
      transport: need(flags.transport, '--transport'),
      delegationBoundary: need(flags['delegation-boundary'], '--delegation-boundary'),
      model: flags.model ?? null,
      session: env.OPENRIG_SESSION_NAME ?? null,
    })
  }
  if (subcommand === 'reconcile') return bridge.reconcile({ dryRun: flags['dry-run'] === true })
  if (subcommand === 'cleanup') return bridge.cleanup(need(args[0], '<ref>'))
  if (subcommand === 'escalate') {
    return bridge.escalate(need(args[0], '<ref>'), { reason: need(flags.reason, '--reason') })
  }
  return bridge.status()
}

// The slice worktree port, when worktrees are enabled (the default once a rig is configured).
// Building it runs no git: the primary checkout is resolved on first use, and a project that is
// not a git repository makes every worktree hook inert.
export function worktreesFor(config, { target, git }) {
  const settings = config.worktrees
  if (!settings || settings.enabled === false) return null
  return createWorktreesPort({
    settings,
    git,
    // The primary checkout even when a command runs inside a slice worktree, so worktrees never
    // nest under another worktree.
    resolveRepoRoot: () => {
      const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: target,
      }).trim()
      return basename(common) === '.git' ? dirname(common) : null
    },
  })
}

export async function main(
  argv = process.argv.slice(2),
  {
    env = process.env,
    execFile = promisify(nodeExecFile),
    cwd = process.cwd(),
    stdout = process.stdout,
    stderr = process.stderr,
    createSource = createSourceAdapter,
    git = defaultGit,
  } = {},
) {
  let parsed
  try {
    parsed = parseBridgeArgs(argv)
  } catch (error) {
    stderr.write(`${error.message}\n${BRIDGE_USAGE}`)
    return 2
  }
  const json = parsed.flags.json === true
  if (parsed.flags.help || parsed.flags.h) {
    stdout.write(BRIDGE_USAGE)
    return 0
  }
  if (!SUBCOMMANDS.includes(parsed.subcommand)) {
    stderr.write(BRIDGE_USAGE)
    return 2
  }
  const target = resolve(cwd, typeof parsed.flags.target === 'string' ? parsed.flags.target : '.')
  const emit = (result, code) => {
    stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : render(result))
    return code
  }
  const loaded = loadBridgeConfig(target)
  if (loaded.status === 'no-rig') {
    if (json) return emit({ ok: true, status: 'no-rig', message: NO_RIG_MESSAGE }, 0)
    stdout.write(`${NO_RIG_MESSAGE}\n`)
    return 0
  }
  if (loaded.status === 'invalid') {
    return emit({ ok: false, status: 'invalid-config', problems: loaded.problems }, 1)
  }
  try {
    const source = createSource(loaded.config.source, { targetDir: target, env })
    const queue = createRigCliQueuePort({ exec: execFile, cwd: target, env })
    if (parsed.subcommand !== 'status') {
      const available = await queue.available()
      if (!available.ok)
        return emit({ ok: false, status: 'rig-unavailable', reason: available.reason }, 1)
    }
    const worktrees = worktreesFor(loaded.config, { target, git })
    const bridge = createBridge({ source, queue, config: loaded.config, worktrees })
    const result = await run(bridge, parsed, { env, cwd })
    const failed = FAILURE_STATUSES.has(result.status)
    return emit({ ok: !failed, ...result }, failed ? 1 : 0)
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`${error.message}\n${BRIDGE_USAGE}`)
      return 2
    }
    if (error instanceof BridgeError) {
      return emit(
        { ok: false, status: error.status, error: error.message, detail: error.detail },
        error.exitCode,
      )
    }
    return emit({ ok: false, status: 'failed', error: error.message }, 1)
  }
}

const invoked = process.argv[1]?.endsWith('bridge.mjs')
if (invoked) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    },
  )
}
