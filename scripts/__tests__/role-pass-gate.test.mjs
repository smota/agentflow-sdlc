import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { collectProcessObservation } from '../../lib/verification/process-collector.mjs'
import { fingerprintCandidate } from '../../lib/verification/workspace.mjs'
import { sealDeliveryRecord } from '../../lib/core/delivery-record.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const sdlcConfigSource = readFileSync(join(repoRoot, 'defaults/sdlc.config.json'), 'utf8')
const tempDirs = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-role-pass-gate-'))
  tempDirs.push(root)
  return root
}

// A self-contained target root the gate can resolve everything against on its own: its own SDLC
// config (so loadSdlcConfig succeeds without falling back to the real repo), its own
// delivery.candidate.inputs pointing at a real file so fingerprintCandidate can compute a real
// digest from the actual working tree (H3) rather than trusting a self-declared one, and (W8f D2) a
// configured check matching candidateDefinition() so the definition/required-assertions binding the
// shared resolver performs (lib/verification/observation-resolver.mjs) has something real to bind
// to — the gate no longer accepts an observation whose definition matches no configured check.
function realTargetRoot(content = 'candidate') {
  const root = fixtureRoot()
  writeFileSync(join(root, 'sdlc.config.json'), sdlcConfigSource)
  writeFileSync(join(root, 'input.txt'), content)
  writeFileSync(
    join(root, 'agent-workflow.config.json'),
    JSON.stringify({
      delivery: {
        source: { kind: 'local-preview' },
        candidate: { inputs: ['input.txt'] },
        checks: { suite: candidateDefinition() },
      },
    }),
  )
  return root
}

function candidateDefinition() {
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

function relRef(root, absPath) {
  return relative(root, absPath).replaceAll('\\', '/')
}

// A real, sealed, collector-observed record produced by the actual collector pipeline against
// `root`, written to a real observation file under `root/.agent-runs/...` so observationRef
// genuinely resolves (H7) instead of pointing at a path nobody ever reads.
function collectorObservedRecord(root, { outcome = 'pass' } = {}) {
  const definition = candidateDefinition()
  const { observation, observationPath } = collectProcessObservation({
    root,
    definition,
    boundary: 'mutate-worktree',
    runner: runnerFor(outcome),
  })
  return { observation, observationRef: relRef(root, observationPath) }
}

// A real, sealed record with a non-deterministic origin, built the way
// lib/verification/github-checks.mjs builds one: real digests from the shared
// fingerprint/record-digest helpers, but asserted rather than collected — never hand-typed hex.
// Also written to a real file under `root` so it resolves, isolating the origin problem from H7.
function agentReportedRecord(
  root,
  { outcome = 'pass', assertions = [{ id: 'search', outcome: 'pass' }] } = {},
) {
  const definition = candidateDefinition()
  const candidate = fingerprintCandidate(root, { inputs: definition.inputs })
  const now = new Date().toISOString()
  const record = sealDeliveryRecord('verification-observation', {
    id: 'agent-reported-1',
    invocationId: 'agent-reported-1',
    criterionId: definition.criterionId,
    producer: 'agentflow:agent-reported',
    origin: 'agent-reported',
    isolation: 'unknown',
    candidateDigest: candidate.digest,
    definitionDigest: recordDigest(definition),
    outcome,
    assertions,
    startedAt: now,
    completedAt: now,
  })
  return { observation: record, observationRef: writeRecordFile(root, 'agent-reported-1', record) }
}

function writeRecordFile(root, invocationId, record) {
  const dir = join(root, '.agent-runs/verification', invocationId)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, 'observation.json')
  writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n')
  return relRef(root, filePath)
}

function observationEnvelope(record, observationRef, { candidateDigest, definitionDigest } = {}) {
  return {
    candidateDigest: candidateDigest ?? record.candidateDigest,
    definitionDigest: definitionDigest ?? record.definitionDigest,
    observationRef,
    record,
  }
}

