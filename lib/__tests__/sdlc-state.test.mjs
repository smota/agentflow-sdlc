import { describe, expect, it } from 'vitest'
import {
  parseEnvelope,
  readinessDenominatorForPath,
  releaseAssignmentState,
  releaseCandidateFromIssue,
  selectedPathFromIssue,
  validateIssueAgainstSdlc,
  validateNoForbiddenEvidenceText,
  validateSdlcConfigShape,
} from '../sdlc-state.mjs'

const config = {
  version: 1,
  authority: {
    human: 'docs/sdlc-definition.md',
    machine: 'sdlc.config.json',
    executionAdapter: 'agent-workflow.config.json',
  },
  roles: [
    { phase: 0, slug: 'analyst', label: 'Analyst', owns: [] },
    { phase: 1, slug: 'developer', label: 'Developer', owns: [] },
    { phase: 2, slug: 'review', label: 'Review', owns: [] },
  ],
  paths: {
    standard: {
      requiredRoles: ['analyst', 'developer', 'review'],
      optionalRoles: [],
      allowsSelfReview: true,
      requiresHumanApproval: false,
    },
    'high-assurance': {
      requiredRoles: ['analyst', 'developer', 'review'],
      optionalRoles: [],
      allowsSelfReview: false,
      requiresHumanApproval: true,
    },
  },
  transitions: [['analyst', 'developer']],
  labels: { type: ['feature'], forbiddenPrefixes: ['agent:'] },
  release: {},
  gateways: {},
  extensionPolicy: {},
}

describe('sdlc-state', () => {
  it('validates config invariants', () => {
    expect(validateSdlcConfigShape(config).ok).toBe(true)
    expect(
      validateSdlcConfigShape({
        ...config,
        paths: { 'high-assurance': { ...config.paths['high-assurance'], allowsSelfReview: true } },
      }).ok,
    ).toBe(false)
    expect(
      validateSdlcConfigShape({
        ...config,
        vocabulary: { rolePassStatuses: ['pass', 'blocked'] },
        actionPolicy: { externalActionRequiresHumanApproval: true },
      }).ok,
    ).toBe(true)
    expect(
      validateSdlcConfigShape({
        ...config,
        actionPolicy: { delegationMayNotWidenBoundary: false },
      }).ok,
    ).toBe(false)
  })

  it('does not infer incidental semver as release candidate', () => {
    expect(releaseCandidateFromIssue({ body: 'Tests ran with package v2.1.9' })).toBeNull()
    expect(releaseCandidateFromIssue({ body: 'Target release: v1.2.3' })).toBe('v1.2.3')
  })

  it('derives release assignment state', () => {
    expect(releaseAssignmentState({ body: 'feature', labels: ['feature'], state: 'open' })).toBe(
      'needs-assignment',
    )
    expect(
      releaseAssignmentState({ body: 'Release: v1.0.0', labels: ['feature'], state: 'open' }),
    ).toBe('assigned')
    expect(releaseAssignmentState({ body: 'no release impact', labels: [], state: 'open' })).toBe(
      'no-release-impact',
    )
  })

  it('selects paths and readiness denominators', () => {
    expect(selectedPathFromIssue({ body: 'auth security', labels: [] }, config)).toBe(
      'high-assurance',
    )
    expect([...readinessDenominatorForPath('standard', config)]).toEqual([
      'analyst',
      'developer',
      'review',
    ])
  })

  it('parses role-pass envelope', () => {
    const entries = parseEnvelope(
      '<!-- [AGENTFLOW-ROLE-PASS-v1] -->\n```json\n{"role":"developer"}\n```\n<!-- [/AGENTFLOW-ROLE-PASS-v1] -->',
    )
    expect(entries).toEqual([{ role: 'developer' }])
  })

  it('validates issues and forbidden evidence', () => {
    expect(
      validateIssueAgainstSdlc(
        { body: '## Acceptance criteria\n- [ ] x', labels: ['feature'] },
        config,
      ).ok,
    ).toBe(true)
    expect(validateIssueAgainstSdlc({ body: '', labels: ['agent:claude'] }, config).ok).toBe(false)
    expect(validateNoForbiddenEvidenceText('api_key=secret').ok).toBe(false)
  })
})
