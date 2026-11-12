// The bridge's worktree port (#584b), backed by lib/runtime/slice-worktrees.mjs. One worktree per
// slice, created before any seat works on it and removed only when it provably holds nothing that
// is not merged. The bridge calls these hooks; this module owns every git decision.
//
//   pathFor({ slice })                    → { path }                  the path a seat will work in
//   prepare({ slice })                    → { path, absolute, branch, base, created }
//   cleanup({ slice, workItem })          → { status: 'removed' | 'absent' | 'kept', reasons, path }
//   sweep({ openSlices, resolveSlice, dryRun })
//                                         → { removed, kept, orphans, wouldRemove }
//
// The integration ref is fetched before any merged-state decision. A ref that cannot be refreshed
// is stale, and a stale ref keeps a worktree, never removes it.
import { existsSync, realpathSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import {
  createSliceWorktree,
  defaultGit,
  inspectSliceWorktree,
  listSliceWorktrees,
  removeSliceWorktree,
  sliceWorktreePath,
} from '../runtime/slice-worktrees.mjs'

export const DEFAULT_WORKTREES_DIR = '.worktrees'
export const DEFAULT_BRANCH_PREFIX = 'work/'
export const DEFAULT_INTEGRATION = 'development'
export const DEFAULT_REMOTE = 'origin'

function message(error) {
  const text = String(error?.stderr || error?.message || error || '')
  return text.split('\n').find(Boolean)?.trim() || 'unknown error'
}

function realish(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

export function createWorktreesPort({ repoRoot, settings = {}, git = defaultGit }) {
  if (!repoRoot) throw new Error('createWorktreesPort requires repoRoot')
  const dir = settings.dir ?? DEFAULT_WORKTREES_DIR
  const branchPrefix = settings.branchPrefix ?? DEFAULT_BRANCH_PREFIX
  const remote = settings.remote ?? DEFAULT_REMOTE

  const run = (args, cwd = repoRoot) => String(git(args, { cwd }))
  const ok = (args) => {
    try {
      run(args)
      return true
    } catch {
      return false
    }
  }

  function integrationName() {
    if (settings.integration) return settings.integration
    try {
      const head = run(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]).trim()
      if (head.startsWith(`${remote}/`)) return head.slice(remote.length + 1)
    } catch {
      // No remote HEAD recorded: use the documented default.
    }
    return DEFAULT_INTEGRATION
  }

  const integrationRef = () => `${remote}/${integrationName()}`

  // { ok: true } or { ok: false, reason }. Nothing is decided from a ref that could not be fetched.
  function refresh() {
    try {
      run(['fetch', '--quiet', remote, integrationName()])
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        reason: `could not fetch ${integrationRef()}, so merged state is unknown: ${message(error)}`,
      }
    }
  }

  const relativePath = (slice) =>
    relative(repoRoot, sliceWorktreePath(repoRoot, slice, { dir }))
      .split('\\')
      .join('/')

  function baseRef() {
    const remoteRef = integrationRef()
    if (ok(['rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`])) return remoteRef
    const local = integrationName()
    if (ok(['rev-parse', '--verify', '--quiet', `${local}^{commit}`])) return local
    throw new Error(`integration ref ${remoteRef} does not exist; set worktrees.integration`)
  }

  function absentOrKept(slice) {
    const path = sliceWorktreePath(repoRoot, slice, { dir })
    const registered = listSliceWorktrees({ repoRoot, git, dir }).some(
      (entry) => realish(entry.path) === realish(path),
    )
    return { path, absent: !registered && !existsSync(path) }
  }

  function isSliceEntry(entry) {
    const slice = basename(entry.path)
    try {
      const expected = sliceWorktreePath(repoRoot, slice, { dir })
      return realish(expected) === realish(entry.path) ? slice : null
    } catch {
      return null
    }
  }

  return {
    settings: { repoRoot, dir, branchPrefix, remote, integration: integrationName() },

    pathFor({ slice }) {
      return { path: relativePath(slice) }
    },

    // Creates `<dir>/<slice>` on `<branchPrefix><slice>` from the freshest integration ref, or
    // reuses it. A failed fetch only means the base may be older; it is not a reason to refuse.
    prepare({ slice }) {
      refresh()
      const base = baseRef()
      const branch = `${branchPrefix}${slice}`
      const made = createSliceWorktree({ repoRoot, slice, branch, base, git, dir })
      return {
        path: relativePath(slice),
        absolute: made.path,
        branch: made.branch,
        base,
        created: made.created,
      }
    },

    cleanup({ slice, workItem }) {
      const { path, absent } = absentOrKept(slice)
      if (absent) return { status: 'absent', reasons: [], path }
      const fetched = refresh()
      if (!fetched.ok) return { status: 'kept', reasons: [fetched.reason], path }
      const result = removeSliceWorktree({
        repoRoot,
        slice,
        git,
        dir,
        integrationRef: integrationRef(),
        mergedHead: workItem?.mergedHead ?? null,
      })
      return { ...result, path }
    },

    // Walks `<dir>/*`. Slices the source lists as open are kept; closed or merged ones go through
    // the same removal rule as cleanup; slices the source does not know are listed, never removed.
    async sweep({ openSlices = [], resolveSlice, dryRun = false }) {
      const out = { removed: [], kept: [], orphans: [], wouldRemove: [] }
      const open = new Set(openSlices)
      const entries = listSliceWorktrees({ repoRoot, git, dir })
      let fetched = null
      for (const entry of entries) {
        const slice = isSliceEntry(entry)
        if (!slice) {
          out.orphans.push({
            slice: basename(entry.path),
            path: entry.path,
            reason: 'not a slice worktree',
          })
          continue
        }
        const where = { slice, path: entry.path }
        if (open.has(slice)) {
          out.kept.push({ ...where, reasons: ['slice is still open'], refused: false })
          continue
        }
        const state = (await resolveSlice?.(slice)) ?? { known: false }
        if (!state.known) {
          out.orphans.push({ ...where, reason: 'no work item in the source has this slice' })
          continue
        }
        if (!state.closed) {
          out.kept.push({ ...where, reasons: ['slice is still open'], refused: false })
          continue
        }
        fetched ??= refresh()
        if (!fetched.ok) {
          out.kept.push({ ...where, reasons: [fetched.reason], refused: true })
          continue
        }
        const input = {
          repoRoot,
          git,
          dir,
          integrationRef: integrationRef(),
          mergedHead: state.mergedHead ?? null,
        }
        if (dryRun) {
          const info = inspectSliceWorktree({ ...input, path: entry.path })
          if (info.reasons.length) {
            out.kept.push({ ...where, reasons: info.reasons, refused: true })
          } else out.wouldRemove.push(where)
          continue
        }
        const result = removeSliceWorktree({ ...input, slice })
        if (result.status === 'removed') out.removed.push({ ...where, branch: result.branch })
        else out.kept.push({ ...where, reasons: result.reasons, refused: true })
      }
      return out
    },
  }
}
