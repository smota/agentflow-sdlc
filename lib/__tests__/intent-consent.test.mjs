import { describe, expect, it } from 'vitest'
import {
  createHostIntentConsent,
  createIntentConsentRequest,
  verifyHostIntentConsent,
} from '../core/intent-consent.mjs'
import { sealDeliveryRecord } from '../core/delivery-record.mjs'

const state = {
  phase: 0,
  runId: 'run',
  revision: 'a'.repeat(64),
  generation: 0,
  goalRef: 'issue:301',
  contractSourceRevision: 'source:1',
  profile: 'standard',
  contract: { goalRevision: 'goal:1', criteria: [{ id: 'check' }] },
}
const scope = {
  repository: 'test/repo',
  coordinationBranch: 'agentflow-state',
  businessBoundary: 'open-pr',
  destinations: ['ready-pr'],
  checks: [{ name: 'test', digest: 'b'.repeat(64) }],
  expiry: { effectGrant: 'separate-typed-grant-required' },
  budget: null,
  assurance: 'agent-observed-local-cooperative',
}
const consent = (request, fields = {}) =>
  createHostIntentConsent({
    request,
    decision: 'agree',
    observerRuntime: 'codex',
    sessionDigest: '1'.repeat(64),
    turnDigest: '2'.repeat(64),
    evidenceDigest: '3'.repeat(64),
    decisionRef: '4'.repeat(64),
    observedAt: '2026-09-28T00:00:00.000Z',
    expiresAt: '2026-09-29T00:00:00.000Z',
    ...fields,
  })

describe('agent-observed phase-zero intent consent', () => {
  it('binds the exact frozen goal, revision, scope, acceptance and opaque evidence', () => {
    const request = createIntentConsentRequest({ state, planDigest: 'c'.repeat(64), scope })
    const decision = consent(request)
    expect(verifyHostIntentConsent(request, decision, '2026-09-28T12:00:00.000Z')).toEqual(decision)
    expect(JSON.stringify(decision)).not.toContain('issue:301')
    for (const changed of [
      { ...state, revision: 'd'.repeat(64) },
      { ...state, contract: { ...state.contract, goalRevision: 'goal:2' } },
    ]) {
      const next = createIntentConsentRequest({ state: changed, planDigest: 'c'.repeat(64), scope })
      expect(() => verifyHostIntentConsent(next, decision, '2026-09-28T12:00:00.000Z')).toThrow()
    }
    const otherScope = createIntentConsentRequest({
      state,
      planDigest: 'c'.repeat(64),
      scope: { ...scope, destinations: ['named-merge'] },
    })
    expect(() =>
      verifyHostIntentConsent(otherScope, decision, '2026-09-28T12:00:00.000Z'),
    ).toThrow()
  })
  it('rejects wrong gate, expiry and unbounded or raw provenance', () => {
    const request = createIntentConsentRequest({ state, planDigest: 'c'.repeat(64), scope })
    const { digest: _digest, ...decisionFields } = consent(request)
    for (const wrong of [
      sealDeliveryRecord('host-intent-consent', {
        ...decisionFields,
        gateClass: 'release-of-candidate',
      }),
      consent(request, { decision: 'blocked' }),
      consent(request, { sessionDigest: 'private-thread-id' }),
      consent(request, { expiresAt: '2026-09-28T00:00:00.000Z' }),
      consent(request, { observerRuntime: 'human' }),
    ])
      expect(() => verifyHostIntentConsent(request, wrong, '2026-09-28T12:00:00.000Z')).toThrow()
    expect(() =>
      createIntentConsentRequest({
        state,
        planDigest: 'c'.repeat(64),
        scope: { ...scope, checks: [] },
      }),
    ).toThrow()
  })
  it('accepts registered project observer runtimes without treating them as human authentication', () => {
    const request = createIntentConsentRequest({
      state,
      planDigest: 'c'.repeat(64),
      scope,
      platformConfig: {
        platformRegistry: {
          additionalPlatforms: [
            {
              slug: 'future-runtime',
              displayName: 'Future Runtime',
              kind: 'agent-runtime',
              routable: false,
            },
          ],
        },
      },
    })
    expect(request.observerRuntimes).toContain('grok')
    expect(request.observerRuntimes).toContain('future-runtime')
    expect(request.observerRuntimes).not.toContain('human')
    const decision = consent(request, { observerRuntime: 'future-runtime' })
    expect(verifyHostIntentConsent(request, decision, '2026-09-28T12:00:00.000Z')).toEqual(decision)
  })
})
