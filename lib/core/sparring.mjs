import { createHash } from 'node:crypto'
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const SEVERITIES = Object.freeze(['blocker', 'structural', 'nit'])
export const REVIEW_STATUSES = Object.freeze(['open', 'verified_closed'])
export const FINDING_STATUSES = Object.freeze(['open', 'resolved', 'waived'])
export const DELEGATION_TOPOLOGIES = Object.freeze([
  'cli-process',
  'child-subagent',
  'remote-session',
  'manual',
])
export const INDEPENDENCE_CLASSIFICATIONS = Object.freeze([
  'independent',
  'same-harness-child',
  'self-review',
  'not-applicable',
])

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function createReviewTargetIdentity({
  workItemId,
  cycle,
  contractDigest,
  sliceManifestDigest,
  policyDigest,
}) {
  if (!workItemId || typeof workItemId !== 'string') {
    throw new Error('ReviewTargetIdentity requires non-empty workItemId')
  }
  if (!cycle || typeof cycle !== 'string') {
    throw new Error('ReviewTargetIdentity requires non-empty cycle')
  }
  if (!contractDigest || typeof contractDigest !== 'string') {
    throw new Error('ReviewTargetIdentity requires non-empty contractDigest')
  }
  if (!sliceManifestDigest || typeof sliceManifestDigest !== 'string') {
    throw new Error('ReviewTargetIdentity requires non-empty sliceManifestDigest')
  }
  if (!policyDigest || typeof policyDigest !== 'string') {
    throw new Error('ReviewTargetIdentity requires non-empty policyDigest')
  }
  return Object.freeze({
    workItemId,
    cycle,
    contractDigest,
    sliceManifestDigest,
    policyDigest,
  })
}

export function computeTargetIdentityDigest(identity) {
  if (!identity || typeof identity !== 'object') {
    throw new Error('cannot compute digest of non-object identity')
  }
  return sha256(canonicalJson(identity))
}

