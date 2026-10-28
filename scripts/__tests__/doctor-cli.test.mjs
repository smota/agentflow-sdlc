import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  lstatSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
const cli = resolve('bin/cli.mjs')
let scratch, target
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
function run(args) {
  return spawnSync(process.execPath, [cli, 'doctor', '--target', target, ...args], {
    encoding: 'utf8',
  })
}
function snapshot() {
  const result = {}
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name)
      const stat = lstatSync(file)
      result[relative(scratch, file)] = [
        stat.mode,
        stat.mtimeMs,
        stat.size,
        stat.isFile() ? hash(readFileSync(file)) : null,
      ]
      if (stat.isDirectory()) walk(file)
    }
  }
  walk(scratch)
  return result
}
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'af-doctor-cli-'))
  target = join(scratch, 'target')
  mkdirSync(target)
})
afterEach(() => rmSync(scratch, { recursive: true, force: true }))

describe('CLI doctor actual consumer', () => {
  it('JSON and plain text expose the same findings, counts and exit status with no fixture changes', () => {
    writeFileSync(join(target, 'AGENTS.md'), 'Authored instructions')
    const before = snapshot()
    const json = run(['--json', '--harness', 'pi,codex'])
    const data = JSON.parse(json.stdout)
    const plain = run(['--harness', 'pi,codex'])
    expect(json.status).toBe(data.summary.exitCode)
    expect(plain.status).toBe(json.status)
    expect(data.schemaVersion).toBe(1)
    expect(Object.keys(data.dimensions)).toHaveLength(5)
    expect(data.dimensions['adapter-bindings'].map((f) => f.id)).toEqual([
      'adapters.pi',
      'adapters.codex',
    ])
    for (const finding of data.findings) expect(plain.stdout).toContain(finding.reason)
    for (const [name, count] of Object.entries(data.summary.counts))
      expect(plain.stdout).toContain(name + ': ' + count)
    expect(plain.stdout).toContain('Future repair:')
    expect(plain.stdout).toContain('Preserves:')
    expect(snapshot()).toEqual(before)
  })
  it('actual evidence files are parsed within target bounds and unsealed confirmation stays unknown', () => {
    writeFileSync(
      join(target, 'receipt.json'),
      JSON.stringify({ mutations: [{ path: 'fixture.txt', hash: hash('confirmed') }] }),
    )
    writeFileSync(join(target, 'fixture.txt'), 'confirmed')
    const before = snapshot()
    const result = run(['--json', '--baseline-receipt', 'receipt.json'])
    const report = JSON.parse(result.stdout)
    expect(
      report.dimensions['lock-integrity'].find((f) => f.id === 'baseline.receipt').alignment,
    ).toBe('unknown')
    expect(snapshot()).toEqual(before)
  })
  it('invalid and escaping evidence errors are stable, sanitized and read-only', () => {
    writeFileSync(join(target, 'bad.json'), '{"secret":"CLI_CANARY"')
    writeFileSync(join(scratch, 'outside.json'), '{"secret":"OUTSIDE_CANARY"}')
    symlinkSync(join(scratch, 'outside.json'), join(target, 'linked.json'))
    const before = snapshot()
    for (const file of ['bad.json', '../outside.json', 'linked.json', 'missing.json']) {
      const result = run(['--json', '--runtime-evidence', file])
      expect(result.status).toBe(2)
      expect(JSON.parse(result.stdout)).toEqual({
        schemaVersion: 1,
        error: 'doctor-input-invalid',
        field: 'runtimeEvidence',
      })
      expect(result.stdout + result.stderr).not.toMatch(/CANARY/)
    }
    expect(snapshot()).toEqual(before)
  })
  it('help documents structured evidence and does not inspect the target', () => {
    const before = snapshot()
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--baseline-receipt')
    expect(result.stdout).toContain('inside the target project')
    expect(snapshot()).toEqual(before)
  })
})
