import { recordDigest } from '../core/record-digest.mjs'
import { requireDeliveryRecord, sealDeliveryRecord } from '../core/delivery-record.mjs'
import { RUN_ROLES } from '../core/run-state.mjs'

export const CONTINUATION_SCHEMA_VERSION = 1
export const MAX_PACKET_BYTES = 32 * 1024

export function createContinuationBundle({
  state,
  runRevision,
  branch,
  commitSha,
  nextSlice,
  artifacts = [],
  storeDigest = null,
}) {
  if (!state || !state.runId) throw new Error('Valid run state required')
  if (typeof branch !== 'string' || !branch.trim()) throw new Error('Invalid branch reference')
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commitSha ?? ''))
    throw new Error('Invalid commit SHA')
  if (typeof nextSlice !== 'string' || !nextSlice.trim())
    throw new Error('Next runnable slice required')

  const allGrants = Object.values(state.grants ?? {})
  const primaryGrant = allGrants[0] ?? null

  const pendingOperations = Object.values(state.operations ?? {})
    .filter((op) => !['confirmed', 'failed'].includes(op.state))
    .map((op) => ({ id: op.id, kind: op.kind, state: op.state, payloadDigest: op.payloadDigest }))

  const openRework = Object.values(state.openRework ?? {}).map((item) => ({
    id: item.id,
    criteria: item.criteria,
  }))

  const verifiedArtifacts = artifacts.map((art) => {
    if (!art.id || !art.digest || !art.path || !Number.isSafeInteger(art.byteLength))
      throw new Error('Invalid artifact reference')
    return {
      id: art.id,
      digest: art.digest,
      path: art.path,
      byteLength: art.byteLength,
      contentType: art.contentType ?? 'application/octet-stream',
    }
  })

  const packet = {
    schemaVersion: CONTINUATION_SCHEMA_VERSION,
    kind: 'continuation-packet',
    runId: state.runId,
    branch,
    commitSha,
    runRevision,
    storeDigest,
    writer: {
      owner: state.owner,
      generation: state.generation,
    },
    grant: primaryGrant
      ? {
          id: primaryGrant.envelope.id,
          revision: primaryGrant.revision,
          digest: recordDigest({ envelope: primaryGrant.envelope }),
          expiry: primaryGrant.envelope.binding.expiry,
        }
      : null,
    policyDigest: state.delegationPolicy ? recordDigest(state.delegationPolicy) : null,
    phase: state.phase,
    role: RUN_ROLES[state.phase] ?? null,
    nextSlice,
    candidateDigest: state.candidateDigest ?? null,
    pendingOperations,
    openRework,
    artifacts: verifiedArtifacts,
  }

  const serialized = JSON.stringify(packet)
  if (Buffer.byteLength(serialized) > MAX_PACKET_BYTES)
    throw new Error(`Continuation packet exceeds ${MAX_PACKET_BYTES} bytes limit`)

  return sealDeliveryRecord('continuation-packet', packet)
}

export async function reconstructContinuation({
  bundle,
  store,
  observeWriter,
  resolveArtifact,
  clock = () => new Date().toISOString(),
}) {
  requireDeliveryRecord(bundle, 'continuation-packet')
  if (bundle.schemaVersion !== CONTINUATION_SCHEMA_VERSION)
    throw new Error(`Unsupported continuation schemaVersion: ${bundle.schemaVersion}`)

  const serialized = JSON.stringify(bundle)
  if (Buffer.byteLength(serialized) > MAX_PACKET_BYTES)
    throw new Error('Continuation packet exceeds bounded capacity')

  // 1. Authoritative Store Check
  const snapshot = await store.read()
  const state = snapshot.state ?? reduceRun(snapshot.events)
  if (!state || state.runId !== bundle.runId)
    throw new Error(`Authoritative run ${bundle.runId} not found`)

  const effectiveRevision = snapshot.revision ?? state.revision
  if (effectiveRevision !== bundle.runRevision)
    throw new Error(
      `Authoritative run revision mismatch: expected ${bundle.runRevision}, observed ${effectiveRevision}`,
    )

  // 2. Writer Generation and Liveness Verification
  if (state.generation !== bundle.writer.generation || state.owner !== bundle.writer.owner)
    throw new Error('Writer identity or generation mismatch with authoritative ledger')

  if (typeof observeWriter !== 'function')
    throw new Error('Authoritative writer liveness observer required')

  const writerLiveness = await observeWriter(state)
  if (writerLiveness?.stopped !== true)
    throw new Error('Previous writer liveness unknown or active; continuation refused')

  // 3. Delegation Grant Freshness & Expiry Verification
  if (bundle.grant) {
    const authoritativeGrant = state.grants?.[bundle.grant.id]
    if (!authoritativeGrant)
      throw new Error(`Referenced grant ${bundle.grant.id} missing from authoritative state`)
    if (authoritativeGrant.status !== 'active')
      throw new Error(`Referenced grant ${bundle.grant.id} is revoked`)
    if (recordDigest({ envelope: authoritativeGrant.envelope }) !== bundle.grant.digest)
      throw new Error(`Referenced grant ${bundle.grant.id} tampered or digest mismatch`)
    if (Date.parse(authoritativeGrant.envelope.binding.expiry) <= Date.parse(clock()))
      throw new Error(`Referenced grant ${bundle.grant.id} has expired`)
  }

  // 4. Bounded Artifact Integrity Verification
  if (typeof resolveArtifact !== 'function')
    throw new Error('Artifact resolver required for portable continuation')

  const verifiedArtifacts = []
  for (const artRef of bundle.artifacts) {
    const resolved = await resolveArtifact(artRef)
    if (!resolved || !resolved.content)
      throw new Error(`Corrupted or missing continuation artifact: ${artRef.id}`)
    const computedDigest = recordDigest(resolved.content)
    if (computedDigest !== artRef.digest)
      throw new Error(
        `Artifact digest mismatch for ${artRef.id}: expected ${artRef.digest}, observed ${computedDigest}`,
      )
    verifiedArtifacts.push({
      ...artRef,
      resolvedContent: resolved.content,
    })
  }

  return sealDeliveryRecord('continuation-reconstruction', {
    runId: state.runId,
    verified: true,
    runRevision: snapshot.revision,
    priorWriter: { ...bundle.writer },
    nextGeneration: state.generation + 1,
    phase: state.phase,
    role: RUN_ROLES[state.phase],
    nextSlice: bundle.nextSlice,
    candidateDigest: state.candidateDigest,
    pendingOperations: bundle.pendingOperations,
    openRework: bundle.openRework,
    verifiedArtifactCount: verifiedArtifacts.length,
    activeGrantId: bundle.grant?.id ?? null,
  })
}
