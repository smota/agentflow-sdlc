import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { isInside, nativePath, relativeInside, samePath } from './path-identity.mjs'

// One git worktree per slice, removed only when it provably holds nothing that is not merged.
// git is injected as `(args, { cwd }) => stdout` and throws on a non-zero exit.

const DEFAULT_DIR = '.worktrees'
const DEFAULT_BRANCH_PREFIX = 'work/'
// Ignored paths that are safe to lose with the worktree: rebuilt by an install. Anything else that
// git ignores (evidence under .agent-runs/, .env files) blocks removal.
export const DEFAULT_DISPOSABLE = ['node_modules']
const MAX_LISTED = 10
const SLICE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export function defaultGit(args, { cwd } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
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

const isUnder = isInside

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
    // One spelling for every path this module reports, whatever git printed.
    if (entry.path) entries.push({ ...entry, path: nativePath(entry.path) })
  }
  const root = worktreeRoot(repoRoot, dir)
  return entries.filter((e) => isUnder(root, e.path))
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
  // Creation is refused on any doubt, so a case-insensitive match counts as the same path.
  const atPath = entries.find((e) => samePath(e.path, path, { caseInsensitive: true }))
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

// Every registered worktree of the repository, not only those under the slice directory.
function allWorktrees({ repoRoot, git }) {
  const entries = []
  for (const block of String(git(['worktree', 'list', '--porcelain'], { cwd: repoRoot })).split(
    /\n\s*\n/,
  )) {
    const wt = /^worktree (.+)$/m.exec(block)
    if (wt) entries.push({ path: wt[1].trim() })
  }
  return entries
}

// A name with no slash (`node_modules`) matches that directory anywhere, so a monorepo's
// `packages/*/node_modules` counts; a name with a slash (`build/cache`) matches from the worktree
// root. Whatever sits beneath a disposable path goes with it, including a repository nested there.
function isDisposable(path, disposable) {
  const clean = path.replace(/\/$/, '')
  const parts = clean.split('/')
  return disposable.some((name) => {
    const want = name.replace(/\/$/, '')
    if (!want.includes('/')) return parts.includes(want)
    return clean === want || clean.startsWith(`${want}/`)
  })
}

/** Reads the facts that decide whether a slice worktree may be removed. Never mutates. */
export function inspectSliceWorktree({
  repoRoot,
  path,
  git = defaultGit,
  integrationRef,
  mergedHead = null,
  dir = DEFAULT_DIR,
  branch = null,
  disposable = DEFAULT_DISPOSABLE,
  lockedByUs = false,
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
    detached: false,
    nested: [],
    ignored: [],
    reasons,
  }
  const root = worktreeRoot(repoRoot, dir)
  if (!isUnder(root, path)) {
    reasons.push(`path is outside ${dir}/`)
    return info
  }
  // A symlink at the slice path could stand for another slice's worktree.
  try {
    if (lstatSync(path).isSymbolicLink()) {
      reasons.push('slice path is a symlink')
      return info
    }
  } catch {
    // A missing path is reported below.
  }
  const entry = listSliceWorktrees({ repoRoot, git, dir }).find((e) => samePath(e.path, path))
  if (!entry) {
    reasons.push('not a registered worktree')
    return info
  }
  info.registered = true
  info.locked = entry.locked
  info.branch = entry.branch
  info.detached = entry.detached || !entry.branch
  if (entry.locked && !lockedByUs) reasons.push('worktree is locked')
  if (!existsSync(path)) {
    reasons.push('worktree directory is missing')
    return info
  }
  if (info.detached)
    reasons.push('HEAD is detached (its commits would be reachable from no branch)')
  else if (branch && entry.branch !== branch) {
    reasons.push(`worktree is on branch ${entry.branch}, expected ${branch}`)
  }
  // `git worktree remove` deletes everything under the path, including worktrees nested in it.
  for (const other of allWorktrees({ repoRoot, git })) {
    if (!samePath(other.path, path) && isUnder(path, other.path)) {
      info.nested.push(relativeInside(path, other.path))
    }
  }
  if (info.nested.length) {
    reasons.push(`contains another registered worktree: ${info.nested.join(', ')}`)
  }

  const head = tryGit(git, ['rev-parse', 'HEAD'], path)
  info.head = head.ok ? head.out.trim() : null
  if (!info.head) reasons.push('cannot read HEAD')

  const status = tryGit(git, ['status', '--porcelain', '--untracked-files=all', '--ignored'], path)
  if (!status.ok) {
    reasons.push('cannot read git status')
  } else {
    const lines = status.out.split('\n').filter(Boolean)
    info.untracked = lines.some((l) => l.startsWith('??'))
    info.dirty = lines.some((l) => !l.startsWith('??') && !l.startsWith('!!'))
    info.ignored = lines
      .filter((l) => l.startsWith('!! '))
      .map((l) => l.slice(3).replace(/^"|"$/g, ''))
      .filter((p) => !isDisposable(p, disposable))
    if (info.dirty) reasons.push('has modified or staged changes')
    if (info.untracked) reasons.push('has untracked files')
    if (info.ignored.length) {
      const shown = info.ignored.slice(0, MAX_LISTED).join(', ')
      const more =
        info.ignored.length > MAX_LISTED ? ` (+${info.ignored.length - MAX_LISTED} more)` : ''
      reasons.push(`has ignored files that removal would delete: ${shown}${more}`)
    }
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
    } else if (mergedHead && String(mergedHead).trim().toLowerCase() === info.head) {
      info.merged = true
      info.mergedBy = 'mergedHead'
    }
  }
  if (!info.merged)
    reasons.push(`HEAD is not merged into ${integrationRef || '(no integration ref)'}`)
  return info
}

