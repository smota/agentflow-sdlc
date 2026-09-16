import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  detectOffPathEnforcement,
  detectOptionalRigor,
  detectUnreachablePolicy,
  loadEnforcementPairs,
  runAudit,
} from '../audit-reachability.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const scriptPath = resolve(repoRoot, 'scripts', 'audit-reachability.mjs')
const preReleaseRoot = resolve(here, 'fixtures', 'audit-reachability', 'pre-release')
const fixedRoot = resolve(here, 'fixtures', 'audit-reachability', 'fixed')

// This is the W7 release acceptance test. The fixtures under
// scripts/__tests__/fixtures/audit-reachability/pre-release/ are the actual files from commit
// 0ab3614 (`git show 0ab3614:<path>`), the state of the repository before this release fixed five
// real instances of "a rigorous mechanism built beside a weak one that became the mandatory path."
// If any of these five cannot be reproduced here, the audit is not sensitive enough to catch a
// sixth instance, and this test must fail loudly rather than being loosened to pass.
describe('audit-reachability (W7 acceptance test)', () => {
  it('reproduces instance 1 — unreachable-policy: externalActionRequiresHumanApproval guards a state no profile can reach', () => {
    const findings = detectUnreachablePolicy({ root: preReleaseRoot })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      code: 'unreachable-policy',
      policyKey: 'actionPolicy.externalActionRequiresHumanApproval',
      guardedState: 'external-action',
    })
    // Every configured profile maximum tops out below the guarded state — this is the measured
    // fact the finding rests on, not an assumption.
    for (const maximum of Object.values(findings[0].profileMaximums)) {
      expect(['observe', 'propose', 'mutate-worktree', 'open-pr']).toContain(maximum)
    }
  })

  it('reproduces instance 2 — off-path-enforcement: validateNoForbiddenEvidenceText is called only from the optional sdlc-audit tool, never from the mandatory role-pass validator', () => {
    const findings = detectOffPathEnforcement({ root: preReleaseRoot })
    const match = findings.find((item) => item.symbol === 'validateNoForbiddenEvidenceText')
    expect(match).toBeDefined()
    expect(match).toMatchObject({
      code: 'off-path-enforcement',
      module: 'lib/sdlc-state.mjs',
    })
    expect(match.calledFrom).toEqual(['scripts/sdlc-audit.mjs'])
  })

  it('reproduces instances 3, 4, and 5 via the declarative enforcement-pairs registry', () => {
    // The registry itself is a property of the audit tool (manifests/enforcement-pairs.json at the
    // repo root), not of the pre-release fixture tree, so it is loaded from the real repo and
    // pointed at the fixture's module tree for resolution.
    const pairs = loadEnforcementPairs(repoRoot)
    expect(pairs.map((pair) => pair.id).sort()).toEqual(
      [
        'boundary-gate-vs-phase-gate',
        'review-attestation-vs-cockpit-human-gate',
        'run-track-vs-role-pass-track',
      ].sort(),
    )
    const findings = detectOptionalRigor({ root: preReleaseRoot, pairs })
    const byId = Object.fromEntries(findings.map((item) => [item.pairId, item]))

    // Instance 3: the observation-bound "run" track is not wired into the mandatory,
    // shape-only role-pass validator.
    expect(byId['run-track-vs-role-pass-track']).toMatchObject({ code: 'optional-rigor' })

    // Instance 4: the digest-bound review attestation is not imported by the cockpit's human gate,
    // which instead decided completion from prose alone.
    expect(byId['review-attestation-vs-cockpit-human-gate']).toMatchObject({
      code: 'optional-rigor',
    })

    // Instance 5: boundary gating and phase gating are two declared, unreconciled mechanisms for
    // the same human-review decision.
    expect(byId['boundary-gate-vs-phase-gate']).toMatchObject({ code: 'optional-rigor' })
  })

  it('reports ALL FIVE known pre-release instances when run as a whole audit, and exits non-zero', () => {
    const result = runAudit({ root: preReleaseRoot })
    expect(result.ok).toBe(false)
    const codes = result.findings.map((item) => item.code)
    expect(codes).toContain('unreachable-policy')
    expect(codes.filter((code) => code === 'optional-rigor')).toHaveLength(3)
    expect(result.findings.some((item) => item.symbol === 'validateNoForbiddenEvidenceText')).toBe(
      true,
    )
  })

  it('exits 0 with zero findings once all five instances are fixed', () => {
    const result = runAudit({ root: fixedRoot })
    expect(result.findings).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('is runnable as `node scripts/audit-reachability.mjs [--json]` and its exit code matches the report', () => {
    const failing = spawnSync(
      process.execPath,
      [scriptPath, '--target', preReleaseRoot, '--json'],
      {
        encoding: 'utf8',
      },
    )
    expect(failing.status).toBe(1)
    const failingReport = JSON.parse(failing.stdout)
    expect(failingReport.ok).toBe(false)
    expect(failingReport.findings.length).toBeGreaterThanOrEqual(5)

    const passing = spawnSync(process.execPath, [scriptPath, '--target', fixedRoot, '--json'], {
      encoding: 'utf8',
    })
    expect(passing.status).toBe(0)
    expect(JSON.parse(passing.stdout)).toMatchObject({ ok: true, findings: [] })
  })
})

// W7b acceptance test: precision on REAL code, not on the audit's own assumptions. Every entry
// below was individually verified against the current repository (not guessed): each is a true
// enforcement gap the audit is right to still report. Anything else the audit reports on this tree
// is a false positive that must be fixed in the detector, never papered over by adding it here.
describe('audit-reachability precision on the current repository (W7b)', () => {
  it('finds exactly the declared, justified set of known-true remaining defects', () => {
    const result = runAudit({ root: repoRoot })
    const actual = result.findings
      .map((item) => (item.code === 'optional-rigor' ? item.pairId : item.symbol))
      .sort()

    const expected = [
      // Instance 2, genuinely never fixed: validateNoForbiddenEvidenceText (lib/sdlc-state.mjs) is
      // called only from scripts/sdlc-audit.mjs, an advisory report tool `sdlc audit` that blocks
      // nothing. The mandatory gate for a role-pass, scripts/validate-sdlc-role-pass.mjs, never
      // calls it, so a role-pass containing a secret or a raw transcript is still accepted.
      'validateNoForbiddenEvidenceText',
      // Instance 4, partially fixed: the cockpit's human-approval gate (lib/cockpit-goal-model.mjs
      // #deriveHumanGate) completes on GitHub's reviewDecision alone, which is not bound to a
      // subject digest, while lib/core/review-attestation.mjs#validateReviewAttestation (digest-
      // bound, staleness-checked) exists but is never imported by the gate that actually renders.
      'review-attestation-vs-cockpit-human-gate',
    ].sort()

    expect(actual).toEqual(expected)
  })
})
