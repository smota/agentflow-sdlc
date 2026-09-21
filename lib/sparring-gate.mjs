import {
  computeLedgerRevision,
  computeTargetIdentityDigest,
  validateResolutionLedger,
  validateReviewRoundReceipt,
} from './core/sparring.mjs'

export function applyReviewRound({
  ledger,
  receipt,
  currentTargetIdentity,
  expectedFencingToken = null,
  expectedLedgerRevision = null,
  resolutionEvidences = {},
  waivers = {},
} = {}) {
  const ledgerVal = validateResolutionLedger(ledger)
  if (!ledgerVal.ok) {
    throw new Error(`invalid ledger: ${ledgerVal.errors.join('; ')}`)
  }
  const receiptVal = validateReviewRoundReceipt(receipt)
  if (!receiptVal.ok) {
    throw new Error(`invalid review round receipt: ${receiptVal.errors.join('; ')}`)
  }

  // 1. CAS Check (Codex B2: Concurrency & Lost Updates)
  if (expectedLedgerRevision !== null) {
    const currentRev = ledger.expectedLedgerRevision || computeLedgerRevision(ledger)
    if (expectedLedgerRevision !== currentRev) {
      const err = new Error(
        `CAS_REVISION_MISMATCH: expected ledger revision ${expectedLedgerRevision} does not match current ${currentRev}`,
      )
      err.code = 'CAS_REVISION_MISMATCH'
      throw err
    }
  }

  // 2. Fencing Token Monotonicity Check (Codex B2)
  if (receipt.fencingToken <= ledger.fencingToken) {
    const err = new Error(
      `FENCING_TOKEN_STALE: receipt fencing token ${receipt.fencingToken} is not strictly greater than ledger token ${ledger.fencingToken}`,
    )
    err.code = 'FENCING_TOKEN_STALE'
    throw err
  }
  if (expectedFencingToken !== null && receipt.fencingToken !== expectedFencingToken) {
    const err = new Error(
      `FENCING_TOKEN_MISMATCH: receipt fencing token ${receipt.fencingToken} does not match expected token ${expectedFencingToken}`,
    )
    err.code = 'FENCING_TOKEN_MISMATCH'
    throw err
  }

  // 3. Target Identity Digest Check (Codex B1: Stale / Partial Target Approval)
  const currentIdentityDigest = computeTargetIdentityDigest(currentTargetIdentity)
  if (receipt.targetIdentityDigest !== currentIdentityDigest) {
    const err = new Error(
      `TARGET_IDENTITY_MISMATCH: receipt target digest ${receipt.targetIdentityDigest} does not match current target digest ${currentIdentityDigest}`,
    )
    err.code = 'TARGET_IDENTITY_MISMATCH'
    throw err
  }

  // 4. Update findings ledger with separation of powers (Codex B3: Reviewer cannot self-waive)
  const updatedFindings = { ...ledger.findingsLedger }

  for (const finding of receipt.findings) {
    const existing = updatedFindings[finding.id]
    if (!existing) {
      updatedFindings[finding.id] = {
        initialRound: receipt.round,
        severity: finding.severity,
        description: finding.description,
        citation: finding.citation,
        status: finding.status === 'verified_closed' ? 'resolved' : 'open',
        resolutionEvidence: resolutionEvidences[finding.id] || null,
        waiver: null,
      }
    } else {
      if (finding.status === 'open') {
        // If reviewer still observes it as open, it remains open
        updatedFindings[finding.id] = {
          ...existing,
          status: 'open',
          citation: finding.citation,
          description: finding.description,
        }
      } else if (finding.status === 'verified_closed') {
        // Closed by reviewer: requires resolution evidence from author
        const evidence = resolutionEvidences[finding.id] || existing.resolutionEvidence
        updatedFindings[finding.id] = {
          ...existing,
          status: evidence ? 'resolved' : 'open',
          resolutionEvidence: evidence,
        }
      }
    }
  }

  // Authoritative waivers (must come from authorized caller, never manufactured by reviewer)
  for (const [findingId, waiverData] of Object.entries(waivers)) {
    if (updatedFindings[findingId] && waiverData) {
      if (!waiverData.actor || !waiverData.rationale || !waiverData.scope) {
        throw new Error(
          `invalid waiver for finding ${findingId}: actor, rationale, and scope are required`,
        )
      }
      updatedFindings[findingId] = {
        ...updatedFindings[findingId],
        status: 'waived',
        waiver: {
          actor: waiverData.actor,
          rationale: waiverData.rationale,
          scope: waiverData.scope,
          expiry: waiverData.expiry || null,
        },
      }
    }
  }

  // Check open blockers or structural findings
  const openCritical = Object.values(updatedFindings).filter(
    (f) => ['blocker', 'structural'].includes(f.severity) && f.status === 'open',
  )

  const newStatus =
    receipt.disposition === 'approved' && openCritical.length === 0 ? 'approved' : 'open'

  const newRounds = [...ledger.rounds, receipt]

  const updatedLedger = {
    ...ledger,
    targetIdentity: currentTargetIdentity,
    targetIdentityDigest: currentIdentityDigest,
    fencingToken: receipt.fencingToken,
    currentRound: receipt.round,
    status: newStatus,
    findingsLedger: updatedFindings,
    rounds: newRounds,
  }

  updatedLedger.expectedLedgerRevision = computeLedgerRevision(updatedLedger)
  return updatedLedger
}

