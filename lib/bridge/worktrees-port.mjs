// The bridge's worktree port (#584b), backed by lib/runtime/slice-worktrees.mjs. One worktree per
// slice, created before any seat works on it and removed only when it provably holds nothing that
// is not merged. The bridge calls these hooks; this module owns every git decision.
//
//   pathFor({ slice })                    → { path } | null           the path a seat will work in
//   prepare({ slice })                    → { path, absolute, branch, base, created }
//   cleanup({ slice, workItem })          → { status: 'removed' | 'absent' | 'kept', reasons, path }
//   sweep({ openSlices, resolveSlice, dryRun })
//                                         → { removed, kept, orphans, wouldRemove }
//
// Git runs lazily: building the port runs nothing, and a project that is not a git repository
// makes every hook inert (null). Reasons that reach a person are scrubbed: paths are relative to
// the repository root, the home directory is `~`, and remote URLs (which may hold tokens) are
// replaced. A dry run never fetches, so its answers may be stale and say so.
//
// The integration ref is fetched before any merged-state decision. A ref that cannot be refreshed
// is stale, and a stale ref keeps a worktree, never removes it.
import { existsSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { canonicalPath, samePath } from '../runtime/path-identity.mjs'
import {
  DEFAULT_DISPOSABLE,
  createSliceWorktree,
  defaultGit,
  inspectSliceWorktree,
  listSliceWorktrees,
  removeSliceWorktree,
  sliceWorktreePath,
} from '../runtime/slice-worktrees.mjs'
import { scrubReason } from '../runtime/scrub-git-output.mjs'

export const DEFAULT_WORKTREES_DIR = '.worktrees'
export const DEFAULT_BRANCH_PREFIX = 'work/'
export const DEFAULT_INTEGRATION = 'development'
export const DEFAULT_REMOTE = 'origin'

function message(error) {
  const text = String(error?.stderr || error?.message || error || '')
  return text.split('\n').find(Boolean)?.trim() || 'unknown error'
}

// Every way a path may be spelled in git's output: as given, canonical, and with either slash.
function rootSpellings(top) {
  const out = new Set()
  for (const form of [top, canonicalPath(top)]) {
    out.add(form)
    out.add(form.replace(/\\/g, '/'))
    out.add(form.replace(/\//g, '\\'))
  }
  return [...out]
}

export function createWorktreesPort({
  repoRoot = null,
  resolveRepoRoot = null,
  settings = {},
  git = defaultGit,
}) {
  if (!repoRoot && !resolveRepoRoot) {
    throw new Error('createWorktreesPort requires repoRoot or resolveRepoRoot')
  }
  const dir = settings.dir ?? DEFAULT_WORKTREES_DIR
  const branchPrefix = settings.branchPrefix ?? DEFAULT_BRANCH_PREFIX
  const remote = settings.remote ?? DEFAULT_REMOTE
  const disposable = Array.isArray(settings.disposable) ? settings.disposable : DEFAULT_DISPOSABLE

  let resolved
  // The primary checkout, resolved on first use; null when the project is not a git repository.
  function root() {
    if (resolved === undefined) {
      try {
        resolved = repoRoot ?? resolveRepoRoot() ?? null
      } catch {
        resolved = null
      }
    }
    return resolved
  }

  const run = (args, cwd = root()) => String(git(args, { cwd }))
  const ok = (args) => {
    try {
      run(args)
      return true
    } catch {
      return false
    }
  }

  function scrub(text) {
    const top = root()
    let remoteUrl = null
    try {
      remoteUrl = run(['remote', 'get-url', remote]).trim()
    } catch {
      // No such remote.
    }
    return scrubReason(text, {
      roots: top ? rootSpellings(top) : [],
      remoteUrls: [remoteUrl],
    })
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

  // A merged head only counts against the branch it merged into. The source must say which, and it
  // must be the integration branch; anything else is ignored and the worktree must be an ancestor.
  const headFor = (item) =>
    item?.mergedHead && item.mergedInto === integrationName() ? item.mergedHead : null

  // { ok: true } or { ok: false, reason }. Nothing is decided from a ref that could not be fetched.
  function refresh() {
    try {
      run(['fetch', '--quiet', remote, integrationName()])
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        reason: scrub(
          `could not fetch ${integrationRef()}, so merged state is unknown: ${message(error)}`,
        ),
      }
    }
  }

  const relativePath = (slice) =>
    relative(resolve('/'), sliceWorktreePath(resolve('/'), slice, { dir }))
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
    const path = sliceWorktreePath(root(), slice, { dir })
    const registered = listSliceWorktrees({ repoRoot: root(), git, dir }).some((entry) =>
      samePath(entry.path, path),
    )
    return { path, absent: !registered && !existsSync(path) }
  }

  function isSliceEntry(entry) {
    const slice = basename(entry.path)
    try {
      const expected = sliceWorktreePath(root(), slice, { dir })
      return samePath(expected, entry.path) ? slice : null
    } catch {
      return null
    }
  }

  const shown = (path) => scrub(path)

  return {
    // Configuration only: reading it runs no git. The integration branch is resolved on use.
    settings: {
      dir,
      branchPrefix,
      remote,
      integration: settings.integration ?? null,
      disposable,
    },

    // The primary checkout (runs git once, on first use).
    root,

    pathFor({ slice }) {
      return root() ? { path: relativePath(slice) } : null
    },

    // Creates `<dir>/<slice>` on `<branchPrefix><slice>` from the freshest integration ref, or
    // reuses it. A failed fetch only means the base may be older; it is not a reason to refuse.
    prepare({ slice }) {
      if (!root()) return null
      refresh()
      const base = baseRef()
      const branch = `${branchPrefix}${slice}`
      const made = createSliceWorktree({ repoRoot: root(), slice, branch, base, git, dir })
      return {
        path: relativePath(slice),
        absolute: made.path,
        branch: made.branch,
        base,
        created: made.created,
      }
    },

    cleanup({ slice, workItem }) {
      if (!root()) return null
      const where = relativePath(slice)
      try {
        const { absent } = absentOrKept(slice)
        if (absent) return { status: 'absent', reasons: [], path: where }
        const fetched = refresh()
        if (!fetched.ok) return { status: 'kept', reasons: [fetched.reason], path: where }
        const result = removeSliceWorktree({
          repoRoot: root(),
          slice,
          git,
          dir,
          integrationRef: integrationRef(),
          mergedHead: headFor(workItem),
          branchPrefix,
          disposable,
        })
        return {
          ...result,
          path: where,
          reasons: result.reasons.map(scrub),
          ...(result.branchNote ? { branchNote: scrub(result.branchNote) } : {}),
        }
      } catch (error) {
        return {
          status: 'kept',
          reasons: [scrub(`cleanup failed: ${message(error)}`)],
          path: where,
        }
      }
    },

    // Walks `<dir>/*`. Slices the source lists as open are kept; closed or merged ones go through
    // the same removal rule as cleanup; slices the source does not know are listed, never removed.
    // A dry run does not fetch and marks what it reports as possibly stale.
    async sweep({ openSlices = [], resolveSlice, dryRun = false }) {
      if (!root()) return null
      const out = { removed: [], kept: [], orphans: [], wouldRemove: [] }
      if (dryRun) out.possiblyStale = true
      const open = new Set(openSlices)
      const entries = listSliceWorktrees({ repoRoot: root(), git, dir })
      let fetched = dryRun ? { ok: true } : null
      for (const entry of entries) {
        const slice = isSliceEntry(entry)
        const at = shown(entry.path)
        if (!slice) {
          out.orphans.push({
            slice: basename(entry.path),
            path: at,
            reason: 'not a slice worktree',
          })
          continue
        }
        const where = { slice, path: at }
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
          repoRoot: root(),
          git,
          dir,
          integrationRef: integrationRef(),
          mergedHead: headFor(state),
          disposable,
        }
        if (dryRun) {
          const info = inspectSliceWorktree({
            ...input,
            path: entry.path,
            branch: `${branchPrefix}${slice}`,
          })
          if (info.reasons.length) {
            out.kept.push({ ...where, reasons: info.reasons.map(scrub), refused: true })
          } else out.wouldRemove.push(where)
          continue
        }
        const result = removeSliceWorktree({ ...input, slice, branchPrefix })
        if (result.status === 'removed') out.removed.push({ ...where, branch: result.branch })
        else out.kept.push({ ...where, reasons: result.reasons.map(scrub), refused: true })
      }
      return out
    },
  }
}
