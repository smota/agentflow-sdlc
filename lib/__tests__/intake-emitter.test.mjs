import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import {
  VALID_CATEGORIES,
  VALID_SEVERITIES,
  computeFindingFingerprint,
  connectToBacklogQueue,
  createFinding,
  loadLocalFindings,
  normalizeReproSteps,
  saveFindingLocally,
  validateFinding,
} from '../core/intake-emitter.mjs'
import { runEmitFinding } from '../../scripts/dogfood/emit-finding.mjs'

describe('lib/core/intake-emitter (Issue #487)', () => {
  let tempDir

  beforeEach(() => {
    tempDir = join(tmpdir(), `intake-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('schema validation (schemas/intake-finding.json)', () => {
    it('validates schema definition against standard JSON Schema Draft 2020-12', () => {
      const schemaPath = join(process.cwd(), 'schemas', 'intake-finding.json')
      expect(existsSync(schemaPath)).toBe(true)
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
      const ajv = new Ajv2020({ allErrors: true, strict: false })
      const validate = ajv.compile(schema)

      const validFinding = {
        findingId: 'finding-123456789abc',
        timestamp: new Date().toISOString(),
        commitSha: '56c6e5566035b93b3d9abe15fd697f36c98f9c51',
        category: 'crash',
        reproSteps: ['npm start', 'curl http://localhost:3000/error'],
        observedOutput: 'Fatal error: unhandled exception',
        expectedProgress: 'Graceful 500 error response',
        severity: 'critical',
        jtbdPushForce: 'Server crashes when hitting invalid endpoint during evaluation',
      }

      const isValid = validate(validFinding)
      expect(isValid).toBe(true)
    })

    it('rejects finding missing required fields or invalid category', () => {
      const invalid = {
        findingId: 'f1',
        category: 'not-a-category',
      }
      const { valid, errors } = validateFinding(invalid)
      expect(valid).toBe(false)
      expect(errors.some((e) => e.includes('commitSha'))).toBe(true)
      expect(errors.some((e) => e.includes('category'))).toBe(true)
    })

    it('supports structured JTBD push force objects', () => {
      const structuredFinding = {
        findingId: 'finding-struct',
        timestamp: new Date().toISOString(),
        commitSha: 'abcdef123456',
        category: 'ergonomics-friction',
        reproSteps: 'cli run',
        observedOutput: 'Confusing flag syntax',
        expectedProgress: 'Intuitive POSIX flag names',
        severity: 'medium',
        jtbdPushForce: {
          struggle: 'Developers struggle to remember custom flag names',
          desiredProgress: 'Standardize flags across subcommands',
          pushDimension: 'cognitive-load',
        },
      }
      const { valid, errors } = validateFinding(structuredFinding)
      expect(valid).toBe(true)
      expect(errors).toEqual([])
    })
  })

  describe('fingerprinting and deduplication', () => {
    it('produces identical fingerprints for semantically identical inputs regardless of whitespace', () => {
      const f1 = {
        category: 'crash',
        targetComponent: 'cli',
        reproSteps: ['pnpm build', 'node index.js'],
        observedOutput: 'Out of memory  error',
      }
      const f2 = {
        category: 'CRASH',
        targetComponent: 'CLI',
        reproSteps: '  pnpm build\nnode index.js  ',
        observedOutput: 'Out of memory error',
      }
      expect(computeFindingFingerprint(f1)).toBe(computeFindingFingerprint(f2))
    })

    it('produces different fingerprints for different categories or repro steps', () => {
      const f1 = {
        category: 'crash',
        reproSteps: 'node a.js',
        observedOutput: 'error',
      }
      const f2 = {
        category: 'edge-case',
        reproSteps: 'node a.js',
        observedOutput: 'error',
      }
      expect(computeFindingFingerprint(f1)).not.toBe(computeFindingFingerprint(f2))
    })
  })

  describe('createFinding and local persistence', () => {
    it('creates and persists finding to disk with automatic fingerprinting', () => {
      const finding = createFinding({
        commitSha: '1234567890abcdef',
        category: 'performance-regression',
        reproSteps: ['pnpm test:perf'],
        observedOutput: 'Test took 8.5s (threshold: 3.0s)',
        expectedProgress: 'Test should complete under 3.0s',
        severity: 'high',
        jtbdPushForce: 'Cold test suite execution slows developer feedback loops',
        targetComponent: 'test-runner',
      })

      expect(finding.findingId).toMatch(/^finding-[a-f0-9]{12}$/)
      expect(finding.fingerprint).toHaveLength(64)

      const saveResult = saveFindingLocally(finding, {
        targetDir: tempDir,
        intakeDir: 'intake',
      })
      expect(saveResult.saved).toBe(true)
      expect(saveResult.duplicate).toBe(false)
      expect(existsSync(saveResult.path)).toBe(true)

      const loaded = loadLocalFindings(join(tempDir, 'intake'))
      expect(loaded).toHaveLength(1)
      expect(loaded[0].findingId).toBe(finding.findingId)
      expect(loaded[0].category).toBe('performance-regression')
    })

    it('detects and suppresses duplicate findings when dedup is enabled', () => {
      const params = {
        commitSha: '1234567890abcdef',
        category: 'crash',
        reproSteps: ['node app.js'],
        observedOutput: 'Segmentation fault',
        expectedProgress: 'Clean exit or caught exception',
        severity: 'critical',
        jtbdPushForce: 'App crashes on start',
      }

      const f1 = createFinding(params)
      const save1 = saveFindingLocally(f1, { targetDir: tempDir, intakeDir: 'intake' })
      expect(save1.saved).toBe(true)

      const f2 = createFinding(params)
      const save2 = saveFindingLocally(f2, { targetDir: tempDir, intakeDir: 'intake' })
      expect(save2.saved).toBe(false)
      expect(save2.duplicate).toBe(true)
      expect(save2.finding.findingId).toBe(f1.findingId)
    })
  })

  describe('connectToBacklogQueue', () => {
    it('formats a structured backlog capability intake item', () => {
      const finding = createFinding({
        commitSha: '56c6e55660',
        category: 'ergonomics-friction',
        targetComponent: 'steer-cli',
        reproSteps: ['steer assign'],
        observedOutput: 'Unknown flag error without suggestion',
        expectedProgress: 'Helpful flag suggestion provided',
        severity: 'medium',
        jtbdPushForce: 'Supervisors need actionable feedback when typing invalid flags',
      })

      const { queueItem, enqueued } = connectToBacklogQueue(finding, { dryRun: true })
      expect(enqueued).toBe(false)
      expect(queueItem.kind).toBe('capability')
      expect(queueItem.triage).toBe('intake')
      expect(queueItem.title).toContain('[steer-cli]')
      expect(queueItem.body).toContain('## Job / Push Force')
      expect(queueItem.body).toContain('## Deterministic Reproduction')
      expect(queueItem.body).toContain('1. `steer assign`')
    })

    it('atomically appends to backlog queue file when queuePath is provided', () => {
      const finding = createFinding({
        commitSha: '56c6e55660',
        category: 'edge-case',
        reproSteps: ['git status'],
        observedOutput: 'Unexpected untracked file',
        expectedProgress: 'Ignored file pattern',
        severity: 'low',
        jtbdPushForce: 'Clean workspace state preservation',
      })

      const queuePath = join(tempDir, 'queue.json')
      const result = connectToBacklogQueue(finding, { queuePath })
      expect(result.enqueued).toBe(true)
      expect(existsSync(queuePath)).toBe(true)

      const storedQueue = JSON.parse(readFileSync(queuePath, 'utf8'))
      expect(storedQueue).toHaveLength(1)
      expect(storedQueue[0].findingId).toBe(finding.findingId)

      // Deduplication test on queue file
      connectToBacklogQueue(finding, { queuePath })
      const storedQueue2 = JSON.parse(readFileSync(queuePath, 'utf8'))
      expect(storedQueue2).toHaveLength(1)
    })
  })

  describe('CLI runner (scripts/dogfood/emit-finding.mjs)', () => {
    it('shows help text when passed --help', async () => {
      let stdout = ''
      const origWrite = process.stdout.write
      process.stdout.write = (chunk) => {
        stdout += chunk
        return true
      }
      try {
        const code = await runEmitFinding(['--help'])
        expect(code).toBe(0)
        expect(stdout).toContain('Usage: node scripts/dogfood/emit-finding.mjs')
      } finally {
        process.stdout.write = origWrite
      }
    })

    it('emits finding from CLI flags and returns JSON', async () => {
      let stdout = ''
      const origWrite = process.stdout.write
      process.stdout.write = (chunk) => {
        stdout += chunk
        return true
      }
      try {
        const code = await runEmitFinding([
          '--category',
          'crash',
          '--repro',
          'npm run crash-test',
          '--observed',
          'Process exited with SIGSEGV',
          '--expected',
          'Process terminates normally',
          '--severity',
          'critical',
          '--jtbd',
          'Native addon memory corruption during heavy load',
          '--target',
          tempDir,
          '--intake-dir',
          'intake-cli',
          '--json',
        ])
        expect(code).toBe(0)
        const parsed = JSON.parse(stdout)
        expect(parsed.ok).toBe(true)
        expect(parsed.saved).toBe(true)
        expect(parsed.finding.category).toBe('crash')
      } finally {
        process.stdout.write = origWrite
      }
    })

    it('supports dry run mode without writing to disk', async () => {
      let stdout = ''
      const origWrite = process.stdout.write
      process.stdout.write = (chunk) => {
        stdout += chunk
        return true
      }
      try {
        const code = await runEmitFinding([
          '--category',
          'edge-case',
          '--repro',
          'test step',
          '--observed',
          'obs',
          '--expected',
          'exp',
          '--severity',
          'low',
          '--jtbd',
          'dry run jtbd',
          '--target',
          tempDir,
          '--intake-dir',
          'dry-intake',
          '--dry-run',
          '--json',
        ])
        expect(code).toBe(0)
        const parsed = JSON.parse(stdout)
        expect(parsed.saved).toBe(false)
        expect(existsSync(join(tempDir, 'dry-intake'))).toBe(false)
      } finally {
        process.stdout.write = origWrite
      }
    })

    it('loads finding definition from a JSON file', async () => {
      const jsonFile = join(tempDir, 'sample-finding.json')
      writeFileSync(
        jsonFile,
        JSON.stringify({
          category: 'performance-regression',
          reproSteps: 'make test',
          observedOutput: 'slow',
          expectedProgress: 'fast',
          severity: 'high',
          jtbdPushForce: 'build takes too long',
        }),
      )

      let stdout = ''
      const origWrite = process.stdout.write
      process.stdout.write = (chunk) => {
        stdout += chunk
        return true
      }
      try {
        const code = await runEmitFinding([
          '--file',
          jsonFile,
          '--target',
          tempDir,
          '--intake-dir',
          'intake-file',
          '--json',
        ])
        expect(code).toBe(0)
        const parsed = JSON.parse(stdout)
        expect(parsed.saved).toBe(true)
        expect(parsed.finding.category).toBe('performance-regression')
      } finally {
        process.stdout.write = origWrite
      }
    })
  })
})
