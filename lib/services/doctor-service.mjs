import { resolve } from 'node:path'
import {
  readProjectConfigs,
  readLockfile,
  readBaselineAlignment,
  readAdapterBindings,
  readRuntimeReachability,
} from './doctor-readers.mjs'

export function inspectDoctor({
  packageRoot,
  targetDir = process.cwd(),
  harnesses = ['all'],
  baselineReceipt = null,
  runtimeRequest = null,
  runtimeEvidence = null,
} = {}) {
  const root = resolve(targetDir)
  const pkgRoot = packageRoot ? resolve(packageRoot) : root

  const configFindings = readProjectConfigs({ targetDir: root })
  const lockFindings = readLockfile({ targetDir: root })
  const baselineFindings = readBaselineAlignment({ targetDir: root, baselineReceipt })
  const adapterFindings = readAdapterBindings({ packageRoot: pkgRoot, targetDir: root, harnesses })
  const runtimeFindings = readRuntimeReachability({ runtimeRequest, runtimeEvidence })

  const findings = [
    ...configFindings,
    ...lockFindings,
    ...baselineFindings,
    ...adapterFindings,
    ...runtimeFindings,
  ]

  const counts = {
    valid: 0,
    missing: 0,
    invalid: 0,
    differing: 0,
    matched: 0,
    unknown: 0,
  }

  const proposedChanges = []
  const preservedPaths = []

  for (const f of findings) {
    if (counts[f.structural] !== undefined) counts[f.structural]++
    if (counts[f.alignment] !== undefined) counts[f.alignment]++
    if (f.proposedChange) proposedChanges.push(f.proposedChange)
    if (f.preservedPaths && Array.isArray(f.preservedPaths)) {
      preservedPaths.push(...f.preservedPaths)
    }
  }

  const hasDefects = counts.missing > 0 || counts.invalid > 0 || counts.differing > 0
  const hasUnknown = counts.unknown > 0

  let status = 'ok'
  let exitCode = 0
  if (hasDefects) {
    status = 'defect'
    exitCode = 1
  } else if (hasUnknown) {
    status = 'unknown'
    exitCode = 2
  }

  return {
    schemaVersion: 1,
    targetDir: root,
    timestamp: new Date().toISOString(),
    ok: exitCode === 0,
    summary: {
      status,
      exitCode,
      counts,
    },
    dimensions: {
      'project-configs': configFindings,
      'adapter-bindings': adapterFindings,
      'lock-integrity': [...lockFindings, ...baselineFindings],
      'runtime-reachability': runtimeFindings,
    },
    findings,
    remediation: {
      proposedChanges,
      preservedPaths: [...new Set(preservedPaths)],
    },
  }
}

export { formatDoctorJson, formatDoctorPlain } from './doctor-report.mjs'
