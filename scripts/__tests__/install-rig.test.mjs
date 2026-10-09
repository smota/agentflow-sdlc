import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

const INSTALL_RIG = resolve('adapters/openrig/scripts/install-rig.sh')
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

const dirs = []

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
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

// The installer reads configurations.yaml with node. Expose only node, not its install directory,
// which can also hold a globally installed rig.
const NODE_BIN = mkdtempSync(join(tmpdir(), 'agentflow-node-bin-'))
symlinkSync(process.execPath, join(NODE_BIN, 'node'))

// HOME is an empty sandbox and PATH has no rig, so the installer touches nothing real.
function installRig(home, ...args) {
  const env = { HOME: home, PATH: `${NODE_BIN}:/usr/bin:/bin` }
  return spawnSync('bash', [INSTALL_RIG, ...args], { encoding: 'utf8', env })
}

function excludeLines(file) {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

afterAll(() => {
  rmSync(NODE_BIN, { recursive: true, force: true })
})

describe('install-rig.sh target repository', () => {
  it('writes the excludes once for a linked worktree', () => {
    const home = tempDir('agentflow-home-')
    const repo = tempDir('agentflow-repo-')
    initRepo(repo)
    const worktree = join(tempDir('agentflow-wt-'), 'linked')
    runGit(['worktree', 'add', worktree, '-b', 'linked'], repo)

    for (let run = 0; run < 2; run += 1) {
      const result = installRig(home, worktree)
      expect(result.status, result.stderr).toBe(0)
    }

    // Git reads info/exclude from the common git dir for every worktree.
    expect(
      excludeLines(join(repo, '.git/info/exclude')).filter((l) => EXCLUDES.includes(l)),
    ).toEqual(EXCLUDES)
    expect(runGit(['check-ignore', 'CLAUDE.local.md'], worktree)).toBe('CLAUDE.local.md')
  })

  it('writes the excludes to .git/info/exclude for a plain repository', () => {
    const home = tempDir('agentflow-home-')
    const repo = tempDir('agentflow-repo-')
    initRepo(repo)

    const result = installRig(home, repo)

    expect(result.status, result.stderr).toBe(0)
    expect(excludeLines(join(repo, '.git/info/exclude'))).toEqual(expect.arrayContaining(EXCLUDES))
  })

  it.each([
    ['a directory that is not a repository', () => tempDir('agentflow-plain-')],
    ['a missing path', () => join(tempDir('agentflow-gone-'), 'missing')],
  ])('exits 1 before step 1 for %s', (_label, target) => {
    const home = tempDir('agentflow-home-')

    const result = installRig(home, target())

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not a Git repository')
    expect(existsSync(join(home, '.openrig'))).toBe(false)
  })

  it('skips the excludes without an argument and leaves $HOME/code alone', () => {
    const home = tempDir('agentflow-home-')
    const decoy = join(home, 'code', 'decoy')
    mkdirSync(decoy, { recursive: true })
    initRepo(decoy)
    const before = readFileSync(join(decoy, '.git/info/exclude'), 'utf8')

    const result = installRig(home)

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('No target repository given; skipping')
    expect(readFileSync(join(decoy, '.git/info/exclude'), 'utf8')).toBe(before)
  })
})

const AUTH = '{\n  "existing": {\n    "type": "api"\n  }\n}\n'

function plantAuth(home) {
  const file = join(home, '.pi/agent/auth.json')
  mkdirSync(join(home, '.pi/agent'), { recursive: true })
  writeFileSync(file, AUTH)
  return file
}

function piSeats(home) {
  const dir = join(home, '.openrig/state/pi')
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

describe('install-rig.sh preset', () => {
  it('leaves auth.json untouched and creates no Pi seats for a preset without Pi', () => {
    const home = tempDir('agentflow-home-')
    const auth = plantAuth(home)

    const result = installRig(home, '--preset', 'all-claude')

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Preset: all-claude (Pi seats: none)')
    expect(readFileSync(auth, 'utf8')).toBe(AUTH)
    expect(existsSync(join(home, '.openrig/state/pi'))).toBe(false)
  })

  it('bridges only the Pi seats of balanced-grok-lead and adds the grok-cli marker', () => {
    const home = tempDir('agentflow-home-')
    const auth = plantAuth(home)

    const result = installRig(home, '--preset', 'balanced-grok-lead')

    expect(result.status, result.stderr).toBe(0)
    expect(piSeats(home)).toEqual([
      'orch-arch@agentflow',
      'pm-manager@agentflow-product',
      'rev-review@agentflow',
    ])
    const written = JSON.parse(readFileSync(auth, 'utf8'))
    expect(written.existing).toEqual({ type: 'api' })
    expect(written['grok-cli']).toMatchObject({ access: 'pi-grok-cli-account-vault-v1' })
  })

  it('does not create auth.json for a Pi preset when none exists', () => {
    const home = tempDir('agentflow-home-')

    const result = installRig(home, '--preset', 'balanced-grok-lead')

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(home, '.pi/agent/auth.json'))).toBe(false)
  })

  it('defaults to the recommended preset, balanced-grok-lead', () => {
    const home = tempDir('agentflow-home-')

    const result = installRig(home)

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Preset: balanced-grok-lead')
    expect(piSeats(home)).toEqual([
      'orch-arch@agentflow',
      'pm-manager@agentflow-product',
      'rev-review@agentflow',
    ])
    expect(existsSync(join(home, '.openrig/specs/agentflow/rig.yaml'))).toBe(true)
    expect(readFileSync(join(home, '.openrig/specs/agentflow-product/rig.yaml'), 'utf8')).toContain(
      'id: manager',
    )
    expect(readFileSync(join(home, '.openrig/specs/agentflow-product/rig.yaml'), 'utf8')).not.toContain(
      'permission_policy',
    )
  })

  it('exits 1 for an unknown preset before step 1', () => {
    const home = tempDir('agentflow-home-')

    const result = installRig(home, '--preset', 'no-such')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown preset "no-such"')
    expect(existsSync(join(home, '.openrig'))).toBe(false)
  })

  it.each([
    ['before the path', (repo) => ['--preset', 'all-claude', repo]],
    ['after the path', (repo) => [repo, '--preset=all-claude']],
  ])('keeps the repository path positional with --preset %s', (_label, args) => {
    const home = tempDir('agentflow-home-')
    const repo = tempDir('agentflow-repo-')
    initRepo(repo)

    const result = installRig(home, ...args(repo))

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Preset: all-claude')
    expect(excludeLines(join(repo, '.git/info/exclude'))).toEqual(expect.arrayContaining(EXCLUDES))
  })

  it('rejects a second positional argument before step 1', () => {
    const home = tempDir('agentflow-home-')
    const repo = tempDir('agentflow-repo-')
    initRepo(repo)

    const result = installRig(home, repo, 'all-claude')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Unexpected argument 'all-claude'")
    expect(existsSync(join(home, '.openrig'))).toBe(false)
  })
})
