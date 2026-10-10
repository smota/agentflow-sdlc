// Product-to-delivery handoff with a busy hold (issue 363).
//
// A product seat sends work to a delivery seat only through this module, as
// `agentflow-sdlc handoff deliver`.
// The delivery squad is the unit: while it has unfinished work, new work is held in a product-squad
// record and no delivery seat is woken. A held handoff goes out once, oldest first, when the squad
// is free, or when the person releases it. An unreadable signal counts as busy.
//
// This file ships inside the product base and uses only Node built-ins, so the copy in the OpenRig
// spec library works on its own after `agentflow-sdlc adapters update openrig`.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

export const DELIVERY_SEAT_PREFIXES = [
  'orch-arch',
  'dev-build-jr',
  'dev-build',
  'dev-build-sr',
  'dev-qa',
  'rev-review',
]

// Environment markers of an agent session. Release and clearing a busy record are refused there.
const AGENT_ENV = [
  'OPENRIG_SESSION_NAME',
  'OPENRIG_NODE_ID',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CODEX_SANDBOX',
  'CODEX_THREAD_ID',
  'PI_CODING_AGENT_DIR',
]

const LOCK_STALE_MS = 60_000

export const USAGE = `Usage:
  agentflow-sdlc handoff deliver --to <session> (--body-file <file> | --body <text>) [--goal <uri>] [--transition <uri>] [--reply] [--medium github --repo <owner/repo> | --medium filesystem --root <dir>] [--json]
  agentflow-sdlc handoff list [--rig <delivery-rig>] [--all] [--json]
  agentflow-sdlc handoff flush [--rig <delivery-rig>] [--medium ...] [--json]
  agentflow-sdlc handoff release <hold-id>            (the person only, at a terminal)
  agentflow-sdlc handoff busy <rig> --set [--note <text>] | --clear   (--clear: the person only)

deliver sends to a free delivery squad and holds the handoff while the squad is busy.
A reply (--reply --goal <uri>) about a goal the squad is already doing is delivered.
There is no option that sends anyway: only the person's release does.
`

class HandoffError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.exitCode = exitCode
  }
}

export function isDeliverySeat(session) {
  const [seat, rig] = String(session ?? '').split('@')
  return Boolean(rig) && DELIVERY_SEAT_PREFIXES.includes(seat)
}

export function rigOf(session) {
  return String(session ?? '').split('@')[1] ?? ''
}

function findOnPath(name, env) {
  const pathValue = env.PATH ?? env.Path ?? ''
  const names = process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name]
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const item of names) {
      const candidate = join(dir, item)
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
  }
  return null
}

// The product CLI that serves `board` is the installed `agentflow-sdlc` command on PATH. The shim
// itself is run, never the file it links to.
function locateCli(env) {
  return findOnPath('agentflow-sdlc', env)
}

export function defaultDeps({ env = process.env } = {}) {
  return {
    env,
    home: homedir(),
    now: () => new Date(),
    run: (command, args, options = {}) =>
      spawnSync(command, args, { encoding: 'utf8', env, shell: false, ...options }),
    cliPath: locateCli(env),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await rl.question(question)
      } finally {
        rl.close()
      }
    },
  }
}

// --- store -------------------------------------------------------------------------------------

function storeDir(deps, rig) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rig))
    throw new HandoffError(`Invalid rig name '${rig}'.`)
  return join(deps.home, '.openrig', 'state', 'agentflow-handoffs', rig)
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temp, path)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function holdsOf(deps, rig) {
  const dir = join(storeDir(deps, rig), 'holds')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(join(dir, name)))
    .sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
    )
}

function saveHold(deps, hold) {
  writeJsonAtomic(join(storeDir(deps, hold.rig), 'holds', `${hold.id}.json`), hold)
}

function allRigs(deps) {
  const root = join(deps.home, '.openrig', 'state', 'agentflow-handoffs')
  return existsSync(root) ? readdirSync(root).sort() : []
}

// One flusher per squad at a time, so a held handoff is delivered exactly once.
function withLock(deps, rig, fn) {
  const lock = join(storeDir(deps, rig), 'lock')
  mkdirSync(dirname(lock), { recursive: true })
  try {
    mkdirSync(lock)
  } catch {
    const age = deps.now().getTime() - statSync(lock).mtimeMs
    if (age < LOCK_STALE_MS)
      throw new HandoffError(`Another handoff for ${rig} is in progress; try again.`)
    rmdirSync(lock)
    mkdirSync(lock)
  }
  try {
    return fn()
  } finally {
    rmdirSync(lock)
  }
}

