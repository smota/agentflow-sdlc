import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { inspectDoctor } from '../services/doctor-service.mjs'
import { runConfigDoctor } from '../config/doctor.mjs'
import { formatDoctorJson, formatDoctorPlain } from '../services/doctor-report.mjs'
import {
  readBaselineAlignment,
  readProjectConfigs,
  readRuntimeReachability,
  safeReadFileUtf8,
  createReadScope,
  MAX_FILE_SIZE,
  MAX_AGGREGATE_SIZE,
} from '../services/doctor-readers.mjs'
import { planAdoption, applyAdoption } from '../adoption/transaction.mjs'
import { buildRuntimeRequest } from '../onboarding/runtime-handoff.mjs'
import { LOCKFILE_NAME } from '../lockfile.mjs'
import { syncBuiltinESMExports } from 'node:module'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import cp from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
let scratch, root
function write(relative, content) {
  const full = path.join(root, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}
function seal(base) {
  return { ...base, receiptToken: digest(JSON.stringify(base)) }
}
function receiptFor(paths = ['fixture.txt']) {
  const planToken = 'a'.repeat(64)
  const entries = paths.map((p) => ({
    target: p,
    source: p,
    ownership: 'managed',
    state: 'managed',
    hash: digest('confirmed'),
  }))
  write(LOCKFILE_NAME, JSON.stringify({ version: 2, profile: 'standard', planToken, entries }))
  for (const p of paths) write(p, 'confirmed')
  const mutations = [
    ...entries.map((e) => ({ path: e.target, afterHash: e.hash })),
    { path: LOCKFILE_NAME, afterHash: digest(fs.readFileSync(path.join(root, LOCKFILE_NAME))) },
  ]
  return seal({
    version: 1,
    target: root.replaceAll('\\', '/'),
    profile: 'standard',
    planToken,
    changed: mutations.map((m) => m.path),
    mutations,
  })
}
function snapshot(dir) {
  const files = {}
  function walk(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name)
      const stat = fs.lstatSync(full)
      const key = path.relative(dir, full)
      files[key] = {
        mode: stat.mode,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        bytes: stat.isFile() ? digest(fs.readFileSync(full)) : null,
      }
      if (stat.isDirectory()) walk(full)
    }
  }
  walk(dir)
  return files
}
beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'af-doctor-recovery-'))
  root = path.join(scratch, 'project')
  fs.mkdirSync(root)
})
afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  fs.rmSync(scratch, { recursive: true, force: true })
})

