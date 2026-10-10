// Issue 363: product seats cannot wake a busy delivery squad. These tests use a fake `rig`, a fake
// board, and temporary homes only. No live daemon, seat, or GitHub call is made.
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as hold from '../../adapters/openrig/agentflow-product/handoff.mjs'
import {
  HOOK_COMMAND,
  guardDecision,
  runHook,
} from '../../adapters/openrig/agentflow-product/handoff-guard.mjs'

const CLI = resolve('bin/cli.mjs')
const PRODUCT = resolve('adapters/openrig/agentflow-product')
const RIG = 'agentflow-demo'
const GOAL = 'https://github.com/acme/app/issues/7'
const OTHER = 'https://github.com/acme/app/issues/9'
const TRANSITION = `${GOAL}#issuecomment-1`
const SEATS = ['orch-arch', 'dev-build-jr', 'dev-build', 'dev-build-sr', 'dev-qa', 'rev-review']
const MANAGER = 'pm-manager@agentflow-pm'
const ANALYST = 'pm-analyst@agentflow-pm'

const dirs = []
const realpath = (p) => (realpathSync.native ? realpathSync.native(p) : realpathSync(p))
function tempDir(prefix) {
  const dir = mkdtempSync(join(realpath(tmpdir()), prefix))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// The installed `agentflow-sdlc` shim on PATH.
const SHIM = '/fake/bin/agentflow-sdlc'

function idleNodes(rig = RIG) {
  return SEATS.map((seat) => ({
    canonicalSessionName: `${seat}@${rig}`,
    agentActivity: { state: 'idle' },
  }))
}

// A fake `rig` and board. `queue create` adds a pending item, as the real queue does.
function fakeDeps({
  sender = MANAGER,
  nodes = idleNodes(),
  queue = [],
  wip = [],
  fail = {},
  tty = false,
  answer = '',
  env = {},
} = {}) {
  const home = tempDir('agentflow-hold-home-')
  const calls = []
  const state = { queue: [...queue] }
  let clock = Date.parse('2026-10-10T00:00:00Z')
  const ok = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' })
  const run = (command, args) => {
    calls.push([command, ...args])
    if (command === SHIM) {
      if (fail.board) return { status: 1, stdout: '', stderr: 'board failed' }
      return ok({ groups: [{ state: 'WIP', items: wip.map((uri) => ({ uri })) }] })
    }
    const verb = args[0] === 'queue' ? `queue ${args[1]}` : args[0]
    if (fail[verb]) return { status: 3, stdout: '', stderr: `${verb} failed` }
    if (verb === 'ps') return ok(nodes)
    if (verb === 'queue list') return ok(state.queue)
    if (verb === 'queue create') {
      const destination = args[args.indexOf('--destination') + 1]
      const body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
      state.queue.push({
        qitemId: `q${state.queue.length + 1}`,
        destinationSession: destination,
        state: 'pending',
        body,
      })
      return { status: 0, stdout: 'created', stderr: '' }
    }
    if (verb === 'send') return { status: 0, stdout: 'sent', stderr: '' }
    return { status: 9, stdout: '', stderr: `unexpected rig ${args.join(' ')}` }
  }
  const deps = {
    env: { ...(sender ? { OPENRIG_SESSION_NAME: sender } : {}), ...env },
    home,
    now: () => new Date((clock += 1000)),
    run,
    cliPath: SHIM,
    stdinIsTTY: tty,
    stdoutIsTTY: tty,
    ask: async () => answer,
  }
  const sends = () =>
    calls.filter(
      ([command, ...args]) =>
        command === 'rig' && (args[0] === 'send' || (args[0] === 'queue' && args[1] === 'create')),
    )
  return { deps, calls, state, sends, home }
}

function send(deps, overrides = {}) {
  return hold.deliver(deps, {
    to: `orch-arch@${RIG}`,
    body: 'Phase 1 analyst pass\nGoal: ' + GOAL,
    goal: GOAL,
    transition: TRANSITION,
    ...overrides,
  })
}

const BUSY_CASES = [
  [
    'B1: a delivery seat holds an in-progress item',
    {
      queue: [
        {
          qitemId: 'q0',
          destinationSession: `dev-build@${RIG}`,
          state: 'in-progress',
          body: `Goal: ${OTHER}`,
        },
      ],
    },
    'B1',
  ],
  [
    'B2: a delivery seat has a pending item',
    {
      queue: [
        {
          qitemId: 'q0',
          destinationSession: `dev-qa@${RIG}`,
          state: 'pending',
          body: `Goal: ${OTHER}`,
        },
      ],
    },
    'B2',
  ],
  ['B3: a started goal is not Delivered', { wip: [OTHER] }, 'B3'],
]

describe('both product seats are held while the squad is busy (AC1, AC2, AC5)', () => {
  for (const sender of [MANAGER, ANALYST]) {
    it.each(BUSY_CASES)(`${sender}: %s, every seat idle`, (_label, scenario, signal) => {
      const { deps, sends, home } = fakeDeps({ sender, ...scenario })
      const result = send(deps)
      expect(result.status).toBe('held')
      expect(result.signals.map((item) => item.id)).toContain(signal)
      expect(sends()).toEqual([])
      expect(
        existsSync(
          join(home, '.openrig/state/agentflow-handoffs', RIG, 'holds', `${result.id}.json`),
        ),
      ).toBe(true)
    })

    it(`${sender}: B5, the person's busy record`, () => {
      const { deps, sends } = fakeDeps({ sender })
      hold.setBusy(deps, RIG, { note: 'finishing 358' })
      const result = send(deps)
      expect(result.status).toBe('held')
      expect(result.signals[0]).toMatchObject({ id: 'B5' })
      expect(sends()).toEqual([])
    })
  }

  it('counts a working seat as busy, and holds when nothing else is set', () => {
    const nodes = idleNodes()
    nodes[0].agentActivity.state = 'working'
    const { deps, sends } = fakeDeps({ nodes })
    expect(send(deps)).toMatchObject({ status: 'held', signals: [{ id: 'B4' }] })
    expect(sends()).toEqual([])
  })

  it.each([
    ['reports running', { state: 'running' }, 'B4'],
    ['reports unknown', { state: 'unknown' }, 'unknown'],
    ['has no activity state', {}, 'unknown'],
    ['has no activity field', undefined, 'unknown'],
  ])('holds when a seat %s, because it does not prove it is idle', (_, activity, id) => {
    const nodes = idleNodes()
    if (activity === undefined) delete nodes[2].agentActivity
    else nodes[2].agentActivity = activity
    const { deps, sends } = fakeDeps({ nodes })
    const result = send(deps)
    expect(result).toMatchObject({ status: 'held', signals: [{ id }] })
    expect(result.signals[0].detail).toContain(nodes[2].canonicalSessionName)
    expect(sends()).toEqual([])
  })

  it.each([
    ['rig ps fails', { fail: { ps: true } }],
    ['the queue cannot be read', { fail: { 'queue list': true } }],
    ['the board cannot be read', { fail: { board: true } }],
    ['the squad has no seats', { nodes: [] }],
  ])('holds and says the state is unknown when %s', (_label, scenario) => {
    const { deps, sends } = fakeDeps(scenario)
    const result = send(deps)
    expect(result.status).toBe('held')
    expect(result.signals.some((item) => item.id === 'unknown')).toBe(true)
    expect(sends()).toEqual([])
  })

  it('holds when no medium can be found to read unfinished goals', () => {
    const { deps, sends } = fakeDeps()
    const result = hold.deliver(deps, { to: `orch-arch@${RIG}`, body: 'x' })
    expect(result.status).toBe('held')
    expect(result.signals[0].detail).toContain('no medium')
    expect(sends()).toEqual([])
  })

  it('delivers once to a free squad as a queue item with the original body', () => {
    const { deps, sends, state } = fakeDeps()
    expect(send(deps)).toMatchObject({ status: 'delivered' })
    expect(sends()).toHaveLength(1)
    expect(state.queue[0]).toMatchObject({
      destinationSession: `orch-arch@${RIG}`,
      body: `Phase 1 analyst pass\nGoal: ${GOAL}`,
    })
  })

  it('does not hold a message to a seat outside the delivery squad', () => {
    const { deps, sends } = fakeDeps({ wip: [OTHER] })
    const result = hold.deliver(deps, { to: ANALYST, body: 'phase 0 done' })
    expect(result.status).toBe('delivered')
    expect(sends()).toHaveLength(1)
  })
})

describe('busy blocks; nothing sends anyway (AC4, AC13)', () => {
  it.each(['--force', '--anyway', '--now', '--no-hold'])('rejects %s', async (flag) => {
    const { deps, sends } = fakeDeps()
    const out = []
    const code = await hold.main(['deliver', '--to', `orch-arch@${RIG}`, '--body', 'x', flag], {
      deps,
      stdout: { write: (text) => out.push(text) },
      stderr: { write: (text) => out.push(text) },
    })
    expect(code).toBe(2)
    expect(out.join('')).toContain('There is no option that sends anyway')
    expect(sends()).toEqual([])
  })

  it('has no environment switch that turns the guard off', () => {
    const env = { AGENTFLOW_HANDOFF_GUARD: 'off', FORCE: '1' }
    expect(guardDecision({ session: MANAGER, command: 'rig send x y', env }).block).toBe(true)
  })
})

describe('held handoffs are listed, flushed once, and released by the person (AC6-AC8)', () => {
  it('lists each hold with goal, transition, target, sender, signal, and time', async () => {
    const { deps } = fakeDeps({ wip: [OTHER] })
    const held = send(deps)
    const rows = hold.listHolds(deps)
    expect(rows).toEqual([
      expect.objectContaining({
        id: held.id,
        goal: GOAL,
        transition: TRANSITION,
        target: `orch-arch@${RIG}`,
        sender: MANAGER,
        signals: ['B3'],
        since: expect.any(String),
      }),
    ])
    const out = []
    await hold.main(['list', '--json'], { deps, stdout: { write: (text) => out.push(text) } })
    expect(JSON.parse(out.join(''))).toEqual(hold.listHolds(deps))
  })

  it('delivers the oldest hold exactly once when the squad is free, and the rest stay held', () => {
    const scenario = fakeDeps({ wip: [OTHER] })
    const { deps, sends, state } = scenario
    const first = send(deps, { body: 'first\nGoal: ' + GOAL })
    const second = send(deps, { to: `dev-build@${RIG}`, body: 'second' })
    expect(sends()).toEqual([])

    // The other goal is delivered: the squad has no unfinished goal.
    deps.run = ((run) => (command, args) =>
      command === SHIM
        ? {
            status: 0,
            stdout: JSON.stringify({ groups: [{ state: 'WIP', items: [] }] }),
            stderr: '',
          }
        : run(command, args))(deps.run)
    expect(hold.flushSquad(deps, RIG).delivered.id).toBe(first.id)
    expect(hold.flushSquad(deps, RIG).delivered).toBeNull()
    expect(hold.flushSquad(deps, RIG).delivered).toBeNull()
    expect(sends()).toHaveLength(1)
    expect(state.queue.map((item) => item.body)).toEqual([`first\nGoal: ${GOAL}`])
    expect(hold.listHolds(deps).map((row) => row.id)).toEqual([second.id])
  })

  it('makes a new send wait behind older holds even when the squad is free', () => {
    const { deps, sends } = fakeDeps({ wip: [OTHER] })
    const first = send(deps)
    const free = fakeDeps()
    free.deps.home = deps.home
    const second = send(free.deps, { body: 'second' })
    // The free squad took the older hold first, which makes it busy again.
    expect(free.sends()).toHaveLength(1)
    expect(free.state.queue[0].body).toContain('Phase 1 analyst pass')
    expect(sends()).toEqual([])
    expect(second.status).toBe('held')
    expect(hold.listHolds(deps).map((row) => row.id)).not.toContain(first.id)
  })

  it('releases a hold for the person at a terminal, even while busy', async () => {
    const scenario = fakeDeps({ sender: null, wip: [OTHER], tty: true })
    const held = send(scenario.deps)
    scenario.deps.ask = async () => held.id
    const released = await hold.release(scenario.deps, held.id)
    expect(released).toMatchObject({
      state: 'delivered',
      deliveredBy: 'person',
      releasedBy: 'person',
    })
    expect(scenario.sends()).toHaveLength(1)
    expect(hold.listHolds(scenario.deps)).toEqual([])
    expect(hold.listHolds(scenario.deps, { all: true })[0]).toMatchObject({ deliveredBy: 'person' })
  })

  it.each([
    ['an agent session', { sender: MANAGER, tty: true }, 'Refused in an agent session'],
    [
      'a Claude Code session',
      { sender: null, tty: true, env: { CLAUDECODE: '1' } },
      'Refused in an agent session',
    ],
    ['no terminal', { sender: null, tty: false }, 'interactive terminal'],
  ])('refuses release from %s', async (_label, scenario, message) => {
    const { deps, sends } = fakeDeps({ wip: [OTHER], ...scenario })
    const held = send(deps)
    deps.ask = async () => held.id
    await expect(hold.release(deps, held.id)).rejects.toThrow(message)
    expect(sends()).toEqual([])
  })

  it('refuses release without the typed confirmation', async () => {
    const { deps, sends } = fakeDeps({ sender: null, wip: [OTHER], tty: true, answer: 'yes' })
    const held = send(deps)
    await expect(hold.release(deps, held.id)).rejects.toThrow('Not confirmed')
    expect(sends()).toEqual([])
  })

  it('lets an agent record busy but only the person clear it', () => {
    const { deps } = fakeDeps({ tty: true })
    hold.setBusy(deps, RIG, { note: 'the person said so' })
    expect(() => hold.clearBusy(deps, RIG)).toThrow('Refused in an agent session')
    delete deps.env.OPENRIG_SESSION_NAME
    hold.clearBusy(deps, RIG)
    expect(send(deps).status).toBe('delivered')
  })
})

describe('replies about current work go through (AC9)', () => {
  const current = {
    queue: [
      {
        qitemId: 'q0',
        destinationSession: `orch-arch@${RIG}`,
        state: 'in-progress',
        body: `Phase 3\nGoal: ${GOAL}`,
      },
    ],
  }

  it('delivers a reply about the goal the squad is doing, and records no hold', () => {
    const { deps, sends, calls } = fakeDeps(current)
    expect(send(deps, { reply: true, body: 'answer' })).toMatchObject({ status: 'delivered' })
    expect(calls.filter(([, verb]) => verb === 'send')).toHaveLength(1)
    expect(sends()).toHaveLength(1)
    expect(hold.listHolds(deps, { all: true })).toEqual([])
  })

  it('holds a reply about another goal', () => {
    const { deps, sends } = fakeDeps(current)
    expect(send(deps, { reply: true, goal: OTHER, body: 'about 9' }).status).toBe('held')
    expect(sends()).toEqual([])
  })

  it('holds a reply when the squad state cannot be read', () => {
    const { deps, sends } = fakeDeps({ ...current, fail: { board: true } })
    expect(send(deps, { reply: true, body: 'answer' }).status).toBe('held')
    expect(sends()).toEqual([])
  })
})

describe('a hold does not touch the record (AC10)', () => {
  it('never appends, rewrites, or reads a transition', () => {
    const { deps, calls } = fakeDeps({ wip: [OTHER] })
    send(deps)
    hold.listHolds(deps)
    const productCalls = calls.filter(([command]) => command === SHIM)
    expect(productCalls.every(([, verb]) => verb === 'board')).toBe(true)
  })
})

describe('product seat send guard (AC1-AC4, AC13)', () => {
  it.each([
    'rig send orch-arch@agentflow-dev "start phase 2"',
    'rig --verify send orch-arch@agentflow-dev hi',
    '/usr/local/bin/rig send dev-qa@agentflow-dev hi',
    'cd /tmp && rig send orch-arch@agentflow-dev hi',
    'bash -c "rig send orch-arch@agentflow-dev hi"',
    'rig queue create --destination orch-arch@agentflow-dev --body x',
    'rig queue handoff q1 --to orch-arch@agentflow-dev',
    'rig queue handoff-and-complete q1 --to orch-arch@agentflow-dev',
    'rig queue inbox-drop orch-arch@agentflow-dev',
    'tmux send-keys -t orch-arch@agentflow-dev "go" Enter',
    'agentflow-sdlc handoff release hold-1',
    'rig "send" orch-arch@agentflow-dev hi',
    "rig 'send' orch-arch@agentflow-dev hi",
    '"rig" send orch-arch@agentflow-dev hi',
    'r\\ig s\\end orch-arch@agentflow-dev hi',
    "rig $'send' orch-arch@agentflow-dev hi",
    'rig \\\nsend orch-arch@agentflow-dev hi',
    'rig queue "create" --destination orch-arch@agentflow-dev --body x',
    "rig 'queue' 'create' --destination orch-arch@agentflow-dev --body x",
    'rig "queue" handoff q1 --to orch-arch@agentflow-dev',
    'rig $VERB orch-arch@agentflow-dev hi',
    'rig queue $(echo create) --destination orch-arch@agentflow-dev',
    'tmux "send-keys" -t orch-arch@agentflow-dev go Enter',
    'rig > /dev/null send orch-arch@agentflow-dev hi',
    'rig 2>&1 send orch-arch@agentflow-dev hi',
    'rig </dev/null queue create --destination orch-arch@agentflow-dev --body x',
    "rig $'\\x73end' orch-arch@agentflow-dev hi",
    "rig $'\\163end' orch-arch@agentflow-dev hi",
    "rig $'\\u0073end' orch-arch@agentflow-dev hi",
    "rig queue $'\\x63reate' --destination orch-arch@agentflow-dev --body x",
    "rig $'queue' $'create' --destination orch-arch@agentflow-dev --body x",
    'env rig send orch-arch@agentflow-dev hi',
    'R=rig; $R send orch-arch@agentflow-dev hi',
    'rig >/dev/null $VERB orch-arch@agentflow-dev hi',
    'rig s?nd orch-arch@agentflow-dev hi',
    'rig {send,} orch-arch@agentflow-dev hi',
    "bash -c 'rig send orch-arch@agentflow-dev hi'",
    `node -e "require('child_process').execFileSync('rig', ['send', 'orch-arch@agentflow-dev', 'hi'])"`,
  ])('blocks a product seat: %s', (command) => {
    for (const session of [MANAGER, ANALYST]) {
      const decision = guardDecision({ session, command })
      expect(decision.block).toBe(true)
      expect(decision.reason).toContain('agentflow-sdlc handoff deliver')
      expect(decision.reason).not.toContain('handoff.mjs')
    }
  })

  it.each([
    'rig ps --nodes',
    'rig queue list --json',
    'rig whoami --json',
    'agentflow-sdlc handoff deliver --to orch-arch@agentflow-dev --body-file /tmp/h.txt',
    'agentflow-sdlc phase append --phase 1 --status pass',
    'git status',
    'rig whoami --json > /tmp/whoami.json',
    'rig queue list --destination "$OPENRIG_SESSION_NAME" --json 2>&1',
  ])('allows a product seat: %s', (command) => {
    expect(guardDecision({ session: MANAGER, command }).block).toBe(false)
  })

  it.each(['dev-build-sr@agentflow-dev', 'orch-arch@agentflow-dev', undefined, ''])(
    'does not block %s',
    (session) => {
      expect(guardDecision({ session, command: 'rig send pm-analyst@agentflow-pm hi' }).block).toBe(
        false,
      )
    },
  )

  function stream(text) {
    return (async function* () {
      yield text
    })()
  }

  it.each([
    [
      'Claude Code',
      { tool_name: 'Bash', tool_input: { command: 'rig send orch-arch@agentflow-dev hi' } },
    ],
    [
      'Codex',
      {
        tool_name: 'shell',
        tool_input: { command: ['rig', 'send', 'orch-arch@agentflow-dev', 'hi'] },
      },
    ],
  ])('the %s hook exits 2 with the reason', async (_label, call) => {
    const err = []
    const code = await runHook({
      stdin: stream(JSON.stringify(call)),
      env: { OPENRIG_SESSION_NAME: ANALYST },
      stderr: { write: (text) => err.push(text) },
    })
    expect(code).toBe(2)
    expect(err.join('')).toContain('Blocked for product seat')
  })

  it('fails closed on unreadable hook input in a product seat only', async () => {
    const silent = { write: () => {} }
    expect(
      await runHook({ stdin: stream('{'), env: { OPENRIG_SESSION_NAME: ANALYST }, stderr: silent }),
    ).toBe(2)
    expect(
      await runHook({
        stdin: stream('{'),
        env: { OPENRIG_SESSION_NAME: 'dev-qa@agentflow-dev' },
        stderr: silent,
      }),
    ).toBe(0)
  })

  // The hook command is `node -e '<script>'`; run the script as the runtime would, without a shell.
  function runHookCommand(env, call) {
    const script = HOOK_COMMAND.slice("node -e '".length, -1)
    return spawnSync(process.execPath, ['-e', script], {
      input: JSON.stringify(call),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    })
  }

  it('runs the installed guard from the hook command and fails closed when it is missing', () => {
    const home = tempDir('agentflow-guard-home-')
    const call = {
      tool_name: 'Bash',
      tool_input: { command: 'rig send orch-arch@agentflow-dev hi' },
    }
    const homeEnv = { HOME: home, USERPROFILE: home }
    // Missing guard: product seat blocked, delivery seat untouched.
    expect(runHookCommand({ ...homeEnv, OPENRIG_SESSION_NAME: ANALYST }, call).status).toBe(2)
    expect(
      runHookCommand({ ...homeEnv, OPENRIG_SESSION_NAME: 'dev-build@agentflow-dev' }, call).status,
    ).toBe(0)
    // Installed guard: a send is blocked, a read passes.
    const install = spawnSync(
      process.execPath,
      [CLI, 'adapters', 'install', 'openrig', '--home', home],
      { encoding: 'utf8', env: { PATH: process.env.PATH, ...homeEnv } },
    )
    expect(install.status, install.stderr).toBe(0)
    const blocked = runHookCommand({ ...homeEnv, OPENRIG_SESSION_NAME: ANALYST }, call)
    expect(blocked.status).toBe(2)
    expect(blocked.stderr).toContain('Blocked for product seat')
    const read = { tool_name: 'Bash', tool_input: { command: 'rig ps' } }
    expect(runHookCommand({ ...homeEnv, OPENRIG_SESSION_NAME: ANALYST }, read).status).toBe(0)
  })

  it('ships Claude and Codex fragments that run exactly the hook command', () => {
    const claude = JSON.parse(
      readFileSync(join(PRODUCT, 'agents/agentflow/runtime/handoff-guard.claude.json'), 'utf8'),
    )
    expect(claude.hooks.PreToolUse[0]).toMatchObject({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    })
    const codex = readFileSync(
      join(PRODUCT, 'agents/agentflow/runtime/handoff-guard.codex.toml'),
      'utf8',
    )
    expect(codex).toContain(`command = '''${HOOK_COMMAND}'''`)
    const agent = readFileSync(join(PRODUCT, 'agents/agentflow/agent.yaml'), 'utf8')
    expect(
      agent.match(/runtime_resources: \[handoff-guard-claude, handoff-guard-codex\]/g),
    ).toHaveLength(2)
  })
})

describe('the Pi product seat loads the guard as an extension (AC3)', () => {
  function provision(home, args) {
    return spawnSync(
      process.execPath,
      [CLI, 'adapters', 'squads', 'provision', 'openrig', '--home', home, ...args],
      {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: tempDir('agentflow-user-') },
      },
    )
  }

  it('installs the extension in product Pi seats only and blocks a send from it', async () => {
    const home = tempDir('agentflow-pi-home-')
    const project = tempDir('agentflow-project-')
    expect(
      provision(home, ['--kind', 'product', '--preset', 'all-grok', 'pm', project]).status,
    ).toBe(0)
    expect(provision(home, ['--preset', 'all-grok', 'dev', project]).status).toBe(0)
    const extension = (seat) =>
      join(home, '.openrig/state/pi', seat, 'agent/extensions/agentflow-handoff-guard.js')
    expect(existsSync(extension('pm-manager@agentflow-pm'))).toBe(true)
    expect(existsSync(extension('pm-analyst@agentflow-pm'))).toBe(true)
    expect(existsSync(extension('orch-arch@agentflow-dev'))).toBe(false)

    // Load it the way Pi does and call its tool_call handler with this home.
    const handlers = []
    const extPath = realpath(extension('pm-manager@agentflow-pm'))
    const { default: factory } = await import(pathToFileURL(extPath).href)
    factory({ on: (event, handler) => handlers.push([event, handler]) })
    const [[event, handler]] = handlers
    expect(event).toBe('tool_call')
    const saved = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      S: process.env.OPENRIG_SESSION_NAME,
    }
    try {
      process.env.HOME = home
      process.env.USERPROFILE = home
      process.env.OPENRIG_SESSION_NAME = 'pm-manager@agentflow-pm'
      expect(
        await handler({
          toolName: 'bash',
          input: { command: 'rig send orch-arch@agentflow-dev go' },
        }),
      ).toMatchObject({ block: true })
      expect(await handler({ toolName: 'bash', input: { command: 'rig ps' } })).toBeUndefined()
      // Without the installed guard the handler throws, and Pi blocks the call.
      process.env.HOME = tempDir('agentflow-empty-')
      process.env.USERPROFILE = process.env.HOME
      await expect(handler({ toolName: 'bash', input: { command: 'rig ps' } })).rejects.toThrow()
    } finally {
      for (const [key, name] of [
        ['HOME', 'HOME'],
        ['USERPROFILE', 'USERPROFILE'],
        ['S', 'OPENRIG_SESSION_NAME'],
      ]) {
        if (saved[key] === undefined) delete process.env[name]
        else process.env[name] = saved[key]
      }
    }
  })

  it('refreshes the extension on squad update without touching seat state', () => {
    const home = tempDir('agentflow-pi-home-')
    const project = tempDir('agentflow-project-')
    expect(
      provision(home, ['--kind', 'product', '--preset', 'all-grok', 'pm', project]).status,
    ).toBe(0)
    const seatDir = join(home, '.openrig/state/pi/pm-manager@agentflow-pm/agent')
    writeFileSync(join(seatDir, 'session.json'), '{"turn":3}')
    writeFileSync(join(seatDir, 'extensions/agentflow-handoff-guard.js'), 'stale')
    const update = spawnSync(
      process.execPath,
      [CLI, 'adapters', 'squads', 'update', 'openrig', '--home', home, 'pm'],
      {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: tempDir('agentflow-user-') },
      },
    )
    expect(update.status, update.stderr).toBe(0)
    expect(readFileSync(join(seatDir, 'extensions/agentflow-handoff-guard.js'), 'utf8')).toContain(
      'guardDecision',
    )
    expect(readFileSync(join(seatDir, 'session.json'), 'utf8')).toBe('{"turn":3}')
  })
})

