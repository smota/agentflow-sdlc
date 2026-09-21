// W8b — "put the gate on the mandatory path". Checkpoints G2/G3 found that WHERE the product
// decides "a human is required here" was a phase number, a GitHub review flag, and a weak status
// that could delete the strong gate from the queue. These eight tests are written FIRST, against the
// pre-fix code, and each one is confirmed to fail for the defect it targets before the corresponding
// D1-D4 fix lands (see the session report for the failure-mode confirmation).
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, afterEach } from 'vitest'
import { createRunService, requiresHumanAcceptance } from '../application/run-service.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import {
  buildAgentFlowGoalModel,
  deriveHumanGate,
  deriveSelectedPath,
} from '../cockpit-goal-model.mjs'
import * as readinessContract from '../cockpit-readiness-contract.mjs'
import { deriveGateForAction } from '../cockpit-readiness-contract.mjs'
import { GATE_CLASSES, createGate, satisfyGate } from '../core/gate.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
import { requiredHumanGateClasses, resolvePosture, POSTURE_NAMES } from '../core/posture.mjs'
import { fingerprintCandidate } from '../verification/workspace.mjs'
import { loadSdlcConfig } from '../sdlc-state.mjs'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const sdlcConfig = loadSdlcConfig(REPO_ROOT)

// W8d D4 — a real satisfied gate: a sealed adequacy-of-intent gate over `subjectDigest`, paired with
// an attestation `satisfyGate` (lib/core/gate.mjs) actually accepts. Tests that used to complete the
// gate with a bare `{ gateClass, subjectDigest }` shape now build this instead — that bare shape is
// exactly the defect W8d fixes (see "does NOT complete on shape alone" below).
function satisfiedAdequacyGate(subjectDigest, attestationOverrides = {}) {
  const gate = createGate({
    gateClass: GATE_CLASSES.adequacyOfIntent,
    subjectDigest,
    subjectKind: 'goalRevision',
    requiredRole: 'reviewer',
  })
  const attestation = createReviewAttestation({
    subject: 'goal adequacy-of-intent review',
    reviewedDigest: subjectDigest,
    reviewer: { platform: 'human', executor: 'reviewer-1', independence: 'human-gate' },
    decision: 'agree',
    timestamp: '2026-09-16T12:00:00Z',
    findings: [],
    ...attestationOverrides,
  })
  return { gate, attestation }
}

function issue({
  number = 1,
  title = 'Goal',
  body = '## Acceptance criteria\n- [ ] secure\n\nRemote auth security high-assurance',
  labels = [],
  updated_at,
} = {}) {
  return { number, title, body, labels, state: 'open', updated_at }
}

async function startRun({ profile, boundary = 'mutate-worktree', posture, sdlcConfig, authorize }) {
  const store = createMemoryRunStore()
  const service = createRunService({ store, authorize, posture, sdlcConfig })
  const authority = { owner: 'writer', generation: 0 }
  await service.start({
    runId: 'demo',
    goalRef: 'issue:1',
    owner: 'writer',
    profile,
    boundary,
    authority,
  })
  return { service, authority }
}

