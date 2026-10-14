import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const DEFAULT_REFINEMENTS_DIR = '.agentflow/refinements'

export const REMEDIATION_TYPES = {
  PROMPT_CONSTRAINT: 'prompt-constraint',
  PERMISSION_POLICY: 'permission-policy',
  PATH_OWNERSHIP: 'path-ownership',
  TURN_LIMIT: 'turn-limit',
}

export const ROOT_CAUSES = {
  MISSING_NEGATIVE_CONSTRAINT: 'missing-negative-constraint',
  AMBIGUOUS_PROMPT_GUIDANCE: 'ambiguous-prompt-guidance',
  LOOSE_PERMISSION_DEFAULT: 'loose-permission-default',
  ERGONOMICS_FRICTION: 'ergonomics-friction',
}

/**
 * Classifies root cause and synthesizes remediation proposal for a violation or metric.
 */
export function analyzeRootCause(item = {}) {
  // If input is an audit violation
  if (item.category) {
    switch (item.category) {
      case 'steering-persona-hallucination':
        return {
          rootCause: ROOT_CAUSES.AMBIGUOUS_PROMPT_GUIDANCE,
          remediationType: REMEDIATION_TYPES.PROMPT_CONSTRAINT,
          targetSubject: 'agents/**/guidance/*.md',
          summary: `Add explicit negative boundary barring ${item.seat} from assuming supervisory steering identity or claiming steer.lead authority.`,
          proposedChange: `### Explicit Negative Boundary\n- You are strictly prohibited from assuming steering personas (orch.steer, steer.lead).\n- Never attempt self-unfreeze or out-of-rig supervisory verbs.`,
        }
      case 'decider-port-bypass':
        return {
          rootCause: ROOT_CAUSES.MISSING_NEGATIVE_CONSTRAINT,
          remediationType: REMEDIATION_TYPES.PERMISSION_POLICY,
          targetSubject: 'policies/*.yaml',
          summary: `Deny supervisory steering CLI commands (scripts/steer.mjs, steer *) from ${item.seat} execution policy.`,
          proposedChange: `deny:\n  - "steer *"\n  - "node scripts/steer.mjs *"`,
        }
      case 'path-ownership-violation':
        return {
          rootCause: ROOT_CAUSES.LOOSE_PERMISSION_DEFAULT,
          remediationType: REMEDIATION_TYPES.PATH_OWNERSHIP,
          targetSubject: 'manifests/path-ownership.json',
          summary: `Enforce path ownership guard preventing ${item.seat} from writing to protected paths.`,
          proposedChange: `Ensure ${item.seat} has defaultDeny: true or explicit deny pattern matching target files.`,
        }
      case 'unauthorized-git-commit':
        return {
          rootCause: ROOT_CAUSES.MISSING_NEGATIVE_CONSTRAINT,
          remediationType: REMEDIATION_TYPES.PROMPT_CONSTRAINT,
          targetSubject: 'agents/**/guidance/*.md',
          summary: `Add strict negative constraint barring ${item.seat} from executing git commit commands.`,
          proposedChange: `### Negative Boundary\n- You are a non-builder seat. NEVER execute git commit, git push, or author code commits.`,
        }
      case 'deprecated-role-reference':
        return {
          rootCause: ROOT_CAUSES.AMBIGUOUS_PROMPT_GUIDANCE,
          remediationType: REMEDIATION_TYPES.PROMPT_CONSTRAINT,
          targetSubject: 'guidance/**.md',
          summary: `Update deprecated role references: replace orch.steer with steer.lead.`,
          proposedChange: `Replace all occurrences of 'orch.steer' with 'steer.lead'.`,
        }
      default:
        break
    }
  }

  // If input is a high rework count or circuit breaker trip
  if (item.reworkCount > 3 || item.circuitBreakerTrips > 0) {
    return {
      rootCause: ROOT_CAUSES.AMBIGUOUS_PROMPT_GUIDANCE,
      remediationType: REMEDIATION_TYPES.TURN_LIMIT,
      targetSubject: 'adapters/openrig/**/rig.yaml',
      summary: `Circuit breaker tripped or high rework (${item.reworkCount}). Lower max rework loop limit to trigger supervisory freeze sooner.`,
      proposedChange: `max_rework_loops: 3\non_rework_exceeded: freeze_and_escalate`,
    }
  }

  // If input is an intake finding (e.g. ergonomics friction)
  if (item.jtbdPushForce) {
    return {
      rootCause: ROOT_CAUSES.ERGONOMICS_FRICTION,
      remediationType: REMEDIATION_TYPES.PROMPT_CONSTRAINT,
      targetSubject: item.targetComponent || 'skills/**/SKILL.md',
      summary: `Remediate empirical dogfood friction: ${typeof item.jtbdPushForce === 'string' ? item.jtbdPushForce.slice(0, 80) : item.jtbdPushForce.struggle}`,
      proposedChange: `Provide clear defaults and explicit feedback for ${item.targetComponent || 'commands'}.`,
    }
  }

  return {
    rootCause: ROOT_CAUSES.AMBIGUOUS_PROMPT_GUIDANCE,
    remediationType: REMEDIATION_TYPES.PROMPT_CONSTRAINT,
    targetSubject: 'general',
    summary: 'Clarify seat boundary and error handling instructions.',
    proposedChange: 'Review execution trace and refine prompt instructions.',
  }
}

