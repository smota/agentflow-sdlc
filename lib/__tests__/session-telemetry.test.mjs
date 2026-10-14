import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  aggregateTraceRecords,
  extractSessionTelemetry,
  loadTelemetryDigest,
  parseJsonLines,
  saveTelemetryDigest,
} from '../session-telemetry.mjs'
import { runSessionExtractor } from '../../scripts/telemetry/session-extractor.mjs'

describe('lib/core/session-telemetry (Issue #488)', () => {
  let tempDir

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    )
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('parseJsonLines', () => {
    it('gracefully handles truncated, malformed, and empty lines', () => {
      const raw = `
{"step": 1, "type": "USER_INPUT"}
{"step": 2, "type": "PLANNER_RESPONSE", "thinking": "partial...
{"step": 3, "type": "PLANNER_RESPONSE", "status": "DONE"}

not json at all
{"step": 4, "type": "TOOL_CALL"}
`
      const records = parseJsonLines(raw)
      expect(records).toHaveLength(3)
      expect(records[0].step).toBe(1)
      expect(records[1].step).toBe(3)
      expect(records[2].step).toBe(4)
    })
  })

  describe('aggregateTraceRecords', () => {
    it('aggregates turns, tokens, commands, and failures across roles and phases', () => {
      const mockRecords = [
        {
          role: 'orch.arch',
          phase: '2',
          type: 'PLANNER_RESPONSE',
          usage: { prompt_tokens: 500, completion_tokens: 150 },
          tool_calls: [
            {
              name: 'run_command',
              args: { CommandLine: 'git status' },
              exit_code: 0,
            },
          ],
        },
        {
          role: 'dev.build',
          phase: '4',
          type: 'PLANNER_RESPONSE',
          usage: { prompt_tokens: 1200, completion_tokens: 400 },
          tool_calls: [
            {
              name: 'run_command',
              args: { CommandLine: 'pnpm test' },
              exit_code: 1,
            },
            {
              name: 'run_command',
              args: { CommandLine: 'pnpm lint' },
              exit_code: 0,
            },
          ],
        },
        {
          role: 'rev.review',
          phase: '6',
          event: 'rework',
          details: 'Rejecting due to missing test assertions',
        },
        {
          role: 'steer.lead',
          phase: 'governance',
          event: 'freeze',
          reason: 'circuit_breaker_triggered: max rework loops exceeded',
          circuitBreaker: true,
        },
        {
          role: 'steer.lead',
          phase: 'governance',
          event: 'unfreeze',
          resolutionId: 'unfreeze-res-123',
        },
      ]

      const digest = aggregateTraceRecords(mockRecords, 'test-run-1')

      expect(digest.runId).toBe('test-run-1')
      expect(digest.summary.totalTurns).toBe(2)
      expect(digest.summary.tokens.prompt).toBe(1700)
      expect(digest.summary.tokens.completion).toBe(550)
      expect(digest.summary.tokens.total).toBe(2250)
      expect(digest.summary.commands.total).toBe(3)
      expect(digest.summary.commands.failures).toBe(1)
      expect(digest.summary.commands.failureRate).toBe(0.3333)

      expect(digest.summary.processHealth.reworkCount).toBe(1)
      expect(digest.summary.processHealth.freezeCount).toBe(1)
      expect(digest.summary.processHealth.unfreezeCount).toBe(1)
      expect(digest.summary.processHealth.circuitBreakerTrips).toBe(1)

      expect(digest.breakdown.turnsByRole['orch.arch']).toBe(1)
      expect(digest.breakdown.turnsByRole['dev.build']).toBe(1)
      expect(digest.breakdown.commandsByRole['dev.build']).toBe(2)
      expect(digest.failedCommands).toHaveLength(1)
      expect(digest.failedCommands[0].command).toBe('pnpm test')
    })
  })

  describe('extractSessionTelemetry from files and directory', () => {
    it('aggregates multiple concurrent session logs in a run directory', () => {
      const runDir = join(tempDir, 'sessions')
      mkdirSync(runDir, { recursive: true })

      const session1 = [
        JSON.stringify({
          role: 'orch.arch',
          type: 'PLANNER_RESPONSE',
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        JSON.stringify({ role: 'orch.arch', command: 'git checkout -b feat', exit_code: 0 }),
      ].join('\n')

      const session2 = [
        JSON.stringify({
          role: 'dev.build',
          type: 'PLANNER_RESPONSE',
          usage: { prompt_tokens: 300, completion_tokens: 150 },
        }),
        JSON.stringify({ role: 'dev.build', command: 'pnpm compile', exit_code: 2 }),
      ].join('\n')

      writeFileSync(join(runDir, 'arch-session.jsonl'), session1, 'utf8')
      writeFileSync(join(runDir, 'build-session.jsonl'), session2, 'utf8')

      const digest = extractSessionTelemetry({
        inputs: runDir,
        runId: 'multi-session-run',
        targetDir: tempDir,
        outDir: 'telemetry',
      })

      expect(digest.summary.totalTurns).toBe(2)
      expect(digest.summary.tokens.total).toBe(600)
      expect(digest.summary.commands.total).toBe(2)
      expect(digest.summary.commands.failures).toBe(1)

      const saved = loadTelemetryDigest('multi-session-run', {
        targetDir: tempDir,
        telemetryDir: 'telemetry',
      })
      expect(saved).not.toBeNull()
      expect(saved.runId).toBe('multi-session-run')
    })
  })

  describe('CLI runner (scripts/telemetry/session-extractor.mjs)', () => {
    it('prints usage when invoked with --help', async () => {
      let stdout = ''
      const origWrite = process.stdout.write
      process.stdout.write = (chunk) => {
        stdout += chunk
        return true
      }
      try {
        const code = await runSessionExtractor(['--help'])
        expect(code).toBe(0)
        expect(stdout).toContain('Usage: node scripts/telemetry/session-extractor.mjs')
      } finally {
        process.stdout.write = origWrite
      }
    })

    it('extracts session logs from trace file via CLI and emits JSON', async () => {
      const traceFile = join(tempDir, 'single-trace.jsonl')
      writeFileSync(
        traceFile,
        JSON.stringify({
          role: 'pm.manager',
          type: 'PLANNER_RESPONSE',
          usage: { prompt: 200, completion: 80 },
          command: 'ls',
          exit_code: 0,
        }) + '\n',
      )

      let stdout = ''
      const origWrite = process.stdout.write
      process.stdout.write = (chunk) => {
        stdout += chunk
        return true
      }
      try {
        const code = await runSessionExtractor([
          '--traces',
          traceFile,
          '--run-id',
          'cli-test-run',
          '--target',
          tempDir,
          '--out-dir',
          'cli-out',
          '--json',
        ])
        expect(code).toBe(0)
        const parsed = JSON.parse(stdout)
        expect(parsed.runId).toBe('cli-test-run')
        expect(parsed.summary.totalTurns).toBe(1)
        expect(parsed.summary.tokens.total).toBe(280)
        expect(existsSync(join(tempDir, 'cli-out', 'cli-test-run.json'))).toBe(true)
      } finally {
        process.stdout.write = origWrite
      }
    })
  })
})
