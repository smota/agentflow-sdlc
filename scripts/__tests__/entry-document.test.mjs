import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ENTRY_DOCUMENT,
  ENTRY_PATH_MARKER,
  ENTRY_PATH_TERMS,
  GLOSSARY_TERMS,
  SURFACE_TERMS,
  extractMarkedCommandBlock,
  findUndefinedTerms,
  validateDocs,
} from '../validate-docs.mjs'

// W6b — five documents used to compete for a newcomer, none of them reached a first governed
// change, and twelve product terms were used before they were defined. D2 makes ONE document (the
// entry document) the path: it may use only the nine surface terms without defining them, any other
// product term must be avoided or defined at first use, and it must show a runnable three-command
// path to a first governed change. These tests are the real doc-lint check called for by test 5 —
// it is written so a regression (an undefined term creeping back onto the entry path) fails it.

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

describe('entry document surface-term check (W6b / D2, test 5)', () => {
  it('flags a glossary term used bare, with no definition at first use', () => {
    const findings = findUndefinedTerms('Start by reading your role-pass before you continue.')
    expect(findings).toContain('role-pass')
  })

  it('does not flag a glossary term defined inline at first use', () => {
    const findings = findUndefinedTerms(
      'Start by reading your role-pass (a saved note of one finished phase) before you continue.',
    )
    expect(findings).not.toContain('role-pass')
  })

  it('does not flag any of the nine allowed surface terms', () => {
    const sentence = SURFACE_TERMS.map((term) => `Its ${term} matters.`).join(' ')
    expect(findUndefinedTerms(sentence)).toEqual([])
  })

  it('the real entry document uses no undefined product term', () => {
    const text = readFileSync(resolve(repoRoot, ENTRY_DOCUMENT), 'utf8')
    expect(findUndefinedTerms(text)).toEqual([])
  })

  it('"role-pass" itself has left the entry path entirely, per D2', () => {
    const text = readFileSync(resolve(repoRoot, ENTRY_DOCUMENT), 'utf8')
    expect(text).not.toMatch(/role-pass/i)
  })

  it('validateDocs stays green for the whole repository', () => {
    const result = validateDocs(repoRoot)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  // W8e / D5, test 6 — GLOSSARY_TERMS used to be the ONLY thing checked on the entry path: a closed,
  // hand-maintained list that "digest" and "candidate" were never added to, so both passed the lint
  // silently while the entry document used them undefined (finding 6). ENTRY_PATH_TERMS is the set
  // validateDocs actually applies to the entry document; it must catch a real product term even
  // though it is not a hand-typed entry in GLOSSARY_TERMS.
  it('a term like "digest" used undefined on the entry path fails the doc lint (W8e / D5, test 6)', () => {
    const findings = findUndefinedTerms(
      'Your work produces a digest of the exact content.',
      ENTRY_PATH_TERMS,
    )
    expect(findings).toContain('digest')
  })

  it('"digest" is not a hand-typed entry in the old closed GLOSSARY_TERMS list', () => {
    // Proves the catch above comes from the derived product vocabulary, not from someone having
    // quietly added "digest" to the original closed list — which is exactly the defect (finding 6).
    expect(GLOSSARY_TERMS).not.toContain('digest')
    expect(ENTRY_PATH_TERMS).toContain('digest')
  })

  it('"candidate" used undefined on the entry path also fails the doc lint', () => {
    const findings = findUndefinedTerms(
      'This check runs against your candidate files.',
      ENTRY_PATH_TERMS,
    )
    expect(findings).toContain('candidate')
  })

  it('defining "digest" in plain language at first use satisfies the lint', () => {
    const findings = findUndefinedTerms(
      'Your work produces a digest (a short fingerprint of exact content) you can inspect.',
      ENTRY_PATH_TERMS,
    )
    expect(findings).not.toContain('digest')
  })

  // W8e / D4, test 5 — `--writer you` used to be typed on three of the six entry-path commands, pure
  // plumbing a newcomer had to copy without understanding. `--writer` now defaults to the local
  // operator identity, so the documented path never needs to name it.
  it('the entry path never types --writer (W8e / D4, test 5)', () => {
    const text = readFileSync(resolve(repoRoot, ENTRY_DOCUMENT), 'utf8')
    const commands = extractMarkedCommandBlock(text, ENTRY_PATH_MARKER)
    expect(commands).not.toBeNull()
    for (const line of commands) expect(line).not.toMatch(/--writer\b/)
  })
})

// W6c / test 5 — the old test 6 here ("contains a runnable three-command path") asserted only that
// a three-line block existed at the marker; it never ran those commands, so it stayed green while
// the orchestrator found the documented path produced no run, no frozen contract, and no evidence on
// a real fresh repository (defect 1 in the W6c spec). That assertion is deleted: it tested presence,
// not effect. The real regression guard for "does the entry path produce governance" is
// scripts/__tests__/entry-path-governance.test.mjs, which extracts the commands from the live
// document and executes them, asserting on the resulting run/contract/observation state.
describe('extractMarkedCommandBlock (W6b / D2)', () => {
  it('fails to find a marked command block in a document that never marks one', () => {
    expect(
      extractMarkedCommandBlock('# No marker here\n\n```bash\necho hi\n```\n', ENTRY_PATH_MARKER),
    ).toBeNull()
  })

  it("extracts the entry document's own marked block with the count its marker declares", () => {
    const text = readFileSync(resolve(repoRoot, ENTRY_DOCUMENT), 'utf8')
    const declaredCount = Number(ENTRY_PATH_MARKER.match(/(\d+) commands/)?.[1])
    const commands = extractMarkedCommandBlock(text, ENTRY_PATH_MARKER)
    expect(commands).not.toBeNull()
    expect(commands.length).toBe(declaredCount)
    for (const line of commands) expect(line.trim().length).toBeGreaterThan(0)
  })
})
