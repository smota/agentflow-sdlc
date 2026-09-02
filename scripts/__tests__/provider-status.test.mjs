import { execFileSync } from 'node:child_process'
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
    expect(providers.find((item) => item.id === 'ai-foundry-desk').facets).toEqual([
      'inventory',
      'project-adapters',
      'evidence',
    ])
  })
})
