import { describe, expect, it, vi } from 'vitest'
import {
  CLAIM_MARKER,
  claimEntry,
  claimEntryProblems,
  claimOrYield,
  formatClaimMarker,
  ownersEqual,
  parseClaimMarker,
  releaseEntry,
  resolveClaim,
} from '../core/source-claim.mjs'

const rigA = { kind: 'rig', rig: 'agentflow-p-d1', host: 'local' }
const rigB = { kind: 'rig', rig: 'agentflow-p-d2', host: 'local' }
const person = { kind: 'person', id: 'sam' }
const at = '2026-11-11T10:00:00.000Z'
let n = 0
const id = () => (++n).toString(16).padStart(16, '0')

function log(...rows) {
  return rows.map(([entry, writer = 'bot'], position) => ({
    entry,
    writer,
    position,
    uri: `log#${position}`,
  }))
}
const claim = (owner) => claimEntry({ owner, claimId: id(), at })
const release = (owner) => releaseEntry({ owner, claimId: id(), at })
const trusted = { trustedWriters: ['bot'] }

describe('claim entries', () => {
  it('builds, renders and parses a claim marker', () => {
    const entry = claimEntry({ owner: rigA, claimId: 'a1b2c3d4e5f60718', at })
    expect(entry).toEqual({
      v: 1,
      type: 'claim',
      claimId: 'a1b2c3d4e5f60718',
      owner: rigA,
      at,
      cause: null,
    })
    const text = formatClaimMarker(entry)
    expect(text).toBe(`<!-- ${CLAIM_MARKER}${JSON.stringify(entry)} -->`)
    expect(parseClaimMarker(`${text}\nsome prose`)).toEqual(entry)
    expect(parseClaimMarker(`prose\n${text}`)).toBeNull()
    expect(parseClaimMarker('<!-- agentflow-claim:{not json} -->')).toBeNull()
    expect(parseClaimMarker(`<!-- ${CLAIM_MARKER}{"v":2} -->`)).toBeNull()
  })

  it('generates an id and time when omitted and accepts a mirror-change cause', () => {
    const entry = releaseEntry({
      owner: person,
      cause: { kind: 'mirror-change', actor: 'octo', eventId: '9' },
    })
    expect(entry.type).toBe('release')
    expect(entry.claimId).toMatch(/^[0-9a-f]{16}$/)
    expect(Number.isNaN(Date.parse(entry.at))).toBe(false)
    expect(claimEntryProblems(entry)).toEqual([])
  })

  it('reports problems in an entry', () => {
    expect(claimEntryProblems({ v: 1, type: 'grab', claimId: 'x', owner: {}, at: 'no' })).toEqual(
      expect.arrayContaining([
        'type must be claim or release',
        'claimId must be 16 lowercase hex characters',
        'owner.kind must be rig or person',
        'at must be an ISO timestamp',
      ]),
    )
    expect(claimEntryProblems({ ...claim(rigA), writer: 'forged' })).toContain(
      'unexpected key writer',
    )
    expect(() => claimEntry({ owner: { kind: 'rig' }, at })).toThrow('invalid claim entry')
  })

  it('compares owners by kind and identity', () => {
    expect(ownersEqual(rigA, { ...rigA })).toBe(true)
    expect(ownersEqual(rigA, { kind: 'rig', rig: 'agentflow-p-d1' })).toBe(false)
    expect(ownersEqual(rigA, rigB)).toBe(false)
    expect(ownersEqual(person, { kind: 'person', id: 'sam' })).toBe(true)
    expect(ownersEqual(person, { kind: 'rig', rig: 'sam' })).toBe(false)
    expect(ownersEqual(null, rigA)).toBe(false)
  })
})