function busyRecord(deps, rig) {
  const path = join(storeDir(deps, rig), 'busy.json')
  return existsSync(path) ? readJson(path) : null
}

// --- signals -----------------------------------------------------------------------------------

function rigJson(deps, args) {
  const result = deps.run('rig', args)
  if (result.error) return { error: `rig ${args.join(' ')}: ${result.error.message}` }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    return { error: `rig ${args.join(' ')} exited ${result.status}${detail ? `: ${detail}` : ''}` }
  }
  try {
    const parsed = JSON.parse(result.stdout)
    if (Array.isArray(parsed)) return { rows: parsed }
    if (Array.isArray(parsed?.entries) && parsed.truncated === false)
      return { rows: parsed.entries }
    return { error: `rig ${args.join(' ')} returned no complete list` }
  } catch {
    return { error: `rig ${args.join(' ')} output is not JSON` }
  }
}

function goalLine(body) {
  const match = String(body ?? '').match(/^Goal:\s*(\S+)/m)
  return match ? match[1] : null
}

export function mediumFor(goal, options) {
  if (options.medium === 'github' && options.repo) return { medium: 'github', repo: options.repo }
  if (options.medium === 'filesystem' && options.root) {
    return { medium: 'filesystem', root: resolve(options.root) }
  }
  const github = String(goal ?? '').match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/\d+/)
  if (github) return { medium: 'github', repo: github[1] }
  return null
}

function wipGoals(deps, medium) {
  if (!medium) return { error: 'no medium to read unfinished goals (pass --goal or --medium)' }
  if (!deps.cliPath)
    return { error: 'agentflow-sdlc board is not available to read unfinished goals' }
  const args =
    medium.medium === 'github'
      ? ['board', '--medium', 'github', '--repo', medium.repo, '--json']
      : ['board', '--medium', 'filesystem', '--root', medium.root, '--json']
  let result = deps.run(deps.cliPath, args)
  // A shim the process cannot exec (for example a link to a file without the execute bit) still
  // runs as a Node script: run node on the shim path itself.
  if (['EACCES', 'ENOEXEC'].includes(result.error?.code)) {
    result = deps.run(process.execPath, [deps.cliPath, ...args])
  }
  if (result.error || result.status !== 0) {
    const detail = (result.error?.message || result.stderr || '').trim()
    return { error: `agentflow-sdlc board failed${detail ? `: ${detail}` : ''}` }
  }
  try {
    const board = JSON.parse(result.stdout)
    const wip = board.groups?.find((group) => group.state === 'WIP')
    if (!wip || !Array.isArray(wip.items)) return { error: 'agentflow-sdlc board has no WIP group' }
    return { goals: wip.items.map((item) => item.uri) }
  } catch {
    return { error: 'agentflow-sdlc board output is not JSON' }
  }
}

/**
 * Read the squad's busy signals. B1 in-progress (or blocked) queue item, B2 pending queue item,
 * B3 goal started by delivery and not Delivered, B4 a seat reports working or running, B5 the
 * person's busy record. `unknown` is any signal that could not be read, including a seat that does
 * not report idle; it counts as busy.
 */
