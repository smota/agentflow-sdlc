import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { collectProcessObservation } from '../../lib/verification/process-collector.mjs'
import { fingerprintCandidate } from '../../lib/verification/workspace.mjs'
import { sealDeliveryRecord } from '../../lib/core/delivery-record.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const tempDirs = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-role-pass-gate-'))
  tempDirs.push(root)
  return root
}

function candidateDefinition(root, content = 'candidate') {
  writeFileSync(join(root, 'input.txt'), content)
  return {
    id: 'suite',
    criterionId: 'AC-1',
    executable: process.execPath,
    args: [],
    inputs: ['input.txt'],
    assertions: ['search'],
    timeoutMs: 5000,
  }
}

function runnerFor(outcome) {
  return (_bin, _args, options) => {
    writeFileSync(
      options.env.AGENTFLOW_REPORT_PATH,
      JSON.stringify({
        invocationId: options.env.AGENTFLOW_INVOCATION_ID,
        assertions: [{ id: 'search', outcome }],
      }),
    )
    return { status: 0 }
  }
}

// A real, sealed, collector-observed record produced by the actual collector pipeline — the same
// construction lib/__tests__/verification-observation.test.mjs uses — never a hand-typed digest.
function collectorObservedRecord({ outcome = 'pass' } = {}) {
  const root = fixtureRoot()
  const definition = candidateDefinition(root)
  const { observation } = collectProcessObservation({
    root,
    definition,
    boundary: 'mutate-worktree',
    runner: runnerFor(outcome),
  })
  return observation
}

// A real, sealed record with a non-deterministic origin, built the way
// lib/verification/github-checks.mjs builds an external-resolved record: real digests from the
// shared fingerprint/record-digest helpers, never hand-typed hex.
function agentReportedRecord() {
  const root = fixtureRoot()
  const definition = candidateDefinition(root)
  const candidate = fingerprintCandidate(root, definition)
  const now = new Date().toISOString()
  return sealDeliveryRecord('verification-observation', {
    id: 'agent-reported-1',
    invocationId: 'agent-reported-1',
    criterionId: definition.criterionId,
    producer: 'agentflow:agent-reported',
    origin: 'agent-reported',
    isolation: 'unknown',
    candidateDigest: candidate.digest,
    definitionDigest: recordDigest(definition),
    outcome: 'pass',
    assertions: [{ id: 'search', outcome: 'pass' }],
    startedAt: now,
    completedAt: now,
  })
}

function observationEnvelope(record, { candidateDigest, definitionDigest } = {}) {
  return {
    candidateDigest: candidateDigest ?? record.candidateDigest,
    definitionDigest: definitionDigest ?? record.definitionDigest,
    observationRef: '.agent-runs/verification/example/observation.json',
    record,
  }
}

function rolePass({
  role = 'developer',
  independence,
  reviewedAuthors,
  observation,
  body = '- no decisions recorded',
} = {}) {
  const observationSection = observation
    ? `\n\n### Verification observation\n\n\`\`\`json\n${JSON.stringify(observation, null, 2)}\n\`\`\`\n`
    : ''
  const independenceLine = independence ? `\n**Independence boundary:** ${independence}` : ''
  const reviewedAuthorsLine = reviewedAuthors ? `\n**Reviewed authors:** ${reviewedAuthors}` : ''
  return `## Role Pass

**Issue:** #501 — gate integrity
**Branch:** work/agentflow-next-release
**Phase:** 5
**Role:** ${role}
**Status:** pass
**Workflow profile:** standard
**Planned owner:** claude
**Executed by:** claude
**Launcher:** claude
**Executor:** claude-cli
**Transport:** local-cli
**Delegation boundary:** current-session
**Context boundary:** current-session${independenceLine}${reviewedAuthorsLine}
**Model / runtime:** claude-sonnet-5
${observationSection}
### Decisions / findings

${body}
`
}

function runValidator(text) {
  const dir = fixtureRoot()
  const path = join(dir, 'role-pass.md')
  writeFileSync(path, text)
  return spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'validate-sdlc-role-pass.mjs'), '--path', path],
    { cwd: repoRoot, encoding: 'utf8' },
  )
}

describe('role-pass gate: verification observation and independence', () => {
  it('REGRESSION (permanent): theater — filler text with no observation must not pass the mandatory gate', () => {
    const result = runValidator(
      rolePass({
        role: 'developer',
        body: '- I made no decisions. This is filler text to satisfy the validator.',
      }),
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.missing')
    expect(result.stdout).toContain('Result: FAILED')
  })

  it('honest — a valid, passing, deterministic-origin observation whose candidateDigest matches exits 0', () => {
    const record = collectorObservedRecord()
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record) }),
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Result: READY')
  })

  it('stale candidate — candidateDigest not matching the candidate under review fails', () => {
    const record = collectorObservedRecord()
    const staleRoot = fixtureRoot()
    const staleDefinition = candidateDefinition(staleRoot, 'a different candidate entirely')
    const staleCandidate = fingerprintCandidate(staleRoot, staleDefinition)
    const result = runValidator(
      rolePass({
        role: 'developer',
        observation: observationEnvelope(record, { candidateDigest: staleCandidate.digest }),
      }),
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.stale-candidate')
  })

  it('wrong origin — an observation whose origin is not a deterministic origin fails', () => {
    const record = agentReportedRecord()
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record) }),
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.origin')
  })

  it('failed outcome — an observation with outcome: fail fails', () => {
    const record = collectorObservedRecord({ outcome: 'fail' })
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record) }),
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.outcome')
  })

  it('false independence — claiming independent while the reviewer identity is among the reviewed authors fails', () => {
    const result = runValidator(
      rolePass({ role: 'reviewer', independence: 'independent', reviewedAuthors: 'claude' }),
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.independence.self-review')
  })

  it('non-developer role — a reviewer pass with no observation still exits 0', () => {
    const result = runValidator(rolePass({ role: 'reviewer', independence: 'not-applicable' }))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Result: READY')
  })
})
