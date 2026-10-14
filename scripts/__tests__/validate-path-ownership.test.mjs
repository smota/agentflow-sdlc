import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  pinOracleDigest,
  verifyOraclePin,
  verifyRoleAdvance,
} from '../../lib/core/role-collaboration.mjs'
import {
  checkBranchCommits,
  checkPathOwnership,
  computeOracleDigest,
  isAgentCommit,
  loadPathOwnership,
  matchOwnedPath,
  resolveOwnershipCheck,
  seatFromCommit,
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

  it('resolves seat from commit metadata or trailers', () => {
    expect(seatFromCommit({ message: 'feat: add goal\n\nSeat: pm.analyst' })).toBe('pm.analyst')
    expect(seatFromCommit({ authorEmail: 'pm-analyst@agentflow-pm' })).toBe('pm.analyst')
    expect(seatFromCommit({ authorName: 'pm-manager' })).toBe('pm.manager')
    expect(seatFromCommit({ authorName: 'Samuel Mota', authorEmail: 'samuelmota@gmail.com' })).toBe(
      null,
    )
  })

  it('rejects spoofed Seat: trailers when author identity mismatches', () => {
    expect(() =>
      seatFromCommit({
        authorEmail: 'pm-analyst@agentflow-pm',
        message: 'feat: change code\n\nSeat: orch.arch',
      }),
    ).toThrow(/commit seat mismatch/)
  })

  it('normalizes relative path traversals in matchOwnedPath', () => {
    expect(matchOwnedPath('.agentflow/**', 'goals/../.agentflow/PRODUCT.md')).toBe(true)
    expect(matchOwnedPath('.agentflow/**', 'goals/../src/app.js')).toBe(false)
  })

  it('wires oracle pin verification into verifyRoleAdvance', () => {
    const validDigest = 'a'.repeat(64)
    const decision = {
      version: 1,
      type: 'acceptance-decision',
      state: 'accepted',
      deterministicReport: { version: 1, digest: 'b'.repeat(64) },
      digest: 'c'.repeat(64),
    }
    // Builder advancing without oracle pin fails
    const failAdvance = verifyRoleAdvance({
      decision,
      openReworkRequests: [],
      options: { seat: 'dev.build' },
      handoff: { phase: 3 },
      contract: { phase: 3 },
      delivery: { phase: 3 },
    })
    expect(failAdvance.ok).toBe(false)
    expect(failAdvance.errors).toContain(
      'phase 3 must pin an oracle digest before dev.build starts',
    )

    // Builder advancing with oracle pin passes
    const passAdvance = verifyRoleAdvance({
      decision,
      openReworkRequests: [],
      options: { seat: 'dev.build', oracleDigest: validDigest },
      handoff: { phase: 3 },
      contract: { phase: 3 },
      delivery: { phase: 3 },
    })
    // May have stale deterministicReport check error, but oracle pin check passed!
    expect(passAdvance.errors).not.toContain(
      'phase 3 must pin an oracle digest before dev.build starts',
    )
  })

  it('checks branch commits cleanly on clean history', () => {
    const result = checkBranchCommits({ manifest })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects violating commits in a git fixture repository', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'path-ownership-fixture-'))
    const git = (args) => execFileSync('git', args, { cwd: fixtureDir, encoding: 'utf8' })
    try {
      git(['init', '-b', 'development'])
      git(['config', 'user.name', 'Framework Maintainer'])
      git(['config', 'user.email', 'maintainer@example.com'])
      writeFileSync(join(fixtureDir, 'README.md'), '# Fixture\n')
      git(['add', 'README.md'])
      git(['commit', '-m', 'chore: initial commit'])

      // Checkout feature branch
      git(['checkout', '-b', 'feat/violating-pm'])
      mkdirSync(join(fixtureDir, 'src'), { recursive: true })
      writeFileSync(join(fixtureDir, 'src/forbidden.js'), 'export const x = 1\n')
      git(['add', 'src/forbidden.js'])
      git([
        '-c',
        'user.name=pm.analyst',
        '-c',
        'user.email=pm-analyst@agentflow-pm',
        'commit',
        '-m',
        'feat: add application logic',
      ])

      const result = checkBranchCommits({ packageRoot: fixtureDir, manifest })
      expect(result.ok).toBe(false)
      expect(
        result.errors.some((e) => e.includes('pm.analyst cannot write src/forbidden.js')),
      ).toBe(true)
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })

  it('detects renames from guarded tree via --no-renames', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'path-ownership-rename-'))
    const git = (args) => execFileSync('git', args, { cwd: fixtureDir, encoding: 'utf8' })
    try {
      git(['init', '-b', 'development'])
      git(['config', 'user.name', 'Framework Maintainer'])
      git(['config', 'user.email', 'maintainer@example.com'])
      mkdirSync(join(fixtureDir, 'src'), { recursive: true })
      mkdirSync(join(fixtureDir, 'tests/oracles'), { recursive: true })
      writeFileSync(join(fixtureDir, 'src/app.js'), 'const a = 1\n')
      git(['add', 'src/app.js'])
      git(['commit', '-m', 'chore: initial commit'])

      git(['checkout', '-b', 'feat/rename-test'])
      // test-eng tries to move src/app.js to tests/oracles/oracle.js
      git(['mv', 'src/app.js', 'tests/oracles/oracle.js'])
      git([
        '-c',
        'user.name=dev.test-eng',
        '-c',
        'user.email=dev-test-eng@agentflow-dev',
        'commit',
        '-m',
        'test: move code to oracle',
      ])

      const result = checkBranchCommits({ packageRoot: fixtureDir, manifest })
      expect(result.ok).toBe(false)
      expect(result.errors.some((e) => e.includes('dev.test-eng cannot write src/app.js'))).toBe(
        true,
      )
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })

  it('identifies agent commits and requires Seat attribution', () => {
    expect(
      isAgentCommit({
        message: 'fix: something\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      }),
    ).toBe(true)
    expect(isAgentCommit({ authorEmail: 'pm-analyst@agentflow.org' })).toBe(true)
    expect(isAgentCommit({ message: 'feat: add feature\n\nPlatform: claude-code' })).toBe(true)
    expect(
      isAgentCommit({
        authorName: 'Samuel Mota',
        authorEmail: 'samuelmota@gmail.com',
        message: 'chore: update',
      }),
    ).toBe(false)
  })

  it('rejects an agent-co-authored commit in fixture repo when Seat trailer is absent', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'path-ownership-agent-'))
    const git = (args) => execFileSync('git', args, { cwd: fixtureDir, encoding: 'utf8' })
    try {
      git(['init', '-b', 'development'])
      git(['config', 'user.name', 'Framework Maintainer'])
      git(['config', 'user.email', 'maintainer@example.com'])
      writeFileSync(join(fixtureDir, 'README.md'), '# Fixture\n')
      git(['add', 'README.md'])
      git(['commit', '-m', 'chore: initial commit'])

      git(['checkout', '-b', 'feat/agent-work'])
      writeFileSync(join(fixtureDir, 'README.md'), '# Updated\n')
      git(['add', 'README.md'])
      git(['commit', '-m', 'docs: update readme\n\nCo-Authored-By: Claude <noreply@anthropic.com>'])

      const result = checkBranchCommits({ packageRoot: fixtureDir, manifest })
      expect(result.ok).toBe(false)
      expect(
        result.errors.some((e) => e.includes('agent commit missing required Seat attribution')),
      ).toBe(true)
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })

  it('accepts an agent-co-authored commit in fixture repo when valid Seat trailer is present', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'path-ownership-valid-agent-'))
    const git = (args) => execFileSync('git', args, { cwd: fixtureDir, encoding: 'utf8' })
    try {
      git(['init', '-b', 'development'])
      git(['config', 'user.name', 'Framework Maintainer'])
      git(['config', 'user.email', 'maintainer@example.com'])
      writeFileSync(join(fixtureDir, 'README.md'), '# Fixture\n')
      git(['add', 'README.md'])
      git(['commit', '-m', 'chore: initial commit'])

      git(['checkout', '-b', 'feat/valid-agent-work'])
      mkdirSync(join(fixtureDir, '.agentflow'), { recursive: true })
      writeFileSync(join(fixtureDir, '.agentflow/PRODUCT.md'), '# Product Job\n')
      git(['add', '.agentflow/PRODUCT.md'])
      git([
        'commit',
        '-m',
        'docs: update product job\n\nSeat: pm.analyst\nCo-Authored-By: Claude <noreply@anthropic.com>',
      ])

      const result = checkBranchCommits({ packageRoot: fixtureDir, manifest })
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })

  it('bars builders, test-eng, and PM from modifying governance files', () => {
    for (const seat of ['dev.build', 'dev.test-eng', 'pm.analyst']) {
      expect(
        checkPathOwnership({
          seat,
          paths: ['manifests/path-ownership.json'],
          manifest,
        }).ok,
      ).toBe(false)
      expect(
        checkPathOwnership({
          seat,
          paths: ['scripts/validate-path-ownership.mjs'],
          manifest,
        }).ok,
      ).toBe(false)
    }
  })

  it('restricts test-eng to test surfaces via defaultDeny', () => {
    // Permitted test paths
    expect(
      checkPathOwnership({
        seat: 'dev.test-eng',
        paths: ['tests/oracles/pin.json', 'lib/__tests__/foo.test.mjs', 'guidance/test-eng.md'],
        manifest,
      }).ok,
    ).toBe(true)
    // Denied non-test paths
    for (const deniedPath of [
      'scripts/run-delivery.mjs',
      'package.json',
      '.github/workflows/validate-pr.yml',
      'src/index.js',
      'lib/core/role-collaboration.mjs',
    ]) {
      expect(
        checkPathOwnership({
          seat: 'dev.test-eng',
          paths: [deniedPath],
          manifest,
        }).ok,
      ).toBe(false)
    }
  })

  it('does not produce false positives on human commits with names like Kapil, Abbott, Pierre Dupont, or pm-lead@corp.com', () => {
    expect(
      isAgentCommit({
        authorName: 'Pierre Dupont',
        authorEmail: 'pierre.dupont@company.com',
        message: 'fix: typo in documentation\n\nSigned-off-by: Pierre Dupont <pierre@company.com>',
      }),
    ).toBe(false)
    expect(
      isAgentCommit({
        authorName: 'Kapil Abbott',
        authorEmail: 'kapil.abbott@corp.org',
        message: 'chore: update dependency\n\nSigned-off-by: Kapil Abbott <kapil@corp.org>',
      }),
    ).toBe(false)
    expect(
      isAgentCommit({
        authorName: 'PM Lead',
        authorEmail: 'pm-lead@corp.com',
        message: 'docs: roadmap update',
      }),
    ).toBe(false)
    expect(
      seatFromCommit({
        authorName: 'PM Lead',
        authorEmail: 'pm-lead@corp.com',
        message: 'docs: roadmap update',
      }),
    ).toBe(null)
  })

  it('rejects unknown or invalid Seat attributions', () => {
    expect(() =>
      seatFromCommit({
        message: 'feat: add feature\n\nSeat: human',
      }),
    ).toThrow(/unknown or invalid Seat attribution: human/)
    expect(() =>
      seatFromCommit({
        message: 'feat: add feature\n\nSeat: invalid-seat',
      }),
    ).toThrow(/unknown or invalid Seat attribution: invalid-seat/)
  })

  it('computes oracle directory sha256 digest', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'oracle-digest-'))
    try {
      const oracleDir = join(fixtureDir, 'tests/oracles')
      mkdirSync(oracleDir, { recursive: true })
      writeFileSync(join(oracleDir, 'oracle-1.json'), '{"expected": 42}\n')
      writeFileSync(join(oracleDir, 'oracle-2.json'), '{"expected": 99}\n')

      const digest1 = computeOracleDigest({ packageRoot: fixtureDir })
      expect(digest1).toMatch(/^[a-f0-9]{64}$/)

      // Deterministic digest
      const digest2 = computeOracleDigest({ packageRoot: fixtureDir })
      expect(digest2).toBe(digest1)

      // Changing content changes digest
      writeFileSync(join(oracleDir, 'oracle-1.json'), '{"expected": 43}\n')
      const digest3 = computeOracleDigest({ packageRoot: fixtureDir })
      expect(digest3).not.toBe(digest1)
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })

  it('verifies oracle pin with expectedDigest check', () => {
    const digestA = 'a'.repeat(64)
    const digestB = 'b'.repeat(64)
    const pin = pinOracleDigest({ digest: digestA })

    expect(verifyOraclePin({ pin, seat: 'dev.build', expectedDigest: digestA }).ok).toBe(true)
    const mismatch = verifyOraclePin({ pin, seat: 'dev.build', expectedDigest: digestB })
    expect(mismatch.ok).toBe(false)
    expect(mismatch.errors[0]).toContain('does not match expected digest')
  })

  it('fails closed when advancing to developer role without oracle pin using canonical deliveryRole', () => {
    const decision = {
      version: 1,
      type: 'acceptance-decision',
      state: 'accepted',
      deterministicReport: { version: 1, digest: 'b'.repeat(64) },
      digest: 'c'.repeat(64),
    }
    const result = verifyRoleAdvance({
      decision,
      openReworkRequests: [],
      contract: { deliveryRole: 'agentflow:developer' },
      handoff: { toRole: 'agentflow:developer' },
      delivery: { role: 'agentflow:implementation-planner' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('phase 3 must pin an oracle digest before dev.build starts')
  })
})