describe('W8b D1 — the phase gate never died (run-service.advance)', () => {
  it('1. advance() on a high-assurance run no longer requires a human merely because of the phase; it requires one because resolvePosture + crossings say so', async () => {
    const calls = []
    // A fresh run's phase is 0 (nowhere near the old six-role-pass threshold). The deleted condition
    // would never have called authorize with kind 'human-acceptance' here at all.
    const { service, authority } = await startRun({
      profile: 'high-assurance',
      authorize: async ({ kind }) => {
        calls.push(kind)
        return kind !== 'human-acceptance'
      },
    })
    await expect(service.advance({ contract: {}, authority })).rejects.toThrow(
      'Human acceptance is unresolved',
    )
    expect(calls).toContain('human-acceptance')
    // Direct proof phase plays no role at all: the standalone decision function takes no phase input.
    expect(
      requiresHumanAcceptance({
        profile: 'high-assurance',
        boundary: 'mutate-worktree',
        config: sdlcConfig,
      }),
    ).toBe(true)
  })

  // W8b2 — this used to assert only that posture 'advisory' and posture 'autonomous' DIFFER for
  // the same change class ("proof posture is actually consulted"). They did differ, but for the
  // WRONG reason: the code asked `!allowsSelfReview || crossings.length > 0`, a question about
  // self-review, not about which gate classes the posture actually declares
  // (`resolvePosture(...).humanGateClasses`). A test of an effect's presence is not a test of its
  // correctness. Replaced with the full table: every posture x change-class cell's required gate
  // classes must equal what the posture declares, no more and no less.
  it('2. table: for every posture x change class, the required gate classes equal resolvePosture(...).humanGateClasses', () => {
    for (const posture of POSTURE_NAMES) {
      for (const changeClass of Object.keys(sdlcConfig.paths)) {
        const effective = resolvePosture({ posture, changeClass, config: sdlcConfig })
        const required = requiredHumanGateClasses({ posture, changeClass, config: sdlcConfig })
        expect(required).toEqual([...effective.humanGateClasses])
      }
    }
  })

  it('3. assisted + bounded — the factory default on an ordinary change — requires adequacy-of-intent and release-of-candidate', () => {
    const required = requiredHumanGateClasses({
      posture: 'assisted',
      changeClass: 'bounded',
      config: sdlcConfig,
    })
    expect(required).toContain(GATE_CLASSES.adequacyOfIntent)
    expect(required).toContain(GATE_CLASSES.releaseOfCandidate)
  })

  it('4. autonomous + bounded still requires adequacy-of-intent', () => {
    const required = requiredHumanGateClasses({
      posture: 'autonomous',
      changeClass: 'bounded',
      config: sdlcConfig,
    })
    expect(required).toContain(GATE_CLASSES.adequacyOfIntent)
  })

  it('5. run-service and deriveHumanGate agree on every cell, and the requirement formula is defined exactly once', () => {
    for (const posture of POSTURE_NAMES) {
      for (const changeClass of Object.keys(sdlcConfig.paths)) {
        const runServiceRequired = requiresHumanAcceptance({
          profile: changeClass,
          posture,
          config: sdlcConfig,
        })
        const cockpitRequired = deriveHumanGate({
          selectedPath: { profile: changeClass },
          posture,
          config: sdlcConfig,
        }).required
        expect(cockpitRequired).toBe(runServiceRequired)
      }
    }
    // Built by concatenation, not as a literal, so this test's own source text (which necessarily
    // contains the function name too) is never itself a hit — same technique as
    // PHASE_THRESHOLD_NEEDLE below.
    const DEFINITION_NEEDLE = ['export function ', 'requiredHumanGateClasses'].join('')
    const OLD_FORMULA_NEEDLE = ['!effective.allowsSelfReview', ' || crossings'].join('')
    let definitionCount = 0
    for (const dir of ['lib']) {
      walk(join(REPO_ROOT, dir), (file) => {
        if (!/\.mjs$/.test(file)) return
        if (file === fileURLToPath(import.meta.url)) return
        const text = readFileSync(file, 'utf8')
        if (text.includes(DEFINITION_NEEDLE)) definitionCount++
        if (/[\\/](run-service|cockpit-goal-model)\.mjs$/.test(file)) {
          expect(text.includes(OLD_FORMULA_NEEDLE)).toBe(false)
        }
      })
    }
    expect(definitionCount).toBe(1)
  })

  it('3. a high-assurance change class keeps its human floor even at posture autonomous', async () => {
    const calls = []
    const { service, authority } = await startRun({
      profile: 'high-assurance',
      posture: 'autonomous',
      authorize: async ({ kind }) => {
        calls.push(kind)
        return true
      },
    })
    await service.advance({ contract: {}, authority }).catch(() => {})
    expect(calls).toContain('human-acceptance')
    expect(
      requiresHumanAcceptance({
        profile: 'high-assurance',
        posture: 'autonomous',
        config: sdlcConfig,
      }),
    ).toBe(true)
  })
})

