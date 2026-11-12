// AC5 (#582): the bridge is source-agnostic. Only the source registry may name a source system.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE_SPECIFIC = /github|\bgh\b|octokit|pull_request|issue_number/i
const bridgeModules = [
  ...readdirSync(join(repoRoot, 'lib/bridge'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => `lib/bridge/${name}`),
  'scripts/bridge.mjs',
]

describe('bridge stays free of any source system (#582 AC5)', () => {
  it('finds the bridge modules', () => {
    expect(bridgeModules).toEqual(
      expect.arrayContaining(['lib/bridge/bridge.mjs', 'lib/bridge/queue-port.mjs']),
    )
  })

  it.each(bridgeModules)('%s names no source system and imports no source adapter', (path) => {
    const text = readFileSync(join(repoRoot, path), 'utf8')
    expect(text).not.toMatch(SOURCE_SPECIFIC)
    const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
    const sources = imports.filter((specifier) => specifier.includes('/sources/'))
    expect(sources.every((specifier) => specifier.endsWith('/sources/registry.mjs'))).toBe(true)
  })
})
