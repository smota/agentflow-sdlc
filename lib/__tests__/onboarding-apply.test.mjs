import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
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
  readAdoptionJournal,
  recoverAdoption,
} from '../adoption/transaction.mjs'
import { hashContent, readLockfile } from '../lockfile.mjs'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const receiptFiles = []
function applyAdoption(source, target, plan, options = {}) {
  const receiptDestination =
    options.receiptDestination ?? `${target}-${receiptFiles.length}.receipt.json`
  if (!options.receiptDestination) receiptFiles.push(receiptDestination)
  return applyWithReceipt(source, target, plan, { ...options, receiptDestination })
}

function fileInventory(root, relative = '') {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .sort()
    .flatMap((name) => {
      const absolute = join(root, name)
      const path = relative ? `${relative}/${name}` : name
      return statSync(absolute).isDirectory()
        ? [`${path}/`, ...fileInventory(absolute, path)]
        : [`${path}:${readFileSync(absolute).toString('base64')}`]
    })
}

describe('S5 incremental onboarding transactional support', () => {
  let target
  let linkTarget

  beforeEach(() => {
    target = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-s5-apply-'))
  })

  afterEach(() => {
    for (const path of receiptFiles.splice(0)) rmSync(path, { force: true })
    rmSync(target, { recursive: true, force: true })
    if (linkTarget) rmSync(linkTarget, { recursive: true, force: true })
    linkTarget = null
  })

  it('Requirement 2 & AC6: second apply produces status unchanged with zero byte/lock churn', () => {
    const plan = planAdoption(packageRoot, target, { profile: 'minimal' })
    const firstResult = applyAdoption(packageRoot, target, plan, { confirm: plan.token })
    expect(firstResult.changed.length).toBeGreaterThan(0)

    const lockPath = join(target, 'agent-framework-lock.json')
    const lockBeforeSecond = readFileSync(lockPath, 'utf8')
    const statBeforeSecond = statSync(lockPath)
    const filesBeforeSecond = fileInventory(target)

    const secondPlan = planAdoption(packageRoot, target, { profile: 'minimal' })
    expect(secondPlan.actions.every((a) => ['unchanged', 'seed-skip'].includes(a.action))).toBe(
      true,
    )

    const secondResult = applyAdoption(packageRoot, target, secondPlan, {
      confirm: secondPlan.token,
    })
    expect(secondResult).toMatchObject({
      status: 'unchanged',
      changed: [],
    })

    expect(readFileSync(lockPath, 'utf8')).toBe(lockBeforeSecond)
    expect(statSync(lockPath).mtimeMs).toBe(statBeforeSecond.mtimeMs)
    expect(fileInventory(target)).toEqual(filesBeforeSecond)
    expect(readAdoptionJournal(target)).toBeNull()
  })

  it('Requirement 4 & 6: seedValues shallow merges chosen top-level config preserving unchosen fields', () => {
    const initialConfig = {
      customField: 'preserved-authored-value',
      developerSettings: { verbose: true },
      roles: { developer: 'human' },
    }
    writeFileSync(
      join(target, 'agent-workflow.config.json'),
      JSON.stringify(initialConfig, null, 2) + '\n',
    )

    const plan = planAdoption(packageRoot, target, {
      profile: 'minimal',
      seedValues: {
        'agent-workflow.config.json': {
          roles: { developer: 'agy' },
          newTopLevel: 'added-by-onboarding',
        },
      },
    })

    const configAction = plan.actions.find((a) => a.target === 'agent-workflow.config.json')
    expect(configAction).toBeDefined()
    expect(configAction.ownership).toBe('seed-once')
    expect(configAction.action).toBe('update')
    expect(configAction.contentBase64).toBeDefined()

    applyAdoption(packageRoot, target, plan, { confirm: plan.token })

    const finalConfig = JSON.parse(readFileSync(join(target, 'agent-workflow.config.json'), 'utf8'))
    expect(finalConfig.customField).toBe('preserved-authored-value')
    expect(finalConfig.developerSettings).toEqual({ verbose: true })
    expect(finalConfig.roles).toEqual({ developer: 'agy' })
    expect(finalConfig.newTopLevel).toBe('added-by-onboarding')
  })

  it('Requirement 4: rejects invalid existing config rather than overwrite, and rejects unsafe prototype keys', () => {
    writeFileSync(join(target, 'agent-workflow.config.json'), '{\n  malformed json!\n')
    expect(() =>
      planAdoption(packageRoot, target, {
        seedValues: {
          'agent-workflow.config.json': { someKey: 1 },
        },
      }),
    ).toThrow('Invalid existing agent-workflow.config.json')

    writeFileSync(join(target, 'agent-workflow.config.json'), '{\"valid\": 1}\n')
    expect(() =>
      planAdoption(packageRoot, target, {
        seedValues: {
          'agent-workflow.config.json': JSON.parse('{\"__proto__\": {\"polluted\": true}}'),
        },
      }),
    ).toThrow('Unsafe prototype key')
  })

  it('Requirement 3: unselected conflict blocks apply and resolutions allow selective preserve/replace', () => {
    mkdirSync(join(target, 'manifests'), { recursive: true })
    writeFileSync(join(target, 'manifests', 'role-catalog.json'), '{\"modified\": true}\n')

    const blockedPlan = planAdoption(packageRoot, target, { profile: 'standard' })
    expect(blockedPlan.blocked).toBe(true)
    expect(blockedPlan.conflicts).toContain('manifests/role-catalog.json')
    expect(() =>
      applyAdoption(packageRoot, target, blockedPlan, { confirm: blockedPlan.token }),
    ).toThrow('Adoption plan is blocked')

    const resolvedPreservePlan = planAdoption(packageRoot, target, {
      profile: 'standard',
      resolutions: {
        'manifests/role-catalog.json': 'preserve',
      },
    })
    expect(resolvedPreservePlan.blocked).toBe(false)
    const preserveAction = resolvedPreservePlan.actions.find(
      (a) => a.target === 'manifests/role-catalog.json',
    )
    expect(preserveAction.action).toBe('preserve-merged')

    applyAdoption(packageRoot, target, resolvedPreservePlan, {
      confirm: resolvedPreservePlan.token,
    })
    expect(readFileSync(join(target, 'manifests', 'role-catalog.json'), 'utf8')).toBe(
      '{\"modified\": true}\n',
    )

    const lock = readLockfile(target, { strict: true })
    expect(lock.merged).toContain('manifests/role-catalog.json')

    const replacePlan = planAdoption(packageRoot, target, {
      profile: 'standard',
      resolutions: {
        'manifests/role-catalog.json': 'replace',
      },
    })
    expect(replacePlan.blocked).toBe(false)
    const replaceAction = replacePlan.actions.find(
      (a) => a.target === 'manifests/role-catalog.json',
    )
    expect(replaceAction.action).toBe('update')

    applyAdoption(packageRoot, target, replacePlan, { confirm: replacePlan.token })
    const packageSource = readFileSync(join(packageRoot, 'manifests', 'role-catalog.json'), 'utf8')
    expect(readFileSync(join(target, 'manifests', 'role-catalog.json'), 'utf8')).toBe(packageSource)
  })

  it('Requirement 3: rejects unknown resolution keys or non-conflicting paths', () => {
    expect(() =>
      planAdoption(packageRoot, target, {
        profile: 'minimal',
        resolutions: {
          'non-existent.txt': 'preserve',
        },
      }),
    ).toThrow('Invalid resolution target: non-existent.txt')
  })

  it('Requirement 5: migrateLegacy=false rejects legacy v1 lock; migrateLegacy=true migrates in-memory and rolls back cleanly on failure', () => {
    const historicalLock = {
      version: 1,
      files: { 'lib/core/provider-binding.mjs': 'a'.repeat(64) },
      merged: ['authored-override.mjs'],
    }
    writeFileSync(
      join(target, 'agent-framework-lock.json'),
      JSON.stringify(historicalLock, null, 2) + '\n',
    )
    mkdirSync(join(target, 'lib', 'core'), { recursive: true })
    writeFileSync(join(target, 'lib', 'core', 'provider-binding.mjs'), 'different-bytes\n')
    writeFileSync(join(target, 'authored-override.mjs'), 'merged-content\n')

    expect(() => planAdoption(packageRoot, target, { profile: 'minimal' })).toThrow(
      'legacy lockfiles are not supported',
    )

    const plan = planAdoption(packageRoot, target, {
      profile: 'minimal',
      migrateLegacy: true,
      resolutions: {
        'lib/core/provider-binding.mjs': 'replace',
      },
    })
    expect(plan.blocked).toBe(false)
    expect(plan.priorLockVersion).toBe(1)

    expect(() =>
      applyAdoption(packageRoot, target, plan, {
        confirm: plan.token,
        fault(checkpoint) {
          if (checkpoint === 'lock.after-atomic-replace') {
            throw new Error('injected-lock-failure')
          }
        },
      }),
    ).toThrow('injected-lock-failure')

    expect(JSON.parse(readFileSync(join(target, 'agent-framework-lock.json'), 'utf8'))).toEqual(
      historicalLock,
    )
    expect(readFileSync(join(target, 'authored-override.mjs'), 'utf8')).toBe('merged-content\n')
    expect(readAdoptionJournal(target)).toBeNull()
  })

  it('Requirement 7: explicit target root identity binds dev/ino and rejects recreated root while supporting nonexistent targets', () => {
    const freshTarget = join(target, 'uncreated-subdir', 'project')
    const nonExistentPlan = planAdoption(packageRoot, freshTarget, { profile: 'minimal' })
    expect(nonExistentPlan.rootIdentity).toBeNull()
    expect(nonExistentPlan.blocked).toBe(false)

    const receipt = applyAdoption(packageRoot, freshTarget, nonExistentPlan, {
      confirm: nonExistentPlan.token,
    })
    expect(existsSync(join(freshTarget, 'agent-framework-lock.json'))).toBe(true)
    expect(receipt.status).not.toBe('unchanged')

    const existingRoot = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-recreated-'))
    try {
      const plan = planAdoption(packageRoot, existingRoot, { profile: 'minimal' })
      expect(plan.rootIdentity).not.toBeNull()

      rmSync(existingRoot, { recursive: true, force: true })
      mkdirSync(existingRoot)

      expect(() => applyAdoption(packageRoot, existingRoot, plan, { confirm: plan.token })).toThrow(
        'Adoption target root identity changed; recreated or moved root rejected',
      )
    } finally {
      rmSync(existingRoot, { recursive: true, force: true })
    }
  })

  it('Requirement 7: safely rejects parent symlinks including broken symlink paths', () => {
    linkTarget = `${target}-symlink-parent`
    symlinkSync(target, linkTarget, 'junction')
    const childUnderSymlink = join(linkTarget, 'child-project')

    expect(() => planAdoption(packageRoot, childUnderSymlink, { profile: 'minimal' })).toThrow(
      'symlink or junction',
    )
  })

  it('Requirement 1 & 8: defaultReceiptDestination canonicalizes tmpdir alias via realpathSync; preserves authored changes on interruption', () => {
    const plan = planAdoption(packageRoot, target, { profile: 'minimal' })
    const receipt = applyWithReceipt(packageRoot, target, plan, { confirm: plan.token })
    expect(receipt.externalReceiptDestination).toBeDefined()
    expect(existsSync(receipt.externalReceiptDestination)).toBe(true)
    receiptFiles.push(receipt.externalReceiptDestination)

    const expectedTmpDir = realpathSync(tmpdir())
    expect(receipt.externalReceiptDestination.startsWith(expectedTmpDir)).toBe(true)

    writeFileSync(join(target, 'authored-file.txt'), 'authored-bytes\n')
    const before = fileInventory(target)
    const moduleUrl = new URL('../adoption/transaction.mjs', import.meta.url).href
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { planAdoption, applyAdoption } from ${JSON.stringify(moduleUrl)};\n         const plan = planAdoption(${JSON.stringify(packageRoot)}, ${JSON.stringify(target)});\n         applyAdoption(${JSON.stringify(packageRoot)}, ${JSON.stringify(target)}, plan, {\n           confirm: plan.token,\n           receiptDestination: ${JSON.stringify(target + '.receipt.json')},\n           fault(checkpoint) { if (checkpoint === 'apply.before-replace') process.exit(93) }\n         });`,
      ],
      { encoding: 'utf8' },
    )
    expect(child.status).toBe(93)
    const journal = readAdoptionJournal(target)
    expect(journal.mutations).toHaveLength(1)
    expect(recoverAdoption(target, { confirm: journal.recoveryToken })).toMatchObject({
      status: 'recovered',
    })
    expect(fileInventory(target)).toEqual(before)
    expect(readFileSync(join(target, 'authored-file.txt'), 'utf8')).toBe('authored-bytes\n')
  })
})
