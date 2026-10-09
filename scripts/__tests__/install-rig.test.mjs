import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

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

// HOME is an empty sandbox and PATH has no rig, so the installer touches nothing real.
function installRig(home, ...args) {
  const env = { HOME: home, PATH: '/usr/bin:/bin' }
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
