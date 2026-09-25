import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-extension-test-'))
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function writePack(repo, relPath, id = path.basename(relPath)) {
  write(
    path.join(repo, relPath, 'extension-pack.yaml'),
    `id: ${id}\nkind: engineering-approach\nversion: 0.1.0\ndescription: Test pack\ndocumentation:\n  - README.md\n`,
  )
  write(path.join(repo, relPath, 'README.md'), '# Pack\n')
}

describe('CLI prompt helpers', () => {
  it('prints the assisted onboarding prompt', () => {
    const output = execFileSync(
      process.execPath,
      [cli, 'onboarding-prompt', '--target', 'tmp-app'],
      {
        encoding: 'utf8',
      },
    )

    expect(output).toContain('assisted onboarding guide')
    expect(output).toContain('docs/assisted-onboarding.md')
    expect(output).toContain('tmp-app')
    expect(output).toContain('Bootstrap Tooling')
    expect(output).toContain('npm install -g github:smota/agentflow-sdlc')
    expect(output).toContain('agentflow-sdlc doctor-env')
    expect(output).toContain('Present the adoption preview and ask for my explicit confirmation')
    expect(output).toContain('Do not use init --force')
    expect(output).toContain('advisory, assisted, delegated, autonomous')
    expect(output).toContain('blockers and warnings separately')
    const guide = fs.readFileSync(
      new URL('../../docs/assisted-onboarding.md', import.meta.url),
      'utf8',
    )
    const generatedSteps = output.slice(output.indexOf('0. Bootstrap Tooling:')).trim()
    const documentedSteps = guide
      .slice(guide.indexOf('0. Bootstrap Tooling:'))
      .split('\n```')[0]
      .trim()
    expect(generatedSteps.replaceAll('\r\n', '\n')).toBe(documentedSteps.replaceAll('\r\n', '\n'))
  })
})

describe('CLI extension helpers', () => {
  it('lists, inspects, enables, disables, and validates packs deterministically', () => {
    const repo = tempRepo()
    writePack(repo, 'extensions/sample', 'sample')

    const list = execFileSync(process.execPath, [cli, 'extensions', 'list', '--target', repo], {
      encoding: 'utf8',
    })
    expect(list).toContain('extensions/sample')
    expect(list).toContain('disabled')

    const inspect = execFileSync(
      process.execPath,
      [cli, 'extensions', 'inspect', 'sample', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(inspect).dir).toBe('extensions/sample')

    const enable = execFileSync(
      process.execPath,
      [cli, 'extensions', 'enable', 'sample', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(enable).enabledPacks).toEqual(['extensions/sample'])

    const enableAgain = execFileSync(
      process.execPath,
      [cli, 'extensions', 'enable', 'extensions/sample', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(enableAgain).changed).toBe(false)

    const validate = execFileSync(
      process.execPath,
      [cli, 'extensions', 'validate', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(validate).results[0].errors).toEqual([])

    const disable = execFileSync(
      process.execPath,
      [cli, 'extensions', 'disable', 'sample', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(disable).enabledPacks).toEqual([])
  })
})

describe('CLI extension helpers', () => {
  it('lists, inspects, enables, disables, and validates packs deterministically', () => {
    const repo = tempRepo()
    writePack(repo, 'extensions/sample', 'sample')

    const list = execFileSync(process.execPath, [cli, 'extensions', 'list', '--target', repo], {
      encoding: 'utf8',
    })
    expect(list).toContain('extensions/sample')
    expect(list).toContain('disabled')

    const inspect = execFileSync(
      process.execPath,
      [cli, 'extensions', 'inspect', 'sample', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(inspect).dir).toBe('extensions/sample')

    const enable = execFileSync(
      process.execPath,
      [cli, 'extensions', 'enable', 'sample', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(enable).enabledPacks).toEqual(['extensions/sample'])

    const enableAgain = execFileSync(
      process.execPath,
      [cli, 'extensions', 'enable', 'extensions/sample', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(enableAgain).changed).toBe(false)

    const validate = execFileSync(
      process.execPath,
      [cli, 'extensions', 'validate', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(validate).results[0].errors).toEqual([])

    const disable = execFileSync(
      process.execPath,
      [cli, 'extensions', 'disable', 'sample', '--target', repo, '--json'],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(disable).enabledPacks).toEqual([])
  })
})
