import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// A real static check over the core module graph, built from import statements using Node
// built-ins only (no parser dependency). This is the test that keeps `lib/core/` honest after
// everyone stops paying attention to it: it does not just scan the files directly inside
// `lib/core/`, it follows every relative import those files make, transitively, and asserts that
// nothing reachable from a core entry point contains an outbound-call primitive.

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8')
const slash = (value) => value.replaceAll('\\', '/')

function importSpecifiers(source) {
  const specifiers = new Set()
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specifiers.add(match[1])
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g))
    specifiers.add(match[1])
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specifiers.add(match[1])
  return [...specifiers]
}

// Only local (relative) specifiers are part of the repo's own reachable graph; bare specifiers are
// either Node built-ins (`node:*`) or third-party packages, neither of which this static check can
// (or needs to) open — the point is what OUR code reaches, not what's inside npm/node itself.
function resolveLocalImport(fromPath, specifier) {
  if (!specifier.startsWith('.')) return null
  const candidate = resolve(dirname(resolve(repoRoot, fromPath)), specifier)
  const options = extname(candidate)
    ? [candidate]
    : [`${candidate}.mjs`, `${candidate}.js`, `${candidate}.json`]
  const match = options.find((path) => existsSync(path))
  return match ? slash(relative(repoRoot, match)) : null
}

function reachableFrom(entryPaths) {
  const visited = new Set()
  const queue = [...entryPaths]
  while (queue.length) {
    const path = queue.shift()
    if (visited.has(path)) continue
    visited.add(path)
    if (!path.endsWith('.mjs') && !path.endsWith('.js')) continue
    for (const specifier of importSpecifiers(read(path))) {
      const dependency = resolveLocalImport(path, specifier)
      if (dependency && !visited.has(dependency)) queue.push(dependency)
    }
  }
  return visited
}

// Outbound-call surfaces: the primitives Node and the web platform expose for talking to the
// network or spawning a subprocess. Conservative on purpose — this is a text-level check, not an
// execution trace, so it flags the presence of the capability, not proof it fires.
const OUTBOUND_PATTERNS = [
  /\bfetch\s*\(/,
  /from\s+['"]node:(http2?|https|net|dgram|dns|tls|child_process|cluster)['"]/,
  /require\(\s*['"](https?|child_process|net|dgram|dns|tls)['"]\s*\)/,
  /\bnew\s+WebSocket\s*\(/,
  /\bXMLHttpRequest\b/,
]

describe('core purity (architecture)', () => {
  it('7. nothing reachable from lib/core/ performs an outbound call', () => {
    const entries = readdirSync(resolve(repoRoot, 'lib/core'))
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => `lib/core/${name}`)
    const graph = reachableFrom(entries)

    // Sanity: the graph must actually extend past lib/core itself (core depends on
    // sdlc-vocabulary.mjs today), otherwise the assertion below would pass vacuously on an empty
    // or trivial traversal instead of proving anything.
    expect(graph.size).toBeGreaterThan(entries.length)

    const offenders = []
    for (const path of graph) {
      const source = read(path)
      for (const pattern of OUTBOUND_PATTERNS) {
        if (pattern.test(source)) offenders.push(`${path} matches ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