export function readSignals(deps, rig, medium) {
  const signals = []
  const currentGoals = new Set()
  const busy = busyRecord(deps, rig)
  if (busy)
    signals.push({
      id: 'B5',
      detail: `recorded busy since ${busy.since}${busy.note ? `: ${busy.note}` : ''}`,
    })

  const nodes = rigJson(deps, ['ps', '--nodes', '--rig', rig, '--json'])
  if (nodes.error) signals.push({ id: 'unknown', detail: nodes.error })
  else {
    const seats = nodes.rows.filter((row) => rigOf(row?.canonicalSessionName) === rig)
    if (seats.length === 0)
      signals.push({ id: 'unknown', detail: `delivery squad ${rig} has no seats in rig ps` })
    // Only a seat that reports idle adds nothing. A seat that does not prove it is idle is busy:
    // working or running is B4, a missing or other state is unknown.
    for (const seat of seats) {
      const state = seat.agentActivity?.state
      if (state === 'idle') continue
      if (state === 'working' || state === 'running') {
        signals.push({ id: 'B4', detail: `${seat.canonicalSessionName} is ${state}` })
      } else {
        signals.push({
          id: 'unknown',
          detail: `${seat.canonicalSessionName} does not report idle (${state ?? 'no activity state'})`,
        })
      }
    }
  }

  const queue = rigJson(deps, [
    'queue',
    'list',
    '-A',
    '--state',
    'pending,in-progress,blocked',
    '--full',
    '--json',
    '--limit',
    '1000',
  ])
  if (queue.error) signals.push({ id: 'unknown', detail: queue.error })
  else {
    for (const item of queue.rows) {
      if (rigOf(item?.destinationSession) !== rig) continue
      const goal = goalLine(item.body)
      if (goal) currentGoals.add(goal)
      const id = item.state === 'pending' ? 'B2' : 'B1'
      signals.push({
        id,
        detail: `${item.qitemId} ${item.state} for ${item.destinationSession}${goal ? ` (${goal})` : ''}`,
      })
    }
  }

  const wip = wipGoals(deps, medium)
  if (wip.error) signals.push({ id: 'unknown', detail: wip.error })
  else {
    for (const goal of wip.goals) {
      currentGoals.add(goal)
      signals.push({ id: 'B3', detail: `${goal} is WIP` })
    }
  }
  return { signals, currentGoals }
}

// Every signal makes the squad busy. B4 (a seat reported working) adds busy; its absence frees
// nothing, because idle seats with unfinished work are still busy (B1-B3, B5).
export function isFree(signals) {
  return signals.length === 0
}

// --- delivery ----------------------------------------------------------------------------------

function transport(deps, hold) {
  const dir = join(storeDir(deps, hold.rig), 'outbox')
  mkdirSync(dir, { recursive: true })
  const bodyFile = join(dir, `${hold.id}.txt`)
  writeFileSync(bodyFile, hold.body)
  const args = hold.reply
    ? ['send', hold.target, hold.body]
    : ['queue', 'create', '--destination', hold.target, '--body-file', bodyFile]
  const result = deps.run('rig', args)
  if (result.error || result.status !== 0) {
    const detail = (result.error?.message || result.stderr || result.stdout || '').trim()
    throw new HandoffError(
      `Delivery to ${hold.target} failed${detail ? `: ${detail}` : ''}. The handoff stays held.`,
    )
  }
  return (result.stdout || '').trim()
}

function deliverHold(deps, hold, by) {
  transport(deps, hold)
  const delivered = {
    ...hold,
    state: 'delivered',
    deliveredAt: deps.now().toISOString(),
    deliveredBy: by,
  }
  saveHold(deps, delivered)
  return delivered
}

/** Deliver the oldest held handoff for a squad if the squad is free. At most one per call. */
export function flushSquad(deps, rig, medium) {
  return withLock(deps, rig, () => {
    const held = holdsOf(deps, rig).filter((hold) => hold.state === 'held')
    if (held.length === 0) return { delivered: null, signals: [] }
    const oldest = held[0]
    const { signals } = readSignals(deps, rig, medium ?? oldest.medium)
    if (!isFree(signals)) return { delivered: null, signals }
    return { delivered: deliverHold(deps, oldest, 'flush'), signals }
  })
}

function newId(deps) {
  const stamp = deps
    .now()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
  return `hold-${stamp}-${Math.random().toString(16).slice(2, 8)}`
}

