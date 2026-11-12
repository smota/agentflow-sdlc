// Shared fixture for the rig bridge tests (#582): a filesystem source adapter in a temp directory
// plus the in-memory queue port. Nothing here touches the network or a real rig.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBridge } from '../bridge/bridge.mjs'
import { normalizeBridgeConfig } from '../bridge/config.mjs'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'
import { formatRolePassComment, rolePassIdempotencyKey } from '../core/role-pass-evidence.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import {
  createFilesystemSourceAdapter,
  createFilesystemWorkItem,
} from '../sources/filesystem-source.mjs'

export const WRITER = 'agentflow-bridge'
export const RIG = 'agentflow-test'
export const READY = 'agentflow:ready'

const roots = []

export function cleanupBridgeFixtures() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function bridgeFixture({ queueOptions = {}, bridgeOptions = {}, config = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-bridge-'))
  roots.push(root)
  const source = createFilesystemSourceAdapter({ root, writer: WRITER, trustedWriters: [WRITER] })
  const queue = createMemoryQueuePort(queueOptions)
  const bridgeConfig = normalizeBridgeConfig({
    rig: RIG,
    source: { adapter: 'filesystem', root, claimWriters: [WRITER] },
    ...config,
  })
  const bridge = createBridge({ source, queue, config: bridgeConfig, ...bridgeOptions })
  let counter = 0
  const makeItem = (fields = {}) =>
    createFilesystemWorkItem(root, {
      id: fields.id ?? `item-${++counter}`,
      title: 'An item',
      labels: [READY],
      changeClass: 'standard',
      ...fields,
    })
  const setItem = async (refText, parameters) => {
    const { id } = parseSourceRef(refText)
    const operation = 'lifecycle' in parameters ? 'set-lifecycle' : 'update-item'
    const plan = await source.previewMutation({
      operation,
      parameters: { id, ...parameters },
      actionBoundary: { effective: 'external-action' },
    })
    await source.flushReceipt(await source.applyMutation(plan, { confirm: plan.token }))
  }
  // Appends role-pass evidence for the given phases directly to the source.
  const pass = async (refText, phases, { seats = {}, seatRig = null, writer = WRITER } = {}) => {
    const author =
      writer === WRITER
        ? source
        : createFilesystemSourceAdapter({ root, writer, trustedWriters: [WRITER] })
    const { id } = parseSourceRef(refText)
    const defaults = { 0: 'pm.manager', 1: 'pm.analyst', 2: 'orch.arch', 3: 'orch.arch' }
    Object.assign(defaults, { 4: 'dev.build', 5: 'dev.qa', 6: 'rev.review', 7: 'orch.arch' })
    for (const phase of phases) {
      const body = formatRolePassComment({
        idempotencyKey: rolePassIdempotencyKey({ stableId: id, phase, status: 'pass' }),
        phase,
        role: 'role',
        status: 'pass',
        seat: seats[phase] ?? defaults[phase],
        seatVerified: Boolean(seatRig),
        seatRig,
        body: `phase ${phase}`,
      })
      const plan = await author.previewMutation({
        operation: 'add-comment',
        parameters: { id, body },
        actionBoundary: { effective: 'external-action' },
      })
      await author.flushReceipt(await author.applyMutation(plan, { confirm: plan.token }))
    }
  }
  return { root, source, queue, bridge, config: bridgeConfig, makeItem, setItem, pass }
}
