import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateClaimsLedger } from '../claims-ledger.mjs'

let root
const write = (rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const codes = (ledger) => validateClaimsLedger({ root, ledger }).findings.map((f) => f.code)
const row = (overrides = {}) => ({
  id: 'kill-switch',
  quote: 'MUST stop every run on kill',
  source: { file: 'docs/rules.md', line: 3 },
  case: 'B',
  status: 'implemented',
  evidence: { code: ['lib/kill.mjs'], tests: ['lib/__tests__/kill.test.mjs'], conformance: null },
  note: 'wired',
  ...overrides,
})
const ledger = (rows, extra = {}) => ({
  version: 1,
  sources: [{ file: 'docs/rules.md' }],
  wording: { files: ['README.md'], supportsFiles: ['README.md'] },
  rows,
  ...extra,
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'claims-ledger-'))
  write('docs/rules.md', '# Rules\n\n- The runner MUST stop every run on kill.\n')
  write('lib/kill.mjs', 'export const kill = () => {}\n')
  write('lib/__tests__/kill.test.mjs', '// test\n')
  write('README.md', '# Product\n\nIt runs agents.\n')
  mkdirSync(join(root, 'schemas'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('claims ledger', () => {
  it('passes a backed claim', () => {
    expect(validateClaimsLedger({ root, ledger: ledger([row()]) })).toMatchObject({
      ok: true,
      rows: 1,
    })
  })

  it('fails a keyword line with no row, and a quote that no longer exists', () => {
    expect(codes(ledger([]))).toEqual(['uncovered-claim'])
    expect(codes(ledger([row({ quote: 'MUST do something else' })]))).toContain('quote-missing')
  })

  it('requires real code and a real test for an implemented row', () => {
    expect(
      codes(ledger([row({ evidence: { code: ['lib/__tests__/kill.test.mjs'], tests: [] } })])),
    ).toEqual(expect.arrayContaining(['implemented-no-code', 'implemented-no-test']))
    expect(
      codes(
        ledger([
          row({ evidence: { code: ['lib/missing.mjs'], tests: ['lib/__tests__/kill.test.mjs'] } }),
        ]),
      ),
    ).toContain('implemented-no-code')
  })

  it('requires the delivering item on a planned row', () => {
    expect(codes(ledger([row({ status: 'planned', evidence: {} })]))).toContain('planned-no-item')
    expect(codes(ledger([row({ status: 'planned', evidence: {}, plannedBy: 'M1-9' })]))).toEqual([])
  })

  it('checks a count claim against the files on disk', () => {
    write('schemas/a.schema.json', '{}')
    write('schemas/b.schema.json', '{}')
    const counted = row({ count: { dir: 'schemas', suffix: '.schema.json', expected: 3 } })
    expect(codes(ledger([counted]))).toContain('count-mismatch')
  })

  it('enforces the wording rules on product pages', () => {
    write(
      'README.md',
      [
        'AgentFlow is compliant with everything.',
        'It is not compliant with anything by itself.',
        'The records are GxP validated.',
        'Config is validated against the schema.',
        'Agents merge with no human in the loop.',
        'It supports every sandbox.',
      ].join('\n'),
    )
    expect(codes(ledger([row()]))).toEqual([
      'wording-compliant',
      'wording-validated',
      'wording-no-human',
      'wording-supports',
    ])
  })

  it('accepts a supports line backed by an implemented row', () => {
    write('README.md', 'It supports GitHub sources.\n')
    const supports = row({
      id: 'supports-github',
      quote: 'supports GitHub sources',
      source: { file: 'README.md', line: 1 },
    })
    expect(codes(ledger([row(), supports]))).toEqual([])
  })
})