/**
 * Synthesizes a collection of audit violations and telemetry observations into actionable proposals.
 */
export function synthesizeRefinementProposals(options = {}) {
  const auditReport = options.auditReport || { violations: [] }
  const telemetry = options.telemetry || {}
  const intakeFindings = options.intakeFindings || []

  const proposals = []
  const seenHashes = new Set()

  // 1. Ingest audit violations
  const violations = auditReport.violations || []
  for (const violation of violations) {
    const analysis = analyzeRootCause(violation)
    const hash = createHash('sha256')
      .update(`${analysis.rootCause}::${analysis.targetSubject}::${analysis.summary}`)
      .digest('hex')

    if (seenHashes.has(hash)) continue
    seenHashes.add(hash)

    const shortId = hash.slice(0, 10)
    proposals.push({
      refinementId: `refinement-${shortId}`,
      createdAt: new Date().toISOString(),
      rootCause: analysis.rootCause,
      remediationType: analysis.remediationType,
      targetSubject: analysis.targetSubject,
      summary: analysis.summary,
      proposedChange: analysis.proposedChange,
      sourceEvidence: {
        type: 'audit-violation',
        category: violation.category,
        seat: violation.seat,
        stepIndex: violation.stepIndex,
        evidence: violation.evidence,
      },
      status: 'draft',
      humanApprovalRequired: true,
    })
  }

  // 2. Ingest telemetry process health
  const health = telemetry.summary?.processHealth
  if (health && (health.circuitBreakerTrips > 0 || health.reworkCount > 2)) {
    const analysis = analyzeRootCause(health)
    const hash = createHash('sha256')
      .update(`${analysis.rootCause}::${analysis.targetSubject}::${analysis.summary}`)
      .digest('hex')

    if (!seenHashes.has(hash)) {
      seenHashes.add(hash)
      proposals.push({
        refinementId: `refinement-${hash.slice(0, 10)}`,
        createdAt: new Date().toISOString(),
        rootCause: analysis.rootCause,
        remediationType: analysis.remediationType,
        targetSubject: analysis.targetSubject,
        summary: analysis.summary,
        proposedChange: analysis.proposedChange,
        sourceEvidence: {
          type: 'telemetry-process-health',
          reworkCount: health.reworkCount,
          circuitBreakerTrips: health.circuitBreakerTrips,
        },
        status: 'draft',
        humanApprovalRequired: true,
      })
    }
  }

  // 3. Ingest intake findings
  for (const finding of intakeFindings) {
    const analysis = analyzeRootCause(finding)
    const hash = createHash('sha256')
      .update(`${analysis.rootCause}::${analysis.targetSubject}::${analysis.summary}`)
      .digest('hex')

    if (!seenHashes.has(hash)) {
      seenHashes.add(hash)
      proposals.push({
        refinementId: `refinement-${hash.slice(0, 10)}`,
        createdAt: new Date().toISOString(),
        rootCause: analysis.rootCause,
        remediationType: analysis.remediationType,
        targetSubject: analysis.targetSubject,
        summary: analysis.summary,
        proposedChange: analysis.proposedChange,
        sourceEvidence: {
          type: 'dogfood-intake-finding',
          findingId: finding.findingId,
          category: finding.category,
          severity: finding.severity,
        },
        status: 'draft',
        humanApprovalRequired: true,
      })
    }
  }

  return proposals
}