describe('Doctor public read-only observations (AC1–AC6; R1–R5)', () => {
  it('returns five dimensions and formats the same structured findings in JSON and plain text', () => {
    const report = inspectDoctor({ packageRoot: process.cwd(), targetDir: root })
    expect(Object.keys(report.dimensions)).toEqual([
      'project-configs',
      'adapter-bindings',
      'lock-integrity',
      'runtime-reachability',
      'world-integrity',
    ])
    expect(JSON.parse(formatDoctorJson(report))).toEqual(report)
    for (const f of report.findings) expect(formatDoctorPlain(report)).toContain(f.reason)
    expect(report.summary.exitCode).toBe(1)
    expect(report.findings.find((f) => f.id === 'config.workflow').structural).toBe('missing')
    expect(report.findings.find((f) => f.id === 'baseline.receipt').alignment).toBe('unknown')
  })

  it('uses an ACTUAL applied standard adoption receipt and canonical lock; one byte of drift differs', () => {
    const plan = planAdoption(process.cwd(), root, { profile: 'standard' })
    expect(plan.blocked).toBe(false)
    const receipt = applyAdoption(process.cwd(), root, plan, {
      confirm: plan.token,
      receiptDestination: path.join(scratch, 'receipt.json'),
    })
    const actual = receipt.receipt ?? receipt
    const before = readBaselineAlignment({ targetDir: root, baselineReceipt: actual })
    expect(before.find((f) => f.id === 'baseline.receipt').alignment).toBe('matched')
    const managed = actual.mutations.find((m) => m.path.startsWith('lib/') && m.afterHash)
    expect(managed).toBeDefined()
    fs.appendFileSync(path.join(root, managed.path), '\n')
    const after = readBaselineAlignment({ targetDir: root, baselineReceipt: actual })
    expect(after.find((f) => f.id === 'baseline.drift.' + managed.path).alignment).toBe('differing')
    expect(after.find((f) => f.id === 'baseline.receipt').alignment).toBe('differing')
  })

  it('never matches unsealed/hashless/empty/corrupt/wrong-root/unrelated/escaping or null entries', () => {
    const valid = receiptFor()
    const { receiptToken, ...base } = valid
    const cases = [
      {},
      { mutations: [{ path: 'fixture.txt', hash: digest('confirmed') }] },
      { ...valid, receiptToken: 'b'.repeat(64) },
      seal({ ...base, target: path.join(scratch, 'other') }),
      seal({ ...base, mutations: [null], changed: [null] }),
      seal({
        ...base,
        mutations: [{ path: '../outside', afterHash: digest('confirmed') }],
        changed: ['../outside'],
      }),
      seal({
        ...base,
        mutations: [{ path: 'unowned.txt', afterHash: digest('confirmed') }],
        changed: ['unowned.txt'],
      }),
    ]
    for (const receipt of cases) {
      const observations = readBaselineAlignment({ targetDir: root, baselineReceipt: receipt })
      expect(observations.some((f) => f.alignment === 'matched')).toBe(false)
      expect(observations.find((f) => f.id === 'baseline.receipt').alignment).toBe('unknown')
    }
    expect(
      readBaselineAlignment({ targetDir: root, baselineReceipt: valid }).at(-1).alignment,
    ).toBe('matched')
    write(LOCKFILE_NAME, '{}')
    expect(
      readBaselineAlignment({ targetDir: root, baselineReceipt: valid }).at(-1).alignment,
    ).toBe('unknown')
  })

  it('reports all 2049 uninspected receipt entries unknown, never silently matches a prefix', () => {
    write('fixture.txt', 'confirmed')
    const receipt = {
      mutations: Array.from({ length: 2049 }, () => ({
        path: 'fixture.txt',
        hash: digest('confirmed'),
      })),
    }
    receipt.mutations[2048] = { path: 'missing.txt', hash: 'b'.repeat(64) }
    const findings = readBaselineAlignment({ targetDir: root, baselineReceipt: receipt })
    expect(findings.at(-1).alignment).toBe('unknown')
    expect(findings.at(-1).evidence).toMatchObject({
      totalEntries: 2049,
      inspectedEntries: 0,
      uninspectedEntries: 2049,
    })
  })

  it('caps every dimension, finding and remediation list at 512 and retains true observed counts', () => {
    const paths = Array.from({ length: 600 }, (_, i) => `owned-${i}.txt`)
    const receipt = receiptFor(paths)
    for (const p of paths) fs.unlinkSync(path.join(root, p))
    const report = inspectDoctor({
      packageRoot: process.cwd(),
      targetDir: root,
      baselineReceipt: receipt,
    })
    expect(report.summary.totalFindings).toBeGreaterThan(600)
    expect(report.summary.counts.missing).toBeGreaterThanOrEqual(600)
    expect(report.summary).toMatchObject({ capped: true, incomplete: true, exitCode: 1 })
    expect(report.findings).toHaveLength(512)
    for (const findings of Object.values(report.dimensions))
      expect(findings.length).toBeLessThanOrEqual(512)
    expect(report.remediation.proposedChanges.length).toBeLessThanOrEqual(512)
    expect(report.remediation.preservedPaths.length).toBeLessThanOrEqual(512)
    expect(report.remediation.totalProposedChanges).toBeGreaterThan(512)
    expect(formatDoctorPlain(report)).toContain('Coverage incomplete')
  })

  it.each(['advisory', 'assisted', 'delegated', 'autonomous'])(
    'accepts canonical posture %s and uses the pillar helper count API',
    (posture) => {
      write('agent-workflow.config.json', JSON.stringify({ posture }))
      const findings = readProjectConfigs({ targetDir: root })
      expect(findings.find((f) => f.id === 'config.workflow').structural).toBe('valid')
      expect(findings.find((f) => f.id === 'config.pillars')).toMatchObject({
        structural: 'missing',
        evidence: { configuredCount: 0, totalPillars: 4 },
      })
    },
  )
  it.each(['human', null, 123])(
    'rejects noncanonical posture %s and non-object JSON without echoing input',
    (posture) => {
      write('agent-workflow.config.json', JSON.stringify({ posture }))
      expect(
        readProjectConfigs({ targetDir: root }).find((f) => f.id === 'config.workflow').structural,
      ).toBe('invalid')
      write('agent-workflow.config.json', '[]')
      expect(
        readProjectConfigs({ targetDir: root }).find((f) => f.id === 'config.workflow').structural,
      ).toBe('invalid')
    },
  )

  it('guards direct and parent symlinks, nonregular files, large files and sanitized malformed config', () => {
    const external = path.join(scratch, 'external')
    fs.mkdirSync(external)
    fs.writeFileSync(path.join(external, 'nested.json'), '{"secret":"CONTROL_CANARY"}')
    fs.symlinkSync(external, path.join(root, 'linked-parent'), 'junction')
    expect(safeReadFileUtf8(root, 'linked-parent/nested.json')).toMatchObject({
      ok: false,
      error: 'symlink-escapes-root',
    })
    fs.symlinkSync(
      path.join(external, 'nested.json'),
      path.join(root, 'agent-workflow.config.json'),
    )
    fs.symlinkSync(external, path.join(root, '.agentflow'), 'junction')
    const report = inspectDoctor({ packageRoot: process.cwd(), targetDir: root })
    expect(report.findings.find((f) => f.id === 'config.workflow').structural).toBe('invalid')
    expect(JSON.stringify(report)).not.toContain('CONTROL_CANARY')
    expect(safeReadFileUtf8(root, '..' + path.sep + 'external/nested.json').ok).toBe(false)
    expect(safeReadFileUtf8(root, '.')).toMatchObject({ ok: false, error: 'not-a-file' })
    fs.unlinkSync(path.join(root, 'agent-workflow.config.json'))
    write('agent-workflow.config.json', '{"secret":"PARSE_CANARY"')
    expect(JSON.stringify(inspectDoctor({ targetDir: root }))).not.toContain('PARSE_CANARY')
    write('oversized', Buffer.alloc(MAX_FILE_SIZE + 1))
    expect(safeReadFileUtf8(root, 'oversized')).toMatchObject({
      ok: false,
      error: 'exceeds-max-size',
    })
    const scope = createReadScope()
    scope.bytes = MAX_AGGREGATE_SIZE
    write('small', 'x')
    expect(safeReadFileUtf8(root, 'small', MAX_FILE_SIZE, scope)).toMatchObject({
      ok: false,
      error: 'inspection-budget-exhausted',
    })
    expect(scope.incomplete).toBe(true)
  })

  it('changed bytes between read and post-read identity checks remain unknown', () => {
    write('changing.txt', 'original')
    const originalRead = fs.readFileSync
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
      const bytes = originalRead(file, ...args)
      if (file === path.join(root, 'changing.txt')) fs.writeFileSync(file, 'different-content')
      return bytes
    })
    syncBuiltinESMExports()
    try {
      const scope = createReadScope()
      expect(safeReadFileUtf8(root, 'changing.txt', MAX_FILE_SIZE, scope)).toMatchObject({
        ok: false,
        error: 'changed-during-read',
      })
      expect(scope.incomplete).toBe(true)
    } finally {
      spy.mockRestore()
      syncBuiltinESMExports()
    }
  })

  it('does not mistake fabricated tool records or mismatched runtime evidence for ready', () => {
    const request = buildRuntimeRequest({ runtimeId: 'pi', requestId: 'req' })
    for (const evidence of [
      {
        requestId: 'wrong',
        tools: [
          {
            name: 'SECRET_NAME',
            status: 'ready',
            provenance: 'fabricated',
            observedAt: 'invalid-time',
          },
        ],
      },
      {
        schemaVersion: 1,
        requestId: request.requestId,
        runtimeId: request.runtimeId,
        components: [],
      },
      { tools: [{ name: 'tool', status: 'ready', provenance: 'declared-only' }] },
    ]) {
      const findings = readRuntimeReachability({
        runtimeRequest: request,
        runtimeEvidence: evidence,
      })
      expect(findings.find((f) => f.id === 'runtime.request.validation').structural).toBe('unknown')
      expect(JSON.stringify(findings)).not.toContain('SECRET_NAME')
      expect(findings.every((f) => f.alignment === 'unknown')).toBe(true)
    }
  })

  it('selected harnesses are all inspected; unsafe delegated adapter input becomes unknown', () => {
    const report = inspectDoctor({
      packageRoot: process.cwd(),
      targetDir: root,
      harnesses: ['pi', 'codex'],
    })
    expect(report.dimensions['adapter-bindings'].map((f) => f.id)).toEqual([
      'adapters.pi',
      'adapters.codex',
    ])
    expect(report.dimensions['adapter-bindings'].every((f) => f.alignment === 'differing')).toBe(
      true,
    )
    const external = path.join(scratch, 'outside-skills')
    fs.mkdirSync(external)
    fs.mkdirSync(path.join(root, '.pi'))
    fs.symlinkSync(external, path.join(root, '.pi/skills'), 'junction')
    expect(
      inspectDoctor({ packageRoot: process.cwd(), targetDir: root, harnesses: ['pi'] }).dimensions[
        'adapter-bindings'
      ].at(-1).structural,
    ).toBe('unknown')
  })

  it('accepts a raw consumer sdlc config that omits product constants without rewriting it', () => {
    const source = path.join(process.cwd(), 'defaults/sdlc.config.json')
    const raw = fs.readFileSync(source)
    write('sdlc.config.json', raw)
    write('agent-workflow.config.json', JSON.stringify({ posture: 'assisted' }))
    const inspected = inspectDoctor({
      packageRoot: process.cwd(),
      targetDir: root,
      harnesses: ['agy'],
    })
    expect(inspected.findings.find((f) => f.id === 'config.sdlc').structural).toBe('valid')
    const diagnosed = runConfigDoctor({ packageRoot: process.cwd(), targetDir: root })
    expect(diagnosed.checks.sdlc.ok).toBe(true)
    expect(
      diagnosed.checks.sdlc.findings.filter((f) => ['blocker', 'high'].includes(f.severity)),
    ).toEqual([])
    expect(fs.readFileSync(path.join(root, 'sdlc.config.json'))).toEqual(raw)
  })

  it('recognizes canonical skill directory links and rejects noncanonical or harness-root links', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'manifests/skill-catalog.json'), 'utf8'),
    )
    const harnessDir = path.join(root, '.agents/skills')
    const middle = path.join(scratch, 'skills-middle')
    fs.mkdirSync(harnessDir, { recursive: true })
    fs.mkdirSync(middle)
    for (const skill of catalog.skills) {
      const mid = path.join(middle, skill.qualifiedName)
      fs.symlinkSync(path.join(process.cwd(), skill.source), mid, 'dir')
      fs.symlinkSync(mid, path.join(harnessDir, skill.qualifiedName), 'dir')
    }
    const linked = inspectDoctor({
      packageRoot: process.cwd(),
      targetDir: root,
      harnesses: ['agy'],
    })
    expect(linked.dimensions['adapter-bindings'].every((f) => f.structural !== 'unknown')).toBe(
      true,
    )

    const external = path.join(scratch, 'outside-skills')
    fs.mkdirSync(external)
    fs.rmSync(path.join(harnessDir, catalog.skills[0].qualifiedName))
    fs.symlinkSync(external, path.join(harnessDir, catalog.skills[0].qualifiedName), 'dir')
    expect(
      inspectDoctor({ packageRoot: process.cwd(), targetDir: root, harnesses: ['agy'] }).dimensions[
        'adapter-bindings'
      ].at(-1).structural,
    ).toBe('unknown')
  })

  it('simple scoped success/error verification: zero measured writes, subprocesses or network; exact recursive fixture snapshots preserved', () => {
    const receipt = receiptFor()
    write('AGENTS.md', 'authored instructions')
    write('probe/git', '#!/bin/sh\necho bad > "' + path.join(root, 'PROBE_RAN') + '"\n')
    fs.chmodSync(path.join(root, 'probe/git'), 0o755)
    const before = snapshot(scratch)
    const originalPath = process.env.PATH
    process.env.PATH = path.join(root, 'probe')
    const calls = []
    const deny = (owner, name) =>
      vi.spyOn(owner, name).mockImplementation(() => {
        calls.push(name)
        throw new Error('unexpected effect')
      })
    for (const name of [
      'writeFileSync',
      'appendFileSync',
      'mkdirSync',
      'unlinkSync',
      'renameSync',
      'rmSync',
      'mkdtempSync',
      'chmodSync',
    ])
      deny(fs, name)
    for (const name of ['writeFile', 'mkdir', 'unlink', 'rename']) deny(fsp, name)
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'])
      deny(cp, name)
    deny(http, 'request')
    deny(https, 'request')
    deny(globalThis, 'fetch')
    syncBuiltinESMExports()
    try {
      const success = inspectDoctor({
        packageRoot: process.cwd(),
        targetDir: root,
        baselineReceipt: receipt,
      })
      expect(
        success.dimensions['lock-integrity'].find((f) => f.id === 'baseline.receipt').alignment,
      ).toBe('matched')
      const error = inspectDoctor({
        packageRoot: process.cwd(),
        targetDir: root,
        baselineReceipt: {},
      })
      expect(
        error.dimensions['lock-integrity'].find((f) => f.id === 'baseline.receipt').structural,
      ).toBe('invalid')
      expect(success.findings.find((f) => f.id === 'runtime.tool.git').alignment).toBe('unknown')
      expect(calls).toEqual([])
      expect(snapshot(scratch)).toEqual(before)
    } finally {
      process.env.PATH = originalPath
      vi.restoreAllMocks()
      syncBuiltinESMExports()
    }
  })
})
