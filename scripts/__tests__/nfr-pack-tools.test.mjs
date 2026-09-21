import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  checkNfrTargets,
  NFR_AREAS,
} from '../../extensions/nfr-verification/tools/check-nfr-targets.mjs'
import { validateNfrTemplates } from '../../extensions/nfr-verification/validators/validate-nfr-templates.mjs'

const VALID_TABLE = `
## Non-functional targets

| ID | Area | Applies | Target or Decision | Verification | Check or Tool | Required | Reason (if not applicable) |
|---|---|---|---|---|---|---|---|
| NFR-01 | security | yes | No untrusted inputs | deterministic | bandit | yes | - |
| NFR-02 | privacy and compliance | no | - | manual | review | no | No PII handled |
| NFR-03 | performance and capacity | yes | p99 < 50ms | deterministic | benchmark | yes | - |
| NFR-04 | reliability | yes | zero crashes | deterministic | vitest | yes | - |
| NFR-05 | observability | yes | trace propagation | deterministic | otel-check | yes | - |
| NFR-06 | operability | yes | zero downtime deploy | manual | runbook | yes | - |
| NFR-07 | compatibility and versioning | yes | backwards compatible | deterministic | schema-diff | yes | - |
| NFR-08 | cost | no | - | manual | review | no | Local compute only |
| NFR-09 | usability and accessibility | yes | keyboard navigable | manual | audit | no | - |
| NFR-10 | maintainability and testability | yes | coverage >= 80% | deterministic | vitest-cov | yes | - |
| NFR-11 | portability and environment | yes | node 20+ on linux/win | deterministic | ci | yes | - |
`

describe('checkNfrTargets', () => {
  it('1. passes a complete and valid targets table with zero findings', () => {
    const findings = checkNfrTargets(VALID_TABLE)
    expect(findings).toHaveLength(0)
    expect(findings.ok).toBe(true)
  })

  it('2. flags a missing area when one is omitted from table', () => {
    const tableMissingSec = VALID_TABLE.replace(
      '| NFR-01 | security | yes | No untrusted inputs | deterministic | bandit | yes | - |',
      '',
    )
    const findings = checkNfrTargets(tableMissingSec)
    expect(findings.some((f) => f.code === 'missing-area' && f.area === 'security')).toBe(true)
  })

  it('3. flags a blank area in a table row', () => {
    const tableWithBlank = VALID_TABLE.replace('| security |', '| |')
    const findings = checkNfrTargets(tableWithBlank)
    expect(findings.some((f) => f.code === 'blank-area')).toBe(true)
  })

  it('4. flags an unknown area name outside ISO 25010', () => {
    const tableWithUnknown = VALID_TABLE.replace('| security |', '| custom-unsupported-area |')
    const findings = checkNfrTargets(tableWithUnknown)
    expect(findings.some((f) => f.code === 'unknown-area')).toBe(true)
  })

  it('5. flags an applies=yes row with missing target text', () => {
    const tableNoTarget = VALID_TABLE.replace(
      '| NFR-01 | security | yes | No untrusted inputs |',
      '| NFR-01 | security | yes | |',
    )
    const findings = checkNfrTargets(tableNoTarget)
    expect(findings.some((f) => f.code === 'missing-target' && f.area === 'security')).toBe(true)
  })

  it('6. flags an applies=yes row where target is a placeholder hyphen', () => {
    const tableHyphenTarget = VALID_TABLE.replace(
      '| NFR-01 | security | yes | No untrusted inputs |',
      '| NFR-01 | security | yes | - |',
    )
    const findings = checkNfrTargets(tableHyphenTarget)
    expect(findings.some((f) => f.code === 'missing-target' && f.area === 'security')).toBe(true)
  })

  it('7. flags an applies=no row missing a reason', () => {
    const tableNoReason = VALID_TABLE.replace(
      '| NFR-02 | privacy and compliance | no | - | manual | review | no | No PII handled |',
      '| NFR-02 | privacy and compliance | no | - | manual | review | no | |',
    )
    const findings = checkNfrTargets(tableNoReason)
    expect(
      findings.some((f) => f.code === 'missing-reason' && f.area === 'privacy and compliance'),
    ).toBe(true)
  })

  it('8. flags an applies=no row where reason is a placeholder hyphen', () => {
    const tableHyphenReason = VALID_TABLE.replace(
      '| NFR-02 | privacy and compliance | no | - | manual | review | no | No PII handled |',
      '| NFR-02 | privacy and compliance | no | - | manual | review | no | - |',
    )
    const findings = checkNfrTargets(tableHyphenReason)
    expect(
      findings.some((f) => f.code === 'missing-reason' && f.area === 'privacy and compliance'),
    ).toBe(true)
  })

  it('9. flags an invalid applies value', () => {
    const tableInvalidApplies = VALID_TABLE.replace(
      '| NFR-01 | security | yes |',
      '| NFR-01 | security | maybe |',
    )
    const findings = checkNfrTargets(tableInvalidApplies)
    expect(findings.some((f) => f.code === 'invalid-applies')).toBe(true)
  })

  it('10. flags missing table when heading or table is absent', () => {
    const findings = checkNfrTargets('Just some text without a table')
    expect(findings.some((f) => f.code === 'missing-table')).toBe(true)
  })
})

describe('validateNfrTemplates', () => {
  it('1. passes validation on pack templates', () => {
    const result = validateNfrTemplates({
      targetsPath: path.resolve('extensions/nfr-verification/templates/nfr-targets.md'),
      evidencePath: path.resolve('extensions/nfr-verification/templates/nfr-evidence.md'),
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('2. fails when template path is invalid or missing', () => {
    const result = validateNfrTemplates({
      targetsPath: path.resolve('extensions/nfr-verification/templates/does-not-exist.md'),
    })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('check-nfr-targets CLI smoke', () => {
  const cliPath = path.resolve('extensions/nfr-verification/tools/check-nfr-targets.mjs')
  const validPath = path.resolve('extensions/nfr-verification/templates/nfr-targets.md')

  it('exits 0 on valid targets file', () => {
    const stdout = execFileSync(process.execPath, [cliPath, validPath], { encoding: 'utf8' })
    expect(stdout).toContain('NFR targets table OK')
  })

  it('emits json findings on failure with --json flag', () => {
    try {
      execFileSync(
        process.execPath,
        [cliPath, path.resolve('extensions/nfr-verification/README.md'), '--json'],
        { encoding: 'utf8' },
      )
      expect.unreachable('Should have exited with non-zero code')
    } catch (err) {
      expect(err.status).toBe(1)
      const parsed = JSON.parse(err.stdout)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed.length).toBeGreaterThan(0)
    }
  })
})
