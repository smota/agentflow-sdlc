import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

// One git worktree per slice, removed only when it provably holds nothing that is not merged.
// git is injected as `(args, { cwd }) => stdout` and throws on a non-zero exit.

const DEFAULT_DIR = '.worktrees'
const SLICE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export function defaultGit(args, { cwd } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function realish(p) {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

function assertSlice(slice) {
  if (typeof slice !== 'string' || !SLICE_RE.test(slice) || slice.includes('..')) {
    throw new Error(`invalid slice name: ${JSON.stringify(slice)}`)
  }
  if (slice.endsWith('.lock') || slice.endsWith('.')) {
    throw new Error(`invalid slice name: ${JSON.stringify(slice)}`)
  }
}

function worktreeRoot(repoRoot, dir) {
  return resolve(repoRoot, dir)
}

/** Absolute directory for a slice. Refuses names that could leave `<repoRoot>/<dir>/`. */
export function sliceWorktreePath(repoRoot, slice, { dir = DEFAULT_DIR } = {}) {
  assertSlice(slice)
  const root = worktreeRoot(repoRoot, dir)
  const path = resolve(root, slice)
  if (dirname(path) !== root) throw new Error(`slice path escapes ${dir}: ${slice}`)
  return path
}

function isUnder(root, path) {
  const rel = relative(realish(root), realish(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(sep)
}

/** Parses `git worktree list --porcelain` into `{ path, head, branch, locked, detached }[]`. */
export function listSliceWorktrees({ repoRoot, git = defaultGit, dir = DEFAULT_DIR }) {
  const out = git(['worktree', 'list', '--porcelain'], { cwd: repoRoot })
  const entries = []
  for (const block of String(out).split(/\n\s*\n/)) {
    const entry = { path: null, head: null, branch: null, locked: false, detached: false }
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) entry.path = line.slice(9).trim()
      else if (line.startsWith('HEAD ')) entry.head = line.slice(5).trim()
      else if (line.startsWith('branch '))
        entry.branch = line
          .slice(7)
          .trim()
          .replace(/^refs\/heads\//, '')
      else if (line === 'detached') entry.detached = true
      else if (line === 'locked' || line.startsWith('locked ')) entry.locked = true
    }
    if (entry.path) entries.push(entry)
  }
  const root = worktreeRoot(repoRoot, dir)
  return entries.filter((e) => isUnder(root, e.path))
}

function samePath(a, b) {
  return realish(a) === realish(b)
}

/** Creates `.worktrees/<slice>` on `<branch>` from `base`, or reuses it for the same slice. */
export function createSliceWorktree({
  repoRoot,
  slice,
  branch,
  base,
  git = defaultGit,
  dir = DEFAULT_DIR,
}) {
  const path = sliceWorktreePath(repoRoot, slice, { dir })
  if (typeof branch !== 'string' || !branch.trim()) throw new Error('branch is required')
  if (typeof base !== 'string' || !base.trim()) throw new Error('base is required')
  const all = git(['worktree', 'list', '--porcelain'], { cwd: repoRoot })
  const entries = []
  for (const block of String(all).split(/\n\s*\n/)) {
    const wt = /^worktree (.+)$/m.exec(block)
    const br = /^branch refs\/heads\/(.+)$/m.exec(block)
    if (wt) entries.push({ path: wt[1].trim(), branch: br ? br[1].trim() : null })
  }
  const lower = path.toLowerCase()
  const atPath = entries.find(
    (e) => samePath(e.path, path) || resolve(e.path).toLowerCase() === lower,
  )
  if (atPath) {
    if (atPath.branch === branch) return { path, branch, created: false }
    throw new Error(`path ${path} is already used by branch ${atPath.branch ?? '(detached)'}`)
  }
  const byBranch = entries.find((e) => e.branch === branch)
  if (byBranch) throw new Error(`branch ${branch} is already checked out at ${byBranch.path}`)
  if (existsSync(path)) throw new Error(`path ${path} exists but is not a registered worktree`)
  let branchExists = true
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoRoot })
  } catch {
    branchExists = false
  }
  if (branchExists) git(['worktree', 'add', path, branch], { cwd: repoRoot })
  else git(['worktree', 'add', '--no-track', '-b', branch, path, base], { cwd: repoRoot })
  return { path, branch, created: true }
}

function tryGit(git, args, cwd) {
  try {
    return { ok: true, out: String(git(args, { cwd })) }
  } catch (error) {
    return { ok: false, out: '', error }
  }
}

