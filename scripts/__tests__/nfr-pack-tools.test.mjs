import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  checkNfrTargets,
  NFR_AREAS,
} from '../../extensions/nfr-verification/tools/check-nfr-targets.mjs'
import {
  checkNfrEvidence,
  OBSERVATION_ORIGINS as PACK_ORIGINS,
  OBSERVATION_OUTCOMES as PACK_OUTCOMES,
} from '../../extensions/nfr-verification/tools/check-nfr-evidence.mjs'
import {
  OBSERVATION_ORIGINS as CORE_ORIGINS,
  OBSERVATION_OUTCOMES as CORE_OUTCOMES,
} from '../../lib/core/verification-observation.mjs'
import { validateNfrTemplates } from '../../extensions/nfr-verification/validators/validate-nfr-templates.mjs'

const VALID_TARGETS_TABLE = `
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

const VALID_EVIDENCE_TABLE = `
## Non-functional verification evidence

| Target ID | Check or Tool | Environment | Candidate Identity | Measured Value | Unit | Threshold | Sample Size | Outcome | Observed At | Origin |
|---|---|---|---|---|---|---|---|---|---|---|
| NFR-01 | bandit | local-cli | 95f2ef8 | 0 | vulnerabilities | <= 0 | 1 tool | pass | 2026-09-21T05:40:00Z | collector-observed |
| NFR-03 | benchmark | local-cli | 95f2ef8 | 32 | ms | <= 50 | 100 runs | pass | 2026-09-21T05:40:00Z | collector-observed |
| NFR-04 | vitest | local-cli | 95f2ef8 | 0 | crashes | == 0 | 14 tests | pass | 2026-09-21T05:40:00Z | collector-observed |
| NFR-05 | otel-check | local-cli | 95f2ef8 | 100 | percent | >= 99 | 50 spans | pass | 2026-09-21T05:40:00Z | collector-observed |
| NFR-06 | runbook | local-cli | 95f2ef8 | verified | manual-check | - | 1 deploy | pass | 2026-09-21T05:40:00Z | human-attested |
| NFR-07 | schema-diff | local-cli | 95f2ef8 | 0 | breaking-changes | <= 0 | 1 schema | pass | 2026-09-21T05:40:00Z | collector-observed |
| NFR-09 | audit | local-cli | 95f2ef8 | 98 | score | >= 90 | 1 page | pass | 2026-09-21T05:40:00Z | human-attested |
| NFR-10 | vitest-cov | local-cli | 95f2ef8 | 88.5 | percent | >= 80 | 1 package | pass | 2026-09-21T05:40:00Z | collector-observed |
| NFR-11 | ci | local-cli | 95f2ef8 | 0 | failures | == 0 | 2 platforms | pass | 2026-09-21T05:40:00Z | collector-observed |
`

describe('Vocabulary Equality (R-4)', () => {
  it('pack observation outcomes match core vocabulary exactly', () => {
    expect(PACK_OUTCOMES).toEqual(CORE_OUTCOMES)
  })

  it('pack observation origins match core vocabulary exactly', () => {
    expect(PACK_ORIGINS).toEqual(CORE_ORIGINS)
  })
})

describe('checkNfrTargets', () => {
  it('1. passes a complete and valid targets table with zero findings', () => {
    const findings = checkNfrTargets(VALID_TARGETS_TABLE)
    expect(findings).toHaveLength(0)
    expect(findings.ok).toBe(true)
  })

  it('2. flags a missing area when one is omitted from table', () => {
    const tableMissingSec = VALID_TARGETS_TABLE.replace(
      '| NFR-01 | security | yes | No untrusted inputs | deterministic | bandit | yes | - |',
      '',
    )
    const findings = checkNfrTargets(tableMissingSec)
    expect(findings.some((f) => f.code === 'missing-area' && f.area === 'security')).toBe(true)
  })

  it('3. flags a blank area in a table row', () => {
    const tableWithBlank = VALID_TARGETS_TABLE.replace('| security |', '| |')
    const findings = checkNfrTargets(tableWithBlank)
    expect(findings.some((f) => f.code === 'blank-area')).toBe(true)
  })

  it('4. flags an unknown area name outside ISO 25010', () => {
    const tableWithUnknown = VALID_TARGETS_TABLE.replace(
      '| security |',
      '| custom-unsupported-area |',
    )
    const findings = checkNfrTargets(tableWithUnknown)
    expect(findings.some((f) => f.code === 'unknown-area')).toBe(true)
  })

  it('5. flags an applies=yes row with missing target text', () => {
    const tableNoTarget = VALID_TARGETS_TABLE.replace(
      '| NFR-01 | security | yes | No untrusted inputs |',
      '| NFR-01 | security | yes | |',
    )
    const findings = checkNfrTargets(tableNoTarget)
    expect(findings.some((f) => f.code === 'missing-target' && f.area === 'security')).toBe(true)
  })

  it('6. flags an applies=yes row where target is a placeholder hyphen', () => {
    const tableHyphenTarget = VALID_TARGETS_TABLE.replace(
      '| NFR-01 | security | yes | No untrusted inputs |',
      '| NFR-01 | security | yes | - |',
    )
    const findings = checkNfrTargets(tableHyphenTarget)
    expect(findings.some((f) => f.code === 'missing-target' && f.area === 'security')).toBe(true)
  })

  it('7. flags an applies=no row missing a reason', () => {
    const tableNoReason = VALID_TARGETS_TABLE.replace(
      '| NFR-02 | privacy and compliance | no | - | manual | review | no | No PII handled |',
      '| NFR-02 | privacy and compliance | no | - | manual | review | no | |',
    )
    const findings = checkNfrTargets(tableNoReason)
    expect(
      findings.some((f) => f.code === 'missing-reason' && f.area === 'privacy and compliance'),
    ).toBe(true)
  })

  it('8. flags an applies=no row where reason is a placeholder hyphen', () => {
    const tableHyphenReason = VALID_TARGETS_TABLE.replace(
      '| NFR-02 | privacy and compliance | no | - | manual | review | no | No PII handled |',
      '| NFR-02 | privacy and compliance | no | - | manual | review | no | - |',
    )
    const findings = checkNfrTargets(tableHyphenReason)
    expect(
      findings.some((f) => f.code === 'missing-reason' && f.area === 'privacy and compliance'),
    ).toBe(true)
  })

  it('9. flags an invalid applies value', () => {
    const tableInvalidApplies = VALID_TARGETS_TABLE.replace(
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

describe('checkNfrEvidence', () => {
  it('1. passes complete valid evidence table cross-referenced with targets', () => {
    const findings = checkNfrEvidence(VALID_EVIDENCE_TABLE, VALID_TARGETS_TABLE)
    expect(findings).toHaveLength(0)
    expect(findings.ok).toBe(true)
  })

  it('2. flags missing result when an applicable target has no evidence row', () => {
    const evidenceMissingNfr1 = VALID_EVIDENCE_TABLE.replace(
      '| NFR-01 | bandit | local-cli | 95f2ef8 | 0 | vulnerabilities | <= 0 | 1 tool | pass | 2026-09-21T05:40:00Z | collector-observed |',
      '',
    )
    const findings = checkNfrEvidence(evidenceMissingNfr1, VALID_TARGETS_TABLE)
    expect(findings.some((f) => f.code === 'missing-result' && f.targetId === 'NFR-01')).toBe(true)
  })

  it('3. flags pass row lacking candidate identity', () => {
    const badEvidence = VALID_EVIDENCE_TABLE.replace('| 95f2ef8 |', '| - |')
    const findings = checkNfrEvidence(badEvidence, VALID_TARGETS_TABLE)
    expect(findings.some((f) => f.code === 'missing-candidate')).toBe(true)
  })

  it('4. flags pass row lacking measured value', () => {
    const badEvidence = VALID_EVIDENCE_TABLE.replace(
      '| 0 | vulnerabilities |',
      '| - | vulnerabilities |',
    )
    const findings = checkNfrEvidence(badEvidence, VALID_TARGETS_TABLE)
    expect(findings.some((f) => f.code === 'missing-measured-value')).toBe(true)
  })

  it('5. flags pass row lacking unit', () => {
    const badEvidence = VALID_EVIDENCE_TABLE.replace('| vulnerabilities |', '| - |')
    const findings = checkNfrEvidence(badEvidence, VALID_TARGETS_TABLE)
    expect(findings.some((f) => f.code === 'missing-unit')).toBe(true)
  })

  it('6. flags not-run row lacking a stated reason', () => {
    const tableWithNotRunNoReason = VALID_EVIDENCE_TABLE.replace(
      '| pass | 2026-09-21T05:40:00Z | collector-observed |',
      '| not-run | 2026-09-21T05:40:00Z | collector-observed |',
    ).replace('| 0 | vulnerabilities | <= 0 |', '| - | - | - |')
    const findings = checkNfrEvidence(tableWithNotRunNoReason, VALID_TARGETS_TABLE)
    expect(findings.some((f) => f.code === 'missing-not-run-reason')).toBe(true)
  })

  it('7. flags outcome outside vocabulary', () => {
    const badOutcome = VALID_EVIDENCE_TABLE.replace('| pass |', '| succeeded |')
    const findings = checkNfrEvidence(badOutcome, VALID_TARGETS_TABLE)
    expect(findings.some((f) => f.code === 'invalid-outcome')).toBe(true)
  })

  it('8. flags origin outside vocabulary', () => {
    const badOrigin = VALID_EVIDENCE_TABLE.replace('| collector-observed |', '| automated-script |')
    const findings = checkNfrEvidence(badOrigin, VALID_TARGETS_TABLE)
    expect(findings.some((f) => f.code === 'invalid-origin')).toBe(true)
  })

  it('9. flags required target resting only on agent-reported evidence', () => {
    const agentReportedEvidence = VALID_EVIDENCE_TABLE.replace(
      '| collector-observed |',
      '| agent-reported |',
    )
    const findings = checkNfrEvidence(agentReportedEvidence, VALID_TARGETS_TABLE)
    expect(findings.some((f) => f.code === 'disallowed-agent-reported')).toBe(true)
  })

  it('10. allows agent-reported evidence on required target when allowAgentReported option is set', () => {
    const agentReportedEvidence = VALID_EVIDENCE_TABLE.replace(
      '| collector-observed |',
      '| agent-reported |',
    )
    const findings = checkNfrEvidence(agentReportedEvidence, VALID_TARGETS_TABLE, {
      allowAgentReported: true,
    })
    expect(findings.some((f) => f.code === 'disallowed-agent-reported')).toBe(false)
  })
})

describe('CLI smoke tests', () => {
  const targetsCli = path.resolve('extensions/nfr-verification/tools/check-nfr-targets.mjs')
  const evidenceCli = path.resolve('extensions/nfr-verification/tools/check-nfr-evidence.mjs')
  const validTargets = path.resolve('extensions/nfr-verification/templates/nfr-targets.md')
  const validEvidence = path.resolve('extensions/nfr-verification/templates/nfr-evidence.md')

  it('check-nfr-targets CLI exits 0 on valid targets file', () => {
    const stdout = execFileSync(process.execPath, [targetsCli, validTargets], { encoding: 'utf8' })
    expect(stdout).toContain('NFR targets table OK')
  })

  it('check-nfr-targets CLI emits json findings on failure with --json flag', () => {
    try {
      execFileSync(
        process.execPath,
        [targetsCli, path.resolve('extensions/nfr-verification/README.md'), '--json'],
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

  it('check-nfr-evidence CLI exits 0 on valid evidence file', () => {
    const stdout = execFileSync(process.execPath, [evidenceCli, validEvidence], {
      encoding: 'utf8',
    })
    expect(stdout).toContain('NFR evidence table OK')
  })

  it('check-nfr-evidence CLI emits json findings on failure with --json flag', () => {
    try {
      execFileSync(
        process.execPath,
        [evidenceCli, path.resolve('extensions/nfr-verification/README.md'), '--json'],
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
