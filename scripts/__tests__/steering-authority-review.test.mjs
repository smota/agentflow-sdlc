import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { steerUnfreeze } from '../steer.mjs'
import { tripLedgerBreaker } from '../../lib/core/role-collaboration.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'

const roots = [],
  nowMs = 1000000
function fixture() {
  const targetDir = mkdtempSync(join(tmpdir(), 'steering-authority-review-'))
  roots.push(targetDir)
  const path = join(targetDir, 'ledger.json')
  const { ledger } = tripLedgerBreaker({ fencingToken: 4 })
  writeFileSync(path, JSON.stringify(ledger))
  const args = {
    ledgerFile: 'ledger.json',
    resolution: 'slice-split',
    rationale: 'Original reviewed decision',
    actor: 'steer.lead',
    targetDir,
    nowMs,
    clock: () => nowMs,
    steeringBinding: {
      authorityId: 'steer.lead',
      replyRoute: 'external:operator',
      goal: 'goal-516',
      task: 'task-520',
      powers: ['unfreeze'],
      issuedAt: nowMs - 1,
      expiresAt: nowMs + 120000,
    },
    steeringRequest: {
      goal: 'goal-516',
      task: 'task-520',
      power: 'unfreeze',
      challenge: 'challenge-unique-12345678901234567890',
      deadlineAt: nowMs + 60000,
      subjectDigest: recordDigest(ledger),
      subjectId: 'ledger:fixture',
    },
  }
  args.steeringRequest.actionDigest = recordDigest({
    resolution: args.resolution,
    rationale: args.rationale,
    humanApproval: null,
    actor: args.actor,
    subjectDigest: args.steeringRequest.subjectDigest,
    subjectId: args.steeringRequest.subjectId,
    goal: args.steeringRequest.goal,
    task: args.steeringRequest.task,
    nextToken: ledger.fencingToken + 1,
  })
  // A host verifier authenticates this particular original decision. It does not echo
  // arbitrary subsequent caller changes into a newly authenticated receipt.
  const receipt = {
    authenticated: true,
    decision: 'approve',
    nonceConsumed: true,
    reachable: true,
    authorityId: args.actor,
    replyRoute: args.steeringBinding.replyRoute,
    ...args.steeringRequest,
    observedAt: nowMs,
    expiresAt: nowMs + 60000,
  }
  args.resolveSteeringSubject = () => ({
    verified: true,
    subjectId: args.steeringRequest.subjectId,
    subjectDigest: recordDigest(ledger),
    goal: args.steeringRequest.goal,
    task: args.steeringRequest.task,
  })
  args.verifySteeringEndpoint = () => ({ ...receipt })
  return { args, path, receipt }
}
async function rejectedWithoutWrite(f) {
  const before = readFileSync(f.path, 'utf8')
  let held = false
  try {
    const result = await steerUnfreeze(f.args)
    held = result?.ok === false || result?.applied === false
  } catch {
    held = true
  }
  expect(held).toBe(true)
  expect(readFileSync(f.path, 'utf8')).toBe(before)
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('authenticated unfreeze decision binding adversarial review (#520)', () => {
  it('applies the exact authenticated decision', async () => {
    const f = fixture()
    expect((await steerUnfreeze(f.args)).applied).toBe(true)
  })
  it.each(['resolution', 'rationale', 'humanApproval'])(
    'rejects reuse of authorization after changing %s',
    async (field) => {
      const f = fixture()
      if (field === 'resolution') f.args.resolution = 're-scope'
      if (field === 'rationale') f.args.rationale = 'Different decision never authenticated'
      if (field === 'humanApproval') f.args.humanApproval = 'approval:never-authenticated'
      await rejectedWithoutWrite(f)
    },
  )
  it('rejects a missing action digest even when ledger identity and unfreeze power match', async () => {
    const f = fixture()
    delete f.args.steeringRequest.actionDigest
    await rejectedWithoutWrite(f)
  })
  it('rejects a verifier receipt authenticating a different action digest', async () => {
    const f = fixture()
    f.receipt.actionDigest = recordDigest({ unrelated: true })
    await rejectedWithoutWrite(f)
  })
  it('prevents approvalRef from substituting an unauthenticated human authorization', async () => {
    const f = fixture()
    f.args.approvalRef = 'approval:substituted'
    await rejectedWithoutWrite(f)
  })
})

it('never treats an authenticated denial as approval', async () => {
  const f = fixture()
  f.args.verifySteeringEndpoint = () => ({ ...f.receipt, decision: 'deny' })
  await rejectedWithoutWrite(f)
})
it('requires source-backed ledger identity rather than content equality alone', async () => {
  const f = fixture()
  delete f.args.resolveSteeringSubject
  await rejectedWithoutWrite(f)
})
it.each([-1, 1.5, '5', null, Number.MAX_SAFE_INTEGER])(
  'rejects invalid legacy fence %j',
  async (fence) => {
    const f = fixture(),
      ledger = JSON.parse(readFileSync(f.path, 'utf8'))
    ledger.fencingToken = fence
    writeFileSync(f.path, JSON.stringify(ledger))
    await rejectedWithoutWrite(f)
  },
)
