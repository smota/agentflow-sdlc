import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { recordDigest } from '../core/record-digest.mjs'
import { analyzeSpool } from '../../scripts/analyze-telemetry.mjs'

describe('fresh-process telemetry continuity', () => {
  it('correlates pause and resume without chat state or a collector', () => {
    const root = mkdtempSync(join(tmpdir(), 'af-303-'))
    const spool = join(root, 'telemetry')
    writeFileSync(join(root, 'app.txt'), 'candidate')
    writeFileSync(join(root, 'app.test.cjs'), "require('node:test').test('works',()=>{})")
    const candidate = { inputs: ['app.txt', 'app.test.cjs'] }
    const check = {
      id: 'suite',
      criterionId: 'check',
      executable: process.execPath,
      args: ['--test', '--test-reporter=junit', 'app.test.cjs'],
      assertions: ['works'],
      timeoutMs: 5000,
      format: 'junit-stdout',
    }
    writeFileSync(
      join(root, 'acceptance.json'),
      JSON.stringify({
        version: 2,
        goalRevision: 'fixture:1',
        criteria: [
          {
            id: 'check',
            definitionDigest: recordDigest({ ...check, ...candidate }),
            assertions: ['works'],
          },
        ],
      }),
    )
    writeFileSync(
      join(root, 'agent-workflow.config.json'),
      JSON.stringify({
        observability: { enabled: true, offline: true, spoolDir: spool },
        delivery: {
          source: { kind: 'local-preview' },
          candidate,
          checks: { suite: check },
          contracts: { 'product-manager': 'acceptance.json' },
        },
      }),
    )
    const moduleUrl = pathToFileURL(resolve('scripts/run-delivery.mjs')).href
    const run = (args, expectedStatus = 0) => {
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { runDelivery } from ${JSON.stringify(moduleUrl)};
        try { process.exitCode = await runDelivery([...JSON.parse(process.argv[1]), '--writer-pid', String(process.pid)]); }
        catch (error) { console.log(JSON.stringify({error: error.message})); process.exitCode = 2; }`,
          JSON.stringify([
            args[0],
            'flow',
            ...args.slice(1),
            '--target',
            root,
            '--writer',
            'operator',
            '--generation',
            '0',
            '--execute',
            '--json',
          ]),
        ],
        { encoding: 'utf8', timeout: 15000, windowsHide: true },
      )
      expect(child.status, child.stderr + child.stdout).toBe(expectedStatus)
      return JSON.parse(child.stdout).result
    }
    try {
      expect(run(['start', '--goal', 'PRIVATE_GOAL']).status).toBe('active')
      run(['freeze'])
      run(['verify', '--check', 'suite'])
      run(['verify', '--check', 'suite'])
      const candidateFile = readFileSync(join(root, 'app.txt'))
      rmSync(join(root, 'app.txt'))
      run(['verify', '--check', 'suite'], 2)
      writeFileSync(join(root, 'app.txt'), candidateFile)
      run(['pause'])
      // Each wrapper process has exited; recovery observes the previous writer as stopped.
      const plan = run(['resume'])
      writeFileSync(join(root, 'recovery.json'), JSON.stringify(plan))
      expect(run(['resume', '--plan', 'recovery.json', '--confirm', plan.digest]).status).toBe(
        'active',
      )
      const spans = readdirSync(spool)
        .filter((name) => name.endsWith('.json'))
        .flatMap((name) => {
          const payload = JSON.parse(readFileSync(join(spool, name), 'utf8')).payload
          return payload.kind === 'traces' ? payload.records : []
        })
      const events = spans
        .filter((span) => span.name !== 'agentflow.session')
        .map((span) => span.attributes)
      expect(new Set(events.map((event) => event.runId)).size).toBe(1)
      expect(new Set(events.map((event) => event.sessionId)).size).toBe(8)
      expect(
        events
          .filter((event) => event.kind === 'run_event_appended')
          .map((event) => event.eventKind),
      ).toEqual(expect.arrayContaining(['started', 'paused', 'resumed']))
      expect(JSON.stringify(spans)).not.toContain('PRIVATE_GOAL')
      const summary = analyzeSpool(spool)
      expect(summary.process.observedRuns).toBe(1)
      expect(summary.process.observedSessions).toBe(8)
      expect(summary.process.acknowledgedEventCounts.resumed).toBe(1)
      expect(summary.input.invalidFiles).toBe(0)
      expect(summary.process.observedAttempts).toBe(3)
      const attempts = events.filter((event) => event.kind === 'execution_attempt')
      expect(attempts).toHaveLength(6)
      expect(attempts.filter((event) => event.state === 'unknown')).toHaveLength(1)
      for (const id of new Set(attempts.map((event) => event.attemptId))) {
        expect(attempts.filter((event) => event.attemptId === id)).toHaveLength(2)
        expect(
          attempts
            .filter((event) => event.attemptId === id)
            .map((event) => event.state)
            .sort(),
        ).toEqual(expect.arrayContaining(['started']))
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60000)
})
