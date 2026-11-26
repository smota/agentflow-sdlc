import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The claims ledger (governed-factory design, item M0-3; goal G1): every documented claim has a row
// that says whether the code backs it, and CI keeps the rows honest.

export const CLAIM_STATUSES = Object.freeze(['implemented', 'measured', 'planned', 'retracted'])
export const CLAIM_CASES = Object.freeze(['A', 'B'])
export const CLAIM_KEYWORD_RE = /\b(MUST|INVARIANT|SHALL|REQUIRED)\b/
const NEGATION_RE = /\b(not|no|never|without|isn't|aren't|cannot|nor)\b/i
const REGULATORY_RE = /\b(GxP|Part 11|Annex 11|Annex 22|GAMP|FDA|regulat\w*)\b/i
const TEST_PATH_RE = /(^|\/)__tests__\/|\.test\.mjs$/

export const DEFAULT_LEDGER_PATH = 'manifests/claims-ledger.json'

function lines(root, file, cache) {
  if (!cache.has(file)) {
    const path = join(root, file)
    cache.set(file, existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : null)
  }
  return cache.get(file)
}

function countFiles(root, dir, suffix) {
  const path = join(root, dir)
  if (!existsSync(path)) return 0
  return readdirSync(path).filter((name) => name.endsWith(suffix)).length
}

export function loadClaimsLedger(root, ledgerPath = DEFAULT_LEDGER_PATH) {
  return JSON.parse(readFileSync(join(root, ledgerPath), 'utf8'))
}

export function validateClaimsLedger({ root, ledger = loadClaimsLedger(root) }) {
  const findings = []
  const error = (code, message) => findings.push({ severity: 'error', code, message })
  const cache = new Map()
  const rows = Array.isArray(ledger?.rows) ? ledger.rows : []
  if (ledger?.version !== 1) error('ledger-version', 'the ledger must have "version": 1')
  if (!Array.isArray(ledger?.rows)) error('ledger-rows', 'the ledger must have a "rows" array')

  // Row shape, evidence and quotes.
  const ids = new Set()
  for (const row of rows) {
    const where = `row ${row?.id ?? '<no id>'}`
    if (!row?.id || ids.has(row.id)) error('row-id', `${where}: id is missing or not unique`)
    ids.add(row?.id)
    if (!CLAIM_STATUSES.includes(row?.status)) error('row-status', `${where}: unknown status`)
    if (!CLAIM_CASES.includes(row?.case)) error('row-case', `${where}: case must be A or B`)
    if (typeof row?.quote !== 'string' || row.quote.length < 10) {
      error('row-quote', `${where}: the quote must be at least 10 characters`)
      continue
    }
    const file = row?.source?.file
    const text = file ? lines(root, file, cache) : null
    if (!text) {
      error('source-missing', `${where}: source file ${file} does not exist`)
    } else if (!text.some((line) => line.includes(row.quote))) {
      error('quote-missing', `${where}: the quote no longer appears in ${file}`)
    }
    if (row.status === 'implemented') {
      const code = row.evidence?.code ?? []
      const tests = row.evidence?.tests ?? []
      const realCode = code.filter((p) => !TEST_PATH_RE.test(p) && existsSync(join(root, p)))
      const realTests = tests.filter((p) => TEST_PATH_RE.test(p) && existsSync(join(root, p)))
      if (!realCode.length) {
        error('implemented-no-code', `${where}: an implemented row needs an existing non-test file`)
      }
      if (!realTests.length) {
        error('implemented-no-test', `${where}: an implemented row needs an existing test file`)
      }
    }
    if (row.status === 'planned' && !row.plannedBy) {
      error('planned-no-item', `${where}: a planned row names the item that delivers it`)
    }
    if (row.count) {
      const actual = countFiles(root, row.count.dir, row.count.suffix)
      if (actual !== row.count.expected) {
        error(
          'count-mismatch',
          `${where}: ${row.count.dir} has ${actual} *${row.count.suffix} files, the claim says ${row.count.expected}`,
        )
      }
    }
  }

  // Every keyword line in a listed source has a row whose quote is on that line.
  for (const source of ledger?.sources ?? []) {
    const text = lines(root, source.file, cache)
    if (!text) {
      error('source-missing', `listed source ${source.file} does not exist`)
      continue
    }
    const covering = rows.filter((row) => row?.source?.file === source.file)
    text.forEach((line, index) => {
      if (!CLAIM_KEYWORD_RE.test(line)) return
      if (!covering.some((row) => typeof row.quote === 'string' && line.includes(row.quote))) {
        error(
          'uncovered-claim',
          `${source.file}:${index + 1} has a MUST, INVARIANT, SHALL or REQUIRED line with no ledger row`,
        )
      }
    })
  }

  // Wording rules on the product pages.
  const wording = ledger?.wording ?? {}
  for (const file of wording.files ?? []) {
    const text = lines(root, file, cache)
    if (!text) continue
    text.forEach((line, index) => {
      const at = `${file}:${index + 1}`
      if (/\bcompliant\b/i.test(line) && !NEGATION_RE.test(line)) {
        error('wording-compliant', `${at} says "compliant"; say "supports" or "maps to"`)
      }
      if (/\bvalidated\b/i.test(line) && REGULATORY_RE.test(line) && !NEGATION_RE.test(line)) {
        error(
          'wording-validated',
          `${at} claims a regulatory "validated"; say "supports" or "maps to"`,
        )
      }
      if (/\bno (person|human) in the loop\b/i.test(line)) {
        error(
          'wording-no-human',
          `${at} says "no person in the loop"; say "no per-change human approval"`,
        )
      }
      if ((wording.supportsFiles ?? []).includes(file) && /\bsupports\b/i.test(line)) {
        const backed = rows.some(
          (row) =>
            row.status === 'implemented' && row.source?.file === file && line.includes(row.quote),
        )
        if (!backed)
          error('wording-supports', `${at} says "supports" with no implemented ledger row`)
      }
    })
  }

  return { ok: findings.length === 0, rows: rows.length, findings }
}
