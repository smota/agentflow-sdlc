import { afterEach, describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
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
    // W8b2 — DEFECT FIXED: this used to expect exit 3 / 'bilateral' here, reachable only because
    // the run-service defect made `requiresHumanAcceptance` silently return false for the default
    // 'assisted' posture on a 'standard' change, letting advance() skip straight past the human
    // gate to the bilateral-collaboration check underneath. With the fix, advance()'s very first
    // transition (phase 0, the intent-freeze crossing) correctly asks a human — every posture,
    // including the factory default, requires one there — and this CLI's own `authorize` callback
    // (scripts/run-delivery.mjs) deliberately never grants `human-acceptance` on its own, so the
    // run correctly blocks here instead of inventing bilateral acceptance it does not have either.
    //
    // W8e / D3 — DEFECT FIXED: this used to expect exit 2 here. "Human acceptance is unresolved" is
    // a governed block (a human decision is owed, not a genuine error) but matched none of the
    // message regexes run-delivery.mjs used to classify exit codes, so it fell through to the
    // generic invalid code. It is now a typed GovernedBlockError and classifies to the documented
    // governed-block code (3), the same code an escalated gate produces.
    expect(advance.code).toBe(3)
    expect(advance.value.error).toContain('Human acceptance is unresolved')
    writeFileSync(join(root, 'app.cjs'), 'module.exports = () => "broken"')
    expect(invoke('verify', 'demo', '--check', 'suite', ...mutation).code).toBe(3)
    expect(invoke('pause', 'demo', ...mutation).code).toBe(0)
    const paused = readFileSync(join(root, '.agent-runs/runs/demo/events.json'))
    const denied = invoke('verify', 'demo', '--check', 'suite', ...mutation)
    expect(denied.code).toBe(3)
    expect(denied.value.error).toContain('Active run required')
    expect(readFileSync(join(root, '.agent-runs/runs/demo/events.json'))).toEqual(paused)
  })

  // W8e / D4, test 5 — `--writer` now defaults to the local operator identity (the OS user name)
  // instead of being required plumbing. `run start` must work without it, and the recorded owner
  // must be the actual OS user, not a placeholder.
  it('`run start` works without --writer, defaulting the owner to the local OS user (W8e / D4, test 5)', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-run-cli-writer-'))
    roots.push(root)
    writeFileSync(
      join(root, 'agent-workflow.config.json'),
      JSON.stringify({
        delivery: { source: { kind: 'local-preview' }, candidate: { inputs: [] } },
      }),
    )
    const result = spawnSync(
      process.execPath,
      [cli, 'run', 'start', 'demo', '--goal', 'fixture:1', '--execute', '--target', root, '--json'],
      { encoding: 'utf8', timeout: 15000 },
    )
    expect(result.status).toBe(0)
    const value = JSON.parse(result.stdout)
    expect(value.result.owner).toBe(userInfo().username)
  })

  // W8e / D6, test 7 — every `run` command used to print nothing but raw internal state
  // (candidateDigest, boundary, generation, revision hashes) whether or not `--json` was requested.
  // A one-line plain-language summary must now come BEFORE the JSON when `--json` is not passed, and
  // `--json` output must stay byte-for-byte what it always was (a hard constraint).
  it('every `run` command prints a plain-language summary line before its JSON, and --json output is unchanged (W8e / D6, test 7)', () => {
    // Each mode gets its OWN fresh root and runs the identical mutating sequence: `run start` and
    // `run freeze` mutate durable state, so replaying the same command twice against one root (once
    // plain, once --json) would hit the second call against already-advanced state instead of
    // proving anything about output formatting. Two parallel roots isolate that.
    const setUpRoot = () => {
      const root = mkdtempSync(join(tmpdir(), 'agentflow-run-cli-summary-'))
      roots.push(root)
      writeFileSync(
        join(root, 'agent-workflow.config.json'),
        JSON.stringify({
          delivery: { source: { kind: 'local-preview' }, candidate: { inputs: [] } },
        }),
      )
      return root
    }
    const plainRoot = setUpRoot()
    const jsonRoot = setUpRoot()
    const mutation = ['--writer', 'fixture', '--generation', '0', '--execute']
    const invoke = (root, extraArgs, args) => {
      const result = spawnSync(
        process.execPath,
        [cli, 'run', ...args, '--target', root, ...extraArgs],
        {
          encoding: 'utf8',
          timeout: 15000,
        },
      )
      if (result.status !== 0 && !args.includes('freeze'))
        throw new Error(`unexpected failure: ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
      return result
    }

    for (const args of [
      ['start', 'demo', '--goal', 'fixture:1', ...mutation],
      ['freeze', 'demo', ...mutation],
      ['status', 'demo'],
      ['checkpoint', 'demo', ...mutation],
    ]) {
      const json = invoke(jsonRoot, ['--json'], args)
      const plain = invoke(plainRoot, [], args)

      // --json stays exactly what it always was: parseable, and its very first character is '{' —
      // no summary line was prepended to it.
      expect(json.stdout.trimStart()[0]).toBe('{')
      const parsedJson = JSON.parse(json.stdout)
      expect(parsedJson.version).toBe(1)

      // Without --json, a plain-language line comes first — not JSON — and the same JSON block
      // still follows it.
      const firstLine = plain.stdout.split('\n')[0]
      expect(firstLine.length).toBeGreaterThan(0)
      expect(firstLine.trim().startsWith('{')).toBe(false)
      const jsonStart = plain.stdout.indexOf('{')
      expect(jsonStart).toBeGreaterThan(firstLine.length - 1)
      const parsedPlain = JSON.parse(plain.stdout.slice(jsonStart))
      expect(parsedPlain.version).toBe(parsedJson.version)
      expect(typeof parsedPlain.result).toBe(typeof parsedJson.result)
    }
  })
})
