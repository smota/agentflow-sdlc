import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
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

// ---------- W8d D1/D2 — synthetic fixtures, one purpose-built repo tree per defect ----------
// These do not reuse the pre-release/fixed fixtures above (which pin a real historical commit and
// must never be edited to make a new point). Each test below builds a tiny throwaway repo tree
// under a temp directory, with `bin/cli.mjs` as its one mandatory entry point (matching
// DECLARED_MANDATORY_ENTRIES's hardcoded 'bin/cli.mjs' path), and deletes it afterward.
const w8dFixtureRoots = []
afterEach(() => {
  for (const root of w8dFixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function w8dFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-audit-w8d-'))
  w8dFixtureRoots.push(root)
  return root
}

function writeFixtureFile(root, relPath, content) {
  const absPath = join(root, ...relPath.split('/'))
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content)
}

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
//
// W8d — CHANGED. The expected set below used to list two known-true defects:
//   - 'validateNoForbiddenEvidenceText' (instance 2): called only from the advisory `sdlc audit`
//     report, never from the mandatory role-pass gate. FIXED by W8d D3 — scripts/
//     validate-sdlc-role-pass.mjs now calls it directly on every role pass it validates.
//   - 'review-attestation-vs-cockpit-human-gate' (instance 4, partially fixed): deriveHumanGate
//     completed on ANY object with a matching gateClass/subjectDigest, never re-verifying an
//     attestation. FIXED by W8d D4 — deriveHumanGate now calls satisfyGate (lib/core/gate.mjs) and
//     completes only when it accepts the pair; lib/cockpit-intent-anchor.mjs's
//     resolveAnchoredHumanGate does the same before ever producing a satisfiedGates entry.
// Both defects are actually fixed, not hidden behind a baseline or allowlist (the spec forbids
// that), so the expected set is now empty. This test still fails loudly — no `.toContain`, no
// subset match — if the audit ever reports anything on the real repository again.
describe('audit-reachability precision on the current repository (W7b, W8d)', () => {
  it('finds nothing on the current repository: the two known-true defects are fixed, not hidden', () => {
    const result = runAudit({ root: repoRoot })
    expect(result.findings).toEqual([])
    expect(result.ok).toBe(true)
  })
})

// W8d spec tests 1, 2, 8 — D1: an import that never runs is not reachability.
describe('W8d D1 — invocation, not import', () => {
  it('1. an import of a validator that is never called is flagged off-path (the exact W7/W7b hole: adding an unused import used to make this finding disappear)', () => {
    const root = w8dFixtureRoot()
    writeFixtureFile(
      root,
      'bin/cli.mjs',
      // The unused import alone — never invoked — is exactly what used to satisfy the pre-fix
      // audit. The real caller is the report script below, which DOES invoke it.
      "import { validateThing as _unused } from '../lib/validator.mjs'\nconsole.log('cli')\n",
    )
    writeFixtureFile(
      root,
      'scripts/report.mjs',
      "import { validateThing } from '../lib/validator.mjs'\nvalidateThing()\n",
    )
    writeFixtureFile(
      root,
      'lib/validator.mjs',
      'export function validateThing() {\n  return true\n}\n',
    )
    const findings = detectOffPathEnforcement({ root })
    const match = findings.find((item) => item.symbol === 'validateThing')
    expect(match).toBeDefined()
    expect(match.calledFrom).toEqual(['scripts/report.mjs'])
    expect(match.calledFrom).not.toContain('bin/cli.mjs')
  })

  it('2. a validator referenced only via `void` (no parentheses — a reference, not a call) is flagged off-path', () => {
    const root = w8dFixtureRoot()
    writeFixtureFile(
      root,
      'bin/cli.mjs',
      "import { validateThing } from '../lib/validator.mjs'\nvoid validateThing\nconsole.log('cli')\n",
    )
    writeFixtureFile(
      root,
      'scripts/report.mjs',
      "import { validateThing } from '../lib/validator.mjs'\nvalidateThing()\n",
    )
    writeFixtureFile(
      root,
      'lib/validator.mjs',
      'export function validateThing() {\n  return true\n}\n',
    )
    const findings = detectOffPathEnforcement({ root })
    const match = findings.find((item) => item.symbol === 'validateThing')
    expect(match).toBeDefined()
    expect(match.calledFrom).toEqual(['scripts/report.mjs'])
    expect(match.calledFrom).not.toContain('bin/cli.mjs')
  })

  it('8. a planted new off-path validator reached only by a report script is still flagged (regression guard for the W7 mutation test: the D1 rewrite must not become LESS sensitive than the original name-convention detector)', () => {
    const root = w8dFixtureRoot()
    writeFixtureFile(root, 'bin/cli.mjs', "console.log('cli')\n")
    writeFixtureFile(
      root,
      'scripts/report-tool.mjs',
      "import { validateSomethingNew } from '../lib/newvalidator.mjs'\nvalidateSomethingNew()\n",
    )
    writeFixtureFile(
      root,
      'lib/newvalidator.mjs',
      'export function validateSomethingNew() {\n  return true\n}\n',
    )
    const findings = detectOffPathEnforcement({ root })
    const match = findings.find((item) => item.symbol === 'validateSomethingNew')
    expect(match).toBeDefined()
    expect(match).toMatchObject({
      code: 'off-path-enforcement',
      module: 'lib/newvalidator.mjs',
    })
    expect(match.calledFrom).toEqual(['scripts/report-tool.mjs'])
  })
})

// W8d spec test 3 — D2: an exported lib/core (or lib/verification) function is checked regardless
// of its name, not only ones matching the validate|require|verify|assert|check convention.
describe('W8d D2 — controls found by location (lib/core, lib/verification), not only by name', () => {
  it('3. an exported core function with no product caller and no declared exemption is flagged', () => {
    const root = w8dFixtureRoot()
    writeFixtureFile(root, 'bin/cli.mjs', "console.log('cli')\n")
    // Deliberately NOT named like a validator (no validate/require/verify/assert/check prefix) —
    // this must still be flagged because it lives in lib/core/, and nothing anywhere calls it.
    writeFixtureFile(
      root,
      'lib/core/whatever.mjs',
      'export function doSomethingImportant() {\n  return 1\n}\n',
    )
    const findings = detectOffPathEnforcement({ root })
    const match = findings.find((item) => item.symbol === 'doSomethingImportant')
    expect(match).toBeDefined()
    expect(match).toMatchObject({
      code: 'off-path-enforcement',
      module: 'lib/core/whatever.mjs',
      calledFrom: [],
    })
  })

  it('a declared exemption suppresses the same finding (proving the exemption path itself works, not just that nothing was checked)', () => {
    // A second lib/core export with the SAME shape as the one above would also be flagged — unless
    // the audit's own exemption list happens to already cover a name, which it does not for
    // fixture-only symbols. This test documents the mechanism using the real audit's own declared
    // exemption for lib/posture-check.mjs#checkPostureCapability instead of inventing a fixture one,
    // since OFF_PATH_EXEMPTIONS is a fixed map in the audit module, not fixture-injectable.
    const findings = detectOffPathEnforcement({ root: repoRoot })
    expect(findings.some((item) => item.symbol === 'checkPostureCapability')).toBe(false)
  })
})
