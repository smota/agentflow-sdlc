// Several delivery rigs on one project (#586). Every rig has its own in-memory queue port; all rigs
// share one filesystem source root, whose claim log decides who works an item. No network, no rig.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { gateCapacityAdmission } from '../bridge/backpressure.mjs'
import { bridgeSessionFor, createBridge } from '../bridge/bridge.mjs'
import { normalizeBridgeConfig } from '../bridge/config.mjs'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'
import { offerQueueId, stableQueueId } from '../bridge/queue-id.mjs'
import { formatRolePassComment, rolePassIdempotencyKey } from '../core/role-pass-evidence.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { formatGateDecision } from '../roster/authority.mjs'
import {
  createFilesystemSourceAdapter,
  createFilesystemWorkItem,
} from '../sources/filesystem-source.mjs'

const CONTROL = 'agentflow-p'
const D1 = 'agentflow-p-d1'
const D2 = 'agentflow-p-d2'
const BRIDGE_WRITER = 'agentflow-bridge'
const WRITERS = { [CONTROL]: BRIDGE_WRITER, [D1]: 'rig-d1', [D2]: 'rig-d2' }
const TRUSTED = Object.values(WRITERS)
const LIB = resolve(import.meta.dirname, '..')
const OPERATOR = `human@${CONTROL}`

const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function rigConfig(extra = {}) {
  return normalizeBridgeConfig({
    rigs: { control: CONTROL, delivery: [D1, D2] },
    source: { adapter: 'filesystem', claimWriters: TRUSTED },
    ...extra,
  })
}

// A control rig and two delivery rigs, each with its own queue port, over one source root. Each
// rig's bridge has its own adapter (its own writer), as separate processes would.
function topology({ config = {}, bridgeOptions = {}, queues: given = null } = {}) {
  const root = tempDir('agentflow-multi-rig-')
  const queues = given ?? {
    [CONTROL]: createMemoryQueuePort(),
    [D1]: createMemoryQueuePort(),
    [D2]: createMemoryQueuePort(),
  }
  const sources = Object.fromEntries(
    Object.entries(WRITERS).map(([rig, writer]) => [
      rig,
      createFilesystemSourceAdapter({ root, writer, trustedWriters: TRUSTED }),
    ]),
  )
  const prepared = { [D1]: [], [D2]: [] }
  const bridgeFor = (rig, options = {}) =>
    createBridge({
      source: sources[rig],
      queues,
      config: rigConfig(config),
      worktrees: prepared[rig]
        ? { prepare: async ({ slice }) => (prepared[rig].push(slice), { path: `wt-${rig}` }) }
        : null,
      ...bridgeOptions,
      ...options,
    })
  let counter = 0
  const makeItem = (fields = {}) =>
    createFilesystemWorkItem(root, {
      id: fields.id ?? `item-${++counter}`,
      title: 'An item',
      labels: ['agentflow:ready'],
      changeClass: 'standard',
      ...fields,
    })
  return { root, queues, sources, prepared, bridgeFor, makeItem }
}

const liveIntake = (port) =>
  port.rows().filter((row) => row.body.startsWith('agentflow-intake/v1') && row.state === 'pending')

async function comment(source, refText, body) {
  const { id } = parseSourceRef(refText)
  const plan = await source.previewMutation({
    operation: 'add-comment',
    parameters: { id, body },
    actionBoundary: { effective: 'external-action' },
    // One entry per writer: the same text from two writers is two source entries.
    idempotencyKey: `comment-${source.writer}-${createHash('sha256').update(body).digest('hex').slice(0, 16)}`,
  })
  await source.flushReceipt(await source.applyMutation(plan, { confirm: plan.token }))
}

async function pass(source, refText, phase, seat, attempt = 1) {
  const { id } = parseSourceRef(refText)
  await comment(
    source,
    refText,
    formatRolePassComment({
      idempotencyKey: rolePassIdempotencyKey({ stableId: id, phase, status: 'pass', attempt }),
      phase,
      role: 'role',
      status: 'pass',
      seat,
      seatVerified: false,
      seatRig: null,
      body: `phase ${phase}`,
    }),
  )
}

