import { describe, it, expect } from 'vitest'
import { steerMergeCheck, verifyMergeGates } from '../steer.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
const head = 'a'.repeat(40),
  nowMs = 1000000,
  repo = 'fixture/project'
function fixture() {
  const pr = {
    number: 530,
    title: 'Fixture',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefOid: head,
    reviewDecision: 'APPROVED',
    author: { login: 'builder' },
    reviews: [
      {
        state: 'APPROVED',
        authorPermission: 'WRITE',
        submittedAt: '2026-10-15T12:00:00Z',
        commit: { oid: head },
        author: { login: 'human-reviewer', is_bot: false },
      },
    ],
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  }
  const calls = []
  const steeringBinding = {
    authorityId: 'steer.lead',
    replyRoute: 'external:operator',
    goal: 'goal-516',
    task: 'merge-530',
    powers: ['merge'],
    issuedAt: nowMs - 1,
    expiresAt: nowMs + 120000,
  }
  const steeringRequest = {
    goal: 'goal-516',
    task: 'merge-530',
    power: 'merge',
    challenge: 'unique-challenge-12345678901234567890',
    deadlineAt: nowMs + 60000,
    subjectId: `github:${repo}/pull/530`,
    subjectDigest: recordDigest({ repository: repo, prNumber: 530, headOid: head }),
    actionDigest: recordDigest({
      action: 'merge',
      repository: repo,
      prNumber: 530,
      headOid: head,
      strategy: 'squash',
      deleteBranch: true,
    }),
  }
  const receipt = {
    ...steeringRequest,
    authorityId: 'steer.lead',
    replyRoute: 'external:operator',
    authenticated: true,
    reachable: true,
    decision: 'approve',
    human: true,
    approverId: 'human-operator',
    nonceConsumed: true,
    observedAt: nowMs,
    expiresAt: nowMs + 60000,
  }
  const args = {
    prNumber: 530,
    repo,
    nowMs,
    clock: () => nowMs,
    steeringBinding,
    steeringRequest,
    verifySteeringEndpoint: () => ({ ...receipt }),
    spawnFn: (_cmd, args) => {
      calls.push(args)
      if (args[0] === 'api')
        return {
          status: 0,
          stdout: JSON.stringify({ user: { login: 'human-reviewer' }, permission: 'write' }),
        }
      if (args[1] === 'merge') {
        pr.state = 'MERGED'
        pr.mergeCommit = { oid: 'c'.repeat(40) }
      }
      return { status: 0, stdout: JSON.stringify(pr) }
    },
  }
  return { pr, args, calls, receipt }
}
describe('head-bound steering merge executable integration (#530)', () => {
  it('defaults to inspection without publication', async () => {
    const f = fixture()
    const r = await steerMergeCheck(f.args)
    expect(r.merged).toBe(false)
    expect(f.calls.filter((a) => a[0] === 'pr' && a[1] === 'merge')).toHaveLength(0)
  })
  it('requires host authority even when explicit execution is requested', async () => {
    const f = fixture()
    delete f.args.verifySteeringEndpoint
    const r = await steerMergeCheck({ ...f.args, execute: true })
    expect(r.merged).toBe(false)
    expect(f.calls.filter((a) => a[0] === 'pr' && a[1] === 'merge')).toHaveLength(0)
  })
  it('publishes exact approved head with server-side head match', async () => {
    const f = fixture()
    expect((await steerMergeCheck({ ...f.args, execute: true })).merged).toBe(true)
    expect(f.calls.find((a) => a[0] === 'pr' && a[1] === 'merge')).toEqual(
      expect.arrayContaining(['--match-head-commit', head, '--repo', repo]),
    )
  })
  it.each(['head', 'decision', 'nonce', 'identity', 'action'])(
    'holds mismatched %s without publication',
    async (mode) => {
      const f = fixture()
      if (mode === 'head') f.pr.headRefOid = 'b'.repeat(40)
      if (mode === 'decision') f.receipt.decision = 'deny'
      if (mode === 'nonce') f.receipt.nonceConsumed = false
      if (mode === 'identity') f.args.steeringRequest.subjectId = 'github:other/project/pull/530'
      if (mode === 'action') f.args.steeringRequest.actionDigest = '0'.repeat(64)
      const r = await steerMergeCheck({ ...f.args, execute: true })
      expect(r.merged).toBe(false)
      expect(f.calls.filter((a) => a[0] === 'pr' && a[1] === 'merge')).toHaveLength(0)
    },
  )
  it('holds current source changes requested even when another author approved', () => {
    const f = fixture()
    f.pr.reviewDecision = 'CHANGES_REQUESTED'
    expect(verifyMergeGates(f.pr).ready).toBe(false)
  })
  it.each(['FAILURE', 'ERROR', 'PENDING'])('rejects status context %s', (state) => {
    const f = fixture()
    f.pr.statusCheckRollup = [{ __typename: 'StatusContext', context: 'external-ci', state }]
    expect(verifyMergeGates(f.pr).ready).toBe(false)
  })
  it('keeps ambiguous publication pending reconciliation', async () => {
    const f = fixture(),
      original = f.args.spawnFn
    f.args.spawnFn = (cmd, args) =>
      args[1] === 'merge'
        ? { status: null, error: { code: 'ETIMEDOUT' }, stderr: 'PRIVATE_RAW_FIXTURE' }
        : original(cmd, args)
    const r = await steerMergeCheck({ ...f.args, execute: true })
    expect(r).toMatchObject({
      merged: false,
      status: 'MERGE_OUTCOME_UNKNOWN',
      requiresReconciliation: true,
    })
    expect(JSON.stringify(r)).not.toContain('PRIVATE_RAW_FIXTURE')
  })
})

