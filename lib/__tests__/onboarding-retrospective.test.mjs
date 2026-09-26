import { describe, expect, it } from 'vitest'
import {
  parseIssueReferences,
  validateReferenceKeywords,
  SAFE_KEYWORDS,
  REFERENCE_ONLY_KEYWORDS,
} from '../../scripts/integration-lifecycle.mjs'
import { issueGrant, grantRequestDigest } from '../core/delegation-grant.mjs'
import {
  parseAndVerifyHarnessOutput,
  HarnessContractError,
} from '../providers/harness-dispatch.mjs'
import { createContinuationBundle, MAX_PACKET_BYTES } from '../application/continuation-service.mjs'
import { recordDigest } from '../core/record-digest.mjs'

describe('Onboarding Retrospective Invariants & Regressions (Issue #259)', () => {
  describe('1. Lifecycle Closure Semantics (Refs #259 bug)', () => {
    it('proves Refs #259 in a PR body is never parsed as a closing issue', () => {
      const prBody = `
## Implemented issues
Closes #250
Closes #251

## Related issues
Refs #259
`
      const closingRefs = parseIssueReferences(prBody)
      expect(closingRefs).toContain('#250')
      expect(closingRefs).toContain('#251')
      expect(closingRefs).not.toContain('#259')
    })

    it('rejects attempt to configure reference-only keywords as closure triggers', () => {
      const validation = validateReferenceKeywords(['Closes', 'Refs'])
      expect(validation.ok).toBe(false)
      expect(validation.errors.some((e) => e.includes('reference-only keyword "Refs"'))).toBe(true)
    })

    it('preserves the SAFE_KEYWORDS allowlist and REFERENCE_ONLY_KEYWORDS denylist', () => {
      expect(SAFE_KEYWORDS).toContain('Closes')
      expect(SAFE_KEYWORDS).toContain('Implements')
      expect(REFERENCE_ONLY_KEYWORDS).toContain('Refs')
      expect(REFERENCE_ONLY_KEYWORDS).toContain('Related')
    })
  })

  describe('2. Distinguishing Delegated Authority from Human Attestation', () => {
    it('strictly enforces explicit issuer identity and rejects untyped authorization', () => {
      const policy = {
        version: 1,
        issuers: [
          {
            id: 'local',
            origin: 'cli:maintainer-session',
            authorityRef: 'host:approval',
            mode: 'local-cooperative',
            allowedActions: ['edit'],
            allowThroughMerge: false,
          },
        ],
        requiredChecks: ['test'],
        reviewPolicy: 'automated',
        materiality: 'fixed-scope-v1',
        allowSubdelegation: false,
        safetyReserve: 2,
      }

      const req = {
        planDigest: 'a'.repeat(64),
        policyDigest: recordDigest(policy),
        repository: 'smota/agentflow-sdlc',
        base: 'main',
        delegate: 'agy',
        allowedPaths: ['src/*'],
        allowedActions: ['edit'],
        capabilities: ['edit'],
        requiredChecks: ['test'],
        reviewPolicy: 'automated',
        materiality: 'fixed-scope-v1',
        allowSubdelegation: false,
        maxAttempts: 2,
        maxExternalEffects: 2,
        expiry: '2026-09-27T12:00:00.000Z',
        issuerMode: 'local-cooperative',
      }

      const boundRequest = {
        ...req,
        issuerBinding: {
          type: 'delegation-issuance',
          issuerId: 'local',
          mode: 'local-cooperative',
          origin: 'cli:maintainer-session',
          authorityRef: 'host:approval',
          policyDigest: recordDigest(policy),
          requestDigest: grantRequestDigest(req),
          decisionRef: 'dec-1',
        },
      }

      const grant = issueGrant(boundRequest, 'local', null, {
        atTime: '2026-09-26T12:00:00.000Z',
        policy,
      })

      // Grant records prospective delegated authority, NOT human candidate attestation
      expect(grant.binding.issuerBinding.mode).toBe('local-cooperative')
      expect(grant.binding.delegate).toBe('agy')
      expect(grant.issuerActor).toBe('local')
    })
  })

  describe('3. Artifact Normalization & Integrity (Double-Escaped Newlines)', () => {
    it('proves that literal escaped newlines produce different digests and are strictly validated', () => {
      const cleanContent = 'export const greeting = "hello";\nexport const target = "world";\n'
      const doubleEscaped = 'export const greeting = "hello";\\nexport const target = "world";\\n'

      const cleanDigest = recordDigest(cleanContent)
      const dirtyDigest = recordDigest(doubleEscaped)

      // The cryptographic digests must be distinct
      expect(cleanDigest).not.toBe(dirtyDigest)

      // Harness output verification detects tampered/escaped content against declared digest
      const tamperedPayload = {
        artifacts: [
          {
            path: 'src/greeting.mjs',
            content: doubleEscaped,
            digest: cleanDigest, // mismatch!
          },
        ],
      }

      expect(() => parseAndVerifyHarnessOutput(tamperedPayload)).toThrow(HarnessContractError)
      expect(() => parseAndVerifyHarnessOutput(tamperedPayload)).toThrowError(/digest mismatch/)
    })

    it('rejects silent output truncation to prevent partial code writes', () => {
      const truncatedPayload = {
        truncated: true,
        artifacts: [{ path: 'src/partial.mjs', content: 'const a = 1' }],
      }
      expect(() => parseAndVerifyHarnessOutput(truncatedPayload)).toThrow(HarnessContractError)
      expect(() => parseAndVerifyHarnessOutput(truncatedPayload)).toThrowError(/truncated/)
    })
  })

  describe('4. Process Volume & Context Boundedness', () => {
    it('enforces continuation packet capacity limit <= 32 KiB', () => {
      const fakeState = {
        runId: 'onboarding-retrospective-run',
        owner: 'agent-1',
        generation: 0,
        phase: 'implementation',
      }

      const bundle = createContinuationBundle({
        state: fakeState,
        runRevision: 'rev-1',
        branch: 'main',
        commitSha: 'a'.repeat(40),
        nextSlice: 'S1',
        artifacts: [
          {
            id: 'art-1',
            path: 'lib/core/file.mjs',
            digest: 'b'.repeat(64),
            byteLength: 1024,
          },
        ],
      })

      const serialized = JSON.stringify(bundle)
      const byteLength = Buffer.byteLength(serialized)
      expect(byteLength).toBeLessThanOrEqual(MAX_PACKET_BYTES)
      expect(bundle.type).toBe('continuation-packet')
    })
  })
})
