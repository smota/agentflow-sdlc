import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateSteeringBinding } from '../core/steering-binding.mjs'
import { evaluateMergeReadiness } from '../core/steering-merge-policy.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import {
  defaultDistributionSelection,
  distributionRole,
  resolveDistribution,
} from '../config/execution-distribution.mjs'
import {
  STEERING_ENFORCEMENT_LIMITS,
  applySteeringAgreement,
  inspectSteeringAgreement,
  planSteeringAgreement,
} from '../config/steering-agreement.mjs'

const roots = []

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'steering-agreement-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true })
})

function writeWorkflow(root, workflow) {
  writeFileSync(join(root, 'agent-workflow.config.json'), `${JSON.stringify(workflow, null, 2)}\n`)
}

function selection() {
  return defaultDistributionSelection()
}

function resolvedSteerLead() {
  const resolved = resolveDistribution(selection())
  const role = distributionRole(resolved, 'steer.lead')
  return {
    resolved,
    route: {
      profile: resolved.id,
      profileDigest: resolved.profileDigest,
      selectionDigest: resolved.selectionDigest,
      steerLeadRoute: {
        default: role.options[0],
        fallbacks: role.options.slice(1),
      },
    },
  }
}

function readyWorkflow(extra = {}) {
  return {
    executionDistribution: selection(),
    collaboration: { maxReworkRounds: 2 },
    delivery: {
      source: { kind: 'github', repo: 'owner/repo' },
      candidate: { context: { workstream: 'goal-534' } },
    },
    ...extra,
  }
}

function limitFlags(limits) {
  return {
    conversationalConfirmationGrantsAuthority: limits.conversationalConfirmationGrantsAuthority,
    bypassesSteeringBinding: limits.bypassesSteeringBinding,
    bypassesMergeReadiness: limits.bypassesMergeReadiness,
    fabricatesHostAuthentication: limits.fabricatesHostAuthentication,
    grantsPublicationOrMergePower: limits.grantsPublicationOrMergePower,
  }
}

