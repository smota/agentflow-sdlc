import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  classifyModule,
  calculateBlastRadius,
  extractIssueReferences,
  extractPrNumber,
  extractIssueCriteriaAndAntiGoals,
  extractPrLimitations,
  buildExclusionFilters,
  loadLastDogfoodMarker,
  saveDogfoodMarker,
  readGitDelta,
  generateDogfoodSurface,
} from '../dogfood-surface.mjs'

const SURFACE_READER_CLI = join(process.cwd(), 'scripts', 'dogfood', 'surface-reader.mjs')

describe('lib/dogfood-surface.mjs - Out-of-Band Dogfood Surface Reader', () => {
  describe('classifyModule', () => {
    it('accurately classifies files into subsystems and domains', () => {
      expect(classifyModule('bin/cli.mjs')).toBe('cli')
      expect(classifyModule('scripts/cli/commands.mjs')).toBe('cli')
      expect(classifyModule('adapters/openrig/lifecycle.mjs')).toBe('adapters')
      expect(classifyModule('skills/agentflow-steerer/SKILL.md')).toBe('skills')
      expect(classifyModule('lib/core/dogfood-surface.mjs')).toBe('lib/core')
      expect(classifyModule('lib/providers/decider-port.mjs')).toBe('lib/providers')
      expect(classifyModule('lib/services/doctor-service.mjs')).toBe('lib/services')
      expect(classifyModule('lib/environment.mjs')).toBe('lib')
      expect(classifyModule('schemas/intake-finding.json')).toBe('schemas')
      expect(classifyModule('manifests/path-ownership.json')).toBe('manifests')
      expect(classifyModule('docs/agent-workflow.md')).toBe('docs')
      expect(classifyModule('scripts/dogfood/surface-reader.mjs')).toBe('dogfood')
      expect(classifyModule('scripts/telemetry/session-extractor.mjs')).toBe('telemetry')
      expect(classifyModule('scripts/validate-docs.mjs')).toBe('scripts')
      expect(classifyModule('scripts/__tests__/steer.test.mjs')).toBe('tests')
      expect(classifyModule('tests/oracles/security.test.mjs')).toBe('tests')
      expect(classifyModule('README.md')).toBe('root')
      expect(classifyModule('OPENRIG.md')).toBe('root')
    })
  })

  describe('calculateBlastRadius', () => {
    it('calculates low blast radius for few non-critical files', () => {
      const radius = calculateBlastRadius({
        files: ['docs/readme.md', 'README.md'],
        insertions: 10,
        deletions: 2,
      })
      expect(radius.level).toBe('low')
      expect(radius.filesChanged).toBe(2)
      expect(radius.modules).toEqual(['docs', 'root'])
    })

    it('calculates medium blast radius for core changes or moderate file count', () => {
      const radius = calculateBlastRadius({
        files: ['lib/core/dogfood-surface.mjs', 'scripts/__tests__/surface.test.mjs'],
        insertions: 120,
        deletions: 5,
      })
      expect(radius.level).toBe('medium')
      expect(radius.modules).toContain('lib/core')
    })

    it('calculates high blast radius for wide touch or critical subsystems', () => {
      const files = [
        'bin/cli.mjs',
        'schemas/intake-finding.json',
        'manifests/path-ownership.json',
        'lib/core/dogfood-surface.mjs',
        'adapters/openrig/lifecycle.mjs',
        'skills/agentflow-steerer/SKILL.md',
        'docs/index.md',
        'scripts/dogfood/surface-reader.mjs',
      ]
      const radius = calculateBlastRadius({
        files,
        insertions: 500,
        deletions: 100,
      })
      expect(radius.level).toBe('high')
      expect(radius.filesChanged).toBe(8)
      expect(radius.modules.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('extractIssueReferences', () => {
    it('extracts and deduplicates closed issue numbers from various keywords', () => {
      const text = `
        feat(steer): typed cli commands
        Closes #483
        Also fixes #478 and resolves #479.
        refs #480, See #483.
      `
      const issues = extractIssueReferences(text)
      expect(issues).toEqual([478, 479, 480, 483])
    })

    it('returns empty array when no references exist', () => {
      expect(extractIssueReferences('')).toEqual([])
      expect(extractIssueReferences(null)).toEqual([])
      expect(extractIssueReferences('Routine refactor without issue numbers')).toEqual([])
    })
  })

  describe('extractPrNumber', () => {
    it('extracts PR number from commit titles and merge headers', () => {
      expect(extractPrNumber('feat: three-rig topology (#495)')).toBe(495)
      expect(extractPrNumber('Squashed and merged pull request smota/agentflow-sdlc#496')).toBe(496)
      expect(extractPrNumber('Unrelated commit message')).toBeNull()
      expect(extractPrNumber(null)).toBeNull()
    })
  })

  describe('extractIssueCriteriaAndAntiGoals', () => {
    it('extracts acceptance criteria and anti-goals from issue markdown', () => {
      const issueBody = `
        ### Job
        When an agent runs dogfood tests, I want a surface reader.

        ## Acceptance Boundaries
        - [ ] Resolves commit delta between last marker and HEAD.
        - Correlates commit messages with closed issues.
        Given a dirty working tree, When queried, Then it reports clean delta.

        ## Anti-Goals
        - Do not modify working tree source files during dogfood inspection.
        - Never route dogfood findings directly to inner delivery seats.

        ## Out of Scope
        - Automated remediation of discovered findings.
      `

      const result = extractIssueCriteriaAndAntiGoals(issueBody)
      expect(result.acceptanceCriteria).toHaveLength(3)
      expect(result.acceptanceCriteria[0]).toBe(
        'Resolves commit delta between last marker and HEAD.',
      )
      expect(result.acceptanceCriteria[1]).toBe('Correlates commit messages with closed issues.')
      expect(result.acceptanceCriteria[2]).toBe(
        'Given a dirty working tree, When queried, Then it reports clean delta.',
      )

      expect(result.antiGoals).toHaveLength(3)
      expect(result.antiGoals).toContain(
        'Do not modify working tree source files during dogfood inspection.',
      )
      expect(result.antiGoals).toContain(
        'Never route dogfood findings directly to inner delivery seats.',
      )
      expect(result.antiGoals).toContain('Automated remediation of discovered findings.')
    })

    it('returns empty arrays for empty or malformed issue bodies', () => {
      expect(extractIssueCriteriaAndAntiGoals('')).toEqual({
        acceptanceCriteria: [],
        antiGoals: [],
      })
      expect(extractIssueCriteriaAndAntiGoals(null)).toEqual({
        acceptanceCriteria: [],
        antiGoals: [],
      })
      expect(extractIssueCriteriaAndAntiGoals('Just some random text')).toEqual({
        acceptanceCriteria: [],
        antiGoals: [],
      })
    })
  })

  describe('extractPrLimitations', () => {
    it('extracts follow-up issues, accepted limitations, and review trade-offs', () => {
      const prData = {
        number: 495,
        body: `
          ## Summary
          Three-rig lifecycle.

          ## Follow-up issues
          Follow-up Issue #483: capability: first-class steering cli verbs and merge-check.

          Accepted limitation: Windows Node 24 takes up to 7 minutes on GHA runners.
        `,
        comments: [
          {
            author: { login: 'reviewer-alice' },
            body: 'Trade-off: CLI commands will be wired in follow-up slice; deferred to #483.',
          },
          {
            author: { login: 'reviewer-bob' },
            body: 'LGTM!',
          },
        ],
      }

      const limitations = extractPrLimitations(prData)
      expect(limitations).toHaveLength(4)

      const followUp = limitations.find((l) => l.type === 'deferred-scope')
      expect(followUp).toBeDefined()
      expect(followUp.text).toContain('Follow-up Issue #483')

      const ghaLimitation = limitations.find((l) => l.text.includes('Windows Node 24'))
      expect(ghaLimitation).toBeDefined()
      expect(ghaLimitation.type).toBe('accepted-limitation')

      const commentTradeoff = limitations.find((l) => l.text.includes('CLI commands will be wired'))
      expect(commentTradeoff).toBeDefined()
    })

    it('ignores "None" in follow-up issues', () => {
      const prData = {
        number: 496,
        body: '## Follow-up issues\nNone. Goal complete.\n',
      }
      const limitations = extractPrLimitations(prData)
      expect(limitations).toHaveLength(0)
    })
  })

  describe('buildExclusionFilters', () => {
    it('creates machine-checkable exclusion filters from anti-goals and review trade-offs', () => {
      const antiGoals = ['Never commit directly to integration trunk']
      const acceptedLimitations = [
        {
          source: 'pr:495:body',
          type: 'deferred-scope',
          text: 'Follow-up Issue #483: first-class steering cli verbs',
        },
      ]

      const filters = buildExclusionFilters({ antiGoals, acceptedLimitations })
      expect(filters).toHaveLength(2)

      expect(filters[0]).toEqual({
        filterId: 'anti-goal-1',
        kind: 'anti-goal',
        pattern: 'Never commit directly to integration trunk',
        reason: 'Explicit anti-goal: Never commit directly to integration trunk',
      })

      expect(filters[1]).toEqual({
        filterId: 'limitation-1',
        kind: 'deferred-scope',
        pattern: 'Follow-up Issue #483: first-class steering cli verbs',
        source: 'pr:495:body',
        reason:
          'Review caveat / deferred scope: Follow-up Issue #483: first-class steering cli verbs',
      })
    })
  })

  describe('marker persistence', () => {
    it('saves and loads dogfood run markers correctly', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dogfood-marker-'))
      try {
        const markerPath = join(tempDir, 'sub', 'marker.json')
        expect(loadLastDogfoodMarker(markerPath)).toBeNull()

        const markerData = {
          lastHead: 'abcdef1234567890',
          timestamp: '2026-10-14T15:00:00Z',
          commitsCount: 3,
        }

        saveDogfoodMarker(markerPath, markerData)
        const loaded = loadLastDogfoodMarker(markerPath)
        expect(loaded).toEqual(markerData)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('readGitDelta with mock executor', () => {
    it('parses simulated commit logs, diffs, and stats', () => {
      const mockExec = vi.fn().mockImplementation((cmd, args) => {
        if (args[0] === 'rev-parse') {
          return `${args[1]}\n`
        }
        if (args[0] === 'log') {
          return (
            'commit-1-sha\x00Alice\x00alice@example.com\x001700000000\x00feat: initial (#10)\x00Closes #100\x1e' +
            'commit-2-sha\x00Bob\x00bob@example.com\x001700001000\x00fix: resolve bug (#11)\x00Fixes #101\x1e'
          )
        }
        if (args[0] === 'diff' && args[1] === '--name-only') {
          return 'lib/core/file-a.mjs\nscripts/tool.mjs\n'
        }
        if (args[0] === 'diff' && args[1] === '--numstat') {
          return '25\t5\tlib/core/file-a.mjs\n10\t2\tscripts/tool.mjs\n'
        }
        return ''
      })

      const delta = readGitDelta({
        since: 'since-sha-111',
        head: 'head-sha-999',
        exec: mockExec,
      })

      expect(delta.commits).toHaveLength(2)
      expect(delta.commits[0].sha).toBe('commit-1-sha')
      expect(delta.commits[0].closesIssues).toEqual([100])
      expect(delta.commits[0].prNumber).toBe(10)
      expect(delta.commits[1].closesIssues).toEqual([101])
      expect(delta.commits[1].prNumber).toBe(11)
      expect(delta.changedFiles).toEqual(['lib/core/file-a.mjs', 'scripts/tool.mjs'])
      expect(delta.insertions).toBe(35)
      expect(delta.deletions).toBe(7)
    })

    it('returns empty delta when since and head resolve to the same SHA', () => {
      const mockExec = vi.fn().mockReturnValue('same-sha\n')
      const delta = readGitDelta({
        since: 'same-sha',
        head: 'same-sha',
        exec: mockExec,
      })
      expect(delta.commits).toEqual([])
      expect(delta.changedFiles).toEqual([])
    })
  })

  describe('generateDogfoodSurface', () => {
    it('assembles complete structured surface manifest with correlated issues and filters', async () => {
      const mockExec = vi.fn().mockImplementation((cmd, args) => {
        if (args[0] === 'rev-parse') {
          return `${args[1]}\n`
        }
        if (args[0] === 'log') {
          return 'commit-sha\x00Sam\x00sam@test.com\x001700000000\x00feat: test (#42)\x00Closes #100\x1e'
        }
        if (args[0] === 'diff' && args[1] === '--name-only') {
          return 'bin/cli.mjs\nlib/core/engine.mjs\n'
        }
        if (args[0] === 'diff' && args[1] === '--numstat') {
          return '50\t10\tbin/cli.mjs\n20\t5\tlib/core/engine.mjs\n'
        }
        return ''
      })

      const mockFetchIssue = vi.fn().mockResolvedValue({
        number: 100,
        title: 'Core Engine Feature',
        state: 'closed',
        body: `
          ## Acceptance Criteria
          - Engine boots without errors.
          ## Anti-Goals
          - Never load external network resources.
        `,
      })

      const mockFetchPr = vi.fn().mockResolvedValue({
        number: 42,
        body: `
          ## Follow-up issues
          Follow-up Issue #105: UI polish.
        `,
        comments: [
          {
            author: { login: 'reviewer' },
            body: 'Accepted limitation: Offline mode only for v1.',
          },
        ],
      })

      const surface = await generateDogfoodSurface({
        since: 'since-sha-111',
        head: 'head-sha-222',
        fetchIssue: mockFetchIssue,
        fetchPr: mockFetchPr,
        exec: mockExec,
      })

      expect(surface.schemaVersion).toBe(1)
      expect(surface.range.commitCount).toBe(1)
      expect(surface.commits).toHaveLength(1)
      expect(surface.correlatedIssues).toHaveLength(1)
      expect(surface.correlatedIssues[0].acceptanceCriteria).toContain(
        'Engine boots without errors.',
      )
      expect(surface.correlatedIssues[0].antiGoals).toContain(
        'Never load external network resources.',
      )

      expect(surface.acceptedLimitations).toHaveLength(2)
      expect(surface.blastRadius.level).toBe('medium')
      expect(surface.blastRadius.modules).toEqual(['cli', 'lib/core'])

      // Check exclusion filters
      expect(surface.exclusionFilters).toHaveLength(3)
      const antiGoalFilter = surface.exclusionFilters.find((f) => f.kind === 'anti-goal')
      expect(antiGoalFilter.pattern).toBe('Never load external network resources.')
      const caveatFilter = surface.exclusionFilters.find((f) => f.kind === 'accepted-limitation')
      expect(caveatFilter.pattern).toBe('Offline mode only for v1')
    })
  })

  describe('CLI surface-reader.mjs execution', () => {
    it('runs --help and exits 0', () => {
      const output = execFileSync(process.execPath, [SURFACE_READER_CLI, '--help'], {
        encoding: 'utf8',
      })
      expect(output).toContain('Usage: node scripts/dogfood/surface-reader.mjs')
      expect(output).toContain('--since')
      expect(output).toContain('--out')
      expect(output).toContain('--dry-run')
    })

    it('generates dogfood surface manifest in dry-run mode via CLI', () => {
      const stdout = execFileSync(
        process.execPath,
        [SURFACE_READER_CLI, '--since', 'HEAD~1', '--head', 'HEAD', '--dry-run', '--json'],
        { encoding: 'utf8' },
      )
      const surface = JSON.parse(stdout)
      expect(surface.schemaVersion).toBe(1)
      expect(surface.range).toBeDefined()
      expect(surface.blastRadius).toBeDefined()
      expect(Array.isArray(surface.commits)).toBe(true)
      expect(Array.isArray(surface.exclusionFilters)).toBe(true)
    })

    it('persists surface manifest and updates marker on disk', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dogfood-cli-out-'))
      try {
        const outFile = join(tempDir, 'surface.json')
        const markerFile = join(tempDir, 'marker.json')

        execFileSync(
          process.execPath,
          [
            SURFACE_READER_CLI,
            '--since',
            'HEAD~1',
            '--head',
            'HEAD',
            '--out',
            outFile,
            '--marker',
            markerFile,
          ],
          { encoding: 'utf8' },
        )

        const surface = JSON.parse(readFileSync(outFile, 'utf8'))
        expect(surface.schemaVersion).toBe(1)
        expect(surface.range.head).toBeDefined()

        const marker = JSON.parse(readFileSync(markerFile, 'utf8'))
        expect(marker.lastHead).toBe(surface.range.head)
        expect(marker.timestamp).toBeDefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})
