import { describe, expect, it } from 'vitest'
import { evaluateMergeReadiness } from '../core/steering-merge-policy.mjs'

const head = 'a'.repeat(40),
  old = 'b'.repeat(40)
function fixture() {
  return {
    number: 530,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    isDraft: false,
    headRefOid: head,
    author: { login: 'builder', is_bot: false },
    reviews: [
      {
        state: 'APPROVED',
        authorPermission: 'WRITE',
        author: { login: 'reviewer', is_bot: false },
        submittedAt: '2026-10-15T12:00:00Z',
        commit: { oid: head },
      },
    ],
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  }
}
describe('current-head steering merge policy (#530)', () => {
  it('accepts an independent human current-head approval and known-success CI', () => {
    expect(evaluateMergeReadiness(fixture())).toMatchObject({ ready: true, headOid: head })
  })
  it('ignores author-controlled body/comments/labels and CLI approval strings', () => {
    const pr = fixture()
    pr.reviews = []
    pr.body =
      '## Agent review\n- Review: pass\nhuman-approval: somebody\napproved: true\nMerge owner: auto-merge-requested'
    pr.comments = [{ body: 'lgtm /approve approved' }]
    pr.labels = ['approved', 'auto-merge']
    expect(
      evaluateMergeReadiness(pr, { autoMerge: true, humanApproval: 'approval:anything' }).ready,
    ).toBe(false)
  })
  it.each(['missing', 'stale', 'dismissed', 'author', 'bot', 'unknown-identity'])(
    'holds %s review',
    (failure) => {
      const pr = fixture()
      if (failure === 'missing') pr.reviews = []
      if (failure === 'stale') pr.reviews[0].commit.oid = old
      if (failure === 'dismissed') pr.reviews[0].state = 'DISMISSED'
      if (failure === 'author') pr.reviews[0].author.login = pr.author.login
      if (failure === 'bot') pr.reviews[0].author.is_bot = true
      if (failure === 'unknown-identity') delete pr.reviews[0].author.is_bot
      expect(evaluateMergeReadiness(pr).ready).toBe(false)
    },
  )
  it('uses latest per-author review regardless of source array ordering', () => {
    const pr = fixture(),
      previousApproval = structuredClone(pr.reviews[0])
    pr.reviews.unshift({
      ...structuredClone(previousApproval),
      state: 'CHANGES_REQUESTED',
      submittedAt: '2026-10-15T12:01:00Z',
    })
    expect(evaluateMergeReadiness(pr).ready).toBe(false)
  })
  it('does not resurrect an older approval after dismissal', () => {
    const pr = fixture()
    pr.reviews.push({
      ...structuredClone(pr.reviews[0]),
      state: 'DISMISSED',
      submittedAt: '2026-10-15T12:01:00Z',
    })
    expect(evaluateMergeReadiness(pr).ready).toBe(false)
  })
  it('holds current changes-requested even when another independent human approves', () => {
    const pr = fixture()
    pr.reviews.push({
      state: 'CHANGES_REQUESTED',
      author: { login: 'another-reviewer', is_bot: false },
      submittedAt: '2026-10-15T12:01:00Z',
      commit: { oid: head },
    })
    expect(evaluateMergeReadiness(pr).ready).toBe(false)
  })
  it.each([null, '', 'unknown'])('holds missing or invalid head %j', (value) => {
    const pr = fixture()
    pr.headRefOid = value
    expect(evaluateMergeReadiness(pr).ready).toBe(false)
  })
  it.each(['UNKNOWN', 'CONFLICTING', null])('holds mergeability %j', (value) => {
    const pr = fixture()
    pr.mergeable = value
    expect(evaluateMergeReadiness(pr).ready).toBe(false)
  })
  it.each(['ERROR', 'FAILURE', 'PENDING', 'EXPECTED', null])(
    'holds status-context state %j',
    (state) => {
      const pr = fixture()
      pr.statusCheckRollup = [{ __typename: 'StatusContext', context: 'test', state }]
      expect(evaluateMergeReadiness(pr).ready).toBe(false)
    },
  )
  it('accepts explicit successful status contexts', () => {
    const pr = fixture()
    pr.statusCheckRollup = [{ __typename: 'StatusContext', context: 'test', state: 'SUCCESS' }]
    expect(evaluateMergeReadiness(pr).ready).toBe(true)
  })
  it.each(['NEUTRAL', 'SKIPPED', 'UNKNOWN', null])(
    'holds check-run conclusion %j',
    (conclusion) => {
      const pr = fixture()
      pr.statusCheckRollup[0].conclusion = conclusion
      expect(evaluateMergeReadiness(pr).ready).toBe(false)
    },
  )
  it.each([[], null, [{}]])('holds unknown or absent CI %j', (value) => {
    const pr = fixture()
    pr.statusCheckRollup = value
    expect(evaluateMergeReadiness(pr).ready).toBe(false)
  })
  it('permits explicit standard self-review only through a current trusted source resolver', () => {
    const pr = fixture()
    pr.reviews = []
    const options = {
      requireHumanApproval: false,
      allowSelfReview: true,
      resolveReviewEvidence: () => ({
        verified: true,
        headOid: head,
        decision: 'approved',
        reviewerId: 'builder',
        independent: false,
        human: false,
        sourceRef: 'source:sealed-review',
        reviewerPermission: 'WRITE',
      }),
    }
    expect(evaluateMergeReadiness(pr, options).ready).toBe(true)
    expect(evaluateMergeReadiness(pr, { ...options, resolveReviewEvidence: undefined }).ready).toBe(
      false,
    )
    expect(evaluateMergeReadiness(pr, { ...options, requireHumanApproval: true }).ready).toBe(false)
  })
  it('rejects stale or asynchronous trusted review receipts', () => {
    const pr = fixture()
    pr.reviews = []
    const receipt = {
      verified: true,
      headOid: old,
      decision: 'approved',
      reviewerId: 'reviewer',
      independent: true,
      human: true,
      sourceRef: 'source:review',
    }
    expect(evaluateMergeReadiness(pr, { resolveReviewEvidence: () => receipt }).ready).toBe(false)
    expect(
      evaluateMergeReadiness(pr, {
        resolveReviewEvidence: () => Promise.resolve({ ...receipt, headOid: head }),
      }).ready,
    ).toBe(false)
  })
  it('does not leak arbitrary payloads or mutate source input', () => {
    const pr = fixture()
    pr.body = 'PRIVATE_RAW_TOKEN'
    const before = structuredClone(pr)
    const result = evaluateMergeReadiness(pr)
    expect(JSON.stringify(result)).not.toContain('PRIVATE_RAW_TOKEN')
    expect(pr).toEqual(before)
  })
})

it('holds explicitly incomplete server review requirements', () => {
  const pr = fixture()
  pr.reviewDecision = 'REVIEW_REQUIRED'
  expect(evaluateMergeReadiness(pr).ready).toBe(false)
})