describe('inspectSteeringAgreement', () => {
  it('resolves existing settings and requires confirmation when unconfirmed', () => {
    const root = tempRoot()
    writeWorkflow(root, readyWorkflow())
    const { route } = resolvedSteerLead()
    const report = inspectSteeringAgreement(root)

    expect(report.ok).toBe(false)
    expect(report.status).toBe('confirmation-required')
    expect(report.alreadyConfirmed).toBe(false)
    expect(report.reusedConfirmedAgreement).toBe(false)
    expect(report.missingParameters).toEqual([])
    expect(report.conflicts).toEqual([])
    expect(report.agreement.executionDistribution).toEqual(route)
    expect(report.agreement.executionDistribution.steerLeadRoute.fallbacks).toHaveLength(2)
    expect(report.agreement.executionDistribution.steerLeadRoute.default.model).toBe(
      route.steerLeadRoute.default.model,
    )
    expect(report.agreement.goalScope).toBe('goal-534')
    expect(report.agreement.steeringOwner).toBe('steer.lead')
    expect(report.agreement.returnRoute).toBe('pm.manager')
    expect(report.agreement.reviewAndPublicationAuthority).toBe('human-gated-merge')
    expect(report.agreement.quotaPolicy).toEqual({
      mode: 'park-and-checkpoint',
      autoMonitoring: false,
    })
    expect(report.agreement.checkpointsAndStopConditions).toEqual({
      checkpointBoundary: 'phase-boundary',
      maxReworkRounds: 2,
      supervisorStaleTimeoutMs: 1800000,
      holdOnUnverifiedAuthority: true,
    })
    expect(report.questions.map((question) => question.parameter)).toEqual(['confirmation'])
    expect(report.questions[0].candidateDigest).toBe(report.candidateDigest)
    expect(limitFlags(report.enforcementLimits)).toEqual({
      conversationalConfirmationGrantsAuthority: false,
      bypassesSteeringBinding: false,
      bypassesMergeReadiness: false,
      fabricatesHostAuthentication: false,
      grantsPublicationOrMergePower: false,
    })
  })

  it('returns missing-parameters with bounded questions when goalScope or executionDistribution is absent', () => {
    const root = tempRoot()
    writeWorkflow(root, { collaboration: { maxReworkRounds: 2 } })
    const report = inspectSteeringAgreement(root)

    expect(report.ok).toBe(false)
    expect(report.status).toBe('missing-parameters')
    expect(report.missingParameters).toEqual(['executionDistribution', 'goalScope'])
    expect(report.conflicts).toEqual([])
    expect(report.questions.map((question) => question.parameter)).toEqual([
      'executionDistribution',
      'goalScope',
    ])
    for (const question of report.questions) {
      expect(question.status).toBe('missing')
      expect(question.prompt.length).toBeGreaterThan(0)
      expect(question.prompt.length).toBeLessThan(400)
      expect(JSON.stringify(question)).not.toMatch(/stack|secret|token|password/i)
    }
    expect(report.questions[0].suggestedCommand).toBe('agentflow-sdlc distribution plan --json')
    expect(report.questions[1].example).toBe('goal-534 or owner/repo')

    writeWorkflow(root, {
      executionDistribution: selection(),
      collaboration: { maxReworkRounds: 2 },
    })
    const goalOnly = inspectSteeringAgreement(root)
    expect(goalOnly.status).toBe('missing-parameters')
    expect(goalOnly.missingParameters).toEqual(['goalScope'])
    expect(goalOnly.questions).toHaveLength(1)
    expect(goalOnly.questions[0].parameter).toBe('goalScope')
    expect(goalOnly.agreement.executionDistribution.steerLeadRoute.default).toBeTruthy()
    expect(goalOnly.agreement.executionDistribution.steerLeadRoute.fallbacks).toHaveLength(2)
  })

  it.each(['dev.build', 'pm.manager', 'orch.arch'])(
    'conflicts when steeringOwner is prohibited in-rig seat %s',
    (steeringOwner) => {
      const root = tempRoot()
      writeWorkflow(root, readyWorkflow())
      const report = inspectSteeringAgreement(root, { steeringOwner })
      expect(report.status).toBe('conflict')
      expect(report.ok).toBe(false)
      expect(report.missingParameters).toEqual([])
      expect(
        report.conflicts.some(
          (conflict) =>
            conflict.parameter === 'overrides' && conflict.reason.includes(steeringOwner),
        ),
      ).toBe(true)
      expect(() => planSteeringAgreement(root, { steeringOwner })).toThrow(/conflicts/)
    },
  )

  it.each(['dev.build', 'builder', 'dev.qa', 'test.eng', 'reviewer'])(
    'conflicts when returnRoute targets internal seat %s',
    (returnRoute) => {
      const root = tempRoot()
      writeWorkflow(root, readyWorkflow())
      const report = inspectSteeringAgreement(root, { returnRoute })
      expect(report.status).toBe('conflict')
      expect(report.ok).toBe(false)
      expect(
        report.conflicts.some(
          (conflict) => conflict.parameter === 'overrides' && conflict.reason.includes(returnRoute),
        ),
      ).toBe(true)
    },
  )

  it('conflicts when holdOnUnverifiedAuthority is disabled', () => {
    const root = tempRoot()
    writeWorkflow(root, readyWorkflow())
    const report = inspectSteeringAgreement(root, {
      checkpointsAndStopConditions: { holdOnUnverifiedAuthority: false },
    })
    expect(report.status).toBe('conflict')
    expect(report.agreement.checkpointsAndStopConditions.holdOnUnverifiedAuthority).toBe(true)
    expect(
      report.conflicts.some(
        (conflict) =>
          conflict.parameter === 'checkpointsAndStopConditions.holdOnUnverifiedAuthority' ||
          /holdOnUnverifiedAuthority/.test(conflict.reason),
      ),
    ).toBe(true)
  })

  it('conflicts when review authority would weaken domain human approval', () => {
    const root = tempRoot()
    writeWorkflow(root, readyWorkflow())
    const report = inspectSteeringAgreement(root, {
      reviewAndPublicationAuthority: 'bounded-self-review-with-human-merge',
    })
    expect(report.status).toBe('conflict')
    expect(report.conflicts).toEqual([
      {
        parameter: 'reviewAndPublicationAuthority',
        reason:
          'Domain configuration requires human approval for external/standard actions; steering agreement cannot weaken merge authority.',
      },
    ])

    writeFileSync(
      join(root, 'sdlc.config.json'),
      `${JSON.stringify({
        paths: { standard: { requiresHumanApproval: false } },
        actionPolicy: { externalActionRequiresHumanApproval: false },
      })}\n`,
    )
    const relaxed = inspectSteeringAgreement(root, {
      reviewAndPublicationAuthority: 'bounded-self-review-with-human-merge',
    })
    expect(relaxed.status).toBe('confirmation-required')
    expect(relaxed.conflicts).toEqual([])
  })
})

