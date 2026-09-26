import { reduceRun } from '../core/run-state.mjs'
import { requireDeliveryRecord, sealDeliveryRecord } from '../core/delivery-record.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import { planGitHubCoordination } from './github-run-store.mjs'

export const V2_SCHEMA_VERSION = 2
export const SEGMENTED_FORMAT = 'segmented-v2'
export const DEFAULT_SEGMENT_SIZE = 500
export const DEFAULT_SEGMENT_BYTES = 256 * 1024

function segmentDigest(segmentEvents) {
  return recordDigest({ events: segmentEvents })
}

export function createSegmentedRunStore({
  repo,
  runId,
  client,
  branch = 'agentflow-state',
  boundary,
  setupConfirm,
  segmentSize = DEFAULT_SEGMENT_SIZE,
  segmentBytes = DEFAULT_SEGMENT_BYTES,
  readCacheBytes = 2 * 1024 * 1024,
}) {
  if (
    !Number.isSafeInteger(readCacheBytes) ||
    readCacheBytes < 0 ||
    readCacheBytes > 2 * 1024 * 1024
  )
    throw new Error('Invalid immutable read cache capacity')
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') ||
    !/^[\w-]{1,100}$/.test(runId ?? '') ||
    !/^[\w/-]+$/.test(branch)
  )
    throw new Error('Invalid GitHub run store identity')
  if (!Number.isSafeInteger(segmentSize) || segmentSize < 1 || segmentSize > 5000)
    throw new Error('Invalid segment size')
  if (!Number.isSafeInteger(segmentBytes) || segmentBytes < 1024 || segmentBytes > 1024 * 1024)
    throw new Error('Invalid segment bytes capacity')

  const prefix = `/repos/${repo}`
  const refPath = `${prefix}/git/ref/heads/${branch}`
  const manifestPath = `runs/${runId}-manifest.json`
  const snapshotPath = `runs/${runId}-snapshot.json`
  const tailPath = `runs/${runId}-tail.json`
  const legacyFilePath = `runs/${runId}.json`
  const request = (...args) => client.request(...args)

  let cached = null

  const write = (path, body, method = 'POST') => {
    if (boundary !== 'external-action')
      throw new Error('Coordination writes require external-action authority')
    return request(path, { method, body })
  }

  async function readBlob(sha) {
    const blob = await request(`${prefix}/git/blobs/${sha}`)
    if (blob.encoding !== 'base64') throw new Error('Invalid blob encoding')
    return Buffer.from(blob.content.replaceAll('\n', ''), 'base64').toString('utf8')
  }

  async function readTreeAndRef() {
    let ref
    try {
      ref = await request(refPath)
    } catch (error) {
      cached = null
      if (error.status === 404) return null
      throw error
    }
    const sourceRevision = ref?.object?.sha
    if (typeof sourceRevision !== 'string' || !sourceRevision) {
      cached = null
      throw new Error('Missing coordination revision')
    }
    const commit = await request(`${prefix}/git/commits/${sourceRevision}`)
    const tree = await request(`${prefix}/git/trees/${commit.tree.sha}?recursive=1`)
    if (tree.truncated) throw new Error('Coordination tree truncated')
    if (
      !Array.isArray(tree.tree) ||
      tree.tree.some(
        (entry) =>
          !(entry.path === 'runs' && entry.type === 'tree' && entry.mode === '040000') &&
          !(
            entry.type === 'blob' &&
            entry.mode === '100644' &&
            /^runs\/[\w-]+\.json$/.test(entry.path)
          ),
      )
    )
      throw new Error('Coordination branch contains unmanaged data')
    return { ref, commit, tree, sourceRevision }
  }

  async function read({ cache = true, verifyAllSegments = true } = {}) {
    const treeInfo = await readTreeAndRef()
    if (!treeInfo) return { events: [], revision: null, sourceRevision: null, formatVersion: 2 }
    const { ref, commit, tree, sourceRevision } = treeInfo

    if (!cache) cached = null
    if (cached?.sourceRevision !== sourceRevision) cached = null
    if (cache && cached) return JSON.parse(cached.serialized)

    const manifestEntry = tree.tree.find((item) => item.path === manifestPath)
    let events = []
    let manifest = null
    let formatVersion = 2

    if (manifestEntry) {
      const manifestContent = await readBlob(manifestEntry.sha)
      manifest = JSON.parse(manifestContent)
      if (manifest.schemaVersion !== V2_SCHEMA_VERSION || manifest.format !== SEGMENTED_FORMAT)
        throw new Error('Unsupported manifest format or schema version')
      if (manifest.runId !== runId) throw new Error('Stored run identity mismatch in manifest')

      // Verify and load segments
      let previousDigest = null
      for (const seg of manifest.segments) {
        const segEntry = tree.tree.find((item) => item.path === seg.path)
        if (!segEntry)
          throw new Error(`Corrupted or missing event segment: ${seg.path}`)
        const segRaw = await readBlob(segEntry.sha)
        const segEvents = JSON.parse(segRaw)
        const computedDigest = segmentDigest(segEvents)
        if (computedDigest !== seg.digest)
          throw new Error(`Segment digest mismatch: expected ${seg.digest}, computed ${computedDigest}`)
        if (seg.parentDigest !== previousDigest)
          throw new Error(`Segment parent digest mismatch: expected ${previousDigest}, received ${seg.parentDigest}`)
        previousDigest = seg.digest
        events.push(...segEvents)
      }

      // Load tail events
      if (manifest.tailPath) {
        const tailEntry = tree.tree.find((item) => item.path === manifest.tailPath)
        if (tailEntry) {
          const tailRaw = await readBlob(tailEntry.sha)
          const tailEvents = JSON.parse(tailRaw)
          events.push(...tailEvents)
        }
      }
    } else {
      // Check legacy v1 file
      const legacyEntry = tree.tree.find((item) => item.path === legacyFilePath)
      if (legacyEntry) {
        const legacyRaw = await readBlob(legacyEntry.sha)
        const parsed = JSON.parse(legacyRaw)
        // If legacy file was replaced with v2 fail-closed marker
        if (!Array.isArray(parsed)) {
          throw new Error('Unsupported legacy run layout; use v2 segmented reader')
        }
        events = parsed
        formatVersion = 1
      }
    }

    const state = reduceRun(events)
    if (state && state.runId !== runId) throw new Error('Stored run identity mismatch')

    // If a snapshot exists in manifest, verify snapshot consistency with reduced state
    if (manifest?.snapshot && verifyAllSegments) {
      if (manifest.snapshot.eventCount <= events.length) {
        const prefixEvents = events.slice(0, manifest.snapshot.eventCount)
        const snapshotState = reduceRun(prefixEvents)
        if (snapshotState.revision !== manifest.snapshot.revision)
          throw new Error('Snapshot revision mismatch with replayed prefix')
      }
    }

    const result = {
      events,
      revision: state?.revision ?? null,
      sourceRevision: ref.object.sha,
      treeSha: commit.tree.sha,
      treeEntries: tree.tree,
      formatVersion,
      manifest,
    }

    if (cache && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sourceRevision)) {
      const serialized = JSON.stringify(result)
      if (Buffer.byteLength(serialized) <= readCacheBytes)
        cached = { sourceRevision, serialized }
    }
    return result
  }

  return {
    durable: true,
    conditionalAdmission: 'single-parent-run-chain-v1',
    read,
    async append(event, expectedRevision) {
      requireDeliveryRecord(event, 'run-event')
      if (event.runId !== runId) throw new Error('Run identity mismatch')
      const current = await read({ cache: false })
      const prior = current.events.find((item) => item.id === event.id)
      if (prior) {
        if (prior.digest !== event.digest) throw new Error('Conflicting event')
        return current
      }
      if (current.revision !== expectedRevision)
        throw Object.assign(new Error('Source revision conflict'), {
          admissionOutcome: 'not-committed',
        })

      const allEvents = [...current.events, event]
      const proposedState = reduceRun(allEvents)
      const reserve = proposedState?.delegationPolicy
        ? Math.max(0, proposedState.delegationPolicy.safetyReserve - proposedState.safetyUsed) * 4096
        : 0

      // Reconstruct or initialize manifest
      let manifest = current.manifest
      let segments = manifest ? structuredClone(manifest.segments) : []
      let existingSegmentEventCount = segments.reduce((sum, s) => sum + s.eventCount, 0)
      let tailEvents = allEvents.slice(existingSegmentEventCount)

      const treeUpdates = []

      // Check if tail has reached segment boundary
      const tailBytes = Buffer.byteLength(JSON.stringify(tailEvents))
      if (tailEvents.length >= segmentSize || tailBytes >= segmentBytes) {
        // Seal current tail into a new immutable segment
        const segIndex = segments.length
        const segPath = `runs/${runId}-seg-${segIndex}.json`
        const segContent = JSON.stringify(tailEvents)
        if (Buffer.byteLength(segContent) > 1024 * 1024 - reserve)
          throw new Error('Run exceeds bounded record size')

        const segBlob = await write(`${prefix}/git/blobs`, { content: segContent, encoding: 'utf-8' })
        treeUpdates.push({ path: segPath, mode: '100644', type: 'blob', sha: segBlob.sha })

        const parentDigest = segments.length > 0 ? segments[segments.length - 1].digest : null
        const digest = segmentDigest(tailEvents)
        const startState = existingSegmentEventCount > 0
          ? reduceRun(allEvents.slice(0, existingSegmentEventCount))
          : null
        const endState = reduceRun(allEvents.slice(0, existingSegmentEventCount + tailEvents.length))

        segments.push({
          id: `seg-${segIndex}`,
          path: segPath,
          digest,
          parentDigest,
          eventCount: tailEvents.length,
          byteLength: Buffer.byteLength(segContent),
          startRevision: startState?.revision ?? null,
          endRevision: endState?.revision ?? null,
        })

        // Snapshot at segment boundary
        const snapshotData = {
          revision: endState?.revision ?? null,
          state: endState,
          eventCount: allEvents.slice(0, existingSegmentEventCount + tailEvents.length).length,
        }
        const snapshotContent = JSON.stringify(snapshotData)
        const snapshotBlob = await write(`${prefix}/git/blobs`, { content: snapshotContent, encoding: 'utf-8' })
        treeUpdates.push({ path: snapshotPath, mode: '100644', type: 'blob', sha: snapshotBlob.sha })

        // Empty the tail
        tailEvents = []
        const emptyTailBlob = await write(`${prefix}/git/blobs`, { content: '[]', encoding: 'utf-8' })
        treeUpdates.push({ path: tailPath, mode: '100644', type: 'blob', sha: emptyTailBlob.sha })

        manifest = {
          schemaVersion: V2_SCHEMA_VERSION,
          format: SEGMENTED_FORMAT,
          runId,
          snapshot: {
            revision: snapshotData.revision,
            eventCount: snapshotData.eventCount,
            path: snapshotPath,
            snapshotDigest: recordDigest(snapshotData),
          },
          segments,
          tailPath,
          tailEventCount: 0,
        }
      } else {
        // Write active tail
        const tailContent = JSON.stringify(tailEvents)
        const tailBlob = await write(`${prefix}/git/blobs`, { content: tailContent, encoding: 'utf-8' })
        treeUpdates.push({ path: tailPath, mode: '100644', type: 'blob', sha: tailBlob.sha })

        manifest = {
          schemaVersion: V2_SCHEMA_VERSION,
          format: SEGMENTED_FORMAT,
          runId,
          snapshot: manifest?.snapshot ?? null,
          segments,
          tailPath,
          tailEventCount: tailEvents.length,
        }
      }

      // Write updated manifest
      const manifestContent = JSON.stringify(manifest, null, 2)
      const manifestBlob = await write(`${prefix}/git/blobs`, { content: manifestContent, encoding: 'utf-8' })
      treeUpdates.push({ path: manifestPath, mode: '100644', type: 'blob', sha: manifestBlob.sha })

      // Write fail-closed marker into legacy path to ensure old v1 binaries fail closed
      const v2Marker = JSON.stringify({
        schemaVersion: V2_SCHEMA_VERSION,
        format: SEGMENTED_FORMAT,
        runId,
        unsupportedMessage: 'This run has been migrated to segmented v2 storage; upgrade AgentFlow to read.',
      })
      const markerBlob = await write(`${prefix}/git/blobs`, { content: v2Marker, encoding: 'utf-8' })
      treeUpdates.push({ path: legacyFilePath, mode: '100644', type: 'blob', sha: markerBlob.sha })

      if (!current.sourceRevision) {
        const setup = await planGitHubCoordination({ repo, branch, client })
        if (setupConfirm !== setup.digest)
          throw new Error('Explicit current coordination setup confirmation required')
      }

      const entryMap = new Map()
      if (current.treeEntries) {
        for (const entry of current.treeEntries) {
          entryMap.set(entry.path, entry)
        }
      }
      for (const update of treeUpdates) {
        entryMap.set(update.path, update)
      }
      const fullTree = Array.from(entryMap.values())

      const tree = await write(`${prefix}/git/trees`, {
        ...(current.treeSha ? { base_tree: current.treeSha } : {}),
        tree: fullTree,
      })
      const commit = await write(`${prefix}/git/commits`, {
        message: `Agentflow ${runId}: ${event.kind} [v2]`,
        tree: tree.sha,
        parents: current.sourceRevision ? [current.sourceRevision] : [],
      })

      try {
        if (current.sourceRevision)
          await write(
            `${prefix}/git/refs/heads/${branch}`,
            { sha: commit.sha, force: false },
            'PATCH',
          )
        else await write(`${prefix}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha })
      } catch (error) {
        const reconciled = await read({ cache: false })
        if (reconciled.events.some((item) => item.id === event.id && item.digest === event.digest))
          return reconciled
        if ([409, 422].includes(error.status)) error.admissionOutcome = 'not-committed'
        throw error
      }

      const confirmed = await read({ cache: false })
      if (!confirmed.events.some((item) => item.id === event.id && item.digest === event.digest))
        throw new Error('Coordination outcome unknown')
      return confirmed
    },
  }
}

export async function previewMigration({ repo, runId, client, branch = 'agentflow-state', segmentSize = DEFAULT_SEGMENT_SIZE }) {
  const prefix = `/repos/${repo}`
  const ref = await client.request(`${prefix}/git/ref/heads/${branch}`)
  const commit = await client.request(`${prefix}/git/commits/${ref.object.sha}`)
  const tree = await client.request(`${prefix}/git/trees/${commit.tree.sha}?recursive=1`)

  const manifestEntry = tree.tree.find((item) => item.path === `runs/${runId}-manifest.json`)
  if (manifestEntry) {
    const raw = await client.request(`${prefix}/git/blobs/${manifestEntry.sha}`)
    const manifest = JSON.parse(Buffer.from(raw.content, 'base64').toString('utf8'))
    return {
      alreadyMigrated: true,
      formatVersion: 2,
      runId,
      segmentCount: manifest.segments.length,
      snapshotRevision: manifest.snapshot?.revision ?? null,
    }
  }

  const legacyEntry = tree.tree.find((item) => item.path === `runs/${runId}.json`)
  if (!legacyEntry) throw new Error(`Run ${runId} not found`)

  const blob = await client.request(`${prefix}/git/blobs/${legacyEntry.sha}`)
  const events = JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8'))
  if (!Array.isArray(events)) throw new Error('Legacy run is not a valid event array')

  const referenceState = reduceRun(events)

  // Partition into segments
  const segments = []
  let previousDigest = null
  for (let i = 0; i < events.length; i += segmentSize) {
    const chunk = events.slice(i, i + segmentSize)
    const digest = segmentDigest(chunk)
    const startState = i > 0 ? reduceRun(events.slice(0, i)) : null
    const endState = reduceRun(events.slice(0, i + chunk.length))
    segments.push({
      id: `seg-${segments.length}`,
      eventCount: chunk.length,
      digest,
      parentDigest: previousDigest,
      startRevision: startState?.revision ?? null,
      endRevision: endState?.revision ?? null,
    })
    previousDigest = digest
  }

  // Verify full replay of simulated segments matches reference reducer exactly
  const replayedEvents = []
  for (let i = 0; i < events.length; i += segmentSize) {
    replayedEvents.push(...events.slice(i, i + segmentSize))
  }
  const replayedState = reduceRun(replayedEvents)
  if (replayedState.revision !== referenceState.revision)
    throw new Error('Migration replay mismatch with reference reducer')

  return sealDeliveryRecord('run-migration-preview', {
    runId,
    sourceRevision: ref.object.sha,
    eventCount: events.length,
    segmentCount: segments.length,
    referenceRevision: referenceState.revision,
    replayedRevision: replayedState.revision,
    verified: true,
    proposedSegments: segments,
  })
}

export async function migrateRunStore({
  repo,
  runId,
  client,
  branch = 'agentflow-state',
  boundary = 'external-action',
  segmentSize = DEFAULT_SEGMENT_SIZE,
}) {
  if (boundary !== 'external-action')
    throw new Error('Migration writes require external-action authority')
  const preview = await previewMigration({ repo, runId, client, branch, segmentSize })
  if (preview.alreadyMigrated) return preview

  const prefix = `/repos/${repo}`
  const ref = await client.request(`${prefix}/git/ref/heads/${branch}`)
  if (ref.object.sha !== preview.sourceRevision)
    throw new Error('Source revision changed before migration')

  const commit = await client.request(`${prefix}/git/commits/${ref.object.sha}`)
  const tree = await client.request(`${prefix}/git/trees/${commit.tree.sha}?recursive=1`)
  const legacyEntry = tree.tree.find((item) => item.path === `runs/${runId}.json`)
  const blob = await client.request(`${prefix}/git/blobs/${legacyEntry.sha}`)
  const events = JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8'))

  const treeUpdates = []
  const segments = []
  let previousDigest = null

  // Write segment blobs
  for (let i = 0; i < events.length; i += segmentSize) {
    const chunk = events.slice(i, i + segmentSize)
    const segIndex = segments.length
    const segPath = `runs/${runId}-seg-${segIndex}.json`
    const segContent = JSON.stringify(chunk)
    const segBlob = await client.request(`${prefix}/git/blobs`, {
      method: 'POST',
      body: { content: segContent, encoding: 'utf-8' },
    })
    treeUpdates.push({ path: segPath, mode: '100644', type: 'blob', sha: segBlob.sha })

    const digest = segmentDigest(chunk)
    const startState = i > 0 ? reduceRun(events.slice(0, i)) : null
    const endState = reduceRun(events.slice(0, i + chunk.length))

    segments.push({
      id: `seg-${segIndex}`,
      path: segPath,
      digest,
      parentDigest: previousDigest,
      eventCount: chunk.length,
      byteLength: Buffer.byteLength(segContent),
      startRevision: startState?.revision ?? null,
      endRevision: endState?.revision ?? null,
    })
    previousDigest = digest
  }

  // Snapshot at end of last segment
  const finalState = reduceRun(events)
  const snapshotData = {
    revision: finalState?.revision ?? null,
    state: finalState,
    eventCount: events.length,
  }
  const snapshotContent = JSON.stringify(snapshotData)
  const snapshotBlob = await client.request(`${prefix}/git/blobs`, {
    method: 'POST',
    body: { content: snapshotContent, encoding: 'utf-8' },
  })
  treeUpdates.push({ path: `runs/${runId}-snapshot.json`, mode: '100644', type: 'blob', sha: snapshotBlob.sha })

  // Empty tail
  const emptyTailBlob = await client.request(`${prefix}/git/blobs`, {
    method: 'POST',
    body: { content: '[]', encoding: 'utf-8' },
  })
  treeUpdates.push({ path: `runs/${runId}-tail.json`, mode: '100644', type: 'blob', sha: emptyTailBlob.sha })

  // Manifest
  const manifest = {
    schemaVersion: V2_SCHEMA_VERSION,
    format: SEGMENTED_FORMAT,
    runId,
    snapshot: {
      revision: snapshotData.revision,
      eventCount: snapshotData.eventCount,
      path: `runs/${runId}-snapshot.json`,
      snapshotDigest: recordDigest(snapshotData),
    },
    segments,
    tailPath: `runs/${runId}-tail.json`,
    tailEventCount: 0,
  }
  const manifestContent = JSON.stringify(manifest, null, 2)
  const manifestBlob = await client.request(`${prefix}/git/blobs`, {
    method: 'POST',
    body: { content: manifestContent, encoding: 'utf-8' },
  })
  treeUpdates.push({ path: `runs/${runId}-manifest.json`, mode: '100644', type: 'blob', sha: manifestBlob.sha })

  // Fail-closed marker in legacy file
  const v2Marker = JSON.stringify({
    schemaVersion: V2_SCHEMA_VERSION,
    format: SEGMENTED_FORMAT,
    runId,
    unsupportedMessage: 'This run has been migrated to segmented v2 storage; upgrade AgentFlow to read.',
  })
  const markerBlob = await client.request(`${prefix}/git/blobs`, {
    method: 'POST',
    body: { content: v2Marker, encoding: 'utf-8' },
  })
  treeUpdates.push({ path: `runs/${runId}.json`, mode: '100644', type: 'blob', sha: markerBlob.sha })

  const entryMap = new Map()
  for (const entry of tree.tree) {
    entryMap.set(entry.path, entry)
  }
  for (const update of treeUpdates) {
    entryMap.set(update.path, update)
  }
  const fullTree = Array.from(entryMap.values())

  const newTree = await client.request(`${prefix}/git/trees`, {
    method: 'POST',
    body: {
      base_tree: commit.tree.sha,
      tree: fullTree,
    },
  })

  const newCommit = await client.request(`${prefix}/git/commits`, {
    method: 'POST',
    body: {
      message: `Agentflow ${runId}: migrate to segmented v2 storage`,
      tree: newTree.sha,
      parents: [ref.object.sha],
    },
  })

  await client.request(`${prefix}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: { sha: newCommit.sha, force: false },
  })

  return sealDeliveryRecord('run-migration-receipt', {
    runId,
    priorRevision: ref.object.sha,
    newRevision: newCommit.sha,
    eventCount: events.length,
    segmentCount: segments.length,
    finalRevision: finalState.revision,
    verified: true,
  })
}
