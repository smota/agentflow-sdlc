import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))

describe('provider status CLI', () => {
  it('lists provider facets without probing executables', () => {
    const providers = JSON.parse(
      execFileSync(process.execPath, [cli, 'providers', 'list', '--json'], { encoding: 'utf8' }),
    )
    expect(providers.find((item) => item.id === 'manual').facets).toContain('execution')
    expect(providers.find((item) => item.id === 'grok-cli').facets).toEqual([
      'execution',
      'evidence',
    ])
    expect(providers.find((item) => item.id === 'grok-cli').intentSupport).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'workflow-orchestration' })]),
    )
    expect(providers.find((item) => item.id === 'xai-api')).toBeTruthy()
    expect(providers.map((item) => item.id)).toEqual([
      'claude-cli',
      'codex-cli',
      'agy-cli',
      'grok-cli',
      'xai-api',
      'manual',
    ])
  })

  it('fails to inspect the removed pi-cli provider and names the replacement', () => {
    const result = spawnSync(process.execPath, [cli, 'providers', 'inspect', 'pi-cli', '--json'], {
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/pi-cli was removed.*OpenRig execution layer/)
  })
})
