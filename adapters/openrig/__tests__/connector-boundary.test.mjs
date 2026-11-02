import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readmePath = resolve(import.meta.dirname, '../README.md')
const extensionsDir = resolve(import.meta.dirname, '../../../extensions')

function openrigPluginManifests(dir, rel = '') {
  if (!existsSync(dir)) return []
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const child = join(dir, entry.name)
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.name.toLowerCase().includes('openrig')) {
      for (const manifest of ['plugin.json', 'manifest.json']) {
        if (existsSync(join(child, manifest))) found.push(`${childRel}/${manifest}`)
      }
    }
    found.push(...openrigPluginManifests(child, childRel))
  }
  return found
}

describe('openrig connector boundary (#559)', () => {
  it('documents the MCP and gateway connector boundary', () => {
    const readme = readFileSync(readmePath, 'utf8')
    expect(readme).toContain('rig gateway')
    expect(readme).toContain('rig mcp serve')
    expect(readme).toContain('optional and off')
    expect(readme).toContain('listed MCP tool is not a grant')
    expect(readme).toContain('Hosted members')
    expect(readme).toContain('experimental and unsupported')
  })

  it('ships no OpenRig plugin under extensions/', () => {
    expect(openrigPluginManifests(extensionsDir)).toEqual([])
  })
})
