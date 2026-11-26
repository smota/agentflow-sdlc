import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../validate-claims-ledger.mjs'

let root
let out
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'validate-claims-'))
  mkdirSync(join(root, 'manifests'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'rules.md'), 'Agents MUST read the policy.\n')
  out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  out.mockRestore()
  rmSync(root, { recursive: true, force: true })
})

const writeLedger = (rows) =>
  writeFileSync(
    join(root, 'manifests', 'claims-ledger.json'),
    JSON.stringify({ version: 1, sources: [{ file: 'docs/rules.md' }], wording: {}, rows }),
  )

describe('validate-claims-ledger', () => {
  it('prints READY and exits 0 when every claim has a row', () => {
    writeLedger([
      {
        id: 'read-policy',
        quote: 'MUST read the policy',
        source: { file: 'docs/rules.md', line: 1 },
        case: 'B',
        status: 'planned',
        plannedBy: 'none',
        evidence: {},
        note: 'agent instruction',
      },
    ])
    expect(main(['--target', root])).toBe(0)
    expect(out.mock.calls.join('')).toMatch(/READY \(1 rows\)/)
  })

  it('prints FAILED with the finding and exits 1 when a claim has no row', () => {
    writeLedger([])
    expect(main(['--target', root, '--json'])).toBe(1)
    expect(JSON.parse(out.mock.calls.join('')).findings[0].code).toBe('uncovered-claim')
  })

  it('fails cleanly when the ledger file is missing', () => {
    expect(main(['--target', root])).toBe(1)
    expect(out.mock.calls.join('')).toMatch(/ledger-unreadable/)
  })
})