it('does not call command acknowledgement verified publication without source readback', async () => {
  const f = fixture()
  f.args.spawnFn = (_cmd, args) => {
    f.calls.push(args)
    if (args[0] === 'api')
      return {
        status: 0,
        stdout: JSON.stringify({ user: { login: 'human-reviewer' }, permission: 'write' }),
      }
    return { status: 0, stdout: JSON.stringify(f.pr) }
  }
  const r = await steerMergeCheck({ ...f.args, execute: true })
  expect(r).toMatchObject({
    merged: false,
    status: 'MERGE_SUBMITTED',
    publicationVerified: false,
    requiresReconciliation: true,
  })
})

it('rejects an unprivileged approval even from a real human', () => {
  const f = fixture()
  f.pr.reviews[0].authorPermission = 'READ'
  expect(verifyMergeGates(f.pr).ready).toBe(false)
})
it('retains unresolved changes requested on an older commit', () => {
  const f = fixture()
  f.pr.reviewDecision = ''
  f.pr.reviews.push({
    state: 'CHANGES_REQUESTED',
    authorPermission: 'WRITE',
    submittedAt: '2026-10-15T11:59:00Z',
    commit: { oid: 'b'.repeat(40) },
    author: { login: 'other-reviewer', is_bot: false },
  })
  expect(verifyMergeGates(f.pr).ready).toBe(false)
})
it('requires explicit human publication approval on the host receipt', async () => {
  const f = fixture()
  f.receipt.human = false
  const r = await steerMergeCheck({ ...f.args, execute: true })
  expect(r.merged).toBe(false)
  expect(f.calls.some((a) => a[1] === 'merge')).toBe(false)
})
it('rechecks CI after endpoint verification before publication', async () => {
  const f = fixture(),
    verify = f.args.verifySteeringEndpoint
  f.args.verifySteeringEndpoint = () => {
    f.pr.statusCheckRollup[0].conclusion = 'FAILURE'
    return verify()
  }
  const r = await steerMergeCheck({ ...f.args, execute: true })
  expect(r.merged).toBe(false)
  expect(f.calls.some((a) => a[1] === 'merge')).toBe(false)
})