export function deliver(deps, options) {
  const target = options.to
  if (!target || !target.includes('@')) throw new HandoffError('--to <session> is required.', 2)
  if (options.body === undefined)
    throw new HandoffError('--body-file <file> or --body <text> is required.', 2)
  const sender = deps.env.OPENRIG_SESSION_NAME || 'person'
  const hold = {
    id: newId(deps),
    state: 'held',
    rig: rigOf(target),
    target,
    sender,
    goal: options.goal ?? null,
    transition: options.transition ?? null,
    reply: Boolean(options.reply),
    medium: mediumFor(options.goal, options),
    body: options.body,
    createdAt: deps.now().toISOString(),
    signals: [],
  }

  // Product-to-product and other non-delivery messages are not held.
  if (!isDeliverySeat(target)) {
    transport(deps, { ...hold, reply: true })
    return { status: 'delivered', target, reason: 'not a delivery seat' }
  }

  return withLock(deps, hold.rig, () => {
    const waiting = holdsOf(deps, hold.rig).filter((item) => item.state === 'held')
    const { signals, currentGoals } = readSignals(deps, hold.rig, hold.medium)
    const known = !signals.some((signal) => signal.id === 'unknown')
    // A reply about a goal the squad is already doing is not new work.
    if (hold.reply && hold.goal && known && currentGoals.has(hold.goal)) {
      transport(deps, hold)
      return { status: 'delivered', target, reason: `reply about current goal ${hold.goal}` }
    }
    // A free squad takes the oldest waiting handoff first; a new one waits behind it.
    if (isFree(signals) && waiting.length === 0) {
      transport(deps, hold)
      return { status: 'delivered', target, reason: 'delivery squad is free' }
    }
    let heldSignals = signals
    let flushed = null
    if (isFree(signals)) {
      // Free, but older handoffs wait: the oldest goes now, which makes the squad busy again.
      flushed = deliverHold(deps, waiting[0], 'flush')
      heldSignals = [{ id: 'queued', detail: `older handoff ${flushed.id} was delivered first` }]
    }
    const held = { ...hold, signals: heldSignals }
    saveHold(deps, held)
    return {
      status: 'held',
      id: held.id,
      target,
      signals: held.signals,
      flushed: flushed?.id ?? null,
    }
  })
}

// --- person-only actions -----------------------------------------------------------------------

export function assertPerson(deps, action) {
  const marker = AGENT_ENV.find((name) => deps.env[name])
  if (marker)
    throw new HandoffError(
      `${action} is for the person. Refused in an agent session (${marker} is set).`,
    )
  if (!deps.stdinIsTTY || !deps.stdoutIsTTY) {
    throw new HandoffError(`${action} is for the person at an interactive terminal.`)
  }
}

export async function release(deps, id) {
  assertPerson(deps, 'Releasing a held handoff')
  const rig = allRigs(deps).find((name) => holdsOf(deps, name).some((hold) => hold.id === id))
  if (!rig) throw new HandoffError(`No held handoff ${id}.`)
  const answer = await deps.ask(
    `Release ${id} and deliver it now, even if the squad is busy? Type the id to confirm: `,
  )
  if (answer.trim() !== id) throw new HandoffError('Not confirmed. Nothing was released.')
  return withLock(deps, rig, () => {
    const hold = holdsOf(deps, rig).find((item) => item.id === id)
    if (!hold || hold.state !== 'held') throw new HandoffError(`${id} is not held.`)
    return deliverHold(deps, { ...hold, releasedBy: 'person' }, 'person')
  })
}

export function setBusy(deps, rig, { note } = {}) {
  const record = {
    since: deps.now().toISOString(),
    note: note ?? null,
    recordedBy: deps.env.OPENRIG_SESSION_NAME || 'person',
  }
  writeJsonAtomic(join(storeDir(deps, rig), 'busy.json'), record)
  return record
}

export function clearBusy(deps, rig) {
  assertPerson(deps, 'Clearing a busy record')
  const path = join(storeDir(deps, rig), 'busy.json')
  // Keep the cleared record beside the store as history.
  if (existsSync(path))
    renameSync(path, join(storeDir(deps, rig), `busy.cleared-${deps.now().getTime()}.json`))
}

// --- list --------------------------------------------------------------------------------------

export function listHolds(deps, { rig, all = false } = {}) {
  const rigs = rig ? [rig] : allRigs(deps)
  return rigs
    .flatMap((name) => holdsOf(deps, name))
    .filter((hold) => all || hold.state === 'held')
    .map((hold) => ({
      id: hold.id,
      state: hold.state,
      goal: hold.goal,
      transition: hold.transition,
      target: hold.target,
      sender: hold.sender,
      signals: hold.signals.map((signal) => signal.id),
      reasons: hold.signals.map((signal) => signal.detail),
      since: hold.createdAt,
      ...(hold.state === 'delivered'
        ? { deliveredAt: hold.deliveredAt, deliveredBy: hold.deliveredBy }
        : {}),
    }))
}

function renderList(rows) {
  if (rows.length === 0) return 'No held handoffs.'
  return rows
    .map((row) =>
      [
        `${row.id}  ${row.state}  since ${row.since}`,
        `  goal: ${row.goal ?? '-'}`,
        `  transition: ${row.transition ?? '-'}`,
        `  to: ${row.target}  from: ${row.sender}`,
        `  held by: ${row.signals.join(', ') || '-'}${row.reasons.length ? ` (${row.reasons.join('; ')})` : ''}`,
        ...(row.deliveredAt ? [`  delivered: ${row.deliveredAt} by ${row.deliveredBy}`] : []),
      ].join('\n'),
    )
    .join('\n')
}

