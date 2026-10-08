import { createRoleHandoff, loadRoleCatalog } from '../role-catalog.mjs'
import {
  createAcceptanceContract,
  createAcceptanceDecision,
  createDeliveryReceipt,
} from '../core/role-collaboration.mjs'

// Records for the catalog-declared phase-0 handoff, built only through the shipped constructors.
export function phaseZeroCollaboration({
  subject = 'issue:1',
  candidateDigest,
  criterionId = 'check',
  description = 'Current evidence',
  fromRole,
  toRole,
  id = 'phase-zero',
} = {}) {
  if (!/^[a-f0-9]{64}$/.test(candidateDigest ?? '')) {
    throw new Error('phaseZeroCollaboration requires a candidate digest')
  }
  const catalog = loadRoleCatalog()
  const receiver = catalog.roles.find((role) => role.kind === 'lifecycle' && role.phase === 0)
  const senderId = (receiver?.acceptsFrom ?? []).find(
    (identity) => identity !== receiver?.qualifiedName,
  )
  const ownerRole = fromRole ?? senderId
  const deliveryRole = toRole ?? receiver?.qualifiedName
  const owner = catalog.roles.find((role) => role.qualifiedName === ownerRole)
  if (!owner) throw new Error(`phase-zero sender is not a catalog role: ${ownerRole ?? ''}`)
  const contract = createAcceptanceContract({
    id: `${id}-contract`,
    subject,
    ownerRole,
    deliveryRole,
    collaborationClass: 'linear',
    candidateDigest,
    criteria: [
      {
        id: criterionId,
        description,
        verification: 'deterministic',
        required: true,
      },
    ],
    councilPolicy: { required: false, seats: [], decisionOwner: ownerRole },
  })
  const handoff = createRoleHandoff({
    id: `${id}-handoff`,
    subject,
    state: 'issued',
    fromRole: ownerRole,
    toRole: deliveryRole,
    rolePassId: 'phase-0',
    profile: 'standard',
    actionBoundary: owner.authority.maximumBoundary,
    inputRefs: [],
    outputRefs: [],
    validationRefs: [],
    expectedAction: 'frame the problem and outcome',
    acceptanceCriteria: [description],
    acceptanceContract: contract,
    openQuestions: [],
    methodPlays: [],
    provenance: {
      platform: 'codex',
      executor: 'codex-cli',
      transport: 'local-cli',
      delegationBoundary: 'current-session',
    },
  })
  const evidenceRef = {
    kind: 'validation',
    system: 'local',
    uri: `observed:${criterionId}`,
    authority: 'working-copy',
    relationship: 'verifies',
  }
  const delivery = createDeliveryReceipt({
    id: `${id}-delivery`,
    handoffDigest: handoff.digest,
    contractDigest: contract.digest,
    producerRole: deliveryRole,
    candidateDigest,
    criteriaResults: [{ criterionId, status: 'pass', evidenceRefs: [evidenceRef] }],
    evidenceRefs: [evidenceRef],
    provenance: { platform: 'codex', executor: 'codex-cli' },
  })
  const decision = createAcceptanceDecision({
    id: `${id}-decision`,
    handoff,
    contract,
    delivery,
    decidedByRole: ownerRole,
    state: 'accepted',
    provenance: { platform: 'codex', executor: 'codex-cli' },
  })
  return { catalog, receiver, senderId, contract, handoff, delivery, decision }
}
