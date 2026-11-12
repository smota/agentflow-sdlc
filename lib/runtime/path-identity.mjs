// Path identity for the slice worktree code (#584). Git reports worktree paths with forward
// slashes and long names, while Node's own paths on Windows use backslashes and may be 8.3 short
// names (RUNNER~1) in a temp directory. Comparing those literally says "not registered" about a
// worktree that is. Every comparison goes through here: resolve, expand short names with the
// platform's native realpath (for the nearest existing ancestor when the path does not exist yet),
// use one separator, and ignore case on Windows. Callers treat any doubt as "keep".
import { realpathSync } from 'node:fs'
import path from 'node:path'

const IMPLS = { win32: path.win32, posix: path.posix }

function config({ platform = process.platform, realpath = realpathSync.native } = {}) {
  return {
    impl: platform === 'win32' ? IMPLS.win32 : IMPLS.posix,
    realpath,
    win: platform === 'win32',
  }
}

// The real path of `p`: symlinks and short names expanded when it exists, else its nearest
// existing ancestor expanded and the rest appended as written.
function realish(p, { impl, realpath }) {
  let current = impl.resolve(p)
  const rest = []
  for (;;) {
    try {
      return impl.join(realpath(current), ...rest.reverse())
    } catch {
      const parent = impl.dirname(current)
      if (parent === current) return impl.resolve(p)
      rest.push(impl.basename(current))
      current = parent
    }
  }
}

function slashes(text, win) {
  let out = win ? text.replace(/\\/g, '/') : text
  // `\\?\C:\x` (what a native realpath may return) is the same place as `C:\x`.
  if (win) out = out.replace(/^\/\/\?\//, '').replace(/^\/\/\.\//, '')
  return out.length > 1 && out.endsWith('/') && !/^[A-Za-z]:\/$/.test(out) ? out.slice(0, -1) : out
}

/** The path in one canonical spelling, original case kept (for reports). */
export function canonicalPath(p, options = {}) {
  const c = config(options)
  return slashes(realish(p, c), c.win)
}

/** The comparison key: canonical, and lower-case on Windows. Never shown to anyone. */
export function pathKey(p, options = {}) {
  const c = config(options)
  const text = canonicalPath(p, options)
  return c.win || options.caseInsensitive ? text.toLowerCase() : text
}

export function samePath(a, b, options = {}) {
  return pathKey(a, options) === pathKey(b, options)
}

/** True when `p` is strictly inside `root` (not equal to it). */
export function isInside(root, p, options = {}) {
  const r = pathKey(root, options)
  const k = pathKey(p, options)
  return k.length > r.length && k.startsWith(r.endsWith('/') ? r : `${r}/`)
}

/** `p` relative to `root`, forward slashes, original case; null when not inside. */
export function relativeInside(root, p, options = {}) {
  if (!isInside(root, p, options)) return null
  const r = canonicalPath(root, options)
  return canonicalPath(p, options).slice(r.endsWith('/') ? r.length : r.length + 1)
}

/** A path in the platform's own spelling (native separators, short names expanded). */
export function nativePath(p, options = {}) {
  const c = config(options)
  const text = canonicalPath(p, options)
  return c.win ? text.replace(/\//g, '\\') : text
}