function rolePass({
  role = 'developer',
  profile = 'standard',
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
**Workflow profile:** ${profile}
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

function runValidator(text, { target = repoRoot } = {}) {
  const dir = fixtureRoot()
  const path = join(dir, 'role-pass.md')
  writeFileSync(path, text)
  return spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'validate-sdlc-role-pass.mjs'), '--path', path, '--target', target],
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

  it('honest — a valid, passing, deterministic-origin observation whose candidateDigest matches the real working tree, with a resolvable observationRef, exits 0', () => {
    const root = realTargetRoot()
    const { observation, observationRef } = collectorObservedRecord(root)
    const result = runValidator(
      rolePass({
        role: 'developer',
        observation: observationEnvelope(observation, observationRef),
      }),
      { target: root },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Result: READY')
  })

  it('stale candidate — the candidate changing since the observation was taken fails (candidate digest is recomputed from the real working tree, not trusted from the envelope)', () => {
    const root = realTargetRoot()
    const { observation, observationRef } = collectorObservedRecord(root)
    writeFileSync(join(root, 'input.txt'), 'a different candidate entirely')
    const result = runValidator(
      rolePass({
        role: 'developer',
        observation: observationEnvelope(observation, observationRef),
      }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.stale-candidate')
  })

  it('wrong origin — an observation whose origin is not a deterministic origin fails', () => {
    const root = realTargetRoot()
    const { observation, observationRef } = agentReportedRecord(root)
    const result = runValidator(
      rolePass({
        role: 'developer',
        observation: observationEnvelope(observation, observationRef),
      }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.origin')
  })

  it('failed outcome — an observation with outcome: fail fails', () => {
    const root = realTargetRoot()
    const { observation, observationRef } = collectorObservedRecord(root, { outcome: 'fail' })
    const result = runValidator(
      rolePass({
        role: 'developer',
        observation: observationEnvelope(observation, observationRef),
      }),
      { target: root },
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

describe('role-pass gate: G1 adversarial holes (H1-H7)', () => {
  it('H1 — role casing bypass: "Developer" (capital D) still requires a verification observation', () => {
    // Before the fix: line 97 normalized the role for display/lookup purposes, but line 101 tested
    // the RAW declared string against OBSERVATION_REQUIRED_ROLES, so "Developer" (matching the
    // config's own label) slipped past the requirement entirely with no observation at all.
    const result = runValidator(
      rolePass({
        role: 'Developer',
        body: '- I made no decisions. This is filler text to satisfy the validator.',
      }),
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.missing')
  })

  it('H2 — the gate must call the real verification engine: a per-assertion failure inside a record that otherwise self-reports outcome: pass is blocked', () => {
    // The old inline re-implementation only checked record-level origin/outcome for required
    // roles; it never looked at individual assertions. verifyObservation checks every required
    // assertion's own outcome, closing that gap.
    const root = realTargetRoot()
    const definition = candidateDefinition()
    const candidate = fingerprintCandidate(root, { inputs: definition.inputs })
    const now = new Date().toISOString()
    const id = randomUUID()
    const record = sealDeliveryRecord('verification-observation', {
      id,
      invocationId: id,
      criterionId: definition.criterionId,
      producer: 'agentflow:process-collector',
      origin: 'collector-observed',
      isolation: 'cooperative',
      candidateDigest: candidate.digest,
      definitionDigest: recordDigest(definition),
      outcome: 'pass',
      assertions: [{ id: 'search', outcome: 'fail' }],
      startedAt: now,
      completedAt: now,
    })
    const observationRef = writeRecordFile(root, id, record)
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record, observationRef) }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.assertion-failed')
  })

  it('H3 — a self-declared candidateDigest that was never fingerprinted from the real working tree is blocked', () => {
    // Forged records agree with themselves by construction (envelope and record are authored
    // together). The gate must recompute the candidate digest independently.
    const root = realTargetRoot()
    const definition = candidateDefinition()
    const now = new Date().toISOString()
    const id = randomUUID()
    const record = sealDeliveryRecord('verification-observation', {
      id,
      invocationId: id,
      criterionId: definition.criterionId,
      producer: 'my-imagination',
      origin: 'collector-observed',
      isolation: 'immutable',
      candidateDigest: 'a'.repeat(64),
      definitionDigest: recordDigest(definition),
      outcome: 'pass',
      assertions: [{ id: 'search', outcome: 'pass' }],
      startedAt: now,
      completedAt: now,
    })
    const observationRef = writeRecordFile(root, id, record)
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record, observationRef) }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.stale-candidate')
  })

  it('H3b — when the target has no delivery.candidate.inputs to fingerprint, that is a finding, never a silent pass', () => {
    const root = fixtureRoot()
    writeFileSync(join(root, 'sdlc.config.json'), sdlcConfigSource)
    writeFileSync(join(root, 'agent-workflow.config.json'), JSON.stringify({}))
    const definition = candidateDefinition()
    const now = new Date().toISOString()
    const record = sealDeliveryRecord('verification-observation', {
      id: 'unfingerprintable',
      invocationId: 'unfingerprintable',
      criterionId: definition.criterionId,
      producer: 'agentflow:process-collector',
      origin: 'collector-observed',
      isolation: 'immutable',
      candidateDigest: 'a'.repeat(64),
      definitionDigest: recordDigest(definition),
      outcome: 'pass',
      assertions: [{ id: 'search', outcome: 'pass' }],
      startedAt: now,
      completedAt: now,
    })
    const observationRef = writeRecordFile(root, 'unfingerprintable', record)
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record, observationRef) }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.candidate-unverifiable')
  })

  it('H4 — an observation with assertions: [] is blocked even though outcome self-reports pass', () => {
    // W8f D2 — before the fix, requiredAssertions came from the RECORD's own `assertions` field, so
    // an empty list meant an empty requirement and this test caught "At least one required
    // assertion is necessary". After the fix, requiredAssertions comes from the CONFIGURED check
    // (`checks.suite.assertions`, which realTargetRoot() sets to candidateDefinition()'s
    // `['search']`) — a record's own empty assertions list no longer erases the requirement, it
    // just means the required assertion never happened, which is a per-assertion failure, not an
    // empty-requirement finding.
    const root = realTargetRoot()
    const definition = candidateDefinition()
    const candidate = fingerprintCandidate(root, { inputs: definition.inputs })
    const now = new Date().toISOString()
    const id = randomUUID()
    const record = sealDeliveryRecord('verification-observation', {
      id,
      invocationId: id,
      criterionId: definition.criterionId,
      producer: 'my-imagination',
      origin: 'collector-observed',
      isolation: 'immutable',
      candidateDigest: candidate.digest,
      definitionDigest: recordDigest(definition),
      outcome: 'pass',
      assertions: [],
      startedAt: now,
      completedAt: now,
    })
    const observationRef = writeRecordFile(root, id, record)
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record, observationRef) }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.assertion-failed')
  })

  it('H5 — declaring Independence boundary: independent without Reviewed authors is blocked, including under high-assurance', () => {
    const standard = runValidator(rolePass({ role: 'reviewer', independence: 'independent' }))
    expect(standard.status).not.toBe(0)
    expect(standard.stdout).toContain('role-pass.independence.unverifiable')

    const highAssurance = runValidator(
      rolePass({ role: 'reviewer', profile: 'high-assurance', independence: 'independent' }),
    )
    expect(highAssurance.status).not.toBe(0)
    expect(highAssurance.stdout).toContain('role-pass.independence.unverifiable')
  })

  it('H5b — high-assurance blocks self-review derived from Reviewed authors even when Independence boundary dishonestly declares "independent"', () => {
    // Executed by is "claude" in the rolePass() template; declaring the same identity as a
    // reviewed author makes the DERIVED boundary self-review regardless of what is claimed.
    const result = runValidator(
      rolePass({
        role: 'reviewer',
        profile: 'high-assurance',
        independence: 'independent',
        reviewedAuthors: 'claude',
      }),
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.high-assurance.self-review')
  })

  it('H6 — origin and outcome policy apply to ANY observation, even on a role that does not require one', () => {
    const root = realTargetRoot()
    const { observation, observationRef } = agentReportedRecord(root, {
      outcome: 'fail',
      assertions: [{ id: 'search', outcome: 'fail' }],
    })
    const result = runValidator(
      rolePass({
        role: 'reviewer',
        independence: 'not-applicable',
        observation: observationEnvelope(observation, observationRef),
      }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toMatch(/role-pass\.observation\.(origin|outcome)/)
  })

  it('H7 — an observationRef that never resolves is a finding, not a silent pass', () => {
    const root = realTargetRoot()
    const { observation } = collectorObservedRecord(root)
    const result = runValidator(
      rolePass({
        role: 'developer',
        observation: observationEnvelope(
          observation,
          '.agent-runs/verification/does-not-exist/observation.json',
        ),
      }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.reference-unresolved')
  })

  it('H7b — an observationRef that resolves to a DIFFERENT record than the one embedded is a finding', () => {
    const root = realTargetRoot()
    const a = collectorObservedRecord(root)
    const b = collectorObservedRecord(root)
    const result = runValidator(
      rolePass({
        role: 'developer',
        observation: observationEnvelope(a.observation, b.observationRef),
      }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.reference-mismatch')
  })
})

// W8f D3 — the single KNOWN LIMITATION test below used to cover ALL synthetic forgery: any
// internally-consistent record with a real candidate digest and a resolvable ref passed, because
// requiredAssertions came from the record itself and definitionDigest was trusted from the
// author's own envelope. After W8f D2 (the gate resolves observations through the shared
// lib/verification/observation-resolver.mjs, the same resolver scripts/run-delivery.mjs calls),
// that is no longer true: a synthetic record is refused unless its definition matches a check the
// TARGET's own agent-workflow.config.json configures AND a matching record is independently found
// in the collector's own storage. The three tests below assert each of those refusals directly.
// What genuinely remains — the one thing D2 cannot close — is a forger who has ordinary write
// access to the worktree writing straight into `.agent-runs/verification/`, the collector's own
// storage location: nothing distinguishes that file from one the real collector produced, because
// both are unsigned JSON on local, author-writable scratch. That residual case gets exactly one
// test, named for what it is.
describe('role-pass gate: most forgery is now refused (W8f D2)', () => {
  it('D2/1 — an observation whose definition matches no configured check is refused, even with correct candidate digest, real storage backing and self-reported passing assertions', () => {
    const root = realTargetRoot()
    // A criterionId the target's one configured check (checks.suite, criterionId 'AC-1') does not
    // serve — so no configured check can ever match this record's definition, no matter how
    // internally consistent the record is.
    const definition = { ...candidateDefinition(), criterionId: 'not-a-configured-criterion' }
    const candidate = fingerprintCandidate(root, { inputs: definition.inputs })
    const now = new Date().toISOString()
    const id = randomUUID()
    const record = sealDeliveryRecord('verification-observation', {
      id,
      invocationId: id,
      criterionId: definition.criterionId,
      producer: 'my-imagination',
      origin: 'collector-observed',
      isolation: 'immutable',
      candidateDigest: candidate.digest,
      definitionDigest: recordDigest(definition), // self-consistent, but matches no configured check
      outcome: 'pass',
      assertions: [{ id: 'search', outcome: 'pass' }],
      startedAt: now,
      completedAt: now,
    })
    // Written to the record's OWN collector-storage path too, so the only thing wrong here is the
    // check binding — isolating D2/1 from D2/2 and D2/3 below.
    const observationRef = writeRecordFile(root, id, record)
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record, observationRef) }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.definition-mismatch')
  })

  it('D2/2 — an embedded observation that differs from the collector\'s stored copy is refused, even though its own declared observationRef resolves and matches', () => {
    const root = realTargetRoot()
    // A real, genuinely-collected record, written by the actual collector pipeline to
    // .agent-runs/verification/<id>/observation.json — the ONE path the shared resolver trusts.
    const real = collectorObservedRecord(root)
    // A forged copy of it, same id (so it targets the SAME collector-storage path), but different
    // content — sealDeliveryRecord recomputes a different digest.
    const forged = sealDeliveryRecord('verification-observation', {
      ...real.observation,
      producer: 'forged-by-hand',
    })
    // The forged copy's OWN observationRef points at a SEPARATE file holding the SAME forged
    // content, so the role pass's own declared reference (H7) resolves and matches on its own —
    // isolating the resolver's independent collector-storage comparison as the thing that refuses
    // this, not H7.
    const observationRef = writeRecordFile(root, randomUUID(), forged)
    const result = runValidator(
      rolePass({
        role: 'developer',
        observation: observationEnvelope(forged, observationRef),
      }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.unverified-source')
  })

  it('D2/3 — an observation whose id has no file at all in collector storage is refused', () => {
    const root = realTargetRoot()
    const definition = candidateDefinition()
    const candidate = fingerprintCandidate(root, { inputs: definition.inputs })
    const now = new Date().toISOString()
    const id = randomUUID()
    const record = sealDeliveryRecord('verification-observation', {
      id,
      invocationId: id,
      criterionId: definition.criterionId,
      producer: 'my-imagination',
      origin: 'collector-observed',
      isolation: 'immutable',
      candidateDigest: candidate.digest,
      definitionDigest: recordDigest(definition),
      outcome: 'pass',
      assertions: [{ id: 'search', outcome: 'pass' }],
      startedAt: now,
      completedAt: now,
    })
    // Resolvable observationRef pointing SOMEWHERE (satisfying H7 on its own) — but nothing was
    // ever written under this id's own collector-storage path, because nothing collected it.
    const observationRef = writeRecordFile(root, 'never-collected', record)
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record, observationRef) }),
      { target: root },
    )
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('role-pass.observation.unverified-source')
  })
})

describe('role-pass gate: known limitation (out of scope, documented not silently claimed)', () => {
  it("KNOWN LIMITATION — writing a fake observation.json directly into local .agent-runs/verification/<id>/ still passes: that directory is author-writable scratch, not a trust anchor. Every other synthetic-record path is refused (see 'most forgery is now refused' above); this is the one path D2 cannot close from inside a single worktree. sealDeliveryRecord is keyless (a checksum over the author's own payload, not a signature), so a file placed directly at the path the resolver trusts is indistinguishable from one the real collector produced. Closing this needs observations anchored in a durable store the author cannot write to directly — the append-only run store (lib/sources/github-run-store.mjs / lib/sources/run-store.mjs), not local .agent-runs/verification/ scratch — a later workstream.", () => {
    const root = realTargetRoot()
    const definition = candidateDefinition()
    const candidate = fingerprintCandidate(root, { inputs: definition.inputs })
    const now = new Date().toISOString()
    const id = randomUUID() // a real-shaped id — the resolver only ever checks the SHAPE, not provenance
    const record = sealDeliveryRecord('verification-observation', {
      id,
      invocationId: id,
      criterionId: definition.criterionId,
      producer: 'typed-by-hand-not-collected',
      origin: 'collector-observed',
      isolation: 'immutable',
      candidateDigest: candidate.digest, // correctly computed, even though no command ever ran
      definitionDigest: recordDigest(definition), // matches the real configured check
      outcome: 'pass',
      assertions: [{ id: 'search', outcome: 'pass' }],
      startedAt: now,
      completedAt: now,
    })
    // Written directly to the id's own collector-storage path — indistinguishable from a real
    // collector run because nothing here is signed and the directory is ordinary worktree scratch.
    const observationRef = writeRecordFile(root, id, record)
    const result = runValidator(
      rolePass({ role: 'developer', observation: observationEnvelope(record, observationRef) }),
      { target: root },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Result: READY')
  })
})

describe('role-pass gate: one resolver, not two (W8f D1/D2)', () => {
  it('the gate no longer derives requiredAssertions from the record, and both the gate and run-delivery.mjs call the same shared resolver', () => {
    const gateSource = readFileSync(
      join(repoRoot, 'scripts', 'validate-sdlc-role-pass.mjs'),
      'utf8',
    )
    const runDeliverySource = readFileSync(join(repoRoot, 'scripts', 'run-delivery.mjs'), 'utf8')
    // The old weak binding: requiredAssertions built from the record's own `assertions` field.
    expect(gateSource).not.toMatch(/record\?\.assertions/)
    expect(gateSource).not.toMatch(/observationBlock\.definitionDigest/)
    // Both callers import the ONE shared resolver, from lib/verification/ (outside lib/core/).
    const resolverImport = /from ['"].*\/verification\/observation-resolver\.mjs['"]/
    expect(gateSource).toMatch(resolverImport)
    expect(runDeliverySource).toMatch(resolverImport)
  })
})
