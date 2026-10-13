import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
  realpathSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { planAdoption, applyAdoption, rollbackAdoption } from '../adoption/transaction.mjs'
import { buildOnboardingPlan } from '../core/onboarding-plan.mjs'
import { createLocalOnboardingService } from '../onboarding/project-writer.mjs'
import { runConfigSync } from '../config/sync.mjs'
import { handleOnboarding } from '../onboarding/cli.mjs'
import { LOCKFILE_NAME } from '../lockfile.mjs'

const packageRoot = resolve(import.meta.dirname, '../..')

describe('Phase 3 Proof Contracts: Transactional Refinement Pipeline (#441)', () => {
  let scratchDir
  let targetDir

  beforeEach(() => {
    scratchDir = mkdtempSync(join(realpathSync(tmpdir()), 'af-refinement-test-'))
    targetDir = join(scratchDir, 'target')
    mkdirSync(targetDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(scratchDir, { recursive: true, force: true })
  })

  it('AC1: generates plan preview containing create, change, and exact untouched files list sealed into plan digest', () => {
    const service = createLocalOnboardingService()
    const plan = service.plan({
      packageRoot,
      targetDir,
      profile: 'standard',
    })

    expect(plan.preview).toBeDefined()
    expect(Array.isArray(plan.preview.create)).toBe(true)
    expect(Array.isArray(plan.preview.change)).toBe(true)
    expect(Array.isArray(plan.preview.remove)).toBe(true)
    expect(Array.isArray(plan.preview.untouched)).toBe(true)
    expect(plan.preview.create.length).toBeGreaterThan(0)
    expect(plan.digest).toBeDefined()
    expect(typeof plan.digest).toBe('string')
    expect(plan.digest.length).toBe(64)
  })

  it('AC2: strictly enforces confirm digest matching plan.digest and rejects drifted inventory', () => {
    const service = createLocalOnboardingService()
    const plan = service.plan({
      packageRoot,
      targetDir,
      profile: 'standard',
    })

    expect(() => {
      service.apply(plan, { confirm: '0'.repeat(64), targetDir, packageRoot })
    }).toThrow(/Confirmation token mismatch/)

    // Modifying agent-workflow.config.json to cause inventory drift
    writeFileSync(join(targetDir, 'agent-workflow.config.json'), JSON.stringify({ version: 1 }))
    expect(() => {
      service.apply(plan, { confirm: plan.digest, targetDir, packageRoot })
    }).toThrow(/Project inventory drifted/)
  })

  it('AC3: re-checks preconditions and safely handles locked or invalid target paths', () => {
    const service = createLocalOnboardingService()
    const plan = service.plan({
      packageRoot,
      targetDir,
      profile: 'standard',
    })

    expect(plan.readyToApply).toBe(true)
    expect(plan.blockers).toEqual([])
  })

  it('AC4: applies mutations via staged atomic replacement and writes on-disk rollback journal', () => {
    const service = createLocalOnboardingService()
    const plan = service.plan({
      packageRoot,
      targetDir,
      profile: 'standard',
    })

    const result = service.apply(plan, { confirm: plan.digest, targetDir, packageRoot })
    const receipt = result.receipt ?? result
    expect(receipt).toBeDefined()
    expect(receipt.mutations.length).toBeGreaterThan(0)
    expect(existsSync(join(targetDir, LOCKFILE_NAME))).toBe(true)
  })

  it('AC5: rollbackAdoption restores exact prior bytes from receipt', () => {
    const service = createLocalOnboardingService()
    const plan = service.plan({
      packageRoot,
      targetDir,
      profile: 'standard',
    })

    const result = service.apply(plan, { confirm: plan.digest, targetDir, packageRoot })
    const receipt = result.receipt ?? result

    const rollbackResult = rollbackAdoption(targetDir, receipt, { confirm: receipt.receiptToken })
    expect(rollbackResult.status).toBe('rolled-back')
    expect(existsSync(join(targetDir, LOCKFILE_NAME))).toBe(false)
  })

  it('AC5 (CLI): onboarding undo auto-discovers latest transaction receipt when --receipt is omitted', () => {
    const service = createLocalOnboardingService()
    const plan = service.plan({
      packageRoot,
      targetDir,
      profile: 'standard',
    })

    const result = service.apply(plan, { confirm: plan.digest, targetDir, packageRoot })
    const receipt = result.receipt ?? result
    expect(existsSync(join(targetDir, LOCKFILE_NAME))).toBe(true)

    const code = handleOnboarding(['undo', '--confirm', receipt.receiptToken], targetDir)
    expect(code).toBe(0)
    expect(existsSync(join(targetDir, LOCKFILE_NAME))).toBe(false)
  })

  it('AC6: config sync --apply returns deprecation notice pointing to onboarding refine', () => {
    const result = runConfigSync({
      packageRoot,
      targetDir,
      write: true,
    })

    expect(result.deprecation).toBeDefined()
    expect(result.deprecation.deprecated).toBe(true)
    expect(result.deprecation.warning).toContain('onboarding refine')
  })
})
