import { afterEach, describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { recordDigest } from '../../lib/core/record-digest.mjs'
const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
describe('run CLI consumer journey', () => {
  it('starts, freezes, observes real tests, and reports a blocked gate without inventing acceptance', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-run-cli-'))
    roots.push(root)
    writeFileSync(join(root, 'app.cjs'), 'module.exports = (value) => value.trim().toLowerCase()')
    writeFileSync(
      join(root, 'app.test.cjs'),
      "const {test}=require('node:test');const assert=require('node:assert/strict');test('normalizes query',()=>assert.equal(require('./app.cjs')(' Search '),'search'))",
    )
    const candidate = { inputs: ['app.cjs', 'app.test.cjs'] }
    const check = {
      id: 'suite',
      criterionId: 'query',
      executable: process.execPath,
      args: ['--test', '--test-reporter=junit', 'app.test.cjs'],
      assertions: ['normalizes query'],
      timeoutMs: 5000,
      format: 'junit-stdout',
    }
    writeFileSync(
      join(root, 'agent-workflow.config.json'),
      JSON.stringify({
        delivery: {
          source: { kind: 'local-preview' },
          candidate,
          checks: { suite: check },
          contracts: { 'product-manager': 'acceptance.json' },
        },
      }),
    )
    writeFileSync(
      join(root, 'acceptance.json'),
      JSON.stringify({
        version: 2,
        goalRevision: 'fixture:1',
        criteria: [
          {
            id: 'query',
            definitionDigest: recordDigest({ ...check, ...candidate }),
            assertions: ['normalizes query'],
          },
        ],
      }),
    )
    const invoke = (...args) => {
      const result = spawnSync(
        process.execPath,
        [cli, 'run', ...args, '--target', root, '--json'],
        { encoding: 'utf8', timeout: 15000 },
      )
      return { code: result.status, value: JSON.parse(result.stdout) }
    }
    const mutation = ['--writer', 'fixture', '--generation', '0', '--execute']
    expect(invoke('start', 'demo', '--goal', 'fixture:1', ...mutation).code).toBe(0)
    const before = readFileSync(join(root, '.agent-runs/runs/demo/events.json'))
    expect(invoke('status', 'demo').value.result.durable).toBe(false)
    expect(readFileSync(join(root, '.agent-runs/runs/demo/events.json'))).toEqual(before)
    mkdirSync(join(root, 'defaults'))
    writeFileSync(
      join(root, 'defaults/sdlc.config.json'),
      JSON.stringify({ deliveryPolicy: { requiredJourneyCoverage: true } }),
    )
    expect(invoke('freeze', 'demo', ...mutation).code).toBe(3)
    const acceptance = JSON.parse(readFileSync(join(root, 'acceptance.json'), 'utf8'))
    acceptance.journeys = [{ id: 'search', required: true, criteria: ['query'] }]
    writeFileSync(join(root, 'acceptance.json'), JSON.stringify(acceptance))
    expect(invoke('freeze', 'demo', ...mutation).code).toBe(0)
    const context = invoke('context', 'demo').value.result
    expect(context.roleReference).toBe('roles/product-manager/ROLE.md')
    expect(context.contract.criteria[0].id).toBe('query')
    const observed = invoke('verify', 'demo', '--check', 'suite', ...mutation)
    expect(observed.code).toBe(0)
    expect(observed.value.result.verification.outcome).toBe('pass')
    const next = invoke('next', 'demo').value.result
    writeFileSync(join(root, 'advance.json'), JSON.stringify(next.advancePlan))
    const advance = invoke(
      'advance',
      'demo',
      '--plan',
      'advance.json',
      '--confirm',
      next.confirm,
      ...mutation,
    )
    expect(advance.code).toBe(3)
    expect(advance.value.error).toContain('bilateral')
    writeFileSync(join(root, 'app.cjs'), 'module.exports = () => "broken"')
    expect(invoke('verify', 'demo', '--check', 'suite', ...mutation).code).toBe(3)
    expect(invoke('pause', 'demo', ...mutation).code).toBe(0)
    const paused = readFileSync(join(root, '.agent-runs/runs/demo/events.json'))
    const denied = invoke('verify', 'demo', '--check', 'suite', ...mutation)
    expect(denied.code).toBe(3)
    expect(denied.value.error).toContain('Active run required')
    expect(readFileSync(join(root, '.agent-runs/runs/demo/events.json'))).toEqual(paused)
  })
})