describe('several delivery rigs: offers and the source claim (#586 AC1)', () => {
  it('offers an item to every delivery rig, one row per rig on its own port', async () => {
    const { queues, bridgeFor, makeItem, sources } = topology()
    const ref = makeItem({ partOf: '578' })
    const stableId = stableQueueId(parseSourceRef(ref))
    const result = await bridgeFor(CONTROL).intake(ref)
    expect(result).toMatchObject({
      status: 'queued',
      offers: [
        { rig: D1, qitemId: offerQueueId(stableId, D1), created: true },
        { rig: D2, qitemId: offerQueueId(stableId, D2), created: true },
      ],
    })
    expect(liveIntake(queues[D1])).toEqual([
      expect.objectContaining({
        qitemId: offerQueueId(stableId, D1),
        destination: `pm-analyst@${D1}`,
        source: bridgeSessionFor(rigConfig(), sources[CONTROL]),
      }),
    ])
    expect(liveIntake(queues[D2])[0].destination).toBe(`pm-analyst@${D2}`)
    expect(queues[CONTROL].rows()).toEqual([])
    // A repeated push creates nothing on either rig.
    expect(await bridgeFor(CONTROL).intake(ref)).toMatchObject({ status: 'already-queued' })
    expect(queues[D1].rows()).toHaveLength(1)
    expect(queues[D2].rows()).toHaveLength(1)
  })

  it('two rigs starting the same item concurrently: exactly one works it, the other yields', async () => {
    for (let round = 0; round < 8; round += 1) {
      const { queues, prepared, bridgeFor, makeItem, sources } = topology()
      const ref = makeItem()
      const { offers } = await bridgeFor(CONTROL).intake(ref)
      const [one, two] = offers
      const results = await Promise.all([
        bridgeFor(D1).start(one.qitemId, { session: `pm-analyst@${D1}` }),
        bridgeFor(D2).start(two.qitemId, { session: `pm-analyst@${D2}` }),
      ])
      const statuses = results.map((result) => result.status).sort()
      expect(statuses).toEqual(['started', 'yielded'])
      const winner = results.find((result) => result.status === 'started').rig
      const loser = winner === D1 ? D2 : D1
      const loserOffer = offers.find((offer) => offer.rig === loser)
      expect(await queues[loser].show(loserOffer.qitemId)).toMatchObject({
        state: 'done',
        closureReason: 'canceled',
        resolution: `claimed by ${winner}`,
      })
      // One workflow instance in total, on the winner; no worktree on the loser.
      expect(queues[winner].instances()).toHaveLength(1)
      expect(queues[loser].instances()).toHaveLength(0)
      expect(prepared[winner]).toHaveLength(1)
      expect(prepared[loser]).toHaveLength(0)
      const claim = await sources[CONTROL].readClaim({ id: parseSourceRef(ref).id })
      expect(claim).toMatchObject({ status: 'held', holder: { kind: 'rig', rig: winner } })
    }
  })

  it('two concurrent processes on one root: exactly one works the item', async () => {
    const script = join(tempDir('agentflow-race-script-'), 'start-offer.mjs')
    const url = (path) => pathToFileURL(join(LIB, path)).href
    writeFileSync(
      script,
      [
        `import { createBridge } from ${JSON.stringify(url('bridge/bridge.mjs'))}`,
        `import { normalizeBridgeConfig } from ${JSON.stringify(url('bridge/config.mjs'))}`,
        `import { createMemoryQueuePort } from ${JSON.stringify(url('bridge/memory-queue.mjs'))}`,
        `import { createFilesystemSourceAdapter } from ${JSON.stringify(url('sources/filesystem-source.mjs'))}`,
        'const [root, rig, writer, trusted, offer, startAt] = process.argv.slice(2)',
        'const queue = createMemoryQueuePort()',
        'const row = JSON.parse(offer)',
        'await queue.create(row)',
        "const source = createFilesystemSourceAdapter({ root, writer, trustedWriters: trusted.split(',') })",
        `const config = normalizeBridgeConfig({ rigs: { control: ${JSON.stringify(CONTROL)}, delivery: [${JSON.stringify(D1)}, ${JSON.stringify(D2)}] }, source: { adapter: 'filesystem' } })`,
        'const bridge = createBridge({ source, queue, config })',
        'while (Date.now() < Number(startAt)) {}',
        "const result = await bridge.start(row.id, { session: 'pm-analyst@' + rig })",
        'process.stdout.write(JSON.stringify({ rig, status: result.status, instances: queue.instances().length, row: await queue.show(row.id) }))',
      ].join('\n'),
    )
    const run = (args) =>
      new Promise((done, failed) => {
        const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => (stdout += chunk))
        child.stderr.on('data', (chunk) => (stderr += chunk))
        child.on('error', failed)
        child.on('close', (code) => done({ code, stdout, stderr }))
      })
    for (let round = 0; round < 3; round += 1) {
      const { bridgeFor, makeItem, queues, sources, root } = topology()
      const ref = makeItem()
      const { offers } = await bridgeFor(CONTROL).intake(ref)
      // Both processes spin until the same instant, then start.
      const startAt = Date.now() + 1500
      const outputs = await Promise.all(
        offers.map((offer) => {
          const row = queues[offer.rig].rows()[0]
          const input = {
            id: row.qitemId,
            destination: row.destination,
            source: row.source,
            body: row.body,
            tags: row.tags,
          }
          return run([
            script,
            root,
            offer.rig,
            WRITERS[offer.rig],
            TRUSTED.join(','),
            JSON.stringify(input),
            String(startAt),
          ])
        }),
      )
      const results = outputs.map((output) => {
        expect(output.code, output.stderr).toBe(0)
        return JSON.parse(output.stdout)
      })
      expect(results.map((result) => result.status).sort()).toEqual(['started', 'yielded'])
      const winner = results.find((result) => result.status === 'started')
      const loser = results.find((result) => result.status === 'yielded')
      expect(winner.instances).toBe(1)
      expect(loser.instances).toBe(0)
      expect(loser.row).toMatchObject({
        closureReason: 'canceled',
        resolution: `claimed by ${winner.rig}`,
      })
      const claim = await sources[CONTROL].readClaim({ id: parseSourceRef(ref).id })
      expect(claim.holder.rig).toBe(winner.rig)
    }
  }, 30000)

  it('a start from a session on no delivery rig is refused', async () => {
    const { bridgeFor, makeItem } = topology()
    const { offers } = await bridgeFor(CONTROL).intake(makeItem())
    await expect(
      bridgeFor(D1).start(offers[0].qitemId, { session: 'pm-analyst@elsewhere' }),
    ).rejects.toMatchObject({ status: 'refused', exitCode: 1 })
  })
})

