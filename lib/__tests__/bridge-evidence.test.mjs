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

  it('AC8: refuses phase 6 evidence from the session that built the change', async () => {
    const { bridge, makeItem, pass } = bridgeFixture()
    const ref = makeItem()
    await pass(ref, [0, 1, 2, 3, 4, 5])
    const review = { phase: 6, status: 'pass', seat: 'rev.review', body: 'ok', ...provenance }
    await expect(
      bridge.recordEvidence(ref, { ...review, session: `dev-build@${RIG}` }),
    ).rejects.toMatchObject({
      status: 'refused',
      message: expect.stringMatching(/built this change/),
    })
    await expect(
      bridge.recordEvidence(ref, { ...review, session: `rev-review@${RIG}` }),
    ).resolves.toMatchObject({ status: 'recorded', seatVerified: true })
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
