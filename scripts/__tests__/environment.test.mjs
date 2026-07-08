import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateEnvironment } from '../../lib/environment.mjs'

function runner(found) {
  const calls = []
  const fn = (bin, args) => {
    calls.push([bin, ...args].join(' '))
    if (!found[bin]) throw new Error(`${bin} missing`)
    return found[bin]
  }
  fn.calls = calls
  return fn
}

describe('environment validation', () => {
  it('reports missing tools without mutating or installing anything', () => {
    const run = runner({ git: 'git version 2.0.0\n', node: 'v22.0.0\n' })
    const report = validateEnvironment(process.cwd(), { runner: run })

    expect(report.ok).toBe(true)
    expect(report.mutated).toBe(false)
    expect(report.note).toContain('No installation commands were executed')
    expect(report.tools.find((tool) => tool.name === 'gh').found).toBe(false)
    expect(report.tools.find((tool) => tool.name === 'gh').installOptions).toContain(
      'Docs: https://cli.github.com/',
    )
    expect(run.calls.some((call) => /install|brew|winget|corepack/.test(call))).toBe(false)
  })

  it('checks configured optional agent availability commands', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdlc-env-'))
    writeFileSync(
      join(dir, 'agent-workflow.config.json'),
      JSON.stringify({
        routing: {
          agents: {
            omnigent: { enabled: true, availabilityCommand: 'omnigent --version' },
          },
        },
      }),
    )
    const run = runner({
      git: 'git version 2\n',
      node: 'v22\n',
      pnpm: '9.0.0\n',
      gh: 'gh version 2\n',
    })
    const report = validateEnvironment(dir, { runner: run })

    const omnigent = report.tools.find((tool) => tool.name === 'omnigent')
    expect(omnigent.required).toBe(false)
    expect(omnigent.found).toBe(false)
    expect(omnigent.installOptions.join('\n')).toContain('omnigent-ai/omnigent')
  })

  it('fails when a required core tool is missing', () => {
    const run = runner({ git: 'git version 2\n' })
    const report = validateEnvironment(process.cwd(), { runner: run })

    expect(report.ok).toBe(false)
    expect(report.tools.find((tool) => tool.name === 'node').required).toBe(true)
  })
})