describe('partition narrows offers (#586)', () => {
  it('offers a mapped mission only to its rig; an unmapped item goes to every rig', async () => {
    const { queues, bridgeFor, makeItem } = topology({
      config: { partition: { key: 'mission', map: { 578: [D2] } } },
    })
    const mapped = await bridgeFor(CONTROL).intake(makeItem({ partOf: '578' }))
    expect(mapped.offers.map((offer) => offer.rig)).toEqual([D2])
    expect(queues[D1].rows()).toHaveLength(0)
    const unmapped = await bridgeFor(CONTROL).intake(makeItem({ partOf: '900' }))
    expect(unmapped.offers.map((offer) => offer.rig)).toEqual([D1, D2])
  })

  it('an area partition reads the label after the prefix', async () => {
    const { bridgeFor, makeItem } = topology({
      config: { partition: { key: 'area', map: { docs: [D1] } } },
    })
    const result = await bridgeFor(CONTROL).intake(
      makeItem({ labels: ['agentflow:ready', 'area:docs'] }),
    )
    expect(result.offers.map((offer) => offer.rig)).toEqual([D1])
  })
})

describe('a source without claim limits the project to one delivery rig (#586 AC4)', () => {
  it('several delivery rigs over a source lacking claim is a configuration error naming the limit', () => {
    const { sources } = topology()
    const noClaim = {
      ...sources[CONTROL],
      capabilities: sources[CONTROL].capabilities.filter((item) => item !== 'claim'),
    }
    let error = null
    try {
      createBridge({ source: noClaim, queue: createMemoryQueuePort(), config: rigConfig() })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({
      status: 'invalid-config',
      exitCode: 1,
      detail: { maxDeliveryRigs: 1, reasons: ['source adapter filesystem does not declare claim'] },
    })
    expect(error.message).toContain('source adapter filesystem does not declare claim')
    // One delivery rig over the same source is fine.
    expect(() =>
      createBridge({
        source: noClaim,
        queue: createMemoryQueuePort(),
        config: normalizeBridgeConfig({ rig: D1, source: { adapter: 'filesystem' } }),
      }),
    ).not.toThrow()
  })
})

describe('delivery rigs work without the control rig (#586 AC5)', () => {
  // A port whose every call fails: the control rig is down.
  function downPort(calls) {
    return new Proxy(
      {},
      {
        get: (_target, name) => () => {
          calls.push(String(name))
          throw new Error(`control rig is down (${String(name)})`)
        },
      },
    )
  }

  it('start and evidence touch only the delivery rig; claimed work finishes and no new offers arrive', async () => {
    const control = []
    const queues = {
      [CONTROL]: createMemoryQueuePort(),
      [D1]: createMemoryQueuePort(),
      [D2]: createMemoryQueuePort(),
    }
    const { bridgeFor, makeItem, root } = topology({
      queues,
      config: { source: { adapter: 'filesystem', claimWriters: TRUSTED } },
    })
    const ref = makeItem()
    const { offers } = await bridgeFor(CONTROL).intake(ref)
    // The control rig stops after the offers went out.
    queues[CONTROL] = downPort(control)
    const d1 = bridgeFor(D1)
    const started = await d1.start(offers[0].qitemId, { session: `pm-analyst@${D1}` })
    expect(started.status).toBe('started')
    const evidenceSource = createFilesystemSourceAdapter({
      root,
      writer: WRITERS[D1],
      trustedWriters: TRUSTED,
    })
    const evidence = createBridge({
      source: evidenceSource,
      queues,
      config: rigConfig({ source: { adapter: 'filesystem', claimWriters: TRUSTED } }),
    })
    const recorded = await evidence.recordEvidence(ref, {
      phase: 0,
      status: 'pass',
      seat: 'pm.manager',
      body: 'analysis',
      executedBy: 'claude',
      launcher: 'claude',
      executor: 'claude-cli',
      transport: 'local-cli',
      delegationBoundary: 'separate-local-session',
      session: `pm-manager@${D1}`,
    })
    expect(recorded.status).toBe('recorded')
    expect(control).toEqual([])
    // Nothing creates offers while the control rig is down: d1 idles once its work is done.
    expect(liveIntake(queues[D1])).toEqual([])
    // d2's own offer is still there; its start yields to d1's claim without the control rig.
    const yielded = await bridgeFor(D2).start(offers[1].qitemId, { session: `pm-analyst@${D2}` })
    expect(yielded).toMatchObject({ status: 'yielded', holder: { rig: D1 } })
    expect(liveIntake(queues[D2])).toEqual([])
    expect(control).toEqual([])
  })
})

describe('adding a delivery rig needs no change to running rigs (#586 AC2)', () => {
  it('work queued with one rig stays visible after a second rig is configured', async () => {
    const root = tempDir('agentflow-add-rig-')
    const queue = createMemoryQueuePort()
    const source = createFilesystemSourceAdapter({
      root,
      writer: BRIDGE_WRITER,
      trustedWriters: TRUSTED,
    })
    const ref = createFilesystemWorkItem(root, { id: 'a', title: 't', labels: ['agentflow:ready'] })
    const one = createBridge({
      source,
      queue,
      config: normalizeBridgeConfig({
        rigs: { control: CONTROL, delivery: [D1] },
        source: { adapter: 'filesystem' },
      }),
    })
    expect(await one.intake(ref)).toMatchObject({
      status: 'queued',
      qitemId: stableQueueId(parseSourceRef(ref)),
    })
    // The operator appends d2 to rigs.delivery; the running d1 row is still the item's work.
    const two = createBridge({ source, queue, config: rigConfig() })
    expect(await two.intake(ref)).toMatchObject({ status: 'already-queued' })
    expect(queue.rows()).toHaveLength(1)
  })
})

describe('gate resolution stays outside the rig (decision 9)', () => {
  it('refuses review-done, merged, closed and reconcile from a delivery seat or delivery rig session', async () => {
    const { bridgeFor, makeItem } = topology()
    const ref = makeItem()
    const control = bridgeFor(CONTROL)
    const refused = [
      null,
      '',
      `dev-build@${D1}`,
      `rev-review@${CONTROL}`,
      `pm-analyst@${D1}`,
      `human@${D1}`,
      `bridge@${D1}`,
    ]
    for (const session of refused) {
      for (const event of ['review-done', 'merged', 'closed']) {
        await expect(control.intake(ref, { event, session })).rejects.toMatchObject({
          status: 'refused',
        })
      }
      await expect(control.reconcile({ session })).rejects.toMatchObject({ status: 'refused' })
      await expect(control.release(ref, { session })).rejects.toMatchObject({ status: 'refused' })
    }
    // A control-rig product seat or a named person outside the delivery rigs may.
    for (const session of [`pm-manager@${CONTROL}`, `human@${CONTROL}`, 'ci@external']) {
      expect((await control.intake(ref, { event: 'review-done', session })).status).toBe(
        'not-ready',
      )
    }
    // The ready event is not a gate resolution.
    expect((await control.intake(ref, { event: 'ready', session: `dev-build@${D1}` })).status).toBe(
      'queued',
    )
  })
})

describe('roster gate decisions before resolving the review gate (#585 follow-up)', () => {
  const roster = {
    version: 1,
    people: [
      {
        id: 'sam',
        handles: { filesystem: 'sam-writer' },
        scopes: [{ gates: ['acceptance-review'], tiers: ['standard'] }],
      },
    ],
  }

  async function reviewed(root, ref, attempt = 1) {
    const bot = createFilesystemSourceAdapter({
      root,
      writer: BRIDGE_WRITER,
      trustedWriters: TRUSTED,
    })
    await pass(bot, ref, 4, 'dev.build', attempt)
    await pass(bot, ref, 6, 'rev.review', attempt)
    return bot
  }
  const writerOn = (root, writer) =>
    createFilesystemSourceAdapter({ root, writer, trustedWriters: TRUSTED })

  const HEAD = 'a'.repeat(40)
  const atHead = { roster, candidateHead: async () => HEAD }

  it('resolves the review gate only after an in-scope roster person agrees on the current digest', async () => {
    const { queues, bridgeFor, makeItem, root } = topology({ bridgeOptions: atHead })
    const ref = makeItem()
    const stableId = stableQueueId(parseSourceRef(ref))
    const { offers } = await bridgeFor(CONTROL).intake(ref)
    const d1 = queues[D1]
    await d1.block(offers[0].qitemId, { on: `external:review:${stableId}` })
    const bot = await reviewed(root, ref)
    const control = bridgeFor(CONTROL)
    // Agent review alone does not open a person gate; the report names the digest-bound gate id.
    const first = await control.intake(ref, { event: 'review-done', session: OPERATOR })
    expect(first).toMatchObject({ status: 'not-ready', gate: { satisfied: false } })
    const gateId = first.gate.gateId
    expect(gateId).toMatch(new RegExp(`^${ref.replace(/[.#]/g, '\\$&')}:review:[0-9a-f]{64}$`))
    // A decision written by a bridge writer, or by someone off the roster, counts for nothing.
    const decision = formatGateDecision({ gate: gateId, decision: 'agree' })
    await comment(bot, ref, decision)
    await comment(writerOn(root, 'mallory'), ref, decision)
    const second = await control.intake(ref, { event: 'review-done', session: OPERATOR })
    expect(second.status).toBe('not-ready')
    expect(second.gate.ignored.map((item) => item.reason)).toEqual([
      'bot-writer',
      'writer-not-on-roster',
    ])
    expect((await d1.show(offers[0].qitemId)).state).toBe('blocked')
    await comment(writerOn(root, 'sam-writer'), ref, decision)
    const third = await control.intake(ref, { event: 'review-done', session: OPERATOR })
    expect(third).toMatchObject({
      status: 'resolved',
      resolved: [offers[0].qitemId],
      gate: { gateId, satisfied: true, approvedBy: 'sam' },
    })
    expect(third.decision).toMatch(/\/log\/\d+$/)
  })

  it('an agreement for an older evidence digest does not satisfy review-done', async () => {
    const { queues, bridgeFor, makeItem, root } = topology({ bridgeOptions: atHead })
    const ref = makeItem()
    const stableId = stableQueueId(parseSourceRef(ref))
    const { offers } = await bridgeFor(CONTROL).intake(ref)
    const d1 = queues[D1]
    const control = bridgeFor(CONTROL)
    const sam = writerOn(root, 'sam-writer')
    await reviewed(root, ref)
    const roundOne = (await control.intake(ref, { event: 'review-done', session: OPERATOR })).gate
      .gateId
    await comment(sam, ref, formatGateDecision({ gate: roundOne, decision: 'agree' }))
    // A second build and review round: new evidence, new digest.
    await reviewed(root, ref, 2)
    await d1.block(offers[0].qitemId, { on: `external:review:${stableId}` })
    const stale = await control.intake(ref, { event: 'review-done', session: OPERATOR })
    expect(stale.status).toBe('not-ready')
    expect(stale.gate.gateId).not.toBe(roundOne)
    expect(stale.gate.ignored.map((item) => item.reason)).toEqual(['stale-gate'])
    expect((await d1.show(offers[0].qitemId)).state).toBe('blocked')
    await comment(sam, ref, formatGateDecision({ gate: stale.gate.gateId, decision: 'agree' }))
    expect(await control.intake(ref, { event: 'review-done', session: OPERATOR })).toMatchObject({
      status: 'resolved',
      resolved: [offers[0].qitemId],
    })
  })

  it('refuses an edited decision, and on a high-assurance item a decision without edit state', async () => {
    const { bridgeFor, makeItem, root, sources } = topology()
    const read = sources[CONTROL].readLogEntries.bind(sources[CONTROL])
    const ref = makeItem()
    await reviewed(root, ref)
    const sam = writerOn(root, 'sam-writer')
    const edited = bridgeFor(CONTROL, {
      ...atHead,
      gateEntries: async (reference) =>
        (await read(reference)).map((entry) =>
          entry.writer === 'sam-writer'
            ? { ...entry, edited: undefined, updatedAt: '2099-01-01T00:00:00.000Z' }
            : entry,
        ),
    })
    const gateId = (await edited.intake(ref, { event: 'review-done', session: OPERATOR })).gate
      .gateId
    await comment(sam, ref, formatGateDecision({ gate: gateId, decision: 'agree' }))
    const refused = await edited.intake(ref, { event: 'review-done', session: OPERATOR })
    expect(refused.status).toBe('not-ready')
    expect(refused.gate.ignored.map((item) => item.reason)).toEqual(['edited-entry'])
    // The same entry unedited, as the filesystem log reports it, satisfies the gate.
    expect(
      (
        await bridgeFor(CONTROL, atHead).intake(ref, {
          event: 'review-done',
          session: OPERATOR,
        })
      ).gate,
    ).toMatchObject({ satisfied: true, approvedBy: 'sam' })

    const haRoster = {
      version: 1,
      people: [
        {
          id: 'sam',
          handles: { filesystem: 'sam-writer' },
          scopes: [{ gates: ['security-review', 'acceptance-review'], tiers: ['high-assurance'] }],
        },
      ],
    }
    const ha = makeItem({ changeClass: 'high-assurance' })
    await reviewed(root, ha)
    const unknown = bridgeFor(CONTROL, {
      roster: haRoster,
      candidateHead: atHead.candidateHead,
      gateEntries: async (reference) =>
        (await read(reference)).map(({ writer, body, uri }) => ({ writer, body, uri })),
    })
    const haGate = (await unknown.intake(ha, { event: 'review-done', session: OPERATOR })).gate
      .gateId
    for (const review of ['security-review', 'acceptance-review']) {
      await comment(sam, ha, formatGateDecision({ gate: haGate, decision: 'agree', review }))
    }
    const haResult = await unknown.intake(ha, { event: 'review-done', session: OPERATOR })
    expect(haResult.status).toBe('not-ready')
    expect(haResult.gate.ignored.map((item) => item.reason)).toEqual([
      'edit-state-unknown',
      'edit-state-unknown',
    ])
  })

  it('fails closed when the source cannot list its log entries', async () => {
    const { makeItem, root } = topology()
    const ref = makeItem()
    const bot = await reviewed(root, ref)
    const blind = createBridge({
      source: { ...bot, readLogEntries: undefined },
      queue: createMemoryQueuePort(),
      config: rigConfig(),
      ...atHead,
    })
    expect(await blind.intake(ref, { event: 'review-done', session: OPERATOR })).toMatchObject({
      status: 'not-ready',
      gate: { reason: 'source-log-unavailable' },
    })
  })
})

// Rigs on one OpenRig daemon share one queue port.
function sharedTopology(options = {}) {
  const port = createMemoryQueuePort()
  return { port, ...topology({ ...options, queues: { [CONTROL]: port, [D1]: port, [D2]: port } }) }
}
const withRigs = (delivery, extra = {}) => ({
  config: rigConfig({ rigs: { control: CONTROL, delivery }, ...extra }),
})
const live = (port) =>
  port.rows().filter((row) => ['pending', 'in-progress', 'blocked'].includes(row.state))
const intakeRows = (port) => live(port).filter((row) => row.body.startsWith('agentflow-intake/v1'))

describe('changing the delivery rigs never hides live work (review round 1)', () => {
  it('a removed rig: its live offer still counts, nothing is queued again, and only its own rig may start it', async () => {
    const { port, bridgeFor, makeItem } = sharedTopology()
    const ref = makeItem()
    const { offers } = await bridgeFor(CONTROL).intake(ref)
    expect(intakeRows(port)).toHaveLength(2)
    // The operator drops d2 from rigs.delivery.
    const control = bridgeFor(CONTROL, withRigs([D1]))
    expect(await control.intake(ref)).toMatchObject({ status: 'already-queued' })
    expect((await control.reconcile({ session: OPERATOR })).restored).toEqual([])
    expect(intakeRows(port)).toHaveLength(2)
    // d1 may not start d2's offer.
    const d2Offer = offers.find((offer) => offer.rig === D2).qitemId
    await expect(
      bridgeFor(D1, withRigs([D1])).start(d2Offer, { session: `pm-analyst@${D1}` }),
    ).rejects.toMatchObject({ status: 'refused' })
  })

  it('config flipping between one and two rigs queues nothing twice', async () => {
    const { port, bridgeFor, makeItem } = sharedTopology()
    const ref = makeItem()
    expect((await bridgeFor(CONTROL, withRigs([D1])).intake(ref)).status).toBe('queued')
    for (const delivery of [[D1, D2], [D1], [D2], [D1, D2]]) {
      expect((await bridgeFor(CONTROL, withRigs(delivery)).intake(ref)).status).toBe(
        'already-queued',
      )
      expect(
        (await bridgeFor(CONTROL, withRigs(delivery)).reconcile({ session: OPERATOR })).restored,
      ).toEqual([])
    }
    expect(intakeRows(port)).toHaveLength(1)
  })

  it('a re-added rig gets offers again only for new work', async () => {
    const { port, bridgeFor, makeItem } = sharedTopology()
    const before = makeItem()
    await bridgeFor(CONTROL, withRigs([D1])).intake(before)
    const after = makeItem()
    const result = await bridgeFor(CONTROL).intake(after)
    expect(result.offers.map((offer) => offer.rig)).toEqual([D1, D2])
    expect(intakeRows(port)).toHaveLength(3)
  })

  it('two concurrent starts of two rows of one item on the same rig make one instance', async () => {
    for (let round = 0; round < 6; round += 1) {
      const { port, bridgeFor, makeItem } = sharedTopology()
      const ref = makeItem()
      const { offers } = await bridgeFor(CONTROL).intake(ref)
      const mine = offers.find((offer) => offer.rig === D1).qitemId
      // A second row offered to d1 for the same item (as an earlier configuration could leave).
      const row = await port.show(mine)
      await port.create({
        id: `${mine}-g2`,
        destination: row.destination,
        source: row.source,
        body: row.body,
        tags: row.tags,
      })
      const d1 = bridgeFor(D1)
      const results = await Promise.all([
        d1.start(mine, { session: `pm-analyst@${D1}` }),
        d1.start(`${mine}-g2`, { session: `pm-analyst@${D1}` }),
      ])
      expect(results.filter((result) => result.status === 'started').length).toBeLessThanOrEqual(1)
      expect(port.instances().filter((instance) => instance.status === 'active')).toHaveLength(
        results.some((result) => result.status === 'started') ? 1 : 0,
      )
    }
  })
})

describe('claim recovery (review round 1)', () => {
  it('a start that fails after the claim puts its row back and releases the claim', async () => {
    const { port, bridgeFor, makeItem, sources } = sharedTopology()
    const ref = makeItem()
    const { offers } = await bridgeFor(CONTROL).intake(ref)
    const [one, two] = offers
    await expect(
      bridgeFor(D1, {
        worktrees: {
          prepare: async () => {
            throw new Error('disk full')
          },
        },
      }).start(one.qitemId, { session: `pm-analyst@${D1}` }),
    ).rejects.toThrow('disk full')
    // Nothing was instantiated: the row is pending again for the next start.
    expect(await port.show(one.qitemId)).toMatchObject({ state: 'pending' })
    const id = parseSourceRef(ref).id
    expect(await sources[CONTROL].readClaim({ id })).toMatchObject({ status: 'free' })
    // The other rig can now take the item.
    expect((await bridgeFor(D2).start(two.qitemId, { session: `pm-analyst@${D2}` })).status).toBe(
      'started',
    )
  })

  it('after a hard crash between claim and instance, the holder resumes its row with --resume', async () => {
    const { port, bridgeFor, makeItem, sources } = sharedTopology()
    const ref = makeItem()
    const { offers } = await bridgeFor(CONTROL).intake(ref)
    const mine = offers.find((offer) => offer.rig === D1).qitemId
    const id = parseSourceRef(ref).id
    // The start died after it claimed the row and the item.
    await port.claim(mine, { session: `pm-analyst@${D1}` })
    await sources[D1].claim({ id }, { kind: 'rig', rig: D1, host: 'local' })
    const d1 = bridgeFor(D1)
    expect((await d1.start(mine, { session: `pm-analyst@${D1}` })).status).toBe('already-started')
    // Within the lease (the row's claim time) a resume is refused: the start may still run.
    await expect(
      d1.start(mine, { session: `pm-analyst@${D1}`, resume: true }),
    ).rejects.toMatchObject({ status: 'refused' })
    const later = bridgeFor(D1, { clock: () => new Date(Date.now() + 3_600_000) })
    expect(await later.start(mine, { session: `pm-analyst@${D1}`, resume: true })).toMatchObject({
      status: 'started',
      resumed: true,
    })
    expect(port.instances()).toHaveLength(1)
  })

  it("a removed rig's claim is released by a person, then another rig takes the item", async () => {
    const { bridgeFor, makeItem, sources } = sharedTopology()
    const ref = makeItem()
    const id = parseSourceRef(ref).id
    await sources[D1].claim({ id }, { kind: 'rig', rig: D1, host: 'local' })
    const onlyD2 = withRigs([D2])
    const first = await bridgeFor(CONTROL, onlyD2).intake(ref)
    expect(
      await bridgeFor(D2, onlyD2).start(first.qitemId, { session: `pm-analyst@${D2}` }),
    ).toMatchObject({ status: 'yielded', holder: { rig: D1 } })
    const control = bridgeFor(CONTROL, onlyD2)
    expect(await control.release(ref, { session: OPERATOR })).toMatchObject({
      status: 'released',
      holder: { rig: D1 },
    })
    expect(await control.release(ref, { session: OPERATOR })).toMatchObject({ status: 'free' })
    const second = await control.intake(ref)
    expect(
      (await bridgeFor(D2, onlyD2).start(second.qitemId, { session: `pm-analyst@${D2}` })).status,
    ).toBe('started')
    expect(await sources[CONTROL].readClaim({ id })).toMatchObject({ holder: { rig: D2 } })
  })

  it('closing the item releases its claim', async () => {
    const { bridgeFor, makeItem, sources } = sharedTopology()
    const ref = makeItem()
    const { offers } = await bridgeFor(CONTROL).intake(ref)
    await bridgeFor(D1).start(offers[0].qitemId, { session: `pm-analyst@${D1}` })
    const id = parseSourceRef(ref).id
    const plan = await sources[CONTROL].previewMutation({
      operation: 'set-lifecycle',
      parameters: { id, lifecycle: 'closed' },
      actionBoundary: { effective: 'external-action' },
    })
    await sources[CONTROL].flushReceipt(
      await sources[CONTROL].applyMutation(plan, { confirm: plan.token }),
    )
    expect(
      await bridgeFor(CONTROL).intake(ref, { event: 'closed', session: OPERATOR }),
    ).toMatchObject({ status: 'aborted', released: { rig: D1 } })
    expect(await sources[CONTROL].readClaim({ id })).toMatchObject({ status: 'free' })
  })
})

describe('backpressure end to end (review round 1)', () => {
  it('a workflow parked at review counts as an open gate; intake waits until review resolves', async () => {
    let admission = null
    const { port, bridgeFor, makeItem, sources, root } = sharedTopology({
      config: { maxOpenGates: 1 },
      bridgeOptions: { admission: (input) => admission(input) },
    })
    admission = gateCapacityAdmission({ source: sources[CONTROL], maxOpenGates: 1 })
    const a = makeItem()
    const { offers } = await bridgeFor(CONTROL).intake(a)
    const started = await bridgeFor(D1).start(offers[0].qitemId, { session: `pm-analyst@${D1}` })
    // The workflow reaches review and parks on the review gate.
    const stableA = stableQueueId(parseSourceRef(a))
    await port.block(started.packetId, { on: `external:review:${stableA}` })
    const b = makeItem()
    expect(await bridgeFor(CONTROL).intake(b)).toMatchObject({
      status: 'deferred',
      reason: 'gate-capacity',
      openGates: 1,
      capacity: 1,
    })
    const stableB = stableQueueId(parseSourceRef(b))
    expect(intakeRows(port).filter((row) => row.tags.includes(`af:${stableB}`))).toEqual([])
    // Review passes and the review-done push resolves the gate.
    await reviewedBy(root, a)
    expect(
      await bridgeFor(CONTROL).intake(a, { event: 'review-done', session: OPERATOR }),
    ).toMatchObject({ status: 'resolved', resolved: [started.packetId] })
    expect((await sources[CONTROL].readWorkItem({ id: parseSourceRef(a).id })).openGates).toBe(0)
    expect((await bridgeFor(CONTROL).intake(b)).status).toBe('queued')
  })

  it('a gate resolved outside the bridge is closed in the source on the next pass', async () => {
    let admission = null
    const { port, bridgeFor, makeItem, sources } = sharedTopology({
      bridgeOptions: { admission: (input) => admission(input) },
    })
    admission = gateCapacityAdmission({ source: sources[CONTROL], maxOpenGates: 1 })
    const a = makeItem()
    const { offers } = await bridgeFor(CONTROL).intake(a)
    const started = await bridgeFor(D1).start(offers[0].qitemId, { session: `pm-analyst@${D1}` })
    const stableA = stableQueueId(parseSourceRef(a))
    await port.block(started.packetId, { on: `external:merge:${stableA}` })
    const b = makeItem()
    expect((await bridgeFor(CONTROL).intake(b)).status).toBe('deferred')
    await port.resolve(started.packetId, { decision: 'a person resolved it in the queue' })
    expect((await bridgeFor(CONTROL).intake(b)).status).toBe('queued')
  })

  it('one reconcile pass admits no more items than capacity allows', async () => {
    let admission = null
    const { bridgeFor, makeItem, sources } = sharedTopology({
      bridgeOptions: { admission: (input) => admission(input) },
    })
    admission = gateCapacityAdmission({ source: sources[CONTROL], maxOpenGates: 2 })
    for (let index = 0; index < 3; index += 1) makeItem()
    const report = await bridgeFor(CONTROL).reconcile({ session: OPERATOR })
    expect(report.restored).toHaveLength(2)
    expect(report.deferred).toEqual([
      expect.objectContaining({ reason: 'gate-capacity', openGates: 0, pending: 2, capacity: 2 }),
    ])
  })
})

describe('the review digest binds the candidate head (review round 1)', () => {
  const roster = {
    version: 1,
    people: [
      {
        id: 'sam',
        handles: { filesystem: 'sam-writer' },
        scopes: [{ gates: ['acceptance-review'], tiers: ['standard'] }],
      },
    ],
  }

  it('a commit pushed after the agreement makes it stale', async () => {
    let head = '1'.repeat(40)
    const { bridgeFor, makeItem, root } = sharedTopology({
      bridgeOptions: { roster, candidateHead: async () => head },
    })
    const ref = makeItem()
    await reviewedBy(root, ref)
    const control = bridgeFor(CONTROL)
    const before = await control.intake(ref, { event: 'review-done', session: OPERATOR })
    expect(before.gate.candidateHead).toBe(head)
    const sam = createFilesystemSourceAdapter({
      root,
      writer: 'sam-writer',
      trustedWriters: TRUSTED,
    })
    await comment(sam, ref, formatGateDecision({ gate: before.gate.gateId, decision: 'agree' }))
    expect(
      (await control.intake(ref, { event: 'review-done', session: OPERATOR })).gate,
    ).toMatchObject({ satisfied: true })
    head = '2'.repeat(40)
    const after = await control.intake(ref, { event: 'review-done', session: OPERATOR })
    expect(after.status).toBe('not-ready')
    expect(after.gate.gateId).not.toBe(before.gate.gateId)
    expect(after.gate.ignored.map((item) => item.reason)).toEqual(['stale-gate'])
  })

  it('an unknown candidate head opens no roster gate', async () => {
    const { bridgeFor, makeItem, root } = sharedTopology({ bridgeOptions: { roster } })
    const ref = makeItem()
    await reviewedBy(root, ref)
    expect(
      await bridgeFor(CONTROL).intake(ref, { event: 'review-done', session: OPERATOR }),
    ).toMatchObject({ status: 'not-ready', gate: { reason: 'candidate-head-unknown' } })
  })
})

async function reviewedBy(root, ref) {
  const bot = createFilesystemSourceAdapter({
    root,
    writer: BRIDGE_WRITER,
    trustedWriters: TRUSTED,
  })
  await pass(bot, ref, 4, 'dev.build')
  await pass(bot, ref, 6, 'rev.review')
}