describe('resolveClaim', () => {
  it('is free with no entries', () => {
    expect(resolveClaim([], trusted)).toMatchObject({ status: 'free', holder: null, ignored: [] })
  })

  it('earliest trusted claim wins and the loser is ignored', () => {
    const first = claim(rigA)
    const result = resolveClaim(log([first], [claim(rigB)]), trusted)
    expect(result).toMatchObject({ status: 'held', holder: rigA, entry: first, uri: 'log#0' })
    expect(result.ignored).toEqual([{ uri: 'log#1', reason: 'held-by-another-owner' }])
  })

  it('holder release frees the item for the next claim', () => {
    const result = resolveClaim(log([claim(rigA)], [release(rigA)], [claim(rigB)]), trusted)
    expect(result).toMatchObject({ status: 'held', holder: rigB, uri: 'log#2' })
  })

  it('a loser or non-holder release is ignored', () => {
    const result = resolveClaim(
      log([claim(rigA)], [claim(rigB)], [release(rigB)], [release(person)]),
      trusted,
    )
    expect(result).toMatchObject({ status: 'held', holder: rigA })
    expect(result.ignored.map((item) => item.reason)).toEqual([
      'held-by-another-owner',
      'release-by-non-holder',
      'release-by-non-holder',
    ])
  })

  it('ignores untrusted writers and invalid entries', () => {
    const result = resolveClaim(
      log([claim(rigB), 'stranger'], [{ v: 1, type: 'claim' }], [claim(rigA)]),
      trusted,
    )
    expect(result).toMatchObject({ status: 'held', holder: rigA, uri: 'log#2' })
    expect(result.ignored).toEqual([
      { uri: 'log#0', reason: 'untrusted-writer' },
      { uri: 'log#1', reason: 'invalid-entry' },
    ])
  })

  it('a repeated claim by the holder keeps the first entry', () => {
    const first = claim(rigA)
    const result = resolveClaim(log([first], [claim(rigA)]), trusted)
    expect(result.entry).toBe(first)
    expect(result.ignored).toEqual([{ uri: 'log#1', reason: 'already-held' }])
  })

  it('a release while free is ignored and order follows position', () => {
    const rows = log([release(rigA)], [claim(rigB)], [claim(rigA)])
    const result = resolveClaim([rows[2], rows[0], rows[1]], trusted)
    expect(result).toMatchObject({ status: 'held', holder: rigB })
    expect(result.ignored).toEqual([
      { uri: 'log#0', reason: 'release-while-free' },
      { uri: 'log#2', reason: 'held-by-another-owner' },
    ])
  })

  it('requires a trusted writer list', () => {
    expect(() => resolveClaim([], {})).toThrow('trustedWriters')
  })
})

describe('claimOrYield', () => {
  const reference = { id: 'x' }
  it('wins when the claim holds', async () => {
    const adapter = {
      id: 'fake',
      capabilities: ['claim'],
      claim: vi.fn(async () => ({ status: 'held', holder: rigA })),
      release: vi.fn(),
      readClaim: vi.fn(),
    }
    expect(await claimOrYield({ adapter, reference, owner: rigA })).toEqual({
      won: true,
      holder: rigA,
    })
    expect(adapter.release).not.toHaveBeenCalled()
  })

  it('releases its own losing entry and yields', async () => {
    const adapter = {
      id: 'fake',
      capabilities: ['claim'],
      claim: vi.fn(async () => ({ status: 'held', holder: rigA })),
      release: vi.fn(async () => ({ status: 'held', holder: rigA })),
      readClaim: vi.fn(),
    }
    expect(await claimOrYield({ adapter, reference, owner: rigB })).toEqual({
      won: false,
      holder: rigA,
    })
    expect(adapter.release).toHaveBeenCalledWith(reference, rigB)
  })

  it('returns the capability-absent result for an adapter without claim', async () => {
    const adapter = { id: 'plain', capabilities: ['read-artifacts'] }
    expect(await claimOrYield({ adapter, reference, owner: rigA })).toEqual({
      available: false,
      status: 'capability-absent',
      capability: 'claim',
      adapter: 'plain',
    })
  })
})
