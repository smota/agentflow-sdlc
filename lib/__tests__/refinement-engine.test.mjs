import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  REMEDIATION_TYPES,
  ROOT_CAUSES,
  analyzeRootCause,
  formatProposalMarkdown,
  saveRefinementArtifacts,
  synthesizeRefinementProposals,
  verifyRefinementApplicationAuthorization,
} from '../refinement-engine.mjs'
import { runSynthesizeRefinements } from '../../scripts/telemetry/synthesize-refinements.mjs'

describe('lib/core/refinement-engine (Issue #490)', () => {
  let tempDir

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `refinement-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    )
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('analyzeRootCause', () => {
    it('maps steering persona hallucinations to prompt constraints', () => {
      const result = analyzeRootCause({
        category: 'steering-persona-hallucination',
        seat: 'dev.build',
      })
      expect(result.rootCause).toBe(ROOT_CAUSES.AMBIGUOUS_PROMPT_GUIDANCE)
      expect(result.remediationType).toBe(REMEDIATION_TYPES.PROMPT_CONSTRAINT)
      expect(result.proposedChange).toContain('prohibited from assuming steering personas')
    })

    it('maps decider port bypass attempts to permission policy denies', () => {
      const result = analyzeRootCause({
        category: 'decider-port-bypass',
        seat: 'orch.arch',
      })
      expect(result.rootCause).toBe(ROOT_CAUSES.MISSING_NEGATIVE_CONSTRAINT)
      expect(result.remediationType).toBe(REMEDIATION_TYPES.PERMISSION_POLICY)
      expect(result.proposedChange).toContain('deny:')
      expect(result.proposedChange).toContain('steer *')
    })

    it('maps path ownership violations to path-ownership guard updates', () => {
      const result = analyzeRootCause({
        category: 'path-ownership-violation',
        seat: 'pm.manager',
      })
      expect(result.rootCause).toBe(ROOT_CAUSES.LOOSE_PERMISSION_DEFAULT)
      expect(result.remediationType).toBe(REMEDIATION_TYPES.PATH_OWNERSHIP)
      expect(result.targetSubject).toBe('manifests/path-ownership.json')
    })

    it('maps circuit breaker trips to turn limits', () => {
      const result = analyzeRootCause({
        circuitBreakerTrips: 1,
        reworkCount: 5,
      })
      expect(result.remediationType).toBe(REMEDIATION_TYPES.TURN_LIMIT)
      expect(result.proposedChange).toContain('max_rework_loops')
    })
  })

  describe('synthesizeRefinementProposals', () => {
    it('synthesizes deduplicated proposals across audit violations and telemetry health', () => {
      const mockAuditReport = {
        violations: [
          {
            category: 'decider-port-bypass',
            seat: 'dev.build',
            stepIndex: 3,
            evidence: 'steer unfreeze',
          },
          {
            category: 'decider-port-bypass',
            seat: 'dev.build',
            stepIndex: 5,
            evidence: 'steer unfreeze (repeated)',
          },
          {
            category: 'steering-persona-hallucination',
            seat: 'orch.arch',
            stepIndex: 8,
            evidence: 'acting as orch.steer',
          },
        ],
      }

      const mockTelemetry = {
        summary: {
          processHealth: {
            circuitBreakerTrips: 1,
            reworkCount: 4,
          },
        },
      }

      const mockIntakeFindings = [
        {
          findingId: 'finding-001',
          category: 'ergonomics-friction',
          targetComponent: 'steer-cli',
          jtbdPushForce: 'Supervisors need clearer error messages on unknown flags',
        },
      ]

      const proposals = synthesizeRefinementProposals({
        auditReport: mockAuditReport,
        telemetry: mockTelemetry,
        intakeFindings: mockIntakeFindings,
      })

      // decider-port-bypass (deduped to 1) + steering persona (1) + telemetry health (1) + intake finding (1) = 4
      expect(proposals).toHaveLength(4)
      for (const p of proposals) {
        expect(p.status).toBe('draft')
        expect(p.humanApprovalRequired).toBe(true)
        expect(p.refinementId).toMatch(/^refinement-[a-f0-9]{10}$/)
      }
    })
  })

  describe('formatProposalMarkdown and saveRefinementArtifacts', () => {
    it('formats proposal markdown with governance warnings and persists artifacts', () => {
      const proposal = {
        refinementId: 'refinement-test1234',
        createdAt: new Date().toISOString(),
        rootCause: ROOT_CAUSES.MISSING_NEGATIVE_CONSTRAINT,
        remediationType: REMEDIATION_TYPES.PERMISSION_POLICY,
        targetSubject: 'policies/dev.yaml',
        summary: 'Deny supervisory commands to prevent inner delivery bypass',
        proposedChange: 'deny:\n  - "steer *"',
        sourceEvidence: { type: 'audit-violation', seat: 'dev.build' },
        status: 'draft',
        humanApprovalRequired: true,
      }

      const md = formatProposalMarkdown(proposal)
      expect(md).toContain('# Policy & Prompt Refinement Proposal: `refinement-test1234`')
      expect(md).toContain('Supervisory Approval Required')
      expect(md).toContain('Human / `steer.lead` required')
      expect(md).toContain('policies/dev.yaml')

      const saved = saveRefinementArtifacts([proposal], {
        targetDir: tempDir,
        outDir: 'refinements',
      })

      expect(saved).toHaveLength(1)
      expect(existsSync(saved[0].markdownPath)).toBe(true)
      expect(existsSync(saved[0].jsonPath)).toBe(true)

      const jsonContent = JSON.parse(readFileSync(saved[0].jsonPath, 'utf8'))
      expect(jsonContent.refinementId).toBe('refinement-test1234')
    })
  })

  describe('safety invariants: verifyRefinementApplicationAuthorization', () => {
    const proposal = {
      refinementId: 'refinement-safe1',
      humanApprovalRequired: true,
      status: 'draft',
    }

    it('rejects approval attempts from in-rig seats', () => {
      const inRigAttempts = ['dev.build', 'orch.arch', 'dev.qa', 'pm.manager']
      for (const seat of inRigAttempts) {
        const check = verifyRefinementApplicationAuthorization(proposal, {
          seat,
          signature: 'sig-123',
          timestamp: new Date().toISOString(),
        })
        expect(check.authorized).toBe(false)
        expect(check.reason).toContain('cannot approve policy refinements')
      }
    })

    it('rejects approval attempts missing signature or timestamp', () => {
      const check = verifyRefinementApplicationAuthorization(proposal, {
        seat: 'steer.lead',
      })
      expect(check.authorized).toBe(false)
      expect(check.reason).toContain('Approval signature and timestamp are required')
    })

    it('authorizes application when signed by steer.lead or human', () => {
      const steerCheck = verifyRefinementApplicationAuthorization(proposal, {
        seat: 'steer.lead',
        signature: 'sha256-signature-abc',
        timestamp: new Date().toISOString(),
      })
      expect(steerCheck.authorized).toBe(true)
      expect(steerCheck.approvedBy).toBe('steer.lead')

      const humanCheck = verifyRefinementApplicationAuthorization(proposal, {
        isHuman: true,
        signature: 'human-approval-token',
        timestamp: new Date().toISOString(),
      })
      expect(humanCheck.authorized).toBe(true)
    })
  })

  describe('CLI runner (scripts/telemetry/synthesize-refinements.mjs)', () => {
    it('shows usage on --help', async () => {
      let stdout = ''
      const origWrite = process.stdout.write
      process.stdout.write = (chunk) => {
        stdout += chunk
        return true
      }
      try {
        const code = await runSynthesizeRefinements(['--help'])
        expect(code).toBe(0)
        expect(stdout).toContain('Usage: node scripts/telemetry/synthesize-refinements.mjs')
      } finally {
        process.stdout.write = origWrite
      }
    })

    it('synthesizes proposals from audit file via CLI and emits JSON', async () => {
      const auditFile = join(tempDir, 'audit-report.json')
      writeFileSync(
        auditFile,
        JSON.stringify({
          violations: [
            {
              category: 'steering-persona-hallucination',
              seat: 'dev.build',
              stepIndex: 1,
              evidence: 'acting as supervisory lead',
            },
          ],
        }),
      )

      let stdout = ''
      const origWrite = process.stdout.write
      process.stdout.write = (chunk) => {
        stdout += chunk
        return true
      }
      try {
        const code = await runSynthesizeRefinements([
          '--audit',
          auditFile,
          '--target',
          tempDir,
          '--out-dir',
          'cli-refinements',
          '--json',
        ])
        expect(code).toBe(0)
        const parsed = JSON.parse(stdout)
        expect(parsed.ok).toBe(true)
        expect(parsed.proposalsCount).toBe(1)
        expect(existsSync(join(tempDir, 'cli-refinements'))).toBe(true)
      } finally {
        process.stdout.write = origWrite
      }
    })
  })
})