/** Reads the facts that decide whether a slice worktree may be removed. Never mutates. */
export function inspectSliceWorktree({
  repoRoot,
  path,
  git = defaultGit,
  integrationRef,
  mergedHead = null,
  dir = DEFAULT_DIR,
}) {
  const reasons = []
  const info = {
    registered: false,
    locked: false,
    dirty: false,
    untracked: false,
    inProgress: false,
    unpushed: false,
    merged: false,
    mergedBy: null,
    head: null,
    branch: null,
    reasons,
  }
  const root = worktreeRoot(repoRoot, dir)
  if (!isUnder(root, path)) {
    reasons.push(`path is outside ${dir}/`)
    return info
  }
  const entry = listSliceWorktrees({ repoRoot, git, dir }).find((e) => samePath(e.path, path))
  if (!entry) {
    reasons.push('not a registered worktree')
    return info
  }
  info.registered = true
  info.locked = entry.locked
  info.branch = entry.branch
  if (entry.locked) reasons.push('worktree is locked')
  if (!existsSync(path)) {
    reasons.push('worktree directory is missing')
    return info
  }

  const head = tryGit(git, ['rev-parse', 'HEAD'], path)
  info.head = head.ok ? head.out.trim() : null
  if (!info.head) reasons.push('cannot read HEAD')

  const status = tryGit(git, ['status', '--porcelain', '--untracked-files=all'], path)
  if (!status.ok) {
    reasons.push('cannot read git status')
  } else {
    const lines = status.out.split('\n').filter(Boolean)
    info.untracked = lines.some((l) => l.startsWith('??'))
    info.dirty = lines.some((l) => !l.startsWith('??'))
    if (info.dirty) reasons.push('has modified or staged changes')
    if (info.untracked) reasons.push('has untracked files')
  }

  for (const name of [
    'MERGE_HEAD',
    'rebase-merge',
    'rebase-apply',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
  ]) {
    const p = tryGit(git, ['rev-parse', '--git-path', name], path)
    if (p.ok && existsSync(resolve(path, p.out.trim()))) {
      info.inProgress = true
      reasons.push(`operation in progress (${name})`)
    }
  }

  const upstream = tryGit(
    git,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    path,
  )
  // An upstream equal to the integration ref (a branch cut from it) is not a push target.
  if (upstream.ok && upstream.out.trim() && upstream.out.trim() !== integrationRef) {
    const ahead = tryGit(git, ['rev-list', '--count', '@{upstream}..HEAD'], path)
    if (!ahead.ok) {
      info.unpushed = true
      reasons.push('cannot compare with upstream')
    } else if (Number(ahead.out.trim()) > 0) {
      info.unpushed = true
      reasons.push(`has ${ahead.out.trim()} unpushed commit(s)`)
    }
  }

  if (info.head && integrationRef) {
    if (tryGit(git, ['merge-base', '--is-ancestor', info.head, integrationRef], path).ok) {
      info.merged = true
      info.mergedBy = 'ancestor'
    } else if (mergedHead && String(mergedHead).trim() === info.head) {
      info.merged = true
      info.mergedBy = 'mergedHead'
    }
  }
  if (!info.merged)
    reasons.push(`HEAD is not merged into ${integrationRef || '(no integration ref)'}`)
  return info
}

/** Removes a slice worktree only when every safety check passes; otherwise says why it was kept. */
export function removeSliceWorktree({
  repoRoot,
  slice,
  git = defaultGit,
  integrationRef,
  mergedHead = null,
  dir = DEFAULT_DIR,
}) {
  const path = sliceWorktreePath(repoRoot, slice, { dir })
  const info = inspectSliceWorktree({ repoRoot, path, git, integrationRef, mergedHead, dir })
  if (info.reasons.length > 0) return { status: 'kept', reasons: info.reasons, path }
  try {
    git(['worktree', 'remove', path], { cwd: repoRoot })
  } catch (error) {
    return { status: 'kept', reasons: [`git worktree remove refused: ${firstLine(error)}`], path }
  }
  const result = { status: 'removed', reasons: [], path, branch: info.branch, branchDeleted: false }
  const integrationBranch = String(integrationRef || '').replace(/^[^/]+\//, '')
  if (info.branch && info.branch !== integrationBranch) {
    const flag = info.mergedBy === 'mergedHead' ? '-D' : '-d'
    const del = tryGit(git, ['branch', flag, info.branch], repoRoot)
    result.branchDeleted = del.ok
    if (!del.ok) result.branchNote = `branch kept: ${firstLine(del.error)}`
  }
  return result
}

function firstLine(error) {
  const text = String(error?.stderr || error?.message || error || '')
  return text.split('\n').find(Boolean)?.trim() || 'unknown error'
}

/**
 * Walks `.worktrees/*`. `closedState(slice)` -> `{ known, closed, mergedHead }`. Unknown slices are
 * listed and never removed; open slices are kept; closed ones go through removeSliceWorktree.
 */
export async function sweepSliceWorktrees({
  repoRoot,
  git = defaultGit,
  dir = DEFAULT_DIR,
  integrationRef,
  closedState,
}) {
  const out = { removed: [], kept: [], unknown: [] }
  for (const entry of listSliceWorktrees({ repoRoot, git, dir })) {
    const slice = basename(entry.path)
    if (!SLICE_RE.test(slice) || join(worktreeRoot(repoRoot, dir), slice) !== resolve(entry.path)) {
      out.unknown.push({ slice, path: entry.path })
      continue
    }
    const state = (await closedState(slice)) || { known: false }
    if (!state.known) {
      out.unknown.push({ slice, path: entry.path })
    } else if (!state.closed) {
      out.kept.push({ slice, path: entry.path, reasons: ['slice is still open'] })
    } else {
      const r = removeSliceWorktree({
        repoRoot,
        slice,
        git,
        dir,
        integrationRef,
        mergedHead: state.mergedHead ?? null,
      })
      if (r.status === 'removed') out.removed.push({ slice, path: entry.path, branch: r.branch })
      else out.kept.push({ slice, path: entry.path, reasons: r.reasons })
    }
  }
  return out
}
