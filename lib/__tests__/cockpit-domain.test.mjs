import { describe, expect, it } from 'vitest'
import {
  classifyIssue,
  createCockpitProject,
  derivePhaseState,
  missingRolePassFieldsFor,
} from '../cockpit-domain.mjs'
import {
  classifyCommentLane,
  extractAgentFlowIssueSections,
  groupCommentsByLane,
} from '../cockpit-markdown.mjs'
import { authorizeCockpitUser, createAuthPolicy, validateAllowedOrigin } from '../cockpit-auth.mjs'
import {
  evaluateGuardedAction,
  formatDurableActionBody,
  parseCockpitIntent,
} from '../cockpit-actions.mjs'

describe('cockpit domain', () => {
  it('creates github-backed project without local checkout requirement', () => {
    expect(
      createCockpitProject({ repo: 'https://github.com/smota/agentflow-sdlc.git' }),
    ).toMatchObject({
      id: 'smota/agentflow-sdlc',
      durableTruth: 'github',
      localTelemetry: 'optional',
    })
  })

  it('classifies AgentFlow-managed epic issues', () => {
    expect(
      classifyIssue({
        labels: ['epic', 'drafted-by:pi'],
        body: '## Feature Tracking\n- [ ] #120',
      }),
    ).toMatchObject({ isEpic: true, isAgentFlowManaged: true })
  })

  it('derives next safe action from evidence and review state', () => {
    expect(derivePhaseState({ rolePasses: [{ phase: '5', role: 'tester' }] }).nextSafeAction).toBe(
      'complete-role-pass-evidence',
    )
    expect(
      derivePhaseState({
        rolePasses: [completeRolePass()],
        validations: [{ status: 'failed' }],
      }).nextSafeAction,
    ).toBe('return-to-developer')
    expect(
      derivePhaseState({
        rolePasses: [completeRolePass()],
        validations: [{ status: 'passed' }],
        reviewFindings: [{ severity: 'blocker' }],
      }).nextSafeAction,
    ).toBe('resolve-review-findings')
  })

  it('checks required role-pass fields', () => {
    expect(missingRolePassFieldsFor(completeRolePass())).toEqual([])
  })
})

describe('cockpit markdown mapping', () => {
  it('extracts canonical issue sections', () => {
    const sections = extractAgentFlowIssueSections(
      '## Requirements\n- one\n\n## Test plan\n- run tests',
    )
    expect(sections.Requirements).toContain('- one')
    expect(sections['Test plan']).toContain('run tests')
  })

  it('groups workflow comments into AgentFlow lanes', () => {
    const grouped = groupCommentsByLane([
      { body: '<!-- agent-handover -->\nnext role' },
      { body: '<!-- agentflow:validation-summary -->\npassed' },
    ])
    expect(grouped.Handover).toHaveLength(1)
    expect(grouped.Validation).toHaveLength(1)
    expect(classifyCommentLane({ body: 'Decision: keep GitHub truth' })).toBe('Decisions')
  })
})

describe('cockpit auth and guarded actions', () => {
  it('enforces GitHub allowlist and repo permission', () => {
    const policy = createAuthPolicy({
      allowedUsers: ['samue'],
      repositories: ['smota/agentflow-sdlc'],
    })
    expect(
      authorizeCockpitUser({
        user: { login: 'samue' },
        repo: 'smota/agentflow-sdlc',
        repoPermission: 'read',
        policy,
      }).ok,
    ).toBe(true)
    expect(
      authorizeCockpitUser({
        user: { login: 'other' },
        repo: 'smota/agentflow-sdlc',
        repoPermission: 'read',
        policy,
      }).reasons,
    ).toContain('user-not-allowed')
  })

  it('validates allowed origins', () => {
    expect(
      validateAllowedOrigin({
        origin: 'https://cockpit.example.com',
        publicUrl: 'https://cockpit.example.com/',
      }),
    ).toBe(true)
    expect(
      validateAllowedOrigin({
        origin: 'https://evil.example.com',
        publicUrl: 'https://cockpit.example.com',
      }),
    ).toBe(false)
  })

  it('blocks remote gate bypass and requires confirmations', () => {
    expect(
      evaluateGuardedAction({ action: 'merge-pr', userRole: 'admin', confirmation: true }).reasons,
    ).toContain('forbidden-by-policy')
    expect(
      evaluateGuardedAction({ action: 'post-handover', userRole: 'operator' }).reasons,
    ).toContain('confirmation-required')
    expect(parseCockpitIntent({ type: 'draft-follow-up', issue: 123 })).toMatchObject({
      ok: true,
      intent: { requiresDurableEvidence: true },
    })
    expect(formatDurableActionBody({ type: 'post-handover', body: 'Next: review' })).toContain(
      '<!-- agent-handover -->',
    )
  })
})

function completeRolePass() {
  return {
    phase: '5',
    role: 'tester',
    read: ['AGENTS.md'],
    decisions: ['run validation'],
    uncertainties: ['none'],
    nextRoleContract: 'review findings',
  }
}