export function evaluateSparringGate({
  targetIdentity,
  ledger,
  profile = 'standard',
  humanDecision = null,
  mandatory = true,
} = {}) {
  const errors = []
  const warnings = []

  if (!ledger) {
    if (mandatory) errors.push('sparring ledger is missing')
    return { unlocked: false, errors, warnings, disposition: 'missing' }
  }

  // 1. Invariant 1 (Target Match - Codex B1)
  const currentTargetDigest = computeTargetIdentityDigest(targetIdentity)
  const ledgerTargetDigest = computeTargetIdentityDigest(ledger.targetIdentity)
  if (currentTargetDigest !== ledgerTargetDigest) {
    errors.push(
      `TARGET_STALE: current target digest ${currentTargetDigest} does not match ledger target digest ${ledgerTargetDigest}`,
    )
  }

  // 2. Invariant 2 (Status Approved)
  if (ledger.status !== 'approved') {
    errors.push(`ledger status is '${ledger.status}', must be 'approved'`)
  }

  // 3. Invariant 3 (Zero open blockers/structural findings - Codex B3)
  const openBlockers = Object.entries(ledger.findingsLedger || {}).filter(
    ([, f]) => f.severity === 'blocker' && f.status === 'open',
  )
  if (openBlockers.length > 0) {
    errors.push(`unresolved blockers remaining: ${openBlockers.map(([id]) => id).join(', ')}`)
  }

  const openStructural = Object.entries(ledger.findingsLedger || {}).filter(
    ([, f]) => f.severity === 'structural' && f.status === 'open',
  )
  if (openStructural.length > 0) {
    errors.push(
      `unresolved structural findings remaining: ${openStructural.map(([id]) => id).join(', ')}`,
    )
  }

  // 4. Invariant 4 (Assurance Eligibility & Independence - Codex B5)
  const approvingRound = ledger.rounds && ledger.rounds[ledger.rounds.length - 1]
  if (approvingRound) {
    const isDegraded = ['same-harness-child', 'self-review'].includes(
      approvingRound.independenceClassification,
    )
    if (isDegraded) {
      if (profile === 'high-assurance') {
        // High-assurance work requires explicit human decision when reviewer is degraded
        if (!humanDecision || humanDecision.status !== 'accepted') {
          errors.push(
            `HIGH_ASSURANCE_INDEPENDENCE_REQUIRED: approving round used ${approvingRound.independenceClassification}; high-assurance profile requires human acceptance decision`,
          )
        } else if (humanDecision.targetIdentityDigest !== currentTargetDigest) {
          errors.push(
            `HUMAN_DECISION_DIGEST_MISMATCH: human decision target ${humanDecision.targetIdentityDigest} does not match current target ${currentTargetDigest}`,
          )
        }
      } else {
        warnings.push(
          `sparring approved with degraded independence (${approvingRound.independenceClassification}) under ${profile} profile`,
        )
      }
    }
  }

  const unlocked = errors.length === 0
  return {
    unlocked,
    errors,
    warnings,
    disposition: unlocked ? 'approved' : 'changes-required',
  }
}
