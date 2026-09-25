import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { validateDocs, validateDocumentedCommands } from '../validate-docs.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

describe('documentation validation', () => {
  it('documents every top-level command exposed by the installed interface', () => {
    const help = execFileSync(process.execPath, [resolve(repoRoot, 'bin/cli.mjs'), '--help'], {
      encoding: 'utf8',
    })
    const signature = help.match(/agentflow-sdlc <[^>]+>/)[0]
    expect(readFileSync(resolve(repoRoot, 'docs/index.md'), 'utf8')).toContain(signature)
  })
  it.each([
    'agentflow-sdlc',
    'npx -y github:smota/agentflow-sdlc',
    'npx agentflow-sdlc',
    'node bin/cli.mjs',
    'node /path/to/agentflow-sdlc/bin/cli.mjs',
  ])('checks supported and invalid commands with %s', (prefix) => {
    expect(validateDocumentedCommands(`${prefix} init --posture assisted`)).toEqual([])
    expect(validateDocumentedCommands(`${prefix} imaginary-command`)).toContain(
      'unknown CLI command imaginary-command',
    )
    expect(validateDocumentedCommands(`${prefix} init --posture interactive`)).toContain(
      'unknown posture interactive',
    )
  })
  it('uses the canonical posture vocabulary for configuration examples', () => {
    expect(validateDocumentedCommands('{"posture": "advisory"}')).toEqual([])
    expect(validateDocumentedCommands('{"posture": "interactive"}')).toContain(
      'unknown posture interactive',
    )
  })
  it('keeps local links, role hubs, headings, and CLI command names valid', () => {
    expect(validateDocs(repoRoot)).toEqual(expect.objectContaining({ ok: true, errors: [] }))
  })
})
