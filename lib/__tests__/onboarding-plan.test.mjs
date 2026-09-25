import { describe, it, expect, vi } from 'vitest'
import { buildOnboardingPlan, recordDigest, hasCurrentDigest } from '../core/onboarding-plan.mjs'
import { createOnboardingService } from '../application/onboarding-service.mjs'

function sampleInventory(overrides = {}) {
  return {
    version: 1,
    target: '/test/project',
    rootIdentity: { dev: 16777220, ino: 123456 },
    profile: 'standard',
    classification: 'partial',
    pendingJournal: false,
    lock: { format: 'v2' },
    config: { status: 'valid' },
    diagnostics: [],
    ...overrides,
  }
}

function sampleProjectPlan(overrides = {}) {
  return {
    version: 1,
    operation: 'adopt',
    target: '/test/project',
    profile: 'standard',
    token: 'test-project-token-1234',
    blocked: false,
    conflicts: [],
    actions: [
      {
        action: 'create',
        source: 'AGENTS.md',
        target: 'AGENTS.md',
        ownership: 'managed',
      },
    ],
    ...overrides,
  }
}

function sampleRuntime(overrides = {}) {
  return {
    schemaVersion: 1,
    requestId: 'req-1',
    runtimeId: 'test-runtime',
    runtimeReady: false,
    action: 'reconcile',
    components: [],
    proposals: [
      {
        componentId: 'cli',
        action: 'install',
        targetVersion: '1.2.0',
      },
    ],
    unknowns: [{ componentId: 'cli', field: 'version', reason: 'unknown' }],
    errors: [],
    ...overrides,
  }
}

describe('buildOnboardingPlan', () => {
  it('produces a deterministic digest and binds hasCurrentDigest', () => {
    const inventory = sampleInventory()
    const runtime = sampleRuntime()
    const projectPlan = sampleProjectPlan()
    const choices = { migrateLegacy: false }

    const planA = buildOnboardingPlan({ inventory, runtime, projectPlan, choices })
    const planB = buildOnboardingPlan({ inventory, runtime, projectPlan, choices })

    expect(planA.digest).toBe(planB.digest)
    expect(hasCurrentDigest(planA)).toBe(true)
    expect(hasCurrentDigest(planB)).toBe(true)

    const planDifferent = buildOnboardingPlan({
      inventory: { ...inventory, classification: 'empty' },
      runtime,
      projectPlan,
      choices,
    })
    expect(planDifferent.digest).not.toBe(planA.digest)
  })

  it('allows project setup to proceed when runtime evidence is unknown', () => {
    const inventory = sampleInventory()
    const runtime = sampleRuntime({ runtimeReady: false })
    const projectPlan = sampleProjectPlan()

    const plan = buildOnboardingPlan({ inventory, runtime, projectPlan })

    expect(plan.readiness.runtime).toBe(false)
    expect(plan.readyToApply).toBe(true)
    expect(plan.readiness.project).toBe(false)
    expect(plan.readiness.governedChange).toBe(false)
    expect(plan.sharedRequests).toEqual([
      {
        componentId: 'cli',
        action: 'install',
        targetVersion: '1.2.0',
      },
    ])
    expect(plan.changes).toEqual(projectPlan.actions)
  })

  it('requires explicit migrateLegacy choice for legacy installations', () => {
    const inventory = sampleInventory({ classification: 'legacy' })
    const projectPlan = sampleProjectPlan()

    const blockedPlan = buildOnboardingPlan({
      inventory,
      projectPlan,
      choices: { migrateLegacy: false },
    })
    expect(blockedPlan.missingChoices).toContain('migrateLegacy')
    expect(blockedPlan.readiness.project).toBe(false)
    expect(blockedPlan.blockers).toContain('Legacy lockfile requires explicit migrateLegacy choice')

    const resolvedPlan = buildOnboardingPlan({
      inventory,
      projectPlan,
      choices: { migrateLegacy: true },
    })
    expect(resolvedPlan.missingChoices).not.toContain('migrateLegacy')
    expect(resolvedPlan.readyToApply).toBe(true)
  })

  it('identifies unresolved conflicts and records missing resolution choices', () => {
    const inventory = sampleInventory({ classification: 'conflicting' })
    const projectPlan = sampleProjectPlan({
      blocked: true,
      conflicts: ['AGENTS.md'],
      actions: [{ action: 'conflict', target: 'AGENTS.md' }],
    })

    const planWithConflicts = buildOnboardingPlan({ inventory, projectPlan })
    expect(planWithConflicts.missingChoices).toContain('resolution:AGENTS.md')
    expect(planWithConflicts.blockers).toContain('Unresolved project conflict for AGENTS.md')
    expect(planWithConflicts.readiness.project).toBe(false)

    const resolvedPlan = buildOnboardingPlan({
      inventory,
      projectPlan: { ...projectPlan, blocked: false },
      choices: { resolutions: { 'AGENTS.md': 'preserve' } },
    })
    expect(resolvedPlan.missingChoices).not.toContain('resolution:AGENTS.md')
    expect(resolvedPlan.readiness.project).toBe(true)
  })

  it('blocks on pendingJournal, invalid config, or unknown lock', () => {
    const journalPlan = buildOnboardingPlan({
      inventory: sampleInventory({ pendingJournal: true }),
      projectPlan: sampleProjectPlan(),
    })
    expect(journalPlan.blockers).toContain('Pending journal requires recovery before onboarding')
    expect(journalPlan.readiness.project).toBe(false)

    const configPlan = buildOnboardingPlan({
      inventory: sampleInventory({ config: { status: 'invalid' } }),
      projectPlan: sampleProjectPlan(),
    })
    expect(configPlan.blockers).toContain('Config file is invalid or malformed')
    expect(configPlan.readiness.project).toBe(false)

    const lockPlan = buildOnboardingPlan({
      inventory: sampleInventory({ lock: { format: 'unknown' } }),
      projectPlan: sampleProjectPlan(),
    })
    expect(lockPlan.blockers).toContain('Lockfile format is unknown or malformed')
    expect(lockPlan.readiness.project).toBe(false)
  })
})

