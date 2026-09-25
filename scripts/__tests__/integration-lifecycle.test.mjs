import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Helpers for temp-directory fixture tests
// ---------------------------------------------------------------------------

function makeTempRepo(lifecycleOverride = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'afw-s0-test-'))
  const config = {
    branching: { trunk: 'main', integration: 'development', defaultPrTarget: 'development' },
    integrationLifecycle: {
      integrationBranch: 'development',
      trunkBranch: 'main',
      addLabels: ['integrated:development', 'awaiting-release'],
      closeIntegratedIssues: true,
      ...lifecycleOverride,
    },
  }
  writeFileSync(join(dir, 'agent-workflow.config.json'), JSON.stringify(config, null, 2))
  return dir
}

// ---------------------------------------------------------------------------
// Pre-existing integration lifecycle tests (8 tests retained)
// ---------------------------------------------------------------------------

describe('integration lifecycle', () => {
  it('parses implementation references and de-duplicates local issues', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    // Note: Refs #25 / Refs #26 lines do not appear in the keyword list — they are passed
    // as plain text in the body and parseIssueReferences only matches configured keywords.
    const refs = parseIssueReferences(`
      Implements #24, #25
      Implements other/repo#99
      Closes #123
    `)

    expect(refs).toEqual(['#24', '#25', '#123'])
  })

  it('ignores lines that start with non-implementation keywords', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    // "Refs" and "Related" are not in the default keyword list so they are not matched.
    const refs = parseIssueReferences(`
      Implements #29
      Closes #30
    `)

    expect(refs).toEqual(['#29', '#30'])
  })

  it('plans issue closure only for merged integration PRs', async () => {
    const { planIntegrationLifecycle } = await import('../integration-lifecycle.mjs')
    const plan = planIntegrationLifecycle(
      {
        number: 42,
        url: 'https://github.com/acme/app/pull/42',
        body: 'Implements #24\nCloses #26',
        baseRefName: 'development',
        merged: true,
        mergeCommit: 'abc123',
      },
      {
        integrationBranch: 'development',
        trunkBranch: 'main',
        addLabels: ['integrated:development', 'awaiting-release'],
        closeIntegratedIssues: true,
        referenceKeywords: ['Implements', 'Closes'],
      },
    )

    expect(plan.skipped).toBe(false)
    expect(plan.issues).toEqual(['#24', '#26'])
    expect(plan.close).toBe(true)
    expect(plan.labels).toEqual(['integrated:development', 'awaiting-release'])
    expect(plan.comment).toContain('Integrated into `development`')
  })

  it('skips non-integration PRs', async () => {
    const { planIntegrationLifecycle } = await import('../integration-lifecycle.mjs')
    const plan = planIntegrationLifecycle(
      {
        number: 42,
        url: 'https://github.com/acme/app/pull/42',
        body: 'Implements #24',
        baseRefName: 'main',
        merged: true,
      },
      { integrationBranch: 'development', referenceKeywords: ['Implements', 'Closes'] },
    )

    expect(plan.skipped).toBe(true)
    expect(plan.reason).toContain('not development')
  })

  // validateSourceAdapter was already called by resolveSource before S0 (W8g D1 comment in
  // the existing file). These tests verify that contract enforcement point still holds.
  it('refuses to resolve a source adapter that violates the contract', async () => {
    const { resolveSource } = await import('../integration-lifecycle.mjs')
    const createBrokenAdapter = () => ({ version: 1, id: 'broken' }) // no capabilities, no readArtifact
    expect(() => resolveSource('acme/app', null, { createAdapter: createBrokenAdapter })).toThrow(
      /source adapter for acme\/app is invalid/i,
    )
  })

  it('resolves a real, contract-valid source adapter for a repo', async () => {
    const { resolveSource } = await import('../integration-lifecycle.mjs')
    const source = resolveSource('acme/app', null)
    expect(typeof source.readArtifact).toBe('function')
  })

  it('resolves to null when no repo is given', async () => {
    const { resolveSource } = await import('../integration-lifecycle.mjs')
    expect(resolveSource(null, null)).toBeNull()
  })

  it('applies lifecycle mutations through a source adapter', async () => {
    const { applyIntegrationPlan } = await import('../integration-lifecycle.mjs')
    const calls = []
    const source = {
      previewMutation: async ({ operation, parameters }) => ({
        operation,
        parameters,
        token: `${operation}-token`,
      }),
      applyMutation: async (preview, { confirm }) => {
        expect(confirm).toBe(preview.token)
        calls.push([preview.operation, preview.parameters])
        return { receiptToken: `${preview.operation}-receipt` }
      },
      flushReceipt: async () => {},
    }
    await applyIntegrationPlan(
      {
        labels: ['integrated:development'],
        issues: ['#24'],
        comment: 'integrated',
        close: true,
      },
      source,
    )
    expect(calls).toEqual([
      ['ensure-label', { label: 'integrated:development' }],
      ['add-comment', { number: '24', body: 'integrated' }],
      ['add-labels', { number: '24', labels: ['integrated:development'] }],
      ['close-artifact', { number: '24' }],
    ])
  })
})

