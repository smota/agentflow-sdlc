import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  createResolutionLedger,
  createReviewTargetIdentity,
  computeTargetIdentityDigest,
} from '../core/sparring.mjs'
import { applyReviewRound, evaluateSparringGate } from '../sparring-gate.mjs'

const sha256 = (content) => createHash('sha256').update(content).digest('hex')

describe('Sparring Gate & Resolution Ledger (Codex Adversarial Scenarios)', () => {
  const baseIdentity = createReviewTargetIdentity({
    workItemId: 'ISSUE-100',
    cycle: 'C-03',
    contractDigest: sha256('contract v1 text'),
    sliceManifestDigest: sha256('slice manifest text'),
    policyDigest: sha256('policy text'),
  })

  const baseReceipt = {
    round: 1,
    cycle: 'C-03',
    targetIdentityDigest: computeTargetIdentityDigest(baseIdentity),
    fencingToken: 1,
    reviewer: {
      platform: 'claude',
      executor: 'claude-cli',
      model: 'claude-opus-5',
    },
    delegationTopology: 'cli-process',
    independenceClassification: 'independent',
    disposition: 'changes-required',
    findings: [
      {
        id: 'B-1',
        severity: 'blocker',
        citation: 'src/ecosystem.mjs:100',
        description: 'Privacy oracle leak',
        status: 'open',
      },
    ],
  }

  it('Scenario 1 (Codex B2): expired writer returns after replacement commits -> stale write rejected', () => {
    let ledger = createResolutionLedger({ targetIdentity: baseIdentity })
    ledger = applyReviewRound({
      ledger,
      receipt: baseReceipt,
      currentTargetIdentity: baseIdentity,
    })
    expect(ledger.fencingToken).toBe(1)

    // Replacement commits round 2 with fencing token 2
    const round2Receipt = {
      ...baseReceipt,
      round: 2,
      fencingToken: 2,
      findings: [
        {
          id: 'B-1',
          severity: 'blocker',
          citation: 'src/ecosystem.mjs:100',
          description: 'Privacy oracle leak',
          status: 'verified_closed',
        },
      ],
      disposition: 'approved',
    }
    ledger = applyReviewRound({
      ledger,
      receipt: round2Receipt,
      currentTargetIdentity: baseIdentity,
      resolutionEvidences: { 'B-1': 'fixed in commit abc123' },
    })
    expect(ledger.fencingToken).toBe(2)

    // Stale writer attempts to commit with fencing token 1
    const staleReceipt = {
      ...baseReceipt,
      round: 1,
      fencingToken: 1,
    }
    expect(() =>
      applyReviewRound({
        ledger,
        receipt: staleReceipt,
        currentTargetIdentity: baseIdentity,
      }),
    ).toThrow(/FENCING_TOKEN_STALE/)
  })

  it('Scenario 2 (Codex B2): CAS revision mismatch is rejected', () => {
    let ledger = createResolutionLedger({ targetIdentity: baseIdentity })
    ledger = applyReviewRound({
      ledger,
      receipt: baseReceipt,
      currentTargetIdentity: baseIdentity,
    })

    const round2Receipt = {
      ...baseReceipt,
      round: 2,
      fencingToken: 2,
    }

    // Pass an outdated expectedLedgerRevision
    expect(() =>
      applyReviewRound({
        ledger,
        receipt: round2Receipt,
        currentTargetIdentity: baseIdentity,
        expectedLedgerRevision: 'outdated-hash-1234567890abcdef',
      }),
    ).toThrow(/CAS_REVISION_MISMATCH/)
  })

  it('Scenario 3 (Codex B1): contract or policy changes after approval -> gate locked (target stale)', () => {
    let ledger = createResolutionLedger({ targetIdentity: baseIdentity })
    const approvingReceipt = {
      ...baseReceipt,
      disposition: 'approved',
      findings: [],
    }
    ledger = applyReviewRound({
      ledger,
      receipt: approvingReceipt,
      currentTargetIdentity: baseIdentity,
    })
    expect(ledger.status).toBe('approved')

    // Evaluate against matching target -> unlocked
    const passEval = evaluateSparringGate({
      targetIdentity: baseIdentity,
      ledger,
    })
    expect(passEval.unlocked).toBe(true)

    // Contract changes in working tree -> new digest
    const alteredIdentity = {
      ...baseIdentity,
      contractDigest: sha256('contract v2 modified text'),
    }
    const failEval = evaluateSparringGate({
      targetIdentity: alteredIdentity,
      ledger,
    })
    expect(failEval.unlocked).toBe(false)
    expect(failEval.errors.some((e) => e.includes('TARGET_STALE'))).toBe(true)
  })

  it('Scenario 4 (Codex B3): reviewer cannot self-waive a blocker', () => {
    let ledger = createResolutionLedger({ targetIdentity: baseIdentity })

    // Receipt has open blocker
    ledger = applyReviewRound({
      ledger,
      receipt: baseReceipt,
      currentTargetIdentity: baseIdentity,
    })
    expect(ledger.findingsLedger['B-1'].status).toBe('open')

    // If receipt claims verified_closed WITHOUT resolution evidence, it stays open
    const sneakyReceipt = {
      ...baseReceipt,
      round: 2,
      fencingToken: 2,
      disposition: 'approved',
      findings: [
        {
          id: 'B-1',
          severity: 'blocker',
          citation: 'src/ecosystem.mjs:100',
          description: 'Privacy oracle leak',
          status: 'verified_closed',
        },
      ],
    }
    ledger = applyReviewRound({
      ledger,
      receipt: sneakyReceipt,
      currentTargetIdentity: baseIdentity,
      resolutionEvidences: {}, // No evidence supplied
    })
    expect(ledger.findingsLedger['B-1'].status).toBe('open')
    expect(ledger.status).toBe('open') // Cannot be approved while blocker is open

    // Only with valid author resolution evidence does it resolve
    ledger = applyReviewRound({
      ledger,
      receipt: { ...sneakyReceipt, fencingToken: 3, round: 3 },
      currentTargetIdentity: baseIdentity,
      resolutionEvidences: { 'B-1': 'mitigated in commit def456' },
    })
    expect(ledger.findingsLedger['B-1'].status).toBe('resolved')
    expect(ledger.status).toBe('approved')
  })

  it('Scenario 5 (Codex B5): Mode B degraded review requires human decision under high-assurance', () => {
    let ledger = createResolutionLedger({ targetIdentity: baseIdentity })
    const innerAgentReceipt = {
      ...baseReceipt,
      reviewer: {
        platform: 'agy',
        executor: 'agy-subagent',
        model: 'gemini-3.1-pro',
      },
      delegationTopology: 'child-subagent',
      independenceClassification: 'same-harness-child', // Degraded assurance
      disposition: 'approved',
      findings: [],
    }
    ledger = applyReviewRound({
      ledger,
      receipt: innerAgentReceipt,
      currentTargetIdentity: baseIdentity,
    })
    expect(ledger.status).toBe('approved')

    // Under standard profile: unlocked with audit warning
    const standardEval = evaluateSparringGate({
      targetIdentity: baseIdentity,
      ledger,
      profile: 'standard',
    })
    expect(standardEval.unlocked).toBe(true)
    expect(standardEval.warnings.length).toBeGreaterThan(0)

    // Under high-assurance profile: blocked without human decision
    const highAssuranceFail = evaluateSparringGate({
      targetIdentity: baseIdentity,
      ledger,
      profile: 'high-assurance',
    })
    expect(highAssuranceFail.unlocked).toBe(false)
    expect(
      highAssuranceFail.errors.some((e) => e.includes('HIGH_ASSURANCE_INDEPENDENCE_REQUIRED')),
    ).toBe(true)

    // High-assurance passes when human decision covers the exact target
    const highAssurancePass = evaluateSparringGate({
      targetIdentity: baseIdentity,
      ledger,
      profile: 'high-assurance',
      humanDecision: {
        status: 'accepted',
        targetIdentityDigest: computeTargetIdentityDigest(baseIdentity),
        actor: 'samuel',
      },
    })
    expect(highAssurancePass.unlocked).toBe(true)
  })

  it('Scenario 6 (Codex B7): missing or incomplete ledger blocks gate advancement', () => {
    const missingEval = evaluateSparringGate({
      targetIdentity: baseIdentity,
      ledger: null,
      mandatory: true,
    })
    expect(missingEval.unlocked).toBe(false)
    expect(missingEval.disposition).toBe('missing')
  })
})