describe('planSteeringAgreement and applySteeringAgreement', () => {
  it('persists a confirmed agreement, writes a receipt, and reuses it with zero questions', () => {
    const root = tempRoot()
    writeWorkflow(root, readyWorkflow())
    expect(() => planSteeringAgreement(root, {})).not.toThrow()
    const plan = planSteeringAgreement(root)
    expect(plan.type).toBe('steering-agreement-plan')
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.after.confirmedDigest).toBe(plan.candidateDigest)
    expect(plan.alreadyConfirmed).toBe(false)
    expect(readFileSync(join(root, 'agent-workflow.config.json'), 'utf8')).not.toContain(
      '"steering"',
    )

    expect(() => applySteeringAgreement(root, plan, 'not-the-digest')).toThrow(/confirmation/)
    const applied = applySteeringAgreement(root, plan, plan.digest)
    expect(applied).toMatchObject({
      ok: true,
      status: 'applied',
      confirmedDigest: plan.candidateDigest,
      planDigest: plan.digest,
      nativeAuthorityGranted: false,
    })
    expect(applied.receipt).toMatch(/^\.agent-runs\/steering-agreement-.+\.json$/)

    const saved = JSON.parse(readFileSync(join(root, 'agent-workflow.config.json'), 'utf8'))
    expect(saved.steering.goalScope).toBe('goal-534')
    expect(saved.steering.steeringOwner).toBe('steer.lead')
    expect(saved.steering.returnRoute).toBe('pm.manager')
    expect(saved.steering.confirmedDigest).toBe(plan.candidateDigest)
    expect(saved.executionDistribution).toEqual(selection())
    expect(limitFlags(saved.steering.authorityBoundary)).toEqual({
      conversationalConfirmationGrantsAuthority: false,
      bypassesSteeringBinding: false,
      bypassesMergeReadiness: false,
      fabricatesHostAuthentication: false,
      grantsPublicationOrMergePower: false,
    })

    const receipts = readdirSync(join(root, '.agent-runs')).filter((name) =>
      name.startsWith('steering-agreement-'),
    )
    expect(receipts).toEqual([applied.receipt.slice('.agent-runs/'.length)])
    const receipt = JSON.parse(readFileSync(join(root, applied.receipt), 'utf8'))
    expect(receipt.type).toBe('steering-agreement-receipt')
    expect(receipt.status).toBe('applied')
    expect(receipt.confirmedDigest).toBe(plan.candidateDigest)
    expect(receipt.planDigest).toBe(plan.digest)

    const again = inspectSteeringAgreement(root)
    expect(again.ok).toBe(true)
    expect(again.status).toBe('confirmed')
    expect(again.alreadyConfirmed).toBe(true)
    expect(again.reusedConfirmedAgreement).toBe(true)
    expect(again.questions).toEqual([])
    expect(again.missingParameters).toEqual([])
    expect(again.conflicts).toEqual([])
    expect(again.confirmedDigest).toBe(plan.candidateDigest)
    expect(limitFlags(again.enforcementLimits)).toEqual(limitFlags(STEERING_ENFORCEMENT_LIMITS))
  })

  it('refuses to plan when required parameters are missing', () => {
    const root = tempRoot()
    writeWorkflow(root, {})
    expect(() => planSteeringAgreement(root)).toThrow(
      /missing required parameters: executionDistribution, goalScope/,
    )
  })
})