// ---------------------------------------------------------------------------
// S0 regression suite
// Acceptance criteria from process-autonomy S0:
//   - Refs never closes; Closes closes exactly listed local issues
//   - Unsafe/malformed override diagnosed and throws before effects
//   - Parser validates at call boundary; substring (Discloses) does not match Closes
//   - Empty keyword list rejected (avoids arbitrary match)
//   - loadIntegrationLifecycleConfig tested with real temp-dir fixture files
//   - Project config does not contain Refs
// ---------------------------------------------------------------------------

describe('S0: lifecycle config correction and keyword guard', () => {
  let dirs = []

  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

  // --- validateReferenceKeywords ---

  it('validateReferenceKeywords accepts recognized safe keywords', async () => {
    const { validateReferenceKeywords, SAFE_KEYWORDS } =
      await import('../integration-lifecycle.mjs')
    const result = validateReferenceKeywords(['Implements', 'Closes'])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    // All SAFE_KEYWORDS are individually accepted
    for (const kw of SAFE_KEYWORDS) {
      expect(validateReferenceKeywords([kw]).ok).toBe(true)
    }
  })

  it('validateReferenceKeywords rejects Refs (exact case)', async () => {
    const { validateReferenceKeywords } = await import('../integration-lifecycle.mjs')
    const result = validateReferenceKeywords(['Implements', 'Refs', 'Closes'])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('reference-only keyword "Refs"'))).toBe(true)
  })

  it('validateReferenceKeywords rejects Refs with leading/trailing whitespace', async () => {
    const { validateReferenceKeywords } = await import('../integration-lifecycle.mjs')
    expect(validateReferenceKeywords([' Refs ']).ok).toBe(false)
    expect(validateReferenceKeywords(['Implements', ' refs ']).ok).toBe(false)
  })

  it('validateReferenceKeywords rejects Refs case-insensitively (refs, REFS)', async () => {
    const { validateReferenceKeywords } = await import('../integration-lifecycle.mjs')
    expect(validateReferenceKeywords(['Implements', 'refs']).ok).toBe(false)
    expect(validateReferenceKeywords(['Implements', 'REFS']).ok).toBe(false)
  })

  it('validateReferenceKeywords rejects empty array', async () => {
    const { validateReferenceKeywords } = await import('../integration-lifecycle.mjs')
    const result = validateReferenceKeywords([])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/must not be empty/)
  })

  it('validateReferenceKeywords rejects non-array', async () => {
    const { validateReferenceKeywords } = await import('../integration-lifecycle.mjs')
    expect(validateReferenceKeywords('Implements').ok).toBe(false)
    expect(validateReferenceKeywords(null).ok).toBe(false)
  })

  it('validateReferenceKeywords rejects null/empty string entries as malformed', async () => {
    const { validateReferenceKeywords } = await import('../integration-lifecycle.mjs')
    const result = validateReferenceKeywords(['Implements', '', null])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('invalid entry'))).toBe(true)
  })

  it('validateReferenceKeywords rejects unrecognized unknown keywords', async () => {
    const { validateReferenceKeywords } = await import('../integration-lifecycle.mjs')
    const result = validateReferenceKeywords(['Implements', 'Merges'])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('unrecognized keyword'))).toBe(true)
  })

  // --- parseIssueReferences parser boundary ---

  it('parseIssueReferences uses default config (Implements, Closes) and excludes Refs lines', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    const refs = parseIssueReferences('Implements #261\nRefs #259\nRefs #260\nCloses #262')
    // Refs lines do not match default keywords
    expect(refs).toEqual(['#261', '#262'])
    expect(refs).not.toContain('#259')
    expect(refs).not.toContain('#260')
  })

  it('parseIssueReferences throws when called with empty keyword list', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    expect(() => parseIssueReferences('Implements #1', { referenceKeywords: [] })).toThrow(
      /invalid referenceKeywords/,
    )
  })

  it('parseIssueReferences throws when called with Refs in keywords list', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    expect(() => parseIssueReferences('Refs #903', { referenceKeywords: ['Refs'] })).toThrow(
      /invalid referenceKeywords/,
    )
  })

  it('parseIssueReferences: Discloses #N does not match keyword Closes (word boundary)', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    // "Discloses" contains "Closes" as a suffix — without \b this would match
    const refs = parseIssueReferences('Discloses #901\nCloses #902')
    expect(refs).not.toContain('#901')
    expect(refs).toContain('#902')
  })

  it('parseIssueReferences: substring keywords do not match — Encloses, Forecloses', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    const refs = parseIssueReferences('Encloses #10\nForecloses #11\nCloses #12')
    expect(refs).not.toContain('#10')
    expect(refs).not.toContain('#11')
    expect(refs).toContain('#12')
  })

  it('parseIssueReferences excludes cross-repository references from closure list', async () => {
    const { parseIssueReferences } = await import('../integration-lifecycle.mjs')
    const refs = parseIssueReferences('Closes #261\nCloses other/repo#9999\nImplements #262', {
      referenceKeywords: ['Implements', 'Closes'],
    })
    expect(refs).toEqual(['#261', '#262'])
    expect(refs.some((r) => r.includes('/'))).toBe(false)
  })

  // --- loadIntegrationLifecycleConfig with real temp-dir fixture files ---

  it('loadIntegrationLifecycleConfig loads valid config from temp dir', async () => {
    const { loadIntegrationLifecycleConfig } = await import('../integration-lifecycle.mjs')
    const dir = makeTempRepo({ referenceKeywords: ['Implements', 'Closes'] })
    dirs.push(dir)
    const cfg = loadIntegrationLifecycleConfig(dir)
    expect(cfg.referenceKeywords).toEqual(['Implements', 'Closes'])
    expect(cfg.integrationBranch).toBe('development')
    expect(cfg.trunkBranch).toBe('main')
  })

  it('loadIntegrationLifecycleConfig throws for Refs in config file (not silent fallback)', async () => {
    const { loadIntegrationLifecycleConfig } = await import('../integration-lifecycle.mjs')
    const dir = makeTempRepo({ referenceKeywords: ['Implements', 'Refs'] })
    dirs.push(dir)
    expect(() => loadIntegrationLifecycleConfig(dir)).toThrow(
      /invalid integrationLifecycle\.referenceKeywords/,
    )
  })

  it('loadIntegrationLifecycleConfig throws for empty keyword array in config file', async () => {
    const { loadIntegrationLifecycleConfig } = await import('../integration-lifecycle.mjs')
    const dir = makeTempRepo({ referenceKeywords: [] })
    dirs.push(dir)
    expect(() => loadIntegrationLifecycleConfig(dir)).toThrow(
      /invalid integrationLifecycle\.referenceKeywords/,
    )
  })

  it('loadIntegrationLifecycleConfig uses DEFAULT_CONFIG when no config file exists', async () => {
    const { loadIntegrationLifecycleConfig, DEFAULT_CONFIG } =
      await import('../integration-lifecycle.mjs')
    const dir = mkdtempSync(join(tmpdir(), 'afw-s0-noconfig-'))
    dirs.push(dir)
    const cfg = loadIntegrationLifecycleConfig(dir)
    expect(cfg.referenceKeywords).toEqual(DEFAULT_CONFIG.referenceKeywords)
    expect(cfg.referenceKeywords).not.toContain('Refs')
  })

  it('loadIntegrationLifecycleConfig uses DEFAULT_CONFIG referenceKeywords when field is absent', async () => {
    const { loadIntegrationLifecycleConfig, DEFAULT_CONFIG } =
      await import('../integration-lifecycle.mjs')
    // Config file without referenceKeywords field
    const dir = mkdtempSync(join(tmpdir(), 'afw-s0-nokeys-'))
    dirs.push(dir)
    writeFileSync(
      join(dir, 'agent-workflow.config.json'),
      JSON.stringify({ integrationLifecycle: { integrationBranch: 'development' } }),
    )
    const cfg = loadIntegrationLifecycleConfig(dir)
    expect(cfg.referenceKeywords).toEqual(DEFAULT_CONFIG.referenceKeywords)
  })

  // --- planIntegrationLifecycle: retrospective #259 scenario ---

  it('planIntegrationLifecycle never closes Refs-only referenced issues', async () => {
    const { planIntegrationLifecycle } = await import('../integration-lifecycle.mjs')
    // Reproduces the exact retrospective #259 closure scenario described in the execution plan:
    // a PR body containing "Refs #259" must not cause issue #259 to be closed.
    const plan = planIntegrationLifecycle(
      {
        number: 999,
        url: 'https://github.com/smota/agentflow-sdlc/pull/999',
        body: 'Implements #261\nRefs #259\nRefs #260',
        baseRefName: 'development',
        merged: true,
        mergeCommit: 'deadbeef',
      },
      {
        integrationBranch: 'development',
        trunkBranch: 'main',
        addLabels: ['integrated:development', 'awaiting-release'],
        closeIntegratedIssues: true,
        referenceKeywords: ['Implements', 'Closes'],
      },
    )
    expect(plan.skipped).toBe(false)
    expect(plan.issues).toEqual(['#261'])
    expect(plan.issues).not.toContain('#259')
    expect(plan.issues).not.toContain('#260')
  })

  // --- Project config regression fixture ---

  it('project agent-workflow.config.json referenceKeywords contain no unsafe keywords', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const { REFERENCE_ONLY_KEYWORDS, validateReferenceKeywords } =
      await import('../integration-lifecycle.mjs')
    const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
    const raw = readFileSync(resolve(root, 'agent-workflow.config.json'), 'utf8')
    const cfg = JSON.parse(raw)
    const keywords = cfg.integrationLifecycle?.referenceKeywords ?? []
    // Must not contain any reference-only keyword
    for (const unsafe of REFERENCE_ONLY_KEYWORDS) {
      expect(keywords.map((k) => k.toLowerCase())).not.toContain(unsafe.toLowerCase())
    }
    // Must pass validateReferenceKeywords
    const result = validateReferenceKeywords(keywords)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })
})

describe('explicit malformed lifecycle overrides', () => {
  for (const value of [null, 'Closes', 42, {}, [' Closes '], ['Closes\t']]) {
    it(`rejects ${JSON.stringify(value)} through the real config loader and parser`, async () => {
      const { loadIntegrationLifecycleConfig, parseIssueReferences } =
        await import('../integration-lifecycle.mjs')
      const dir = makeTempRepo({ referenceKeywords: value })
      try {
        expect(() => loadIntegrationLifecycleConfig(dir)).toThrow(/referenceKeywords/)
        expect(() => parseIssueReferences('Closes #1', { referenceKeywords: value })).toThrow(
          /referenceKeywords/,
        )
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
