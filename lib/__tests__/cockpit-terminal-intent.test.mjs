import { describe, it, expect } from 'vitest'
import {
  FORBIDDEN_REMOTE_ACTIONS,
  parseCockpitIntent,
  evaluateGuardedAction,
  formatDurableActionBody,
  readCockpitIntentEnvelope,
  detectCommentDivergence,
  buildTerminalIntentEnvelope,
} from '../cockpit-actions.mjs'
import {
  appendTerminalIntent,
  readAnchoredTerminalIntent,
  resolveAnchoredHumanGate,
} from '../cockpit-intent-anchor.mjs'
import { createReviewAttestation } from '../core/review-attestation.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import { createGitHubRunStore, planGitHubCoordination } from '../sources/github-run-store.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import { deriveHumanGate, deriveSelectedPath } from '../cockpit-goal-model.mjs'
import { GATE_CLASSES } from '../core/gate.mjs'

// Minimal in-memory GitHub double for refs/commits/trees/blobs on the coordination branch — same
// contract exercised in lib/__tests__/github-run-store.test.mjs.
function fakeGitHub() {
  const objects = new Map()
  const refs = new Map()
  const put = (value) => {
    const sha = recordDigest(value)
    objects.set(sha, value)
    return { sha }
  }
  const client = {
    async request(path, options = {}) {
      const tail = path.replace('/repos/test/repo', '')
      if (!options.method) {
        if (!tail) return { default_branch: 'main' }
        if (tail.startsWith('/rulesets?')) return []
        if (tail.startsWith('/actions/workflows?')) return { total_count: 0, workflows: [] }
        if (tail === '/git/ref/heads/main') return { object: { sha: 'baseline' } }
        if (tail.startsWith('/git/ref/heads/')) {
          const sha = refs.get(tail.slice(15))
          if (!sha) throw Object.assign(new Error('not found'), { status: 404 })
          return { object: { sha } }
        }
        if (tail.startsWith('/git/commits/')) return objects.get(tail.slice(13))
        if (tail.startsWith('/git/trees/'))
          return { tree: objects.get(tail.slice(11).split('?')[0]).tree, truncated: false }
        if (tail.startsWith('/git/blobs/')) {
          const blob = objects.get(tail.slice(11))
          return {
            encoding: 'base64',
            content: Buffer.from(blob.content).toString('base64'),
            size: Buffer.byteLength(blob.content),
          }
        }
      }
      const body = options.body
      if (tail === '/git/blobs') return put(body)
      if (tail === '/git/trees') return put({ tree: body.tree })
      if (tail === '/git/commits') return put({ ...body, tree: { sha: body.tree } })
      if (tail.startsWith('/git/refs')) {
        const branch = body.ref?.replace('refs/heads/', '') ?? tail.slice('/git/refs/heads/'.length)
        const existing = refs.get(branch)
        const commit = objects.get(body.sha)
        if (existing && (body.force !== false || commit.parents[0] !== existing))
          throw Object.assign(new Error('conflict'), { status: 422 })
        refs.set(branch, body.sha)
        return { object: { sha: body.sha } }
      }
      throw new Error(`Unexpected request: ${tail}`)
    },
  }
  return { client }
}

async function seedRun(fake, repo, runId) {
  const setupConfirm = (await planGitHubCoordination({ repo, client: fake.client })).digest
  const store = createGitHubRunStore({
    repo,
    runId,
    client: fake.client,
    boundary: 'external-action',
    setupConfirm,
  })
  await store.append(
    createRunEvent({
      runId,
      id: 'start',
      kind: 'started',
      payload: {
        goalRef: 'issue:1',
        owner: 'writer',
        profile: 'standard',
        boundary: 'external-action',
      },
    }),
    null,
  )
  return store
}

function attestationFor(subjectDigest, overrides = {}) {
  return createReviewAttestation({
    subject: 'issue:1 unit close',
    reviewedDigest: subjectDigest,
    reviewer: { platform: 'human', executor: 'samue', independence: 'human-gate' },
    decision: 'agree',
    timestamp: '2026-09-16T12:00:00Z',
    findings: [],
    ...overrides,
  })
}

