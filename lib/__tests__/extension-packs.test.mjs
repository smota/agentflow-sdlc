import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildExtensionRegistry,
  parseSimpleYaml,
  resolveExtensionPack,
  setExtensionPackEnabled,
  validateConfiguredExtensionPacks,
} from '../extension-packs.mjs'

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'extension-pack-test-'))
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function writePack(repo, relPath, id = path.basename(relPath)) {
  write(
    path.join(repo, relPath, 'extension-pack.yaml'),
    `id: ${id}\nkind: engineering-approach\nversion: 0.1.0\ndescription: Test pack\nprinciples: principles.md\ndocumentation:\n  - README.md\nrequiredSkills:\n  - context-mode\nrequiredCapabilities:\n  - shell\ntemplates:\n  - templates/design.md\ntools:\n  - path: tools/helper.mjs\nvalidators:\n  - path: validators/check.mjs\n`,
  )
  write(path.join(repo, relPath, 'README.md'), '# Sample\n')
  write(path.join(repo, relPath, 'principles.md'), '# Principles\n')
  write(path.join(repo, relPath, 'templates/design.md'), '# Design\n')
  write(path.join(repo, relPath, 'tools/helper.mjs'), '')
  write(path.join(repo, relPath, 'validators/check.mjs'), '')
}

describe('extension packs', () => {
  it('parses the supported manifest yaml shape', () => {
    const parsed = parseSimpleYaml(
      `id: sample\nkind: engineering-approach\nrequiredSkills:\n  - context-mode\ntools:\n  - path: tools/extract.mjs\n    description: Extract\n`,
    )
    expect(parsed.id).toBe('sample')
    expect(parsed.requiredSkills).toEqual(['context-mode'])
    expect(parsed.tools[0].path).toBe('tools/extract.mjs')
  })

  it('validates a configured complete pack', () => {
    const repo = tempRepo()
    write(
      path.join(repo, 'agent-workflow.config.json'),
      JSON.stringify({ extensions: { enabledPacks: ['extensions/sample'] } }),
    )
    writePack(repo, 'extensions/sample', 'sample')

    const result = validateConfiguredExtensionPacks(repo)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].errors).toEqual([])
  })

  it('fails closed when a configured pack is incomplete', () => {
    const repo = tempRepo()
    write(
      path.join(repo, 'agent-workflow.config.json'),
      JSON.stringify({ extensions: { enabledPacks: ['extensions/broken'] } }),
    )
    write(path.join(repo, 'extensions/broken/extension-pack.yaml'), `id: broken\nkind: unknown\n`)

    const result = validateConfiguredExtensionPacks(repo)
    expect(result.results[0].errors.join('\n')).toContain("missing required field 'version'")
    expect(result.results[0].errors.join('\n')).toContain("unsupported kind 'unknown'")
    expect(result.results[0].errors.join('\n')).toContain('missing required file: README.md')
  })

  it('discovers repo-local packs after setup and reports enabled/discovered state', () => {
    const repo = tempRepo()
    writePack(repo, 'extensions/local-pack', 'local-pack')

    const registry = buildExtensionRegistry(repo)

    expect(registry.discovered.map((pack) => pack.relativeDir)).toContain('extensions/local-pack')
    expect(registry.discoveredDisabled).toEqual(['extensions/local-pack'])
  })

  it('enables and disables packs deterministically while preserving config', () => {
    const repo = tempRepo()
    writePack(repo, 'extensions/b-pack', 'b-pack')
    writePack(repo, 'extensions/a-pack', 'a-pack')
    write(
      path.join(repo, 'agent-workflow.config.json'),
      JSON.stringify({
        ciCommands: ['pnpm test'],
        extensions: { enabledPacks: ['extensions/b-pack'] },
      }),
    )

    const first = setExtensionPackEnabled(repo, 'a-pack', true)
    const second = setExtensionPackEnabled(repo, 'extensions/a-pack', true)
    const config = JSON.parse(
      fs.readFileSync(path.join(repo, 'agent-workflow.config.json'), 'utf8'),
    )

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(config.ciCommands).toEqual(['pnpm test'])
    expect(config.extensions.enabledPacks).toEqual(['extensions/a-pack', 'extensions/b-pack'])

    setExtensionPackEnabled(repo, 'b-pack', false)
    const disabled = JSON.parse(
      fs.readFileSync(path.join(repo, 'agent-workflow.config.json'), 'utf8'),
    )
    expect(disabled.extensions.enabledPacks).toEqual(['extensions/a-pack'])
  })

  it('fails ambiguous duplicate ids with candidate paths', () => {
    const repo = tempRepo()
    writePack(repo, 'extensions/one', 'same')
    writePack(repo, 'contrib/two', 'same')

    expect(() => resolveExtensionPack(repo, 'same')).toThrow('extensions/one')
    expect(buildExtensionRegistry(repo).duplicateIds[0]).toContain('same:')
  })

  it('reports missing enabled packs without throwing', () => {
    const repo = tempRepo()
    write(
      path.join(repo, 'agent-workflow.config.json'),
      JSON.stringify({ extensions: { enabledPacks: ['extensions/missing'] } }),
    )

    const result = validateConfiguredExtensionPacks(repo)

    expect(result.registry.enabledMissing).toEqual(['extensions/missing'])
    expect(result.results[0].errors[0]).toContain('enabled extension pack is missing')
  })

  it('rejects paths escaping the repository', () => {
    const repo = tempRepo()
    expect(() => resolveExtensionPack(repo, '../outside')).toThrow('extension pack not found')
  })
})