describe('W8b D2 — a human gate completes only on a satisfied gate, never on reviewDecision', () => {
  const subjectDigest = 'a'.repeat(64)

  it("4. a PR with reviewDecision 'APPROVED' and no satisfied gate leaves the human gate incomplete", () => {
    const selectedPath = deriveSelectedPath({ issue: issue() })
    const gate = deriveHumanGate({
      selectedPath,
      comments: [],
      pullRequests: [{ reviewDecision: 'APPROVED' }],
      subjectDigest,
      satisfiedGates: [],
    })
    expect(gate.complete).toBe(false)
    expect(gate.status).not.toBe('approved')
    // W8d D4 — CHANGED (was a bare `{ gateClass, subjectDigest }` shape). A real satisfied gate — a
    // sealed gate paired with an attestation `satisfyGate` accepts — over the SAME subject, by
    // contrast, does complete it.
    const withSatisfiedGate = deriveHumanGate({
      selectedPath,
      comments: [],
      pullRequests: [{ reviewDecision: 'APPROVED' }],
      subjectDigest,
      satisfiedGates: [satisfiedAdequacyGate(subjectDigest)],
    })
    expect(withSatisfiedGate.complete).toBe(true)
    expect(withSatisfiedGate.status).toBe('approved')
  })

  it('5. reviewDecision appears only as a hint; changing it cannot change completion', () => {
    const selectedPath = deriveSelectedPath({ issue: issue() })
    const base = { selectedPath, comments: [], subjectDigest, satisfiedGates: [] }
    const approved = deriveHumanGate({ ...base, pullRequests: [{ reviewDecision: 'APPROVED' }] })
    const changesRequested = deriveHumanGate({
      ...base,
      pullRequests: [{ reviewDecision: 'CHANGES_REQUESTED' }],
    })
    expect(approved.hints.find((h) => h.id === 'github-review-decision').value).toBe('APPROVED')
    expect(changesRequested.hints.find((h) => h.id === 'github-review-decision').value).toBe(
      'CHANGES_REQUESTED',
    )
    // The hint's value changed; completion and status did not.
    expect(approved.complete).toBe(changesRequested.complete)
    expect(approved.status).toBe(changesRequested.status)
    expect(approved.complete).toBe(false)
  })

  it("buildAgentFlowGoalModel threads satisfiedGates through by the goal's own revision", () => {
    const withApprovedPr = buildAgentFlowGoalModel({
      issue: issue(),
      pullRequests: [{ reviewDecision: 'APPROVED' }],
    })
    expect(withApprovedPr.humanGate.complete).toBe(false)
    // W8d D4 — CHANGED (was a bare `{ gateClass, subjectDigest }` shape).
    const satisfied = buildAgentFlowGoalModel({
      issue: issue(),
      pullRequests: [{ reviewDecision: 'APPROVED' }],
      satisfiedGates: [satisfiedAdequacyGate(withApprovedPr.revision)],
    })
    expect(satisfied.humanGate.complete).toBe(true)
  })
})

// W8d D4 — spec test 5. deriveHumanGate must not complete on a record's SHAPE: a plain object with
// the right `gateClass` and `subjectDigest` is exactly what the pre-fix code accepted (see the
// W8d spec report's reproduction). It now completes only when satisfyGate (lib/core/gate.mjs)
// actually accepts a `{ gate, attestation }` pair over the same subject.
describe('W8d D4 — a human gate does not complete on shape alone; only a satisfied gate completes it', () => {
  const subjectDigest = 'e'.repeat(64)

  it('a plain object shaped like a satisfied gate, with no attestation at all, does not complete the gate', () => {
    const selectedPath = deriveSelectedPath({ issue: issue() })
    const gate = deriveHumanGate({
      selectedPath,
      comments: [],
      subjectDigest,
      satisfiedGates: [{ gateClass: GATE_CLASSES.adequacyOfIntent, subjectDigest }],
    })
    expect(gate.complete).toBe(false)
    expect(gate.status).not.toBe('approved')
  })

  it('a sealed gate paired with a well-formed but non-agreeing attestation does not complete the gate', () => {
    const selectedPath = deriveSelectedPath({ issue: issue() })
    const { gate: sealedGate, attestation } = satisfiedAdequacyGate(subjectDigest, {
      decision: 'changes-requested',
    })
    const result = deriveHumanGate({
      selectedPath,
      comments: [],
      subjectDigest,
      satisfiedGates: [{ gate: sealedGate, attestation }],
    })
    expect(result.complete).toBe(false)
  })

  it('a sealed gate paired with an attestation from a non-human reviewer does not complete the gate', () => {
    const selectedPath = deriveSelectedPath({ issue: issue() })
    const { gate: sealedGate, attestation } = satisfiedAdequacyGate(subjectDigest, {
      reviewer: { platform: 'claude-code', executor: 'agent-1', independence: 'human-gate' },
    })
    const result = deriveHumanGate({
      selectedPath,
      comments: [],
      subjectDigest,
      satisfiedGates: [{ gate: sealedGate, attestation }],
    })
    expect(result.complete).toBe(false)
    // Confirm this is a real, otherwise-valid pair — satisfyGate itself refuses it for the same
    // reason, so the two decision points (the gate library and the cockpit's own gate) agree.
    expect(satisfyGate(sealedGate, attestation).ok).toBe(false)
  })

  it('a valid human attestation over the same subject, paired with the sealed gate, DOES complete the gate', () => {
    const selectedPath = deriveSelectedPath({ issue: issue() })
    const pair = satisfiedAdequacyGate(subjectDigest)
    expect(satisfyGate(pair.gate, pair.attestation).ok).toBe(true)
    const result = deriveHumanGate({
      selectedPath,
      comments: [],
      subjectDigest,
      satisfiedGates: [pair],
    })
    expect(result.complete).toBe(true)
    expect(result.status).toBe('approved')
  })
})

