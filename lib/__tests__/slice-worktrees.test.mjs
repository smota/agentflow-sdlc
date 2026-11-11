import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSliceWorktree,
  inspectSliceWorktree,
  listSliceWorktrees,
  removeSliceWorktree,
  sliceWorktreePath,
  sweepSliceWorktrees,
} from '../runtime/slice-worktrees.mjs'

const g = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

let tmp
let origin
let repo
const INT = 'origin/main'

function commitFile(cwd, name, text = name) {
  writeFileSync(join(cwd, name), text)
  g(cwd, 'add', name)
  g(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', `add ${name}`)
  return g(cwd, 'rev-parse', 'HEAD')
}

const make = (slice) =>
  createSliceWorktree({ repoRoot: repo, slice, branch: `work/${slice}`, base: INT })
const remove = (slice, extra = {}) =>
  removeSliceWorktree({ repoRoot: repo, slice, integrationRef: INT, ...extra })

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'slice-wt-')))
  origin = join(tmp, 'origin.git')
  repo = join(tmp, 'clone')
  g(tmp, 'init', '-q', '--bare', '-b', 'main', origin)
  g(tmp, 'clone', '-q', origin, repo)
  commitFile(repo, 'README.md')
  g(repo, 'push', '-q', 'origin', 'HEAD:main')
  g(repo, 'fetch', '-q', 'origin')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('create', () => {
  it('gives two slices two distinct registered worktrees', () => {
    const a = make('a1')
    const b = make('b2')
    expect(a.path).not.toBe(b.path)
    expect(a.path).toBe(join(repo, '.worktrees', 'a1'))
    expect(
      listSliceWorktrees({ repoRoot: repo })
        .map((e) => e.branch)
        .sort(),
    ).toEqual(['work/a1', 'work/b2'])
  })

  it('is idempotent for the same slice', () => {
    expect(make('a1').created).toBe(true)
    expect(make('a1').created).toBe(false)
  })

  it('refuses a branch or path already used by another slice', () => {
    make('a1')
    expect(() =>
      createSliceWorktree({ repoRoot: repo, slice: 'a2', branch: 'work/a1', base: INT }),
    ).toThrow(/already checked out/)
    expect(() =>
      createSliceWorktree({ repoRoot: repo, slice: 'a1', branch: 'work/other', base: INT }),
    ).toThrow(/already used/)
    mkdirSync(join(repo, '.worktrees', 'stray'), { recursive: true })
    expect(() => make('stray')).toThrow(/not a registered worktree/)
  })

  it('refuses path traversal and odd slice names', () => {
    for (const bad of ['../x', 'a/b', '..', '', '.hidden', 'a b']) {
      expect(() => sliceWorktreePath(repo, bad)).toThrow(/invalid slice/)
    }
    expect(() => make('../x')).toThrow()
    expect(existsSync(join(repo, 'x'))).toBe(false)
  })
})

describe('remove safety', () => {
  it('keeps a worktree with a missing/unregistered path and an outside path', () => {
    expect(remove('nope').reasons).toContain('not a registered worktree')
    const info = inspectSliceWorktree({ repoRoot: repo, path: tmp, integrationRef: INT })
    expect(info.reasons[0]).toMatch(/outside/)
  })

  it('removes a clean merged slice (ancestor) and deletes its branch', () => {
    const { path } = make('m1')
    const r = remove('m1')
    expect(r.status).toBe('removed')
    expect(r.branchDeleted).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(g(repo, 'branch', '--list', 'work/m1')).toBe('')
  })

  it('keeps modified, staged, untracked files', () => {
    const { path } = make('d1')
    writeFileSync(join(path, 'README.md'), 'changed')
    expect(remove('d1').reasons).toContain('has modified or staged changes')
    g(path, 'add', 'README.md')
    expect(remove('d1').reasons).toContain('has modified or staged changes')
    g(path, 'reset', '-q', '--hard')
    writeFileSync(join(path, 'new.txt'), 'x')
    expect(remove('d1').reasons).toContain('has untracked files')
    expect(existsSync(path)).toBe(true)
  })

  it('keeps an unmerged HEAD', () => {
    const { path } = make('u1')
    commitFile(path, 'feature.txt')
    const r = remove('u1')
    expect(r.status).toBe('kept')
    expect(r.reasons.join()).toMatch(/not merged into origin\/main/)
    expect(existsSync(path)).toBe(true)
  })

  it('keeps unpushed commits even when an upstream exists', () => {
    const { path } = make('p1')
    commitFile(path, 'a.txt')
    g(path, 'push', '-q', '-u', 'origin', 'work/p1')
    commitFile(path, 'b.txt')
    const r = remove('p1', { mergedHead: g(path, 'rev-parse', 'HEAD') })
    expect(r.status).toBe('kept')
    expect(r.reasons.join()).toMatch(/unpushed/)
  })

  it('keeps a locked worktree', () => {
    const { path } = make('l1')
    g(repo, 'worktree', 'lock', path)
    const r = remove('l1')
    expect(r.status).toBe('kept')
    expect(r.reasons).toContain('worktree is locked')
  })

  it('keeps a worktree with a merge in progress', () => {
    const { path } = make('ip')
    commitFile(path, 'x.txt', 'one')
    const other = make('ip2')
    commitFile(other.path, 'x.txt', 'two')
    try {
      g(path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', 'work/ip2')
    } catch {
      // conflict expected
    }
    const r = remove('ip')
    expect(r.status).toBe('kept')
    expect(r.reasons.join()).toMatch(/in progress \(MERGE_HEAD\)/)
  })
})

describe('squash merge', () => {
  it('removes when mergedHead equals HEAD (force-deleting the branch), keeps otherwise', () => {
    const { path } = make('s1')
    const head = commitFile(path, 'squashed.txt')
    // squash-merge onto main and push: HEAD is not an ancestor of origin/main
    g(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '--squash', 'work/s1')
    g(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'squash')
    g(repo, 'push', '-q', 'origin', 'HEAD:main')
    g(repo, 'fetch', '-q', 'origin')

    const kept = remove('s1')
    expect(kept.status).toBe('kept')
    expect(remove('s1', { mergedHead: 'deadbeef' }).status).toBe('kept')

    const r = remove('s1', { mergedHead: head })
    expect(r.status).toBe('removed')
    expect(r.branchDeleted).toBe(true)
    expect(existsSync(path)).toBe(false)
  })
})

describe('sweep', () => {
  it('removes closed+merged, keeps open and unsafe, lists unknown, never removes unknown', async () => {
    make('closed')
    make('open')
    const dirty = make('dirty')
    writeFileSync(join(dirty.path, 'u.txt'), 'x')
    make('ghost')
    const state = {
      closed: { known: true, closed: true },
      open: { known: true, closed: false },
      dirty: { known: true, closed: true },
    }
    const res = await sweepSliceWorktrees({
      repoRoot: repo,
      integrationRef: INT,
      closedState: async (s) => state[s] ?? { known: false },
    })
    expect(res.removed.map((r) => r.slice)).toEqual(['closed'])
    expect(res.kept.map((r) => r.slice).sort()).toEqual(['dirty', 'open'])
    expect(res.kept.find((r) => r.slice === 'dirty').reasons).toContain('has untracked files')
    expect(res.unknown.map((r) => r.slice)).toEqual(['ghost'])
    expect(existsSync(join(repo, '.worktrees', 'ghost'))).toBe(true)
  })
})
