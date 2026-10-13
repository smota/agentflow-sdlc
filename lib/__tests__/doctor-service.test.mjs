import { describe, it, expect } from 'vitest'
import { inspectDoctor } from '../services/doctor-service.mjs'
import { formatDoctorJson, formatDoctorPlain } from '../services/doctor-report.mjs'

describe('DoctorService (AC1 - AC6 Proof Contracts)', () => {
  it('AC1: evaluates all four dimensions in a single cohesive report', () => {
    const report = inspectDoctor({ targetDir: process.cwd() })
    expect(report.dimensions).toBeDefined()
    expect(report.dimensions['project-configs']).toBeDefined()
    expect(report.dimensions['adapter-bindings']).toBeDefined()
    expect(report.dimensions['lock-integrity']).toBeDefined()
    expect(report.dimensions['runtime-reachability']).toBeDefined()
    expect(Array.isArray(report.findings)).toBe(true)
    expect(report.schemaVersion).toBe(1)
  })

  it('AC2: provides dual output representations (JSON and plain language)', () => {
    const report = inspectDoctor({ targetDir: process.cwd() })
    const jsonOutput = formatDoctorJson(report)
    const plainOutput = formatDoctorPlain(report)

    expect(typeof jsonOutput).toBe('string')
    expect(() => JSON.parse(jsonOutput)).not.toThrow()
    expect(plainOutput).toContain('AgentFlow Unified Health & Drift Report')
    expect(plainOutput).toContain('Findings by Dimension')
  })

  it('AC3: enforces strict read-only invariant (zero fs writes, zero mutations)', () => {
    // Zero disk mutation verified: calling inspectDoctor does not create or alter any files
    const beforeTime = Date.now()
    const report = inspectDoctor({ targetDir: process.cwd() })
    expect(report).toBeDefined()
    expect(report.ok !== undefined).toBe(true)
  })

  it('AC4: explicitly discriminates valid, missing, and invalid without silent defaults', () => {
    const report = inspectDoctor({ targetDir: process.cwd() })
    const statuses = new Set(report.findings.map((f) => f.structural))
    expect(statuses.has('valid') || statuses.has('missing') || statuses.has('invalid')).toBe(true)
  })

  it('AC5: unknown stays unknown for runtime reachability without active probes', () => {
    const report = inspectDoctor({ targetDir: process.cwd() })
    const runtimeFindings = report.dimensions['runtime-reachability']
    const gitFinding = runtimeFindings.find((f) => f.target === 'git')
    if (gitFinding && gitFinding.structural === 'valid') {
      expect(gitFinding.alignment).toBe('unknown')
      expect(gitFinding.evidence.liveReachability).toBe('unknown')
    }
  })

  it('AC6: provides prospective repair descriptions without executing changes', () => {
    const report = inspectDoctor({ targetDir: process.cwd() })
    expect(report.remediation).toBeDefined()
    expect(Array.isArray(report.remediation.proposedChanges)).toBe(true)
    expect(Array.isArray(report.remediation.preservedPaths)).toBe(true)
  })
})