describe('W8b D3 — the formal gate is never suppressed by the weak one', () => {
  it("6. deriveGateForAction returns a gate for a required unit even when humanGate.status is 'approved'", () => {
    const goal = {
      revision: 'b'.repeat(64),
      versionLens: { state: 'in-progress' },
      humanGate: { required: true, status: 'approved' },
    }
    const gate = deriveGateForAction(goal, { id: 'request-human-gate' })
    expect(gate).toBeTruthy()
    expect(gate.gateClass).toBe(GATE_CLASSES.adequacyOfIntent)
    expect(gate.subjectDigest).toBe(goal.revision)
  })
})

describe('W8b D4 — one candidateDigest, never a metadata recipe', () => {
  const roots = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('7. a release gate subject equals fingerprintCandidate over the candidate files; a unit with no run yields no candidate digest rather than an invented one', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-w8b-'))
    roots.push(root)
    writeFileSync(join(root, 'candidate.txt'), 'real candidate content')
    const realDigest = fingerprintCandidate(root, { inputs: ['candidate.txt'] }).digest
    const goal = {
      revision: 'c'.repeat(64),
      versionLens: { state: 'in-progress', releaseNoteState: 'needs-decision' },
    }
    const action = { id: 'decide-release-impact' }
    const withCandidate = deriveGateForAction(goal, action, { candidateDigest: realDigest })
    expect(withCandidate.subjectDigest).toBe(realDigest)
    expect(withCandidate.gateClass).toBe(GATE_CLASSES.releaseOfCandidate)

    const withoutCandidate = deriveGateForAction(goal, action)
    expect(withoutCandidate.subjectDigest).toBeFalsy()
    expect(withoutCandidate.status).toBe('pending-candidate')
    // No code path computes a candidateDigest from goal metadata any more: the recipe itself is gone.
    expect(readinessContract.releaseCandidateSubject).toBeUndefined()
  })
})

describe('W8b D1 — no gate anywhere is bound to a phase number', () => {
  // Built by concatenation, not as a literal, so this test's own source text is never itself a hit.
  const PHASE_THRESHOLD_NEEDLE = ['phase', ' >= ', '6'].join('')

  it('8. the old phase-number threshold is gone from lib/ and scripts/ (grep -rn returns nothing)', () => {
    const hits = []
    for (const dir of ['lib', 'scripts']) {
      walk(join(REPO_ROOT, dir), (file) => {
        if (!/\.(mjs|js)$/.test(file)) return
        if (file === fileURLToPath(import.meta.url)) return
        const text = readFileSync(file, 'utf8')
        if (text.includes(PHASE_THRESHOLD_NEEDLE)) hits.push(file)
      })
    }
    expect(hits).toEqual([])
  })
})

function walk(dir, onFile) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) walk(full, onFile)
    else onFile(full)
  }
}
