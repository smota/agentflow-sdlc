import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const cli = resolve('bin/cli.mjs')

describe('CLI doctor command', () => {
  it('runs doctor --json and outputs valid JSON with 4 dimensions', () => {
    const res = spawnSync(process.execPath, [cli, 'doctor', '--json'], { encoding: 'utf8' })
    expect(res.status).toBeLessThanOrEqual(2)
    const data = JSON.parse(res.stdout)
    expect(data.schemaVersion).toBe(1)
    expect(data.dimensions['project-configs']).toBeDefined()
    expect(data.dimensions['adapter-bindings']).toBeDefined()
    expect(data.dimensions['lock-integrity']).toBeDefined()
    expect(data.dimensions['runtime-reachability']).toBeDefined()
  })

  it('runs doctor plain text and prints human-readable summary', () => {
    const res = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8' })
    expect(res.status).toBeLessThanOrEqual(2)
    expect(res.stdout).toContain('AgentFlow Unified Health & Drift Report')
    expect(res.stdout).toContain('Findings by Dimension')
  })
})
