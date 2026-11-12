import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseSourceRef } from '../core/source-ref.mjs'
import { parseRolePassComment } from '../core/role-pass-evidence.mjs'
import { RIG, bridgeFixture, cleanupBridgeFixtures } from './bridge-fixture.mjs'

afterEach(cleanupBridgeFixtures)

const provenance = {
  executedBy: 'codex',
  launcher: 'claude',
  executor: 'codex-cli',
  transport: 'local-cli',
  delegationBoundary: 'separate-local-session',
  model: 'gpt-6.1-sol',
}

function comments(root, ref) {
  const { id } = parseSourceRef(ref)
  return readFileSync(join(root, 'items', id, 'log.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.type === 'comment')
}

describe('bridge evidence (#582)', () => {
  it('AC7: writes one role-pass comment with separate provenance fields; a retry writes nothing', async () => {
    const { bridge, makeItem, root } = bridgeFixture()
    const ref = makeItem()
    const input = {
      phase: 0,
      status: 'pass',
      seat: 'pm.manager',
      body: 'framed',
      session: `pm-manager@${RIG}`,
      ...provenance,
    }
    const first = await bridge.recordEvidence(ref, input)
    expect(first).toMatchObject({ status: 'recorded', seatVerified: true })
    expect(first.idempotencyKey).toMatch(/^rp-[0-9a-f]{24}$/)
    const again = await bridge.recordEvidence(ref, input)
    expect(again).toMatchObject({ status: 'already-recorded', uri: first.uri })
    const written = comments(root, ref)
    expect(written).toHaveLength(1)
    expect(parseRolePassComment(written[0].body)).toMatchObject({
      phase: 0,
      role: 'product-manager',
      seat: 'pm.manager',
      seatVerified: true,
      seatRig: RIG,
      ...provenance,
      body: 'framed',
    })
  })

  it('AC7: rejects values outside the provenance vocabularies and illegal transitions', async () => {
    const { bridge, makeItem, root } = bridgeFixture()
    const ref = makeItem()
    const base = { phase: 0, status: 'pass', seat: 'pm.manager', body: 'x', ...provenance }
    for (const bad of [
      { executedBy: 'nobody' },
      { launcher: 'Claude Code' },
      { executor: 'teleport' },
      { transport: 'pigeon' },
      { delegationBoundary: 'anywhere' },
      { model: 'two\nlines' },
      { phase: 4, seat: 'dev.build' },
      { seat: 'dev.build' },
    ]) {
      await expect(bridge.recordEvidence(ref, { ...base, ...bad })).rejects.toMatchObject({
        status: 'refused',
        exitCode: 1,
      })
    }
    expect(comments(root, ref)).toHaveLength(0)
  })

  it('AC8: phase 6 pass needs the reviewer session, distinct from the builder', async () => {
    const { bridge, makeItem, pass, root } = bridgeFixture()
    const ref = makeItem()
    await pass(ref, [0, 1, 2, 3, 4, 5], { seatRig: RIG, seats: { 4: 'dev.build' } })
    const review = { phase: 6, status: 'pass', seat: 'rev.review', body: 'ok', ...provenance }
    for (const [session, message] of [
      [null, /needs the reviewer's OpenRig session/],
      ['someone@elsewhere', /does not hold the review seat/],
      ['not a session', /needs the reviewer's OpenRig session/],
      [`dev-build@${RIG}`, /does not hold the review seat/],
    ]) {
      await expect(bridge.recordEvidence(ref, { ...review, session })).rejects.toMatchObject({
        status: 'refused',
        message: expect.stringMatching(message),
      })
    }
    expect(comments(root, ref)).toHaveLength(6)
    await expect(
      bridge.recordEvidence(ref, { ...review, session: 'rev-review@another-rig' }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/not on the configured rig/) })
    await expect(
      bridge.recordEvidence(ref, { ...review, session: `rev-review@${RIG}` }),
    ).resolves.toMatchObject({ status: 'recorded', seatVerified: true })
  })

  it('ignores evidence from an untrusted writer for validation and retry detection', async () => {
    const { bridge, makeItem, pass, root } = bridgeFixture()
    const ref = makeItem()
    // A stranger forges a phase 0 pass; it neither satisfies the phase graph nor counts as a retry.
    await pass(ref, [0, 1, 2], { writer: 'stranger' })
    const phase3 = { phase: 3, status: 'pass', seat: 'orch.arch', body: 'x', ...provenance }
    await expect(bridge.recordEvidence(ref, phase3)).rejects.toMatchObject({
      status: 'refused',
      message: expect.stringMatching(/not allowed after no transitions/),
    })
    const phase0 = { phase: 0, status: 'pass', seat: 'pm.manager', body: 'x', ...provenance }
    expect(await bridge.recordEvidence(ref, phase0)).toMatchObject({ status: 'recorded' })
    expect(comments(root, ref)).toHaveLength(4)
  })

  it('treats no evidence as trusted when no evidence writers are configured, and says so', async () => {
    const { bridge, makeItem, pass } = bridgeFixture({
      config: { source: { adapter: 'filesystem' } },
    })
    const ref = makeItem()
    await pass(ref, [0])
    const phase1 = { phase: 1, status: 'pass', seat: 'pm.analyst', body: 'x', ...provenance }
    await expect(bridge.recordEvidence(ref, phase1)).rejects.toMatchObject({ status: 'refused' })
    expect(await bridge.status()).toMatchObject({
      evidenceWriters: [],
      evidenceTrust: 'no-evidence-writers-configured',
    })
  })

  it('enforces the return-cycle limit on bridge evidence (skip reasons reach the phase graph)', async () => {
    const { bridge, makeItem, pass } = bridgeFixture()
    const ref = makeItem()
    await pass(ref, [0, 1, 2, 3])
    const build = { phase: 4, status: 'pass', seat: 'dev.build', body: 'b', ...provenance }
    const back = {
      phase: 6,
      status: 'skipped',
      seat: 'rev.review',
      reason: 'return to phase 4',
      body: 'r',
      session: `rev-review@${RIG}`,
      ...provenance,
    }
    const tests = { phase: 5, status: 'pass', seat: 'dev.qa', body: 't', ...provenance }
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await bridge.recordEvidence(ref, build)
      await bridge.recordEvidence(ref, tests)
      await bridge.recordEvidence(ref, back)
    }
    await bridge.recordEvidence(ref, build)
    await bridge.recordEvidence(ref, tests)
    await expect(bridge.recordEvidence(ref, back)).rejects.toMatchObject({
      status: 'refused',
      message: expect.stringMatching(/Return cycle limit reached/),
    })
  })

  it('records an unverified seat when the caller session is another seat or absent', async () => {
    const { bridge, makeItem } = bridgeFixture()
    const ref = makeItem()
    const result = await bridge.recordEvidence(ref, {
      phase: 0,
      status: 'pass',
      seat: 'pm.manager',
      body: 'x',
      ...provenance,
    })
    expect(result).toMatchObject({ status: 'recorded', seatVerified: false })
  })
})
