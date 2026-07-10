import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSimpleYaml, validateConfiguredExtensionPacks } from '../extension-packs.mjs'

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'extension-pack-test-'))
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
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
    write(
      path.join(repo, 'extensions/sample/extension-pack.yaml'),
      `id: sample\nkind: engineering-approach\nversion: 0.1.0\ndescription: Test pack\nprinciples: principles.md\ndocumentation:\n  - README.md\nrequiredSkills:\n  - context-mode\nrequiredCapabilities:\n  - shell\ntemplates:\n  - templates/design.md\ntools:\n  - path: tools/helper.mjs\nvalidators:\n  - path: validators/check.mjs\n`,
    )
    write(path.join(repo, 'extensions/sample/README.md'), '# Sample\n')
    write(path.join(repo, 'extensions/sample/principles.md'), '# Principles\n')
    write(path.join(repo, 'extensions/sample/templates/design.md'), '# Design\n')
    write(path.join(repo, 'extensions/sample/tools/helper.mjs'), '')
    write(path.join(repo, 'extensions/sample/validators/check.mjs'), '')

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
})