/**
 * Removes a slice worktree only when every safety check passes; otherwise says why it was kept.
 * The branch `<branchPrefix><slice>` is deleted only if its tip is still the inspected commit, so
 * a commit made after inspection is never lost; otherwise the branch is kept and reported.
 */
export function removeSliceWorktree({
  repoRoot,
  slice,
  git = defaultGit,
  integrationRef,
  mergedHead = null,
  dir = DEFAULT_DIR,
  branchPrefix = DEFAULT_BRANCH_PREFIX,
  disposable = DEFAULT_DISPOSABLE,
}) {
  const path = sliceWorktreePath(repoRoot, slice, { dir })
  const branch = `${branchPrefix}${slice}`
  const inspect = (extra = {}) =>
    inspectSliceWorktree({
      repoRoot,
      path,
      git,
      integrationRef,
      mergedHead,
      dir,
      branch,
      disposable,
      ...extra,
    })
  const info = inspect()
  if (info.reasons.length > 0) return { status: 'kept', reasons: info.reasons, path }
  // Inspection and removal are separate steps. Lock the worktree (so git will not prune or move it
  // meanwhile), inspect again under the lock, and unlock only to remove at once. A change made in
  // between that git itself does not refuse (an ignored file, a nested worktree) is caught by the
  // second inspection; the narrow gap after it is the residual risk named in docs/openrig-bridge.md.
  const lock = tryGit(
    git,
    ['worktree', 'lock', '--reason', 'agentflow cleanup in progress', path],
    repoRoot,
  )
  if (!lock.ok) {
    return {
      status: 'kept',
      reasons: [`could not lock the worktree: ${firstLine(lock.error)}`],
      path,
    }
  }
  const unlock = () => tryGit(git, ['worktree', 'unlock', path], repoRoot)
  const again = inspect({ lockedByUs: true })
  if (again.reasons.length > 0 || again.head !== info.head) {
    const unlocked = unlock()
    const reasons = again.reasons.length ? again.reasons : ['HEAD moved after inspection']
    if (!unlocked.ok) reasons.push('the worktree is still locked: unlock it by hand')
    return { status: 'kept', reasons, path }
  }
  if (!unlock().ok) {
    return { status: 'kept', reasons: ['could not unlock the worktree to remove it'], path }
  }
  try {
    git(['worktree', 'remove', path], { cwd: repoRoot })
  } catch (error) {
    return { status: 'kept', reasons: [`git worktree remove refused: ${firstLine(error)}`], path }
  }
  const result = { status: 'removed', reasons: [], path, branch, branchDeleted: false }
  const del = tryGit(git, ['update-ref', '-d', `refs/heads/${branch}`, info.head], repoRoot)
  result.branchDeleted = del.ok
  if (!del.ok) {
    result.branchNote = `branch ${branch} kept: it moved after inspection or could not be deleted (${firstLine(del.error)})`
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
  branchPrefix = DEFAULT_BRANCH_PREFIX,
  disposable = DEFAULT_DISPOSABLE,
}) {
  const out = { removed: [], kept: [], unknown: [] }
  for (const entry of listSliceWorktrees({ repoRoot, git, dir })) {
    const slice = basename(entry.path)
    if (!SLICE_RE.test(slice) || !samePath(join(worktreeRoot(repoRoot, dir), slice), entry.path)) {
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
        branchPrefix,
        disposable,
      })
      if (r.status === 'removed') out.removed.push({ slice, path: entry.path, branch: r.branch })
      else out.kept.push({ slice, path: entry.path, reasons: r.reasons })
    }
  }
  return out
}
