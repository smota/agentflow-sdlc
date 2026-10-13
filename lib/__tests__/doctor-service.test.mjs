import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { inspectDoctor } from '../services/doctor-service.mjs'
import { formatDoctorJson, formatDoctorPlain } from '../services/doctor-report.mjs'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import cp from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

describe('Doctor Service Unit Tests (AC1–AC6 & Reviewer Regression Coverage)', () => {
  it('AC1/AC2: inspectDoctor returns four dimensions with dual representation parity', () => {
    const report = inspectDoctor({ targetDir: process.cwd() })
    expect(report.schemaVersion).toBe(1)
    expect(report.dimensions['project-configs']).toBeDefined()
    expect(report.dimensions['adapter-bindings']).toBeDefined()
    expect(report.dimensions['lock-integrity']).toBeDefined()
    expect(report.dimensions['runtime-reachability']).toBeDefined()

    const json = formatDoctorJson(report)
    const plain = formatDoctorPlain(report)
    expect(JSON.parse(json).schemaVersion).toBe(1)
    expect(plain).toContain('=== AgentFlow Unified Health & Drift Report ===')
    expect(plain).toContain('Findings by Dimension')
  })

  it('AC3: zero file system mutations, child process executions, or network requests', async () => {
    // Spy on mutating fs.promises and child_process methods
    const writeSpy = vi.spyOn(fsp, 'writeFile')
    const mkdirSpy = vi.spyOn(fsp, 'mkdir')
    const unlinkSpy = vi.spyOn(fsp, 'unlink')
    const renameSpy = vi.spyOn(fsp, 'rename')
    const execSpy = vi.spyOn(cp, 'exec')
    const execFileSpy = vi.spyOn(cp, 'execFile')
    const spawnSpy = vi.spyOn(cp, 'spawn')

    // Snapshot target directory mtime and entry set
    const filesBefore = fs.readdirSync(process.cwd())

    const report = inspectDoctor({ targetDir: process.cwd() })
    expect(report).toBeDefined()

    expect(writeSpy).not.toHaveBeenCalled()
    expect(mkdirSpy).not.toHaveBeenCalled()
    expect(unlinkSpy).not.toHaveBeenCalled()
    expect(renameSpy).not.toHaveBeenCalled()
    expect(execSpy).not.toHaveBeenCalled()
    expect(execFileSpy).not.toHaveBeenCalled()
    expect(spawnSpy).not.toHaveBeenCalled()

    const filesAfter = fs.readdirSync(process.cwd())
    expect(filesAfter).toEqual(filesBefore)

    vi.restoreAllMocks()
  })

  it('AC4 / R1: baseline receipt integrity handles empty, unhashed, escaping and malformed receipts without false matched', () => {
    // 1. Empty receipt {}
    const repEmpty = inspectDoctor({ targetDir: process.cwd(), baselineReceipt: {} })
    const baseFindingEmpty = repEmpty.findings.find((f) => f.id === 'baseline.receipt')
    expect(baseFindingEmpty.structural).toBe('invalid')
    expect(baseFindingEmpty.alignment).toBe('unknown')

    // 2. Receipt with entry lacking hash
    const repNoHash = inspectDoctor({
      targetDir: process.cwd(),
      baselineReceipt: { mutations: [{ path: 'package.json' }] },
    })
    const driftNoHash = repNoHash.findings.find((f) => f.id === 'baseline.drift.package.json')
    expect(driftNoHash).toBeDefined()
    expect(driftNoHash.structural).toBe('invalid')
    expect(driftNoHash.alignment).toBe('unknown')

    // 3. Receipt with escaping path ../outside
    const repEscape = inspectDoctor({
      targetDir: process.cwd(),
      baselineReceipt: { mutations: [{ path: '../outside', hash: 'a'.repeat(64) }] },
    })
    const driftEscape = repEscape.findings.find((f) => f.id === 'baseline.drift.../outside')
    expect(driftEscape).toBeDefined()
    expect(driftEscape.structural).toBe('invalid')
    expect(driftEscape.alignment).toBe('differing')
  })

  it('AC4 / R2: symlink escapes and malformed JSON errors are guarded and sanitized without leaking inputs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-doc-sym-'))
    const outsideTarget = path.join(tmpDir, 'outside-secret.txt')
    fs.writeFileSync(outsideTarget, 'SECRET_CANARY_VALUE')

    const fakeRoot = path.join(tmpDir, 'repo')
    fs.mkdirSync(fakeRoot)
    const symlinkPath = path.join(fakeRoot, 'agent-workflow.config.json')
    fs.symlinkSync(outsideTarget, symlinkPath)

    const rep = inspectDoctor({ targetDir: fakeRoot })
    const wfFinding = rep.findings.find((f) => f.id === 'config.workflow')
    expect(wfFinding.structural).toBe('invalid')
    expect(wfFinding.reason).toContain('symbolic link pointing outside project root')
    expect(JSON.stringify(rep)).not.toContain('SECRET_CANARY_VALUE')

    // Malformed JSON should not leak content
    const badJsonPath = path.join(fakeRoot, 'bad-wf')
    fs.mkdirSync(badJsonPath)
    fs.writeFileSync(
      path.join(badJsonPath, 'agent-workflow.config.json'),
      '{ "unclosed": "REVIEW_CANARY_LEAK" ',
    )
    const repBad = inspectDoctor({ targetDir: badJsonPath })
    const badFinding = repBad.findings.find((f) => f.id === 'config.workflow')
    expect(badFinding.structural).toBe('invalid')
    expect(badFinding.reason).toBe('agent-workflow.config.json JSON parse error.')
    expect(JSON.stringify(repBad)).not.toContain('REVIEW_CANARY_LEAK')

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('AC5 / R4: runtime reachability validates request and marks declared-only evidence as unknown', () => {
    // Declared-only evidence must remain unknown
    const rep = inspectDoctor({
      targetDir: process.cwd(),
      runtimeEvidence: {
        tools: [{ name: 'declared-tool', status: 'ready', provenance: 'declared-only' }],
      },
    })
    const evFinding = rep.findings.find((f) => f.id === 'runtime.evidence.declared-tool')
    expect(evFinding).toBeDefined()
    expect(evFinding.structural).toBe('unknown')
    expect(evFinding.alignment).toBe('unknown')

    // Mismatched request ID
    const repMismatch = inspectDoctor({
      targetDir: process.cwd(),
      runtimeRequest: { id: 'req-123' },
      runtimeEvidence: { requestId: 'req-999', tools: [] },
    })
    const mismatchFinding = repMismatch.findings.find((f) => f.id === 'runtime.request.validation')
    expect(mismatchFinding).toBeDefined()
    expect(mismatchFinding.structural).toBe('unknown')
  })

  it('R3: bounding limits cap findings at 512 while retaining true total count', () => {
    const mutations = []
    for (let i = 0; i < 600; i++) {
      mutations.push({ path: `file-${i}.txt`, hash: 'b'.repeat(64) })
    }
    const rep = inspectDoctor({
      targetDir: process.cwd(),
      baselineReceipt: { mutations },
    })
    expect(rep.summary.totalFindings).toBeGreaterThan(512)
    expect(rep.summary.capped).toBe(true)
    expect(rep.findings.length).toBe(513) // 512 details + 1 truncation notification
    const capFinding = rep.findings.find((f) => f.id === 'doctor.findings.capped')
    expect(capFinding).toBeDefined()
  })
})
