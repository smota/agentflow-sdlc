import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '../../..')

function requiredToolNames(environmentSource) {
  const start = environmentSource.indexOf('const tools = [')
  const end = environmentSource.indexOf('for (const { slug, command } of configuredAgents)', start)
  const toolsSource = environmentSource.slice(start, end)
  const names = []
  for (const match of toolsSource.matchAll(
    /tool\(\s*'([^']*)',\s*'([^']*)',\s*'[^']*',\s*(true|false),/g,
  )) {
    if (match[3] === 'true') names.push(match[1])
  }
  return names
}

describe('openrig package boundary (#566)', () => {
  it('does not declare an @openrig package dependency', () => {
    const packageJson = readFileSync(resolve(repoRoot, 'package.json'), 'utf8')
    const lockfile = readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8')
    expect(packageJson).not.toContain('@openrig')
    expect(lockfile).not.toContain('@openrig')
  })

  it('does not list rig as a required executable', () => {
    const environmentSource = readFileSync(resolve(repoRoot, 'lib/environment.mjs'), 'utf8')
    const required = requiredToolNames(environmentSource)
    expect(required.length).toBeGreaterThan(0)
    expect(required).not.toContain('rig')
  })

  it('documents the workspace join command', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(repoRoot, 'adapters/openrig/manifest.json'), 'utf8'),
    )
    expect(manifest.commands).toContain('rig up <spec> --name <rig> --cwd <repo>')
  })
})
