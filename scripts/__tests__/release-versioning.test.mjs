import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildReleasePlan,
  formatTag,
  incrementVersion,
  loadReleaseVersioningConfig,
  validateReleaseBump,
} from '../../lib/release-versioning.mjs'

function tempRepo() {
  return mkdtempSync(join(tmpdir(), 'release-versioning-'))
}

describe('release versioning', () => {
  it('increments default main.minor.fix segments', () => {
    expect(incrementVersion('1.2.3', 'main')).toBe('2.0.0')
    expect(incrementVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(incrementVersion('1.2.3', 'fix')).toBe('1.2.4')
  })

  it('validates intended bump versions', () => {
    expect(
      validateReleaseBump({ currentVersion: '1.2.3', nextVersion: '1.3.0', bump: 'minor' }).ok,
    ).toBe(true)
    expect(
      validateReleaseBump({ currentVersion: '1.2.3', nextVersion: '1.2.5', bump: 'fix' }).ok,
    ).toBe(false)
  })

  it('loads project overrides and formats tags', () => {
    const root = tempRepo()
    writeFileSync(
      join(root, 'agent-workflow.config.json'),
      JSON.stringify({
        releaseVersioning: {
          strategy: 'calver',
          segments: ['year', 'month', 'fix'],
          tagFormat: 'release-${version}',
        },
      }),
    )
    const config = loadReleaseVersioningConfig(root)
    expect(config.strategy).toBe('calver')
    expect(formatTag('2026.7.1', config)).toBe('release-2026.7.1')
    expect(incrementVersion('2026.7.0', 'month', config)).toBe('2026.8.0')
  })

  it('builds read-only release plans', () => {
    const root = tempRepo()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.2.0' }))
    const plan = buildReleasePlan({ repoRoot: root, bump: 'minor' })
    expect(plan.mutated).toBe(false)
    expect(plan.currentVersion).toBe('0.2.0')
    expect(plan.nextVersion).toBe('0.3.0')
    expect(plan.tag).toBe('v0.3.0')
  })
})