describe('authority boundary after confirmation', () => {
  it('does not let a confirmed agreement authenticate steering or merge', () => {
    const root = tempRoot()
    writeWorkflow(root, readyWorkflow())
    const plan = planSteeringAgreement(root)
    applySteeringAgreement(root, plan, plan.digest)
    const confirmed = inspectSteeringAgreement(root)
    expect(confirmed.status).toBe('confirmed')
    expect(limitFlags(confirmed.enforcementLimits)).toEqual({
      conversationalConfirmationGrantsAuthority: false,
      bypassesSteeringBinding: false,
      bypassesMergeReadiness: false,
      fabricatesHostAuthentication: false,
      grantsPublicationOrMergePower: false,
    })
    expect(confirmed.enforcementLimits.summary).toMatch(/never authenticates/i)

    const now = 1_700_000_000_000
    const unauthenticated = evaluateSteeringBinding({
      nowMs: now,
      binding: {
        authorityId: confirmed.agreement.steeringOwner,
        replyRoute: confirmed.agreement.returnRoute,
        goal: confirmed.agreement.goalScope,
        task: 'steer-setup',
        powers: ['observe', 'merge'],
        issuedAt: now - 1000,
        expiresAt: now + 60_000,
        confirmedDigest: confirmed.confirmedDigest,
      },
      request: {
        goal: confirmed.agreement.goalScope,
        task: 'steer-setup',
        power: 'observe',
        challenge: 'c'.repeat(32),
        deadlineAt: now + 60_000,
        confirmedDigest: confirmed.confirmedDigest,
      },
    })
    expect(unauthenticated.authorized).toBe(false)
    expect(unauthenticated.reachable).toBe(false)
    expect(unauthenticated.status).toBe('STEERING_AUTHENTICATION_UNVERIFIED')

    const deniedReceipt = evaluateSteeringBinding({
      nowMs: now,
      binding: {
        authorityId: 'steer.lead',
        replyRoute: 'pm.manager',
        goal: 'goal-534',
        task: 'steer-setup',
        powers: ['merge'],
        issuedAt: now - 1000,
        expiresAt: now + 60_000,
      },
      request: {
        goal: 'goal-534',
        task: 'steer-setup',
        power: 'merge',
        challenge: 'd'.repeat(32),
        deadlineAt: now + 60_000,
        subjectId: 'github:owner/repo/pull/1',
        subjectDigest: 'a'.repeat(64),
        actionDigest: 'b'.repeat(64),
      },
      verifyEndpoint: () => ({ authenticated: false, reachable: false }),
    })
    expect(deniedReceipt.authorized).toBe(false)
    expect(deniedReceipt.status).toBe('STEERING_AUTHENTICATION_UNVERIFIED')

    const head = 'ab'.repeat(20)
    const merge = evaluateMergeReadiness(
      {
        number: 534,
        state: 'OPEN',
        isDraft: false,
        mergeable: 'MERGEABLE',
        headRefOid: head,
        title: 'confirmed steering agreement',
        humanApproval: confirmed.agreement.steeringOwner,
        steering: confirmed.agreement,
        author: { login: 'builder' },
        reviews: [],
        statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      },
      { repository: 'owner/repo', requireHumanApproval: true },
    )
    expect(merge.ready).toBe(false)
    expect(merge.failedGates.map((gate) => gate.name)).toEqual(
      expect.arrayContaining(['review', 'humanApproval']),
    )
  })

  it('refuses a self-digested plan with grantsPublicationOrMergePower: true or weakened domain human approval', () => {
    const root = tempRoot()
    writeWorkflow(root, readyWorkflow())
    const basePlan = planSteeringAgreement(root)

    // 1. Forge a plan with grantsPublicationOrMergePower: true and recompute its plan digest
    const forgedBoundaryPlan = structuredClone(basePlan)
    delete forgedBoundaryPlan.digest
    forgedBoundaryPlan.after.authorityBoundary.grantsPublicationOrMergePower = true
    const forgedDigest = recordDigest(forgedBoundaryPlan)
    forgedBoundaryPlan.digest = forgedDigest

    expect(() => applySteeringAgreement(root, forgedBoundaryPlan, forgedDigest)).toThrow(
      /must be false|violates authority boundary/,
    )

    // 2. Forge a plan weakening domain human approval to bounded-self-review-with-human-merge
    const forgedReviewPlan = structuredClone(basePlan)
    delete forgedReviewPlan.digest
    forgedReviewPlan.after.reviewAndPublicationAuthority = 'bounded-self-review-with-human-merge'
    const forgedReviewDigest = recordDigest(forgedReviewPlan)
    forgedReviewPlan.digest = forgedReviewDigest

    expect(() => applySteeringAgreement(root, forgedReviewPlan, forgedReviewDigest)).toThrow(
      /confirmedDigest mismatch|conflicts with current project configuration/,
    )

    // 3. Even if on-disk config is manually tampered with grantsPublicationOrMergePower: true, inspect reports conflict and does not reuse it
    const validApplied = applySteeringAgreement(root, basePlan, basePlan.digest)
    expect(validApplied.ok).toBe(true)
    const tamperedDisk = JSON.parse(readFileSync(join(root, 'agent-workflow.config.json'), 'utf8'))
    tamperedDisk.steering.authorityBoundary.grantsPublicationOrMergePower = true
    writeWorkflow(root, tamperedDisk)

    const postTamperInspect = inspectSteeringAgreement(root)
    expect(postTamperInspect.ok).toBe(false)
    expect(postTamperInspect.status).toBe('conflict')
    expect(postTamperInspect.reusedConfirmedAgreement).toBe(false)
    expect(
      postTamperInspect.conflicts.some((c) =>
        /grantsPublicationOrMergePower must be false/.test(c.reason),
      ),
    ).toBe(true)
  })
})