/**
 * Packages a proposal into a Markdown draft artifact.
 */
export function formatProposalMarkdown(proposal) {
  return [
    `# Policy & Prompt Refinement Proposal: \`${proposal.refinementId}\``,
    '',
    `> [!IMPORTANT]`,
    `> **Supervisory Approval Required**: This is an autonomous RSI refinement proposal. It must be reviewed and accepted by a human supervisor or \`steer.lead\` before application. In-rig seats are prohibited from self-applying refinements.`,
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| **Refinement ID** | \`${proposal.refinementId}\` |`,
    `| **Created At** | ${proposal.createdAt} |`,
    `| **Root Cause** | \`${proposal.rootCause}\` |`,
    `| **Remediation Type** | \`${proposal.remediationType}\` |`,
    `| **Target Subject** | \`${proposal.targetSubject}\` |`,
    `| **Status** | **${proposal.status.toUpperCase()}** |`,
    `| **Approval Gate** | Human / \`steer.lead\` required |`,
    '',
    `## Problem Summary`,
    proposal.summary,
    '',
    `## Source Evidence`,
    '```json',
    JSON.stringify(proposal.sourceEvidence, null, 2),
    '```',
    '',
    `## Proposed Amendment`,
    '```markdown',
    proposal.proposedChange,
    '```',
    '',
    `## Approval Procedure`,
    `To accept and apply this refinement:`,
    `1. Verify the proposal against current repository policy and active goals.`,
    `2. Apply changes to \`${proposal.targetSubject}\` under a human or supervisory commit identity.`,
    `3. Update proposal status to \`accepted\` in \`.agentflow/refinements/${proposal.refinementId}.md\`.`,
  ].join('\n')
}

/**
 * Saves synthesized refinement proposals as draft artifacts in .agentflow/refinements/
 */
export function saveRefinementArtifacts(proposals = [], options = {}) {
  const targetDir = resolve(options.targetDir || process.cwd())
  const outDir = resolve(targetDir, options.outDir || DEFAULT_REFINEMENTS_DIR)

  mkdirSync(outDir, { recursive: true })
  const savedFiles = []

  for (const p of proposals) {
    const filePath = join(outDir, `${p.refinementId}.md`)
    const mdContent = formatProposalMarkdown(p)
    writeFileSync(filePath, mdContent, 'utf8')

    // Also persist machine-readable JSON representation
    const jsonPath = join(outDir, `${p.refinementId}.json`)
    writeFileSync(jsonPath, JSON.stringify(p, null, 2), 'utf8')

    savedFiles.push({
      refinementId: p.refinementId,
      markdownPath: filePath,
      jsonPath,
    })
  }

  return savedFiles
}

/**
 * Safety Invariant Verification: Verifies whether an application attempt is authorized.
 * Fails closed if human/steer approval is absent.
 */
export function verifyRefinementApplicationAuthorization(proposal, approval = {}) {
  if (!proposal || proposal.humanApprovalRequired !== true) {
    return {
      authorized: false,
      reason: 'Invalid proposal or missing humanApprovalRequired invariant',
    }
  }

  const approverRole = approval.role || approval.seat || ''
  const isAuthorizedApprover =
    approval.isHuman === true || approverRole === 'steer.lead' || approverRole === 'steer-lead'

  if (!isAuthorizedApprover) {
    return {
      authorized: false,
      reason: `Unauthorized application attempt: seat '${approverRole}' cannot approve policy refinements. Must be human or steer.lead.`,
    }
  }

  if (!approval.signature || !approval.timestamp) {
    return {
      authorized: false,
      reason: 'Approval signature and timestamp are required to apply refinement',
    }
  }

  return {
    authorized: true,
    approvedBy: approverRole || 'human',
  }
}
