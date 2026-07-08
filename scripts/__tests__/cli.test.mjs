import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))

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
    expect(output).toContain('do not execute them without explicit approval')
  })

  it('prints the assisted update prompt with read-only and approval gates', () => {
    const output = execFileSync(process.execPath, [cli, 'update-prompt', '--target', 'tmp-app'], {
      encoding: 'utf8',
    })

    expect(output).toContain('assisted update guide')
    expect(output).toContain('docs/assisted-update.md')
    expect(output).toContain('tmp-app')
    expect(output).toContain('Start read-only')
    expect(output).toContain('agent-framework-lock.json')
    expect(output).toContain('ask for approval before running sync')
  })
})
