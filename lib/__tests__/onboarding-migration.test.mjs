import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyAdoption as applyWithReceipt,
  planAdoption,
  rollbackAdoption,
} from '../adoption/transaction.mjs'
import { createOnboardingService } from '../application/onboarding-service.mjs'
import { inspectProject } from '../onboarding/project-reader.mjs'
import { readLockfile, hashContent } from '../lockfile.mjs'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const receiptFiles = []

function applyAdoption(source, target, plan, options = {}) {
  const receiptDestination =
    options.receiptDestination ?? `${target}-${receiptFiles.length}.receipt.json`
  if (!options.receiptDestination) receiptFiles.push(receiptDestination)
  return applyWithReceipt(source, target, plan, { ...options, receiptDestination })
}

describe('S6 issue #256 explicit legacy migration and selective unknown lock recovery', () => {
  let target
  let linkTarget
  let service

  it.each(['untrusted', 'seed-once'])(
    'requires selective choices when a v2 ownership claim is %s',
    (ownership) => {
      const path = 'docs/adopters/index.md'
      mkdirSync(join(target, 'docs/adopters'), { recursive: true })
      writeFileSync(join(target, path), 'user authored bytes')
      writeFileSync(
        join(target, 'agent-framework-lock.json'),
        JSON.stringify({
          version: 2,
          entries: [
            {
              source: path,
              target: path,
              ownership,
              state: 'managed',
              hash: hashContent('user authored bytes'),
            },
          ],
        }),
      )
      const plan = planAdoption(packageRoot, target, { profile: 'minimal', recoverUnknown: true })
      expect(plan.blocked).toBe(true)
      expect(plan.actions.find((a) => a.target === path).action).toBe('conflict')
    },
  )

  beforeEach(() => {
    target = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-s6-migration-'))
    service = createOnboardingService({
      inspect: inspectProject,
      planProject: (pkg, tgt, opts) => planAdoption(pkg, tgt, opts),
      applyProject: (pkg, tgt, plan, opts) => applyAdoption(pkg, tgt, plan, opts),
      recoverProject: () => ({ status: 'clean' }),
      assessRuntime: (req) => ({ runtimeReady: true, proposals: [], request: req }),
    })
  })

  afterEach(() => {
    for (const path of receiptFiles.splice(0)) rmSync(path, { force: true })
    rmSync(target, { recursive: true, force: true })
    if (linkTarget) rmSync(linkTarget, { recursive: true, force: true })
    linkTarget = null
  })

  it('Requirement 1: unknown lockfile is preserved untouched until explicit recoverUnknown choice', () => {
    const malformedContent = '{"version": "corrupted", invalid json\n'
    const lockPath = join(target, 'agent-framework-lock.json')
    writeFileSync(lockPath, malformedContent)

    mkdirSync(join(target, 'manifests'), { recursive: true })
    const managedPath = join(target, 'manifests', 'role-catalog.json')
    writeFileSync(managedPath, '{"authored": "preserved"}\n')

    expect(() => planAdoption(packageRoot, target, { profile: 'standard' })).toThrow(
      'Invalid AgentFlow lockfile',
    )

    const sPlan = service.plan({
      packageRoot,
      targetDir: target,
      profile: 'standard',
    })

    expect(sPlan.readyToApply).toBe(false)
    expect(sPlan.missingChoices).toContain('recoverUnknown')
    expect(sPlan.blockers).toContain('Lockfile format is unknown or malformed')
    expect(sPlan.diagnostics.length).toBeGreaterThan(0)

    expect(readFileSync(lockPath, 'utf8')).toBe(malformedContent)
    expect(readFileSync(managedPath, 'utf8')).toBe('{"authored": "preserved"}\n')
  })

  it('Requirement 2: strict boolean type validation rejects non-boolean recoverUnknown and migrateLegacy', () => {
    expect(() =>
      planAdoption(packageRoot, target, {
        recoverUnknown: 'true',
      }),
    ).toThrow('recoverUnknown must be a boolean')

    expect(() =>
      planAdoption(packageRoot, target, {
        migrateLegacy: 'true',
      }),
    ).toThrow('migrateLegacy must be a boolean')

    expect(() =>
      service.plan({
        packageRoot,
        targetDir: target,
        choices: { recoverUnknown: 'true' },
      }),
    ).toThrow(TypeError)

    expect(() =>
      service.plan({
        packageRoot,
        targetDir: target,
        choices: { migrateLegacy: 'true' },
      }),
    ).toThrow(TypeError)
  })

  it('Requirement 3: recoverUnknown treats unknown lock as empty ownership; unresolved conflict is blocked', () => {
    writeFileSync(
      join(target, 'agent-framework-lock.json'),
      '{"version": 999, "unrecognized": true}\n',
    )
    mkdirSync(join(target, 'manifests'), { recursive: true })
    writeFileSync(join(target, 'manifests', 'role-catalog.json'), '{"authored": true}\n')

    const plan = planAdoption(packageRoot, target, {
      profile: 'standard',
      recoverUnknown: true,
    })

    expect(plan.blocked).toBe(true)
    expect(plan.conflicts).toContain('manifests/role-catalog.json')
    expect(() => applyAdoption(packageRoot, target, plan, { confirm: plan.token })).toThrow(
      'Adoption plan is blocked',
    )

    const sPlan = service.plan({
      packageRoot,
      targetDir: target,
      profile: 'standard',
      choices: { recoverUnknown: true },
    })
    expect(sPlan.readyToApply).toBe(false)
    expect(sPlan.missingChoices).toContain('resolution:manifests/role-catalog.json')
    expect(sPlan.blockers).toContain('Unresolved project conflict for manifests/role-catalog.json')
  })

  it('Requirement 4: explicit resolutions allow preserving authored files while replacing selected ones', () => {
    const malformedBytes = 'MALFORMED_HEADER_BYTES_NOT_JSON\n'
    writeFileSync(join(target, 'agent-framework-lock.json'), malformedBytes)

    mkdirSync(join(target, 'manifests'), { recursive: true })
    const preservePath = join(target, 'manifests', 'role-catalog.json')
    const replacePath = join(target, 'manifests', 'runtime-platforms.json')

    writeFileSync(preservePath, '{"custom": "keep-this-file"}\n')
    writeFileSync(replacePath, '{"outdated": "replace-this-file"}\n')

    const plan = planAdoption(packageRoot, target, {
      profile: 'standard',
      recoverUnknown: true,
      resolutions: {
        'manifests/role-catalog.json': 'preserve',
        'manifests/runtime-platforms.json': 'replace',
      },
    })

    expect(plan.blocked).toBe(false)
    expect(plan.priorLockVersion).toBe('unknown')
    expect(plan.priorLockHash).toBeDefined()

    const receipt = applyAdoption(packageRoot, target, plan, { confirm: plan.token })
    expect(receipt.planToken).toBe(plan.token)

    expect(readFileSync(preservePath, 'utf8')).toBe('{"custom": "keep-this-file"}\n')
    const expectedReplace = readFileSync(
      join(packageRoot, 'manifests', 'runtime-platforms.json'),
      'utf8',
    )
    expect(readFileSync(replacePath, 'utf8')).toBe(expectedReplace)

    const v2Lock = readLockfile(target, { strict: true })
    expect(v2Lock.version).toBe(2)
    expect(v2Lock.merged).toContain('manifests/role-catalog.json')
    expect(v2Lock.files['manifests/runtime-platforms.json']).toBeDefined()
  })

  it('Requirement 5: rollback restores original malformed bytes of unknown lockfile and pre-adoption file state', () => {
    const originalMalformedBytes = 'corrupted-lock-content-line-1\ncorrupted-lock-content-line-2\n'
    writeFileSync(join(target, 'agent-framework-lock.json'), originalMalformedBytes)

    mkdirSync(join(target, 'manifests'), { recursive: true })
    const replacePath = join(target, 'manifests', 'role-catalog.json')
    writeFileSync(replacePath, '{"authored": "old-version"}\n')

    const plan = planAdoption(packageRoot, target, {
      profile: 'standard',
      recoverUnknown: true,
      resolutions: {
        'manifests/role-catalog.json': 'replace',
      },
    })

    const receipt = applyAdoption(packageRoot, target, plan, { confirm: plan.token })
    expect(readFileSync(join(target, 'agent-framework-lock.json'), 'utf8')).not.toBe(
      originalMalformedBytes,
    )

    const rollbackResult = rollbackAdoption(target, receipt, { confirm: receipt.receiptToken })
    expect(rollbackResult.status).toBe('rolled-back')

    expect(readFileSync(join(target, 'agent-framework-lock.json'), 'utf8')).toBe(
      originalMalformedBytes,
    )
    expect(readFileSync(replacePath, 'utf8')).toBe('{"authored": "old-version"}\n')
  })

  it('Requirement 6: plan and rollback are invalidated by subsequent drift', () => {
    const lockPath = join(target, 'agent-framework-lock.json')
    writeFileSync(lockPath, '{"version": 99, "malformed": true}\n')
    mkdirSync(join(target, 'manifests'), { recursive: true })
    writeFileSync(join(target, 'manifests', 'role-catalog.json'), '{"orig": true}\n')

    const plan = planAdoption(packageRoot, target, {
      profile: 'standard',
      recoverUnknown: true,
      resolutions: { 'manifests/role-catalog.json': 'preserve' },
    })

    writeFileSync(lockPath, '{"version": 99, "malformed": "edited-after-plan"}\n')
    expect(() => applyAdoption(packageRoot, target, plan, { confirm: plan.token })).toThrow(
      'Adoption plan is stale; generate a new preview',
    )

    const freshPlan = planAdoption(packageRoot, target, {
      profile: 'standard',
      recoverUnknown: true,
      resolutions: { 'manifests/role-catalog.json': 'preserve' },
    })
    const receipt = applyAdoption(packageRoot, target, freshPlan, { confirm: freshPlan.token })

    writeFileSync(lockPath, '{"tampered": true}\n')
    expect(() => rollbackAdoption(target, receipt, { confirm: receipt.receiptToken })).toThrow(
      'Adoption rollback refused because agent-framework-lock.json drifted',
    )
  })

  it('Requirement 7: legacy format supported vs rejected future version distinct', () => {
    const legacyLock = {
      version: 1,
      files: { 'lib/core/provider-binding.mjs': 'b'.repeat(64) },
      merged: [],
    }
    writeFileSync(
      join(target, 'agent-framework-lock.json'),
      JSON.stringify(legacyLock, null, 2) + '\n',
    )

    expect(() =>
      planAdoption(packageRoot, target, {
        recoverUnknown: true,
        migrateLegacy: false,
      }),
    ).toThrow('legacy lockfiles are not supported')

    const futureVersionLock = {
      version: 3,
      files: {},
    }
    writeFileSync(
      join(target, 'agent-framework-lock.json'),
      JSON.stringify(futureVersionLock, null, 2) + '\n',
    )

    expect(() =>
      planAdoption(packageRoot, target, {
        migrateLegacy: true,
        recoverUnknown: false,
      }),
    ).toThrow('unknown lockfile version 3')

    const futureRecoverPlan = planAdoption(packageRoot, target, {
      recoverUnknown: true,
      migrateLegacy: false,
    })
    expect(futureRecoverPlan.priorLockVersion).toBe('unknown')
  })

  it('Requirement 8: lockfile symlink or junction is never read, written, or recovered', () => {
    const externalDir = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-external-lock-'))
    try {
      const externalLock = join(externalDir, 'real-lock.json')
      writeFileSync(externalLock, '{"version": 2, "files": {}}\n')

      const symlinkLock = join(target, 'agent-framework-lock.json')
      symlinkSync(externalLock, symlinkLock)

      expect(() =>
        planAdoption(packageRoot, target, {
          recoverUnknown: true,
        }),
      ).toThrow('regular file')
    } finally {
      rmSync(externalDir, { recursive: true, force: true })
    }
  })

  it('Requirement 9: existing invalid config file stays blocked to prevent erasing user data', () => {
    writeFileSync(join(target, 'agent-framework-lock.json'), '{"malformed": true}\n')
    writeFileSync(join(target, 'agent-workflow.config.json'), '{"broken-json": invalid\n')

    const sPlan = service.plan({
      packageRoot,
      targetDir: target,
      profile: 'standard',
      choices: { recoverUnknown: true },
    })

    expect(sPlan.readyToApply).toBe(false)
    expect(sPlan.blockers).toContain('Config file is invalid or malformed')
    expect(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8')).toBe(
      '{"broken-json": invalid\n',
    )
  })
})
