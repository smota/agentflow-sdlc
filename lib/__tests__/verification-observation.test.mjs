import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectProcessObservation,
  inspectProcessRuntime,
} from '../verification/process-collector.mjs'
import { fingerprintCandidate } from '../verification/workspace.mjs'
import { verifyObservation } from '../core/verification-observation.mjs'
import { recordDigest } from '../core/record-digest.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-observe-'))
  roots.push(root)
  writeFileSync(join(root, 'input.txt'), 'candidate')
  const definition = {
    id: 'suite',
    criterionId: 'AC-1',
    executable: process.execPath,
    args: [],
    inputs: ['input.txt'],
    assertions: ['search'],
    timeoutMs: 5000,
  }
  return { root, definition, boundary: 'mutate-worktree' }
}
function runner(_bin, _args, options) {
  writeFileSync(
    options.env.AGENTFLOW_REPORT_PATH,
    JSON.stringify({
      invocationId: options.env.AGENTFLOW_INVOCATION_ID,
      assertions: [{ id: 'search', outcome: 'pass' }],
    }),
  )
  return { status: 0 }
}
describe('current invocation verification', () => {
  it('invalidates a changed executable without changing the candidate files', () => {
    const options = fixture(),
      executable = join(options.root, 'runtime-fixture')
    writeFileSync(executable, 'first runtime')
    options.definition.executable = executable
    const result = collectProcessObservation({
      ...options,
      runner: (...args) => {
        const output = runner(...args)
        writeFileSync(executable, 'second runtime')
        return output
      },
    })
    expect(result.observation.outcome).toBe('fail')
    expect(result.observation.errors).toContain('Executable runtime changed during verification')
    expect(inspectProcessRuntime(options.root, options.definition).identity.digest).not.toBe(
      result.observation.executionContextDigest,
    )
    expect(fingerprintCandidate(options.root, options.definition).digest).toBe(
      result.candidate.digest,
    )
  })
  it('collects current evidence and requires source resolution separately', () => {
    const options = fixture()
    const { observation } = collectProcessObservation({ ...options, runner })
    const input = {
      observation,
      candidateDigest: fingerprintCandidate(options.root, options.definition).digest,
      definitionDigest: recordDigest(options.definition),
      requiredAssertions: ['search'],
    }
    expect(verifyObservation(input).status).toBe('blocked')
    expect(verifyObservation({ ...input, sourceVerified: true }).status).toBe('pass')
    expect(
      verifyObservation({ ...input, sourceVerified: true, requireImmutable: true }).status,
    ).toBe('blocked')
  })
  it('rejects an exit-zero no-op rather than reusing a report', () => {
    const options = fixture()
    const first = collectProcessObservation({ ...options, runner })
    const second = collectProcessObservation({ ...options, runner: () => ({ status: 0 }) })
    expect(first.observation.outcome).toBe('pass')
    expect(second.observation.outcome).toBe('fail')
    expect(second.observation.invocationId).not.toBe(first.observation.invocationId)
  })
  it('rejects a copied report from an earlier invocation', () => {
    const options = fixture()
    const first = collectProcessObservation({ ...options, runner })
    const old = readFileSync(first.observationPath.replace('observation.json', 'report.json'))
    const result = collectProcessObservation({
      ...options,
      runner: (_b, _a, opts) => {
        writeFileSync(opts.env.AGENTFLOW_REPORT_PATH, old)
        return { status: 0 }
      },
    })
    expect(result.observation.errors).toContain('Report belongs to another invocation')
  })
  it('invalidates candidate changes during a real check', () => {
    const options = fixture()
    const result = collectProcessObservation({
      ...options,
      runner: (...args) => {
        const result = runner(...args)
        writeFileSync(join(options.root, 'input.txt'), 'changed')
        return result
      },
    })
    expect(result.observation.outcome).toBe('fail')
    expect(result.observation.errors).toContain('Candidate changed during verification')
  })
  it('never executes without the required action boundary', () => {
    expect(() => collectProcessObservation({ ...fixture(), boundary: 'observe', runner })).toThrow(
      'authority',
    )
  })
  it('runs a real child and captures the structured assertion', () => {
    const options = fixture()
    options.definition.args = [
      '-e',
      "require('fs').writeFileSync(process.env.AGENTFLOW_REPORT_PATH, JSON.stringify({invocationId:process.env.AGENTFLOW_INVOCATION_ID,assertions:[{id:'search',outcome:'pass'}]}))",
    ]
    expect(collectProcessObservation(options).observation.outcome).toBe('pass')
  })
  it('collects a real native Node JUnit report without a custom evidence formatter', () => {
    const options = fixture()
    writeFileSync(
      join(options.root, 'search.test.cjs'),
      "const { test } = require('node:test'); test('search', () => require('node:assert/strict').equal(2 + 2, 4))",
    )
    options.definition.inputs.push('search.test.cjs')
    options.definition.format = 'junit-stdout'
    options.definition.args = ['--test', '--test-reporter=junit', 'search.test.cjs']
    expect(collectProcessObservation(options).observation.outcome).toBe('pass')
  })
})
