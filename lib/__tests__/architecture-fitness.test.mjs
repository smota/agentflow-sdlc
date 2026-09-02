import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveCompositionProfile } from '../adoption/profiles.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8')
const slash = (value) => value.replaceAll('\\', '/')

function localDependency(from, specifier, { allowBareRelative = false } = {}) {
  if (!specifier.startsWith('.') && !allowBareRelative) return null
  if (specifier.includes('://') || specifier.startsWith('#')) return null
  const candidate = resolve(dirname(resolve(repoRoot, from)), specifier.split('#', 1)[0])
  const options = extname(candidate) ? [candidate] : [`${candidate}.mjs`, `${candidate}.json`]
  const match = options.find((path) => existsSync(path))
  return match ? slash(relative(repoRoot, match)) : null
}

describe('architecture fitness', () => {
  it('uses one complete local and CI validation gate', () => {
    const scripts = JSON.parse(read('package.json')).scripts
    for (const name of [
      'validate:authority',
      'validate:roles',
      'validate:skills',
      'test:collaboration',
    ]) {
      expect(scripts['validate:release']).toContain(`pnpm ${name}`)
    }
    expect(read('.github/workflows/validate-pr.yml')).toContain('run: pnpm validate:release')
  })
  it('keeps portable core contracts independent from providers, sources, and Cockpit', () => {
    for (const name of readdirSync(resolve(repoRoot, 'lib/core')).filter((item) =>
      item.endsWith('.mjs'),
    )) {
      const path = `lib/core/${name}`
      const source = read(path)
      expect(source).not.toMatch(/from ['"]\.\.\/(providers|sources|cockpit|adoption|config)/)
      expect(source).not.toContain('node:child_process')
      expect(source).not.toMatch(/from ['"]node:fs/)
    }
  })

  it('does not import private AI Foundry Desk implementation paths', () => {
    const source = read('lib/providers/ai-foundry-desk.mjs')
    expect(source).not.toMatch(
      /from ['"][^'"]*(?:agent-manager|ai-foundry-desk\/(?:src|dist))[^'"]*['"]/,
    )
    expect(source).toContain("executable: 'afd'")
  })

  it('contains no shell-based provider availability execution', () => {
    const source = `${read('lib/role-routing.mjs')}\n${read('lib/providers/local-cli.mjs')}`
    expect(source).not.toContain('shell: true')
    expect(source).not.toMatch(/execSync\(/)
  })

  it('keeps source adapters independent from Cockpit', () => {
    expect(read('lib/sources/github.mjs')).not.toMatch(/cockpit/)
    expect(read('lib/sources/github-client.mjs')).not.toMatch(/cockpit/)
    expect(read('lib/sources/github-cli.mjs')).not.toMatch(/cockpit/)
    expect(read('lib/cockpit-github.mjs')).toContain("from './sources/github-client.mjs'")
  })

  it('keeps the minimal composition free of provider and Cockpit assets', () => {
    const minimal = resolveCompositionProfile('minimal').managedFiles
    expect(minimal.some((path) => path.startsWith('lib/providers/'))).toBe(false)
    expect(minimal.some((path) => /cockpit/i.test(path))).toBe(false)
    for (const id of ['minimal', 'standard', 'github', 'cockpit']) {
      expect(resolveCompositionProfile(id).managedFiles.length).toBeGreaterThan(0)
    }
  })

  it('keeps every modular composition import and schema-reference closed', () => {
    for (const id of ['minimal', 'standard', 'github', 'cockpit']) {
      const files = new Set(resolveCompositionProfile(id).managedFiles)
      for (const path of files) {
        const dependencies = []
        if (path.endsWith('.mjs')) {
          const source = read(path)
          dependencies.push(
            ...[...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(
              (match) => match[1],
            ),
            ...[...source.matchAll(/import\s+['"]([^'"]+)['"]/g)].map((match) => match[1]),
          )
        } else if (path.endsWith('.json')) {
          dependencies.push(
            ...[...read(path).matchAll(/"\$ref"\s*:\s*"([^"]+)"/g)].map((match) => match[1]),
          )
        }
        for (const specifier of dependencies) {
          const dependency = localDependency(path, specifier, {
            allowBareRelative: path.endsWith('.json'),
          })
          if (dependency)
            expect(files.has(dependency), `${id}: ${path} -> ${dependency}`).toBe(true)
        }
      }
    }
  })

  it('keeps the role product complete in every core profile', () => {
    for (const id of ['minimal', 'standard']) {
      const files = resolveCompositionProfile(id).managedFiles
      expect(new Set(files).size, `${id} must not contain duplicate files`).toBe(files.length)
      expect(files).toContain('manifests/role-catalog.json')
      expect(files).toContain('manifests/method-catalog.json')
      expect(files.filter((path) => /^roles\/.+\/ROLE\.md$/.test(path))).toHaveLength(10)
    }
  })
})