describe('createOnboardingService', () => {
  it('coordinates inspect, plan, apply, verify, and recover using injected ports', () => {
    const inspectPort = vi
      .fn()
      .mockImplementation((pkgRoot, targetDir) => sampleInventory({ target: targetDir }))
    const planPort = vi
      .fn()
      .mockImplementation((pkgRoot, targetDir) => sampleProjectPlan({ target: targetDir }))
    const applyPort = vi.fn().mockReturnValue({ receiptToken: 'receipt-123' })
    const recoverPort = vi.fn().mockReturnValue({ status: 'recovered' })
    const assessRuntimePort = vi.fn().mockReturnValue(sampleRuntime())

    const service = createOnboardingService({
      inspect: inspectPort,
      planProject: planPort,
      applyProject: applyPort,
      recoverProject: recoverPort,
      assessRuntime: assessRuntimePort,
    })

    const input = {
      packageRoot: '/test/pkg',
      targetDir: '/test/project',
      profile: 'standard',
      runtimeRequest: { requestId: 'req-1', runtimeId: 'test-runtime' },
      runtimeEvidence: { schemaVersion: 1 },
      choices: {},
    }

    const inspection = service.inspect(input)
    expect(inspection.inventory.target).toBe('/test/project')
    expect(inspection.runtime.runtimeId).toBe('test-runtime')

    const plan = service.plan(input)
    expect(plan.digest).toBeDefined()
    expect(hasCurrentDigest(plan)).toBe(true)

    const applyResult = service.apply(plan, {
      confirm: plan.digest,
      runtimeEvidence: input.runtimeEvidence,
    })
    expect(applyResult.receiptToken).toBe('receipt-123')
    expect(applyPort).toHaveBeenCalledTimes(1)

    const recoveryResult = service.recover(input, { confirm: 'rec-token' })
    expect(recoverPort).toHaveBeenCalledWith('/test/project', { confirm: 'rec-token' })
    expect(recoveryResult.recovery.status).toBe('recovered')
    expect(recoveryResult.plan.digest).toBeDefined()
  })

  it('rejects apply on invalid confirm token, missing choices, or blockers', () => {
    const service = createOnboardingService({
      inspect: vi.fn().mockReturnValue(sampleInventory()),
      planProject: vi.fn().mockReturnValue(sampleProjectPlan()),
      applyProject: vi.fn(),
      recoverProject: vi.fn(),
    })

    const plan = service.plan({
      packageRoot: '/test/pkg',
      targetDir: '/test/project',
    })

    expect(() => service.apply(plan, { confirm: 'wrong-token' })).toThrow(
      /Confirmation token mismatch/,
    )

    const blockedPlan = { ...plan, blockers: ['Some blocker'], digest: null }
    blockedPlan.digest = recordDigest(blockedPlan)
    expect(() => service.apply(blockedPlan, { confirm: blockedPlan.digest })).toThrow(
      /Cannot apply plan with blockers/,
    )
  })

  it('refuses apply on inventory drift or root identity drift', () => {
    let callCount = 0
    const inspectPort = vi.fn().mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        return sampleInventory({ target: '/test/project' })
      }
      return sampleInventory({
        target: '/test/project',
        lock: { format: 'v2', changed: true },
      })
    })

    const service = createOnboardingService({
      inspect: inspectPort,
      planProject: vi.fn().mockReturnValue(sampleProjectPlan()),
      applyProject: vi.fn(),
      recoverProject: vi.fn(),
    })

    const plan = service.plan({
      packageRoot: '/test/pkg',
      targetDir: '/test/project',
    })

    expect(() =>
      service.apply(plan, {
        confirm: plan.digest,
      }),
    ).toThrow(/drift/i)
  })

  it('verify reports projectReady, runtimeReady, and governedChangeReady accurately', () => {
    const completeInventory = sampleInventory({
      classification: 'complete',
      lock: { format: 'v2' },
      config: { status: 'valid' },
    })

    const noMutationsPlan = sampleProjectPlan({
      actions: [{ action: 'unchanged', target: 'AGENTS.md' }],
      blocked: false,
      conflicts: [],
    })

    const service = createOnboardingService({
      inspect: vi.fn().mockReturnValue(completeInventory),
      planProject: vi.fn().mockReturnValue(noMutationsPlan),
      applyProject: vi.fn(),
      recoverProject: vi.fn(),
      assessRuntime: vi.fn().mockReturnValue({ runtimeReady: true }),
    })

    const resReady = service.verify({
      packageRoot: '/test/pkg',
      targetDir: '/test/project',
      runtimeRequest: { requestId: '1', runtimeId: 'r' },
      runtimeEvidence: {},
    })

    expect(resReady.projectReady).toBe(true)
    expect(resReady.runtimeReady).toBe(true)
    expect(resReady.governedChangeReady).toBe(false)
    expect(resReady.explanation).toBe('Needs issue contract and actual verification')

    const pendingMutationsPlan = sampleProjectPlan({
      actions: [{ action: 'create', target: 'AGENTS.md' }],
    })
    const servicePending = createOnboardingService({
      inspect: vi.fn().mockReturnValue(completeInventory),
      planProject: vi.fn().mockReturnValue(pendingMutationsPlan),
      applyProject: vi.fn(),
      recoverProject: vi.fn(),
      assessRuntime: vi.fn().mockReturnValue({ runtimeReady: false }),
    })

    const resPending = servicePending.verify({
      packageRoot: '/test/pkg',
      targetDir: '/test/project',
    })
    expect(resPending.projectReady).toBe(false)
    expect(resPending.runtimeReady).toBe(false)
  })
})
