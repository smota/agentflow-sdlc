// Journey tests for `agentflow-sdlc adapters ...` (issue 358). Every run uses a temporary home and
// a PATH with node and git only (plus a fake `rig` where a test says so): no bash, sh, or
// PowerShell, and never the real OpenRig daemon.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

const CLI = resolve('bin/cli.mjs')
const OPENRIG = resolve('adapters/openrig')
const FIXTURE_ADAPTERS = resolve('scripts/__tests__/fixtures/adapters')
const WINDOWS = process.platform === 'win32'
const EXCLUDES = [
  'CLAUDE.local.md',
  'AGENTS.md',
  '/.openrig/',
  '.openrig/',
  '/.worktrees/',
  '.worktrees/',
  '.claude/settings.local.json',
  'gate-lane-verdict.json',
]
const PI_SEATS_BALANCED = [
  'orch-arch@agentflow',
  'pm-manager@agentflow-product',
  'rev-review@agentflow',
]

const dirs = []
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function findOnPath(name, pathValue) {
  const extensions = WINDOWS ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`)
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
  }
  return null
}

// PATH for every run: node and git, nothing else from the host.
const BIN = mkdtempSync(join(tmpdir(), 'agentflow-adapter-bin-'))
const GIT = findOnPath('git', process.env.PATH || process.env.Path || '')
let PATH
if (WINDOWS) {
  // Git for Windows keeps git.exe in cmd/ without bash; node's directory has no shell either.
  PATH = [dirname(process.execPath), dirname(GIT)].join(delimiter)
} else {
  symlinkSync(process.execPath, join(BIN, 'node'))
  symlinkSync(GIT, join(BIN, 'git'))
  PATH = BIN
}

function baseEnv(userHome, extra = {}) {
  const env = { PATH, HOME: userHome, USERPROFILE: userHome, ...extra }
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[name]) env[name] = process.env[name]
  }
  return env
}

// Run with --home pointing at `home` and a separate user home, so OpenRig is never contacted.
function cli(args, { home, cwd, env = {} } = {}) {
  const userHome = tempDir('agentflow-user-')
  const homeArgs = home ? ['--home', home] : []
  return spawnSync(process.execPath, [CLI, ...args, ...homeArgs], {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf8',
    env: baseEnv(userHome, env),
  })
}

function ok(result) {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  return result
}

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function initRepo(dir) {
  runGit(['init', '--initial-branch=development'], dir)
  runGit(['config', 'user.name', 'Tester'], dir)
  runGit(['config', 'user.email', 'tester@example.com'], dir)
  writeFileSync(join(dir, 'file.txt'), 'content')
  runGit(['add', 'file.txt'], dir)
  runGit(['commit', '-m', 'initial'], dir)
}

// Relative path -> content for every file under dir, following links.
function tree(dir) {
  const files = {}
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(dir, path).split('\\').join('/')] = readFileSync(path, 'utf8')
    }
  }
  walk(dir)
  return files
}

function specs(home, name = '') {
  return join(home, '.openrig', 'specs', name)
}

function piSeats(home) {
  const dir = join(home, '.openrig', 'state', 'pi')
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

const AUTH = { existing: { type: 'api' } }
function plantPi(home) {
  const agent = join(home, '.pi', 'agent')
  mkdirSync(join(agent, 'npm', 'pkg'), { recursive: true })
  writeFileSync(join(agent, 'settings.json'), '{"theme":"dark"}')
  writeFileSync(join(agent, 'models-store.json'), '{"models":[]}')
  writeFileSync(join(agent, 'auth.json'), JSON.stringify(AUTH))
  writeFileSync(join(agent, 'npm', 'pkg', 'index.js'), 'export default 1\n')
}

function install(home, ...args) {
  return ok(cli(['adapters', 'install', 'openrig', ...args], { home }))
}

// A copy of the OpenRig adapter under another id, so a test can change "the product copy".
function adapterCopy() {
  const root = tempDir('agentflow-adapters-')
  const dir = join(root, 'openrig-copy')
  cpSync(OPENRIG, dir, { recursive: true })
  const manifestPath = join(dir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, harness: 'openrig-copy' }))
  return { root, dir, env: { AGENTFLOW_ADAPTER_PATH: root } }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(BIN, { recursive: true, force: true })
})

describe('test environment (AC16)', () => {
  it('has node and git on PATH and no bash, sh, or PowerShell', () => {
    expect(GIT).not.toBeNull()
    for (const shell of ['bash', 'sh', 'pwsh', 'powershell']) {
      expect(findOnPath(shell, PATH), shell).toBeNull()
    }
  })
})

describe('adapter lifecycle surface (AC1, AC2)', () => {
  it('lists the adapter operations in help and keeps providers to discovery', () => {
    const root = ok(cli(['--help']))
    expect(root.stdout).toContain(
      'adapters <install|update|squads provision|squads update|squads list|squads remove>',
    )
    const help = ok(cli(['adapters', '--help']))
    for (const op of [
      'install',
      'update',
      'squads provision',
      'squads update',
      'squads list',
      'squads remove',
    ]) {
      expect(help.stdout).toContain(`agentflow-sdlc adapters ${op} <id>`)
    }
    const providers = ok(cli(['providers', '--help']))
    expect(providers.stdout).not.toMatch(/install|update|squad/)
  })

  it('names the adapters with a lifecycle for an unknown id', () => {
    const result = cli(['adapters', 'install', 'no-such'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unknown adapter "no-such"')
    expect(result.stderr).toContain('openrig')
  })

  it('says an adapter without a lifecycle has no lifecycle operations', () => {
    const result = cli(['adapters', 'install', 'pi'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Adapter "pi" has no lifecycle operations')
  })

  it('rejects an option the operation does not take', () => {
    const result = cli(['adapters', 'update', 'openrig', '--preset', 'all-claude'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unknown option "--preset"')
  })
})

describe('adapters install openrig (AC3-AC6)', () => {
  it('places both bases with the product copy content and names the recommended preset', () => {
    const home = tempDir('agentflow-home-')
    const result = install(home)
    expect(result.stdout).toContain('Preset: balanced-grok-lead')
    expect(tree(specs(home, 'agentflow'))).toEqual(tree(join(OPENRIG, 'agentflow')))
    expect(tree(specs(home, 'agentflow-product'))).toEqual(tree(join(OPENRIG, 'agentflow-product')))
  })

  it('refuses an unknown preset, lists the known ones, and writes nothing', () => {
    const home = tempDir('agentflow-home-')
    const result = cli(['adapters', 'install', 'openrig', '--preset', 'no-such'], { home })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown preset "no-such"')
    expect(result.stderr).toContain('Known presets: balanced-grok-lead')
    expect(readdirSync(home)).toEqual([])
  })

  it('refuses when the delivery and product bases disagree on the preset', () => {
    const home = tempDir('agentflow-home-')
    const copy = adapterCopy()
    const config = join(copy.dir, 'agentflow-product', 'configurations.yaml')
    writeFileSync(
      config,
      readFileSync(config, 'utf8').replace(
        'recommended: balanced-grok-lead',
        'recommended: all-claude',
      ),
    )
    const result = cli(['adapters', 'install', 'openrig-copy'], { home, env: copy.env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Delivery preset "balanced-grok-lead" and product preset "all-claude" differ',
    )
    expect(readdirSync(home)).toEqual([])
  })

  it('lets each Pi seat read the shared Pi files and adds the grok-cli marker only', () => {
    const home = tempDir('agentflow-home-')
    plantPi(home)
    install(home, '--preset', 'balanced-grok-lead')
    expect(piSeats(home)).toEqual(PI_SEATS_BALANCED)
    const auth = JSON.parse(readFileSync(join(home, '.pi/agent/auth.json'), 'utf8'))
    expect(auth.existing).toEqual(AUTH.existing)
    expect(auth['grok-cli']).toMatchObject({ access: 'pi-grok-cli-account-vault-v1' })
    for (const seat of PI_SEATS_BALANCED) {
      const agent = join(home, '.openrig/state/pi', seat, 'agent')
      expect(readFileSync(join(agent, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
      expect(readFileSync(join(agent, 'models-store.json'), 'utf8')).toBe('{"models":[]}')
      expect(JSON.parse(readFileSync(join(agent, 'auth.json'), 'utf8'))['grok-cli']).toBeDefined()
      expect(readFileSync(join(agent, 'npm', 'pkg', 'index.js'), 'utf8')).toBe('export default 1\n')
    }
  })

  it('creates no Pi seat state for a preset without Pi seats and says it skipped', () => {
    const home = tempDir('agentflow-home-')
    plantPi(home)
    const result = install(home, '--preset', 'all-claude')
    expect(result.stdout).toContain('Preset: all-claude (Pi seats: none)')
    expect(result.stdout).toContain("Preset 'all-claude' has no Pi seats; skipping")
    expect(existsSync(join(home, '.openrig/state/pi'))).toBe(false)
    expect(JSON.parse(readFileSync(join(home, '.pi/agent/auth.json'), 'utf8'))).toEqual(AUTH)
  })

  it('is identical when repeated and writes the excludes once for a linked worktree', () => {
    const home = tempDir('agentflow-home-')
    plantPi(home)
    const repo = tempDir('agentflow-repo-')
    initRepo(repo)
    const worktree = join(tempDir('agentflow-wt-'), 'linked')
    runGit(['worktree', 'add', worktree, '-b', 'linked'], repo)

    install(home, worktree)
    const first = tree(home)
    const second = install(home, worktree)
    expect(tree(home)).toEqual(first)
    expect(second.stdout).toContain('OpenRig was not contacted')

    const lines = readFileSync(join(repo, '.git/info/exclude'), 'utf8').split(/\r?\n/)
    for (const line of EXCLUDES) expect(lines.filter((item) => item === line)).toHaveLength(1)
    expect(runGit(['check-ignore', 'CLAUDE.local.md'], worktree)).toBe('CLAUDE.local.md')
  })

  it.each([
    ['a directory that is not a repository', () => tempDir('agentflow-plain-')],
    ['a missing path', () => join(tempDir('agentflow-gone-'), 'missing')],
  ])('refuses %s and writes nothing', (_label, target) => {
    const home = tempDir('agentflow-home-')
    const result = cli(['adapters', 'install', 'openrig', target()], { home })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not a Git repository')
    expect(readdirSync(home)).toEqual([])
  })
})

describe('adapters update openrig (AC7)', () => {
  it('refreshes the bases from the product copy and leaves squads in place', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    const copy = adapterCopy()
    ok(cli(['adapters', 'install', 'openrig-copy'], { home, env: copy.env }))
    ok(
      cli(['adapters', 'squads', 'provision', 'openrig-copy', 'demo', project], {
        home,
        env: copy.env,
      }),
    )

    writeFileSync(join(copy.dir, 'agentflow', 'CULTURE.md'), '# Changed culture\n')
    writeFileSync(join(copy.dir, 'agentflow-product', 'NEW.md'), 'new\n')
    rmSync(join(copy.dir, 'agentflow', 'startup', 'review-lead.md'))

    const result = ok(cli(['adapters', 'update', 'openrig-copy'], { home, env: copy.env }))
    expect(result.stdout).toContain('OpenRig itself was not changed')
    expect(tree(specs(home, 'agentflow'))).toEqual(tree(join(copy.dir, 'agentflow')))
    expect(tree(specs(home, 'agentflow-product'))).toEqual(
      tree(join(copy.dir, 'agentflow-product')),
    )
    expect(existsSync(specs(home, 'agentflow-demo/rig.yaml'))).toBe(true)
    expect(readFileSync(specs(home, 'agentflow-demo/CULTURE.md'), 'utf8')).toBe(
      '# Changed culture\n',
    )
  })

  it('tells the person to install first when nothing is installed', () => {
    const home = tempDir('agentflow-home-')
    const result = cli(['adapters', 'update', 'openrig'], { home })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Install first: agentflow-sdlc adapters install openrig')
    expect(readdirSync(home)).toEqual([])
  })
})

describe('adapters squads openrig (AC8-AC11)', () => {
  function provision(home, ...args) {
    return ok(cli(['adapters', 'squads', 'provision', 'openrig', ...args], { home }))
  }

  it('provisions a delivery squad that launches in the project path', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    const result = provision(home, '--sibling', 'agentflow-pm', 'demo', project)
    expect(result.stdout).toContain(`rig up agentflow-demo --cwd ${project}`)
    const rig = readFileSync(specs(home, 'agentflow-demo/rig.yaml'), 'utf8')
    expect(rig).toContain('name: agentflow-demo')
    expect(rig).toContain('id: arch')
    expect(rig).toContain('path: sibling.md')
    expect(readFileSync(specs(home, 'agentflow-demo/sibling.md'), 'utf8')).toContain(
      'pm-analyst@agentflow-pm',
    )
    expect(readFileSync(specs(home, 'agentflow-demo/startup/context.md'), 'utf8')).toBe(
      readFileSync(join(OPENRIG, 'agentflow/startup/context.md'), 'utf8'),
    )
  })

  it('provisions a product squad from the product base with the preset runtimes', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    install(home)
    provision(
      home,
      '--kind',
      'product',
      '--sibling',
      'agentflow-demo',
      '--preset',
      'all-claude',
      'pm',
      project,
    )
    const rig = readFileSync(specs(home, 'agentflow-pm/rig.yaml'), 'utf8')
    expect(rig).toContain('name: agentflow-pm')
    expect(rig).toContain('id: manager')
    expect(rig).not.toContain('id: build')
    expect(rig).not.toContain('runtime: pi')
    expect(readFileSync(specs(home, 'agentflow-pm/sibling.md'), 'utf8')).toContain(
      'orch-arch@agentflow-demo',
    )
    // The sibling is recorded in this copy only.
    expect(existsSync(specs(home, 'agentflow-product/sibling.md'))).toBe(false)

    provision(home, '--kind', 'product', '--preset', 'all-grok', 'pm2', project)
    const grok = readFileSync(specs(home, 'agentflow-pm2/rig.yaml'), 'utf8')
    expect(grok).toContain('runtime: pi')
    expect(grok).toContain('model: grok-cli/grok-4.7')
    expect(piSeats(home)).toEqual(
      expect.arrayContaining(['pm-manager@agentflow-pm2', 'pm-analyst@agentflow-pm2']),
    )
  })

  it.each([
    ['an unknown kind', ['--kind', 'other', 'demo']],
    ['an unknown product preset', ['--kind', 'product', '--preset', 'no-such', 'demo']],
  ])('writes nothing for %s', (_label, args) => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    install(home)
    const before = tree(home)
    const result = cli(['adapters', 'squads', 'provision', 'openrig', ...args, project], { home })
    expect(result.status).toBe(1)
    expect(tree(home)).toEqual(before)
  })

  it('updates the spec, rig definition, and sibling record and keeps seat runtime state', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    plantPi(home)
    provision(home, '--sibling', 'agentflow-pm', 'demo', project)
    const seatState = join(home, '.openrig/state/pi/orch-arch@agentflow-demo/agent/session.json')
    writeFileSync(seatState, '{"turn":7}')
    const seatsBefore = tree(join(home, '.openrig/state/pi'))
    writeFileSync(specs(home, 'agentflow-demo/rig.yaml'), 'name: tampered\n')
    writeFileSync(specs(home, 'agentflow-demo/sibling.md'), 'stale\n')

    ok(cli(['adapters', 'squads', 'update', 'openrig', 'demo', project], { home }))
    const rig = readFileSync(specs(home, 'agentflow-demo/rig.yaml'), 'utf8')
    expect(rig).toContain('name: agentflow-demo')
    expect(rig).toContain('path: sibling.md')
    expect(readFileSync(specs(home, 'agentflow-demo/sibling.md'), 'utf8')).toContain(
      'No sibling squad was named',
    )
    expect(tree(join(home, '.openrig/state/pi'))).toEqual(seatsBefore)

    ok(
      cli(['adapters', 'squads', 'update', 'openrig', '--sibling', 'agentflow-pm', 'demo'], {
        home,
      }),
    )
    expect(readFileSync(specs(home, 'agentflow-demo/sibling.md'), 'utf8')).toContain(
      'pm-manager@agentflow-pm',
    )
  })

  it('keeps the kind and sibling of a product squad on update', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    provision(home, '--kind', 'product', '--sibling', 'agentflow-demo', 'pm', project)
    ok(cli(['adapters', 'squads', 'update', 'openrig', 'pm'], { home }))
    expect(readFileSync(specs(home, 'agentflow-pm/rig.yaml'), 'utf8')).toContain('id: manager')
    expect(readFileSync(specs(home, 'agentflow-pm/sibling.md'), 'utf8')).toContain(
      'dev-qa@agentflow-demo',
    )
  })

  it('refuses to update a squad that was never provisioned', () => {
    const home = tempDir('agentflow-home-')
    const result = cli(['adapters', 'squads', 'update', 'openrig', 'demo'], { home })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Provision it first')
  })

  it('lists the bases and squads as stopped when OpenRig is not contacted', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    provision(home, 'demo', project)
    provision(home, '--kind', 'product', 'pm', project)
    const names = ['agentflow', 'agentflow-demo', 'agentflow-pm', 'agentflow-product']

    const json = JSON.parse(
      ok(cli(['adapters', 'squads', 'list', 'openrig', '--json'], { home })).stdout,
    )
    expect(json).toEqual(
      names.map((rig) => ({ rig, status: 'stopped', specDir: specs(home, rig) })),
    )

    const text = ok(cli(['adapters', 'squads', 'list', 'openrig'], { home })).stdout
    for (const name of names) expect(text).toMatch(new RegExp(`${name}\\s+stopped\\s+`))
  })

  it('removes one squad and its seat state, and leaves the rest and the shared files', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    plantPi(home)
    provision(home, 'demo', project)
    provision(home, 'other', project)
    const bases = tree(specs(home, 'agentflow'))
    const pi = tree(join(home, '.pi'))
    const other = tree(specs(home, 'agentflow-other'))

    ok(cli(['adapters', 'squads', 'remove', 'openrig', 'demo'], { home }))
    expect(existsSync(specs(home, 'agentflow-demo'))).toBe(false)
    expect(piSeats(home).filter((seat) => seat.endsWith('@agentflow-demo'))).toEqual([])
    expect(piSeats(home).filter((seat) => seat.endsWith('@agentflow-other'))).toHaveLength(6)
    expect(tree(specs(home, 'agentflow-other'))).toEqual(other)
    expect(tree(specs(home, 'agentflow'))).toEqual(bases)
    expect(tree(join(home, '.pi'))).toEqual(pi)
  })

  it.each(['../escape', 'a/../../..', '..'])(
    'refuses the project name %s and touches nothing',
    (name) => {
      const home = tempDir('agentflow-home-')
      install(home)
      const before = tree(home)
      for (const op of ['provision', 'remove']) {
        const result = cli(['adapters', 'squads', op, 'openrig', name], { home })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('is not a valid project name')
      }
      expect(tree(home)).toEqual(before)
    },
  )

  it.each(['agentflow', 'agentflow-product', 'product'])(
    'refuses to remove the base %s',
    (name) => {
      const home = tempDir('agentflow-home-')
      install(home)
      const before = tree(home)
      const result = cli(['adapters', 'squads', 'remove', 'openrig', name], { home })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Refusing to remove the base rig')
      expect(tree(home)).toEqual(before)
    },
  )
})

// A fake `rig` on PATH, run with HOME as the temporary home, which is the only case where the
// adapter contacts OpenRig. A node script with a shebang is not spawnable without a shell on Windows.
describe.skipIf(WINDOWS)('adapters with a running OpenRig (fake rig)', () => {
  function fakeRig(running = [], { downExit = 0, ps = 'json', mode = 0o755 } = {}) {
    const dir = tempDir('agentflow-fakerig-')
    const log = join(dir, 'calls.log')
    const script = join(dir, 'rig')
    writeFileSync(
      script,
      `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n')
if (args[0] === 'daemon') console.log('Daemon running on port 1')
if (args[0] === 'ps' && ${JSON.stringify(ps)} === 'json') console.log(JSON.stringify(${JSON.stringify(running)}.map((rigName) => ({ rigName, status: 'running' }))))
if (args[0] === 'ps' && ${JSON.stringify(ps)} === 'garbage') console.log('daemon unreachable')
if (args[0] === 'ps' && ${JSON.stringify(ps)} === 'fail') { console.error('PS FAILED'); process.exit(3) }
if (args[0] === 'down' && ${downExit} !== 0) { console.error('STOP REFUSED'); process.exit(${downExit}) }
`,
      { mode },
    )
    symlinkSync(join(BIN, 'node'), join(dir, 'node'))
    symlinkSync(join(BIN, 'git'), join(dir, 'git'))
    return {
      calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []),
      path: dir,
    }
  }

  function live(args, home, rig) {
    return ok(
      spawnSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        env: { PATH: rig.path, HOME: home },
      }),
    )
  }

  it('syncs the spec library on install and update and calls nothing else', () => {
    const home = tempDir('agentflow-home-')
    const rig = fakeRig()
    expect(live(['adapters', 'install', 'openrig'], home, rig).stdout).toContain(
      'Spec library synced',
    )
    live(['adapters', 'update', 'openrig'], home, rig)
    expect(rig.calls()).toEqual(['daemon status', 'specs sync', 'daemon status', 'specs sync'])
  })

  it('shows a running squad as running', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    const rig = fakeRig(['agentflow-demo'])
    live(['adapters', 'squads', 'provision', 'openrig', 'demo', project], home, rig)
    const rows = JSON.parse(
      live(['adapters', 'squads', 'list', 'openrig', '--json'], home, rig).stdout,
    )
    expect(rows.find((row) => row.rig === 'agentflow-demo').status).toBe('running')
    expect(rows.find((row) => row.rig === 'agentflow').status).toBe('stopped')
  })

  it('stops a running squad with rig down before removing it', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    const rig = fakeRig(['agentflow-demo'])
    live(['adapters', 'squads', 'provision', 'openrig', 'demo', project], home, rig)
    live(['adapters', 'squads', 'remove', 'openrig', 'demo'], home, rig)
    const calls = rig.calls()
    expect(calls).toContain('down agentflow-demo')
    expect(calls.filter((call) => call.startsWith('down'))).toEqual(['down agentflow-demo'])
    expect(existsSync(specs(home, 'agentflow-demo'))).toBe(false)
  })

  it('keeps the spec and seat state and fails when rig down refuses to stop', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    const rig = fakeRig(['agentflow-demo'], { downExit: 7 })
    live(['adapters', 'squads', 'provision', 'openrig', 'demo', project], home, rig)
    const before = tree(home)
    const result = spawnSync(
      process.execPath,
      [CLI, 'adapters', 'squads', 'remove', 'openrig', 'demo'],
      {
        encoding: 'utf8',
        env: { PATH: rig.path, HOME: home },
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('rig down agentflow-demo failed (exit 7): STOP REFUSED')
    expect(result.stderr).toContain('Nothing was removed')
    expect(tree(home)).toEqual(before)
    expect(piSeats(home).filter((seat) => seat.endsWith('@agentflow-demo'))).toHaveLength(6)
  })

  it.each([
    ['rig ps exits non-zero', { ps: 'fail' }, 'rig ps exited 3: PS FAILED'],
    [
      'rig ps prints unreadable output',
      { ps: 'garbage' },
      'rig ps --json output could not be read',
    ],
    ['rig cannot be executed', { mode: 0o644 }, 'EACCES'],
  ])('keeps the spec and seat state and fails when %s', (_label, options, message) => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    // Provision with a working rig, then swap in the broken one.
    live(['adapters', 'squads', 'provision', 'openrig', 'demo', project], home, fakeRig())
    const rig = fakeRig(['agentflow-demo'], options)
    const before = tree(home)
    const result = spawnSync(
      process.execPath,
      [CLI, 'adapters', 'squads', 'remove', 'openrig', 'demo'],
      {
        encoding: 'utf8',
        env: { PATH: rig.path, HOME: home },
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Could not read rig status')
    expect(result.stderr).toContain(message)
    expect(result.stderr).toContain('Nothing was removed')
    expect(tree(home)).toEqual(before)
    expect(rig.calls().filter((call) => call.startsWith('down'))).toEqual([])
  })

  it('still lists squads as stopped when rig status cannot be read', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    live(['adapters', 'squads', 'provision', 'openrig', 'demo', project], home, fakeRig())
    const rows = JSON.parse(
      live(['adapters', 'squads', 'list', 'openrig', '--json'], home, fakeRig([], { ps: 'fail' }))
        .stdout,
    )
    expect(rows.map((row) => row.status)).toEqual(['stopped', 'stopped', 'stopped'])
  })
})

describe('a second adapter joins by declaration (AC14)', () => {
  it('installs, provisions, lists, and removes through the same commands', () => {
    const home = tempDir('agentflow-home-')
    const env = { AGENTFLOW_ADAPTER_PATH: FIXTURE_ADAPTERS }
    const run = (...args) => cli(['adapters', ...args], { home, env })
    expect(ok(run('install', 'fixture-rig')).stdout).toContain('fixture-rig installed')
    ok(run('squads', 'provision', 'fixture-rig', 'one'))
    expect(
      ok(run('squads', 'list', 'fixture-rig'))
        .stdout.trim()
        .split(/\r?\n/),
    ).toEqual(['fixture-base', 'fixture-one'])
    ok(run('squads', 'remove', 'fixture-rig', 'one'))
    expect(ok(run('squads', 'list', 'fixture-rig')).stdout.trim()).toBe('fixture-base')
    expect(run('squads', 'remove', 'fixture-rig', 'base').status).toBe(1)
    // An operation the adapter does not declare is refused by core, not crashed.
    const update = run('update', 'fixture-rig')
    expect(update.status).toBe(1)
    expect(update.stderr).toContain('does not support adapters update')
  })
})