// --- command line ------------------------------------------------------------------------------

const VALUE_FLAGS = new Set([
  'to',
  'body',
  'body-file',
  'goal',
  'transition',
  'medium',
  'repo',
  'root',
  'rig',
  'note',
])
const BOOLEAN_FLAGS = new Set(['reply', 'json', 'all', 'set', 'clear'])

export function parseArgs(args) {
  const options = {}
  const positionals = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2)
    if (BOOLEAN_FLAGS.has(name)) options[name] = true
    else if (VALUE_FLAGS.has(name)) {
      const value = inline ?? args[(index += 1)]
      if (value === undefined) throw new HandoffError(`--${name} requires a value.`, 2)
      options[name] = value
    } else
      throw new HandoffError(`Unknown option --${name}. There is no option that sends anyway.`, 2)
  }
  return { options, positionals }
}

function flushAll(deps, rigs, medium) {
  const delivered = []
  for (const rig of rigs) {
    try {
      const result = flushSquad(deps, rig, medium)
      if (result.delivered) delivered.push(result.delivered)
    } catch {
      // A busy lock or failed delivery leaves the hold in place; the next command tries again.
    }
  }
  return delivered
}

export async function main(
  argv,
  { deps = defaultDeps(), stdout = process.stdout, stderr = process.stderr } = {},
) {
  const [command, ...rest] = argv
  const write = (text) => stdout.write(`${text}\n`)
  try {
    if (!command || command === '--help' || command === '-h') {
      write(USAGE)
      return command ? 0 : 2
    }
    const { options, positionals } = parseArgs(rest)
    if (options['body-file'] !== undefined)
      options.body = readFileSync(resolve(options['body-file']), 'utf8')
    const medium = mediumFor(options.goal, options)

    if (command === 'deliver') {
      const result = deliver(deps, options)
      if (options.json) write(JSON.stringify(result, null, 2))
      else if (result.status === 'held') {
        write(`HELD ${result.id}: not delivered to ${result.target}; the delivery squad is busy.`)
        for (const signal of result.signals) write(`  ${signal.id}: ${signal.detail}`)
        write('It goes out by itself when the squad is free, or when the person releases it.')
      } else write(`Delivered to ${result.target} (${result.reason}).`)
      return 0
    }
    if (command === 'list') {
      flushAll(deps, options.rig ? [options.rig] : allRigs(deps), null)
      const rows = listHolds(deps, { rig: options.rig, all: options.all })
      write(options.json ? JSON.stringify(rows, null, 2) : renderList(rows))
      return 0
    }
    if (command === 'flush') {
      const delivered = flushAll(deps, options.rig ? [options.rig] : allRigs(deps), medium)
      write(
        options.json
          ? JSON.stringify(delivered.map((hold) => hold.id))
          : delivered.length
            ? delivered.map((hold) => `Delivered ${hold.id} to ${hold.target}.`).join('\n')
            : 'Nothing delivered.',
      )
      return 0
    }
    if (command === 'release') {
      if (!positionals[0]) throw new HandoffError('release needs a hold id.', 2)
      const hold = await release(deps, positionals[0])
      write(`Released ${hold.id}: delivered to ${hold.target} by the person.`)
      return 0
    }
    if (command === 'busy') {
      const rig = positionals[0]
      if (!rig || options.set === options.clear)
        throw new HandoffError('busy needs <rig> and one of --set or --clear.', 2)
      if (options.set) {
        setBusy(deps, rig, { note: options.note })
        write(`Recorded ${rig} as busy. New work to it is held until the person clears this.`)
      } else {
        clearBusy(deps, rig)
        write(`Cleared the busy record for ${rig}.`)
      }
      return 0
    }
    throw new HandoffError(`Unknown handoff command "${command}".\n${USAGE}`, 2)
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`)
    return Number.isInteger(error.exitCode) ? error.exitCode : 1
  }
}

const invoked =
  process.argv[1] &&
  (() => {
    try {
      return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
    } catch {
      return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    }
  })()
if (invoked) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code ?? 0
  })
}
