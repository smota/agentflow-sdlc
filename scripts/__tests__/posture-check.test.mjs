import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPostureCapability } from '../../lib/posture-check.mjs'

let sandbox

afterEach(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true })
  sandbox = undefined
})

describe('posture-check (D3: advisory only)', () => {
  it('7. warns on a repo with no test suite, no CI, and no observation fixtures — and never blocks', () => {
    sandbox = mkdtempSync(join(tmpdir(), 'posture-check-'))
    const result = checkPostureCapability({ posture: 'delegated', root: sandbox })

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.code === 'posture-check.no-tests')).toBe(true)
    expect(result.warnings.some((w) => w.code === 'posture-check.no-ci')).toBe(true)
    expect(result.warnings.some((w) => w.code === 'posture-check.no-observation-fixtures')).toBe(
      true,
    )

    // Advisory only: there is no blocking field of any kind, at any posture, for any capability gap.
    expect(result).not.toHaveProperty('ok')
    expect(result).not.toHaveProperty('blocked')
    expect(result.advisoryOnly).toBe(true)

    // A different posture over the very same under-equipped repo still only warns — posture-check
    // has no mechanism to refuse or downgrade the configured posture.
    const forAutonomous = checkPostureCapability({ posture: 'autonomous', root: sandbox })
    expect(forAutonomous.advisoryOnly).toBe(true)
    expect(forAutonomous.posture).toBe('autonomous')
  })
})