export function validateReviewRoundReceipt(receipt = {}) {
  const errors = []
  if (!Number.isInteger(receipt.round) || receipt.round < 1) {
    errors.push('round must be a positive integer')
  }
  if (!receipt.cycle || typeof receipt.cycle !== 'string') {
    errors.push('cycle must be a non-empty string')
  }
  if (
    !receipt.targetIdentityDigest ||
    typeof receipt.targetIdentityDigest !== 'string' ||
    receipt.targetIdentityDigest.length !== 64
  ) {
    errors.push('targetIdentityDigest must be a 64-character hex SHA-256 digest')
  }
  if (!Number.isInteger(receipt.fencingToken) || receipt.fencingToken < 1) {
    errors.push('fencingToken must be a positive integer')
  }
  if (!receipt.reviewer || typeof receipt.reviewer !== 'object') {
    errors.push('reviewer must be an object with platform, executor, model')
  } else {
    for (const f of ['platform', 'executor', 'model']) {
      if (!receipt.reviewer[f] || typeof receipt.reviewer[f] !== 'string') {
        errors.push(`reviewer.${f} must be a non-empty string`)
      }
    }
  }
  if (!DELEGATION_TOPOLOGIES.includes(receipt.delegationTopology)) {
    errors.push(`delegationTopology must be one of: ${DELEGATION_TOPOLOGIES.join(', ')}`)
  }
  if (!INDEPENDENCE_CLASSIFICATIONS.includes(receipt.independenceClassification)) {
    errors.push(
      `independenceClassification must be one of: ${INDEPENDENCE_CLASSIFICATIONS.join(', ')}`,
    )
  }
  if (!['approved', 'changes-required'].includes(receipt.disposition)) {
    errors.push('disposition must be either approved or changes-required')
  }
  if (!Array.isArray(receipt.findings)) {
    errors.push('findings must be an array')
  } else {
    for (const [index, f] of receipt.findings.entries()) {
      if (!f.id || typeof f.id !== 'string') {
        errors.push(`finding[${index}].id must be a non-empty string`)
      }
      if (!SEVERITIES.includes(f.severity)) {
        errors.push(`finding[${index}].severity must be one of: ${SEVERITIES.join(', ')}`)
      }
      if (!f.citation || typeof f.citation !== 'string') {
        errors.push(`finding[${index}].citation must be a non-empty string`)
      }
      if (!f.description || typeof f.description !== 'string') {
        errors.push(`finding[${index}].description must be a non-empty string`)
      }
      if (!REVIEW_STATUSES.includes(f.status)) {
        errors.push(`finding[${index}].status must be one of: ${REVIEW_STATUSES.join(', ')}`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

export function computeLedgerRevision(ledger) {
  if (!ledger) return null
  const projection = {
    ledgerVersion: ledger.ledgerVersion,
    targetIdentity: ledger.targetIdentity,
    targetIdentityDigest: ledger.targetIdentityDigest,
    fencingToken: ledger.fencingToken,
    currentRound: ledger.currentRound,
    status: ledger.status,
    findingsLedger: ledger.findingsLedger,
    roundsCount: Array.isArray(ledger.rounds) ? ledger.rounds.length : 0,
  }
  return sha256(canonicalJson(projection))
}

export function createResolutionLedger({ targetIdentity }) {
  const identity = createReviewTargetIdentity(targetIdentity)
  const targetIdentityDigest = computeTargetIdentityDigest(identity)
  const ledger = {
    ledgerVersion: 1,
    targetIdentity: identity,
    targetIdentityDigest,
    fencingToken: 0,
    expectedLedgerRevision: null,
    currentRound: 0,
    status: 'open',
    findingsLedger: {},
    rounds: [],
  }
  return ledger
}

export function validateResolutionLedger(ledger = {}) {
  const errors = []
  if (ledger.ledgerVersion !== 1) {
    errors.push('ledgerVersion must be 1')
  }
  if (!ledger.targetIdentity || typeof ledger.targetIdentity !== 'object') {
    errors.push('targetIdentity must be a valid object')
  }
  if (!ledger.targetIdentityDigest || ledger.targetIdentityDigest.length !== 64) {
    errors.push('targetIdentityDigest must be a 64-character hex digest')
  }
  if (!Number.isInteger(ledger.fencingToken) || ledger.fencingToken < 0) {
    errors.push('fencingToken must be a non-negative integer')
  }
  if (!Number.isInteger(ledger.currentRound) || ledger.currentRound < 0) {
    errors.push('currentRound must be a non-negative integer')
  }
  if (!['open', 'approved', 'rejected'].includes(ledger.status)) {
    errors.push('status must be open, approved, or rejected')
  }
  if (!ledger.findingsLedger || typeof ledger.findingsLedger !== 'object') {
    errors.push('findingsLedger must be an object')
  }
  if (!Array.isArray(ledger.rounds)) {
    errors.push('rounds must be an array')
  }
  return { ok: errors.length === 0, errors }
}

export function createSparringBrief({
  objective,
  contractSliceText,
  contractSliceHash,
  attackVectors = [],
  constraints = [],
  priorUnresolvedFindings = [],
}) {
  if (!objective || typeof objective !== 'string') {
    throw new Error('SparringBrief requires non-empty objective')
  }
  if (!contractSliceText || typeof contractSliceText !== 'string') {
    throw new Error('SparringBrief requires non-empty contractSliceText')
  }
  const sliceHash = contractSliceHash || sha256(contractSliceText)
  return Object.freeze({
    objective,
    contractSliceText,
    contractSliceHash: sliceHash,
    attackVectors: Object.freeze([...attackVectors]),
    constraints: Object.freeze([...constraints]),
    requiredTaxonomy: Object.freeze([...SEVERITIES]),
    priorUnresolvedFindings: Object.freeze([...priorUnresolvedFindings]),
  })
}