describe('board runs through the installed agentflow-sdlc shim on PATH', () => {
  // A PATH with an `agentflow-sdlc` link to a Node script that has no execute bit, as a linked
  // checkout installs it. The script answers `board` with one WIP goal.
  function installedShim() {
    const root = tempDir('agentflow-shim-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const target = join(root, 'cli.mjs')
    writeFileSync(
      target,
      `if (process.argv[2] === 'board') console.log(JSON.stringify({ groups: [{ state: 'WIP', items: [{ uri: ${JSON.stringify(OTHER)} }] }] }))\nelse process.exit(4)\n`,
    )
    chmodSync(target, 0o644)
    const shim = join(bin, 'agentflow-sdlc')
    symlinkSync(target, shim)
    return { bin, shim }
  }

  it('locates the shim path itself, not the file it links to', () => {
    const { bin, shim } = installedShim()
    expect(hold.defaultDeps({ env: { PATH: bin } }).cliPath).toBe(shim)
  })

  it('has no CLI when agentflow-sdlc is not on PATH', () => {
    const deps = hold.defaultDeps({ env: { PATH: tempDir('agentflow-empty-path-') } })
    expect(deps.cliPath).toBeNull()
  })

  it.runIf(process.platform !== 'win32')(
    'runs node on the shim path when the shim cannot be executed',
    () => {
      const { bin, shim } = installedShim()
      const deps = hold.defaultDeps({ env: { PATH: `${bin}${delimiter}${process.env.PATH}` } })
      const realRun = deps.run
      const calls = []
      deps.run = (command, args, options) => {
        calls.push([command, ...args])
        if (command === 'rig') {
          const value = args[0] === 'ps' ? idleNodes() : []
          return { status: 0, stdout: JSON.stringify(value), stderr: '' }
        }
        return realRun(command, args, options)
      }
      const { signals } = hold.readSignals(deps, RIG, { medium: 'github', repo: 'acme/app' })
      expect(signals).toEqual([{ id: 'B3', detail: `${OTHER} is WIP` }])
      const product = calls.filter(([command]) => command !== 'rig')
      expect(product[0].slice(0, 2)).toEqual([shim, 'board'])
      expect(product[1].slice(0, 3)).toEqual([process.execPath, shim, 'board'])
      expect(product.flat().some((part) => String(part).endsWith('cli.mjs'))).toBe(false)
    },
  )
})

describe('the installed product copy runs on its own (activation)', () => {
  it('runs handoff.mjs from the spec library with no product checkout', () => {
    const home = tempDir('agentflow-lib-home-')
    const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home }
    expect(
      spawnSync(process.execPath, [CLI, 'adapters', 'install', 'openrig', '--home', home], {
        encoding: 'utf8',
        env,
      }).status,
    ).toBe(0)
    const installed = join(home, '.openrig/specs/agentflow-product/handoff.mjs')
    const list = spawnSync(process.execPath, [installed, 'list', '--json'], {
      encoding: 'utf8',
      env,
      cwd: home,
    })
    expect(list.status, list.stderr).toBe(0)
    expect(JSON.parse(list.stdout)).toEqual([])
    const force = spawnSync(
      process.execPath,
      [installed, 'deliver', '--to', 'orch-arch@x', '--body', 'b', '--force'],
      { encoding: 'utf8', env, cwd: home },
    )
    expect(force.status).toBe(2)
  })

  it('refuses release through the product CLI in an agent session', () => {
    const home = tempDir('agentflow-cli-home-')
    const result = spawnSync(process.execPath, [CLI, 'handoff', 'release', 'hold-1'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, OPENRIG_SESSION_NAME: MANAGER },
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refused in an agent session')
  })
})

describe('the written workflow tells both seats to hold (AC11)', () => {
  const read = (path) => readFileSync(join(PRODUCT, path), 'utf8')

  it('names handoff deliver and the hold in startup and guidance for both seats', () => {
    for (const path of ['startup/context.md', 'startup/analyst.md', 'startup/manager.md']) {
      expect(read(path), path).toContain('handoff deliver')
    }
    expect(read('startup/context.md')).toContain('Idle seats do not make the squad free')
    expect(read('agents/agentflow/guidance/analyst.md')).toContain('only to a free delivery squad')
    expect(read('agents/agentflow/guidance/manager.md')).toContain('handoff deliver')
  })

  it('leaves no instruction to send to delivery with rig send or rig queue', () => {
    for (const path of [
      'startup/context.md',
      'startup/analyst.md',
      'startup/manager.md',
      'CULTURE.md',
      'README.md',
    ]) {
      const text = read(path)
      expect(text, path).not.toMatch(
        /uses `rig send`|`rig queue handoff --to`|as soon as the phase/,
      )
    }
  })
})

describe('phase 1 append output states the hold (AC10, AC11)', () => {
  async function append(root, phase, seat, key) {
    const { main } = await import('../phase-handoff.mjs')
    const logs = []
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk) => {
      logs.push(String(chunk))
      return true
    }
    try {
      await main([
        'append',
        '--medium',
        'filesystem',
        '--root',
        root,
        '--title',
        'A goal',
        '--phase',
        String(phase),
        '--status',
        'pass',
        '--seat',
        seat,
        '--key',
        key,
        '--body',
        `phase ${phase}`,
      ])
      return JSON.parse(logs.at(-1))
    } finally {
      process.stdout.write = write
    }
  }

  it('tells the sender to deliver phase 1 only to a free squad, and adds no transition', async () => {
    const root = tempDir('agentflow-goal-')
    const zero = await append(root, 0, 'pm.manager', 'p0')
    expect(zero.delivery).toBeUndefined()
    const one = await append(root, 1, 'pm.analyst', 'p1')
    expect(one.delivery).toContain('Deliver it only to a free delivery squad; hold it otherwise.')
    expect(one.delivery).toContain(`--transition ${one.transition.uri}`)
    expect(one.goal.transitions.map((item) => item.phase)).toEqual([0, 1])
  })
})