describe('close-unit: a terminal intent anchored in the run store', () => {
  it('1. a human closing a unit produces a typed, digest-bound attestation appended to the run store', async () => {
    const fake = fakeGitHub()
    const repo = 'test/repo'
    const runId = 'issue-1'
    await seedRun(fake, repo, runId)
    const unit = { candidate: 'unit-1' }
    const subjectDigest = recordDigest(unit)
    const parsed = parseCockpitIntent({
      type: 'close-unit',
      repo,
      issue: 1,
      subjectDigest,
      unit,
      attestation: attestationFor(subjectDigest),
      preApprovalRefs: [],
    })
    expect(parsed.ok).toBe(true)

    await appendTerminalIntent({ client: fake.client, repo, runId, intent: parsed.intent })

    const { events } = await createGitHubRunStore({
      repo,
      runId,
      client: fake.client,
      boundary: 'observe',
    }).read()
    expect(events).toHaveLength(2)
    const decision = events[1]
    expect(decision.kind).toBe('checkpoint')
    expect(decision.payload.agentflowIntent.subjectDigest).toBe(subjectDigest)
    expect(decision.payload.agentflowIntent.verdict).toBe('agree')
    expect(decision.payload.agentflowIntent.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('2. an agent reads the decision from the fenced envelope, never by matching words in the prose', () => {
    const unit = { candidate: 'unit-2' }
    const subjectDigest = recordDigest(unit)
    const parsed = parseCockpitIntent({
      type: 'close-unit',
      repo: 'test/repo',
      issue: 2,
      subjectDigest,
      unit,
      attestation: attestationFor(subjectDigest, { decision: 'agree' }),
      preApprovalRefs: [],
    })
    expect(parsed.ok).toBe(true)
    // Prose deliberately contradicts the real verdict; a reader that scans words would be fooled.
    const body = formatDurableActionBody({
      ...parsed.intent,
      body: 'Honestly I think this should be blocked — changes requested everywhere.',
    })
    const read = readCockpitIntentEnvelope(body)
    expect(read.ok).toBe(true)
    expect(read.envelope.verdict).toBe('agree')
  })

  it('3. a prose-only comment — including one that says "approved, this is closed" — is not accepted as an intent', () => {
    expect(readCockpitIntentEnvelope('approved, this is closed. Ship it.').ok).toBe(false)
    expect(readCockpitIntentEnvelope('').ok).toBe(false)
    expect(readCockpitIntentEnvelope(undefined).ok).toBe(false)
  })

  it('4. close-unit without a valid attestation over the subject digest is refused', () => {
    const subjectDigest = recordDigest({ candidate: 'unit-4' })
    expect(
      parseCockpitIntent({ type: 'close-unit', repo: 'test/repo', issue: 4, subjectDigest }).ok,
    ).toBe(false)
    expect(
      parseCockpitIntent({
        type: 'close-unit',
        repo: 'test/repo',
        issue: 4,
        subjectDigest,
        attestation: {},
      }).ok,
    ).toBe(false)
  })

  it('5. an attestation over the wrong subject digest is refused', () => {
    const unit = { candidate: 'unit-5a' }
    const subjectDigest = recordDigest(unit)
    const wrongDigest = recordDigest({ candidate: 'unit-5b' })
    const parsed = parseCockpitIntent({
      type: 'close-unit',
      repo: 'test/repo',
      issue: 5,
      subjectDigest,
      unit,
      attestation: attestationFor(wrongDigest),
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.errors).toContain('reviewedDigest is stale')
  })

  it('5b (W8a D2). close-unit with a client-supplied subject digest that does not match the unit is refused', () => {
    // The client claims a subjectDigest AND supplies an attestation that matches its own claim —
    // internally consistent, but the claim itself is forged: it was never derived from the real
    // unit. The server must resolve the digest from `unit` itself and refuse the mismatch, not
    // trust whatever the client says its own digest is.
    const realUnit = { candidate: 'unit-5c-real' }
    const forgedSubjectDigest = recordDigest({ candidate: 'unit-5c-forged' })
    const parsed = parseCockpitIntent({
      type: 'close-unit',
      repo: 'test/repo',
      issue: 5,
      subjectDigest: forgedSubjectDigest,
      unit: realUnit,
      attestation: attestationFor(forgedSubjectDigest),
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.errors).toContain('subjectDigest does not match the unit')
  })

  it('6. every action in FORBIDDEN_REMOTE_ACTIONS is still refused after adding close-unit', () => {
    expect(FORBIDDEN_REMOTE_ACTIONS).toContain('mark-review-passed')
    expect(FORBIDDEN_REMOTE_ACTIONS).toContain('bypass-human-gate')
    expect(FORBIDDEN_REMOTE_ACTIONS).not.toContain('close-unit')
    for (const action of FORBIDDEN_REMOTE_ACTIONS) {
      expect(
        evaluateGuardedAction({ action, userRole: 'admin', confirmation: true }).reasons,
      ).toContain('forbidden-by-policy')
      expect(parseCockpitIntent({ type: action }).ok).toBe(false)
    }
    const unit = { candidate: 'unit-6' }
    const subjectDigest = recordDigest(unit)
    const legit = parseCockpitIntent({
      type: 'close-unit',
      repo: 'test/repo',
      issue: 6,
      subjectDigest,
      unit,
      attestation: attestationFor(subjectDigest),
    })
    expect(legit.ok).toBe(true)
    expect(
      evaluateGuardedAction({ action: 'close-unit', userRole: 'maintainer', confirmation: true })
        .ok,
    ).toBe(true)
  })

  it('7. a comment edited after the fact diverges from its anchored record and is detectable', async () => {
    const fake = fakeGitHub()
    const repo = 'test/repo'
    const runId = 'issue-7'
    await seedRun(fake, repo, runId)
    const unit = { candidate: 'unit-7' }
    const subjectDigest = recordDigest(unit)
    const parsed = parseCockpitIntent({
      type: 'close-unit',
      repo,
      issue: 7,
      subjectDigest,
      unit,
      attestation: attestationFor(subjectDigest),
      preApprovalRefs: [],
    })
    await appendTerminalIntent({ client: fake.client, repo, runId, intent: parsed.intent })
    const anchoredEnvelope = await readAnchoredTerminalIntent({
      client: fake.client,
      repo,
      runId,
      subjectDigest,
    })

    const originalComment = formatDurableActionBody(parsed.intent)
    const originalRead = readCockpitIntentEnvelope(originalComment)
    expect(detectCommentDivergence(originalRead.envelope, anchoredEnvelope).diverged).toBe(false)

    // A naive edit that changes the visible verdict without recomputing the digest is caught by
    // the envelope's own self-consistency check.
    const naiveEdit = originalComment.replace(
      '"verdict": "agree"',
      '"verdict": "changes-requested"',
    )
    expect(readCockpitIntentEnvelope(naiveEdit).ok).toBe(false)

    // A careful edit recomputes a self-consistent digest for the forged content — still cannot
    // reproduce the digest anchored in the run store.
    const forgedEnvelope = buildTerminalIntentEnvelope({
      intentType: 'close-unit',
      subjectDigest,
      attestation: { ...parsed.intent.attestation, decision: 'changes-requested' },
      preApprovalRefs: [],
    })
    expect(detectCommentDivergence(forgedEnvelope, anchoredEnvelope).diverged).toBe(true)
  })

  it('8. a question asked before approval is retained with the attestation, as a reference not a transcript', async () => {
    const fake = fakeGitHub()
    const repo = 'test/repo'
    const runId = 'issue-8'
    await seedRun(fake, repo, runId)
    const unit = { candidate: 'unit-8' }
    const subjectDigest = recordDigest(unit)
    const preApprovalRefs = [
      {
        type: 'add-clarification',
        commentId: 555,
        url: 'https://github.com/test/repo/issues/8#issuecomment-555',
      },
    ]
    const parsed = parseCockpitIntent({
      type: 'close-unit',
      repo,
      issue: 8,
      subjectDigest,
      unit,
      attestation: attestationFor(subjectDigest),
      preApprovalRefs,
    })
    expect(parsed.intent.preApprovalRefs).toEqual(preApprovalRefs)

    const anchored = await appendTerminalIntent({
      client: fake.client,
      repo,
      runId,
      intent: parsed.intent,
    })
    expect(anchored.envelope.preApprovalRefs).toEqual(preApprovalRefs)

    const anchoredEnvelope = await readAnchoredTerminalIntent({
      client: fake.client,
      repo,
      runId,
      subjectDigest,
    })
    expect(anchoredEnvelope.preApprovalRefs).toEqual(preApprovalRefs)
    // A reference, not a transcript: no free-text question/answer body is carried in the record.
    expect(JSON.stringify(anchoredEnvelope)).not.toMatch(/what does this mean|why are we/i)
  })

  // W8c D5 — DEFECT FIXED. readAnchoredTerminalIntent and detectCommentDivergence were built and
  // never called: a human's decision was written to the run store and nothing ever read it back.
  // resolveAnchoredHumanGate wires the two together and produces exactly the satisfiedGates shape
  // deriveHumanGate (W8b D2) already knows how to consume.
  it('6. a human close-unit anchored in the run store completes the cockpit\'s human gate on the next read; a comment edited after anchoring is detected as divergent and does not complete it', async () => {
    const fake = fakeGitHub()
    const repo = 'test/repo'
    const runId = 'issue-9'
    await seedRun(fake, repo, runId)
    const unit = { candidate: 'unit-9' }
    const subjectDigest = recordDigest(unit)
    const parsed = parseCockpitIntent({
      type: 'close-unit',
      repo,
      issue: 9,
      subjectDigest,
      unit,
      attestation: attestationFor(subjectDigest),
      preApprovalRefs: [],
    })
    expect(parsed.ok).toBe(true)
    await appendTerminalIntent({ client: fake.client, repo, runId, intent: parsed.intent })
    const comments = [{ body: formatDurableActionBody(parsed.intent) }]

    const satisfiedGates = await resolveAnchoredHumanGate({
      client: fake.client,
      repo,
      runId,
      subjectDigest,
      comments,
    })
    expect(satisfiedGates).toEqual([{ gateClass: GATE_CLASSES.adequacyOfIntent, subjectDigest }])
    const selectedPath = deriveSelectedPath({
      issue: { body: '## Acceptance criteria\n- [ ] secure\n\nRemote auth security' },
    })
    const gate = deriveHumanGate({ selectedPath, subjectDigest, satisfiedGates })
    expect(gate.complete).toBe(true)
    expect(gate.status).toBe('approved')

    // Now the visible comment is edited after the fact. A "careful" edit even recomputes a
    // self-consistent digest for the forged content (mirroring test 7 above) — it still cannot
    // reproduce the digest already anchored in the run store, so the decision is not honored.
    const forgedEnvelope = buildTerminalIntentEnvelope({
      intentType: 'close-unit',
      subjectDigest,
      attestation: { ...parsed.intent.attestation, decision: 'changes-requested' },
      preApprovalRefs: [],
    })
    const editedComments = [
      { body: `Edited afterwards.\n\n\`\`\`agentflow-intent\n${JSON.stringify(forgedEnvelope, null, 2)}\n\`\`\`` },
    ]
    const afterEdit = await resolveAnchoredHumanGate({
      client: fake.client,
      repo,
      runId,
      subjectDigest,
      comments: editedComments,
    })
    expect(afterEdit).toEqual([])
    const gateAfterEdit = deriveHumanGate({ selectedPath, subjectDigest, satisfiedGates: afterEdit })
    expect(gateAfterEdit.complete).toBe(false)
  })
})
