import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pinOracleDigest, verifyOraclePin } from '../../lib/core/role-collaboration.mjs'
import {
  checkPathOwnership,
  loadPathOwnership,
  resolveOwnershipCheck,
  validatePathOwnershipManifest,
} from '../validate-path-ownership.mjs'

const manifest = loadPathOwnership(fileURLToPath(new URL('../..', import.meta.url)))

describe('path ownership', () => {
  it('loads a manifest with the pm, builder, and test-eng rules', () => {
    expect(validatePathOwnershipManifest(manifest)).toEqual({ ok: true, errors: [] })
  })

  it('lets a PM seat write only .agentflow and goals', () => {
    expect(
      checkPathOwnership({
        seat: 'pm.analyst',
        paths: ['.agentflow/PRODUCT.md', 'goals/job.md'],
        manifest,
      }).ok,
    ).toBe(true)
    for (const path of [
      'specs/cap.md',
      'src/app.js',
      'lib/core/role-collaboration.mjs',
      'tests/oracles/pin.json',
      'README.md',
    ]) {
      expect(checkPathOwnership({ seat: 'pm.manager', paths: [path], manifest }).ok).toBe(false)
    }
  })

  it('checks changed paths instead of skipping when the CLI seat and path flags are absent', () => {
    expect(
      resolveOwnershipCheck({
        paths: ['src/app.js', 'tests/oracles/pin.json'],
        manifest,
        env: {},
      }),
    ).toMatchObject({ ok: false, errors: ['seat is required to check changed paths'] })
    expect(
      resolveOwnershipCheck({
        paths: ['src/app.js'],
        manifest,
        env: { OPENRIG_SESSION_NAME: 'pm-analyst@agentflow-pm' },
      }).ok,
    ).toBe(false)
    expect(
      resolveOwnershipCheck({
        paths: ['goals/job.md'],
        manifest,
        env: { AGENTFLOW_SEAT: 'pm.analyst' },
      }).ok,
    ).toBe(true)
  })

  it('rejects builder edits to oracles and test-eng edits to application source', () => {
    expect(
      checkPathOwnership({
        seat: 'dev.build',
        paths: ['lib/core/role-collaboration.mjs'],
        manifest,
      }).ok,
    ).toBe(true)
    expect(
      checkPathOwnership({
        seat: 'dev.build-jr',
        paths: ['tests/oracles/pin.json'],
        manifest,
      }).errors,
    ).toContain('dev.build-jr cannot write tests/oracles/pin.json (builder-oracle-guard)')
    expect(
      checkPathOwnership({
        seat: 'dev.test-eng',
        paths: ['tests/oracles/pin.json'],
        manifest,
      }).ok,
    ).toBe(true)
    expect(checkPathOwnership({ seat: 'dev.test-eng', paths: ['src/app.js'], manifest }).ok).toBe(
      false,
    )
    expect(
      checkPathOwnership({
        seat: 'dev.test-eng',
        paths: ['lib/core/role-collaboration.mjs'],
        manifest,
      }).ok,
    ).toBe(false)
  })

  it('requires a phase 3 oracle digest before a builder starts', () => {
    const digest = 'a'.repeat(64)
    const pin = pinOracleDigest({ digest })
    expect(pin).toMatchObject({ phase: 3, oracleDigest: digest, pinnedBefore: 'dev.build' })
    expect(verifyOraclePin({ pin, seat: 'dev.build' }).ok).toBe(true)
    expect(verifyOraclePin({ seat: 'dev.build-jr' }).ok).toBe(false)
    expect(() => pinOracleDigest({ digest: 'short' })).toThrow(/sha256/)
  })
})
