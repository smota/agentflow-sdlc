import { describe, expect, it } from 'vitest'
import {
  goalChildCompletionStatus,
  renderGoalPartsLedger,
  parseGoalPartsLedger,
  goalLedgerFindings,
  withoutPartsLedger,
} from '../core/work-projection.mjs'
import { goalSubjectDigest } from '../core/person-gates.mjs'
import { validateIssueAgainstSdlc } from '../sdlc-state.mjs'
import { syncGoalLedger } from '../../scripts/sync-goal-ledger.mjs'
import {
  planIntegrationLifecycle,
  parseGoalReferences,
} from '../../scripts/integration-lifecycle.mjs'

const marker = (kind, parent) =>
  `<!-- agentflow-work:${JSON.stringify({ kind, parent: parent ? `https://github.com/smota/agentflow-sdlc/issues/${parent}` : null })} -->`

const goal = (number, extraBody = '') => ({
  number,
  title: 'goal: supervise the cockpit',
  body: `${marker('goal')}\n**Kind:** goal\n\n## Job\n\nBuild the autonomous cockpit.${extraBody ? `\n\n${extraBody}` : ''}`,
  labels: ['kind:goal', 'feature'],
  state: 'open',
})

const note = (number, parent = 439) => ({
  number,
  title: `capability: breakdown ${number}`,
  body: `**Kind:** capability\n\n**Epic:** #${parent}\n\n## Part\n\nx\n\nPart of #${parent}`,
  labels: ['kind:capability'],
  state: 'open',
})

const capability = (
  number,
  {
    parent = 439,
    replaces = [],
    state = 'open',
    deliveryPr = null,
    mergeCommit = null,
    closed_at = null,
    comments = [],
  } = {},
) => ({
  number,
  title: `capability: feature slice ${number}`,
  body: [
    marker('capability', parent),
    '**Kind:** capability\n\n## Part\n\nx',
    `Part of #${parent}`,
    ...replaces.map((item) => `Replaces #${item}`),
  ].join('\n\n'),
  labels:
    state === 'closed'
      ? ['kind:capability', 'state:delivered', 'integrated:development']
      : ['kind:capability'],
  state,
  deliveryPr,
  mergeCommit,
  closed_at,
  comments,
})

describe('goalChildCompletionStatus', () => {
  it('returns empty summary when goal has no children', () => {
    const records = [goal(439)]
    const status = goalChildCompletionStatus(records, 439)
    expect(status.total).toBe(0)
    expect(status.delivered).toBe(0)
    expect(status.open).toBe(0)
    expect(status.readyForClosure).toBe(false)
    expect(status.statusMessage).toBe('No child parts defined')
  })

  it('calculates completion with mixed admitted and unadmitted parts', () => {
    const records = [
      goal(439),
      note(440, 439),
      note(441, 439),
      capability(450, {
        parent: 439,
        replaces: [440],
        state: 'closed',
        deliveryPr: 455,
        mergeCommit: 'abc1234',
        closed_at: '2026-10-13T12:00:00Z',
      }),
    ]
    const status = goalChildCompletionStatus(records, 439)
    expect(status.total).toBe(2) // 441 (unadmitted note) and 450 (replaces 440)
    expect(status.admitted).toBe(1)
    expect(status.unadmittedNotes).toBe(1)
    expect(status.delivered).toBe(1)
    expect(status.open).toBe(1)
    expect(status.readyForClosure).toBe(false)
    expect(status.statusMessage).toBe('1 of 2 child parts delivered (1 remaining)')

    const deliveredPart = status.parts.find((p) => p.number === 450)
    expect(deliveredPart.delivered).toBe(true)
    expect(deliveredPart.replacement).toBe('#440')
    expect(deliveredPart.deliveryPr).toBe(455)
    expect(deliveredPart.commit).toBe('abc1234')
    expect(deliveredPart.date).toBe('2026-10-13')
  })

  it('detects ready-for-closure milestone when all child parts are delivered', () => {
    const records = [
      goal(439),
      capability(440, { parent: 439, state: 'closed', deliveryPr: 445 }),
      capability(441, { parent: 439, state: 'closed', deliveryPr: 446 }),
      capability(442, { parent: 439, state: 'closed', deliveryPr: 447 }),
    ]
    const status = goalChildCompletionStatus(records, 439)
    expect(status.total).toBe(3)
    expect(status.delivered).toBe(3)
    expect(status.open).toBe(0)
    expect(status.unadmittedNotes).toBe(0)
    expect(status.readyForClosure).toBe(true)
    expect(status.statusMessage).toBe(
      'All child capabilities delivered — ready for person review/closure',
    )
  })

  it('extracts delivery PR and commit from comments when not explicitly on record', () => {
    const records = [
      goal(439),
      capability(440, {
        parent: 439,
        state: 'closed',
        comments: [
          'Integrated into `development` by PR #445: https://github.com/smota/agentflow-sdlc/pull/445\n\nMerge commit: `573989c`',
        ],
      }),
    ]
    const status = goalChildCompletionStatus(records, 439)
    const part = status.parts[0]
    expect(part.deliveryPr).toBe(445)
    expect(part.commit).toBe('573989c')
  })
})

describe('renderGoalPartsLedger and parseGoalPartsLedger', () => {
  it('renders deterministic markdown table and callouts', () => {
    const records = [
      goal(439),
      note(440, 439),
      capability(445, {
        parent: 439,
        replaces: [440],
        state: 'closed',
        deliveryPr: 448,
        mergeCommit: '1234567',
        closed_at: '2026-10-13T10:00:00Z',
      }),
      capability(446, { parent: 439, state: 'open' }),
    ]
    const markdown = renderGoalPartsLedger(records, 439)
    expect(markdown).toContain('> **Status:** 1 of 2 child parts delivered (1 remaining)')
    expect(markdown).toContain('> **Progress:** 1/2 delivered (50%)')
    expect(markdown).toContain(
      '| #445 | capability | capability: feature slice 445 | Delivered | Replaces #440 | #448 | `1234567` | 2026-10-13 |',
    )
    expect(markdown).toContain(
      '| #446 | capability | capability: feature slice 446 | In Progress | — | — | — | — |',
    )
  })

  it('parses rendered ledger round-trip', () => {
    const records = [
      goal(439),
      capability(440, {
        parent: 439,
        state: 'closed',
        deliveryPr: 445,
        mergeCommit: '573989c',
        closed_at: '2026-10-13T00:00:00Z',
      }),
    ]
    const rendered = renderGoalPartsLedger(records, 439)
    const body = `## Job\n\nOutcome.\n\n## Child Work & History\n\n${rendered}\n\n## Acceptance criteria\n\n- [ ] Done`
    const parsed = parseGoalPartsLedger(body)

    expect(parsed).not.toBeNull()
    expect(parsed.readyForClosure).toBe(true)
    expect(parsed.statusMessage).toBe(
      'All child capabilities delivered — ready for person review/closure',
    )
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].partNumber).toBe(440)
    expect(parsed.rows[0].status).toBe('Delivered')
    expect(parsed.rows[0].deliveryPr).toBe('#445')
    expect(parsed.rows[0].commit).toBe('`573989c`')
  })
})

describe('goalLedgerFindings', () => {
  it('passes cleanly when ledger matches records', () => {
    const records = [
      capability(440, { parent: 439, state: 'closed', deliveryPr: 445, mergeCommit: '573989c' }),
    ]
    const rendered = renderGoalPartsLedger([goal(439), ...records], 439)
    const goalRecord = goal(439, `## Child Work & History\n\n${rendered}`)
    const findings = goalLedgerFindings(goalRecord, [goalRecord, ...records])
    expect(findings).toEqual([])
  })

  it('detects missing part in ledger', () => {
    const records = [
      capability(440, { parent: 439, state: 'closed' }),
      capability(441, { parent: 439, state: 'open' }),
    ]
    // Ledger only lists 440
    const incompleteLedger = `> **Status:** 1 of 2 child parts delivered (1 remaining)\n\n| Part | Kind | Title | Status | Replacement | Delivery PR | Commit | Date |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n| #440 | capability | cap | Delivered | — | — | — | — |`
    const goalRecord = goal(439, `## Child Work & History\n\n${incompleteLedger}`)
    const findings = goalLedgerFindings(goalRecord, [goalRecord, ...records])
    expect(findings).toContain('goal parts ledger is missing part #441')
  })

  it('detects desynchronized status when record is delivered but ledger says In Progress', () => {
    const records = [capability(440, { parent: 439, state: 'closed' })]
    const desyncLedger = `> **Status:** 0 of 1 child parts delivered (1 remaining)\n\n| Part | Kind | Title | Status | Replacement | Delivery PR | Commit | Date |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n| #440 | capability | cap | In Progress | — | — | — | — |`
    const goalRecord = goal(439, `## Child Work & History\n\n${desyncLedger}`)
    const findings = goalLedgerFindings(goalRecord, [goalRecord, ...records])
    expect(findings.some((f) => f.includes('status desynchronized for part #440'))).toBe(true)
  })

  it('detects premature ready-for-closure claim', () => {
    const records = [capability(440, { parent: 439, state: 'open' })]
    const prematureLedger = `> **Status:** All child capabilities delivered — ready for person review/closure\n\n| Part | Kind | Title | Status | Replacement | Delivery PR | Commit | Date |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n| #440 | capability | cap | In Progress | — | — | — | — |`
    const goalRecord = goal(439, `## Child Work & History\n\n${prematureLedger}`)
    const findings = goalLedgerFindings(goalRecord, [goalRecord, ...records])
    expect(findings).toContain('goal parts ledger prematurely claims ready-for-closure')
  })
})

describe('person gates subject digest preservation', () => {
  it('does not alter goalSubjectDigest when parts ledger is added or updated', () => {
    const baseGoal = goal(439)
    const baseDigest = goalSubjectDigest(baseGoal)

    const withLedger = goal(
      439,
      `## Child Work & History\n\n> **Status:** All child capabilities delivered — ready for person review/closure\n\n| Part | Status |\n| #440 | Delivered |`,
    )
    const withLedgerDigest = goalSubjectDigest(withLedger)

    expect(withLedgerDigest).toBe(baseDigest)

    const updatedLedger = goal(
      439,
      `## Child Work & History\n\n> **Status:** Updated status\n\n| Part | Status |\n| #440 | Delivered |\n| #441 | Delivered |`,
    )
    expect(goalSubjectDigest(updatedLedger)).toBe(baseDigest)
  })
})

describe('validateIssueAgainstSdlc integration', () => {
  const config = { labels: { type: ['feature'], forbiddenPrefixes: [] } }

  it('reports child status and ready for closure when validating a goal with records', () => {
    const records = [capability(440, { parent: 439, state: 'closed' })]
    const rendered = renderGoalPartsLedger([goal(439), ...records], 439)
    const goalRecord = {
      ...goal(
        439,
        `## Acceptance criteria\n\n- [ ] criteria\n\n## Child Work & History\n\n${rendered}`,
      ),
    }

    const report = validateIssueAgainstSdlc(goalRecord, config, { records })
    expect(report.ok).toBe(true)
    expect(report.childStatus).toBeDefined()
    expect(report.childStatus.readyForClosure).toBe(true)
    expect(report.childStatus.total).toBe(1)
    expect(report.childStatus.delivered).toBe(1)
  })

  it('reports findings when goal parts ledger is desynchronized', () => {
    const records = [capability(440, { parent: 439, state: 'closed' })]
    const staleLedger = `> **Status:** 0 of 1 child parts delivered\n\n| Part | Kind | Title | Status | Replacement | Delivery PR | Commit | Date |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n| #440 | capability | cap | In Progress | — | — | — | — |`
    const goalRecord = {
      ...goal(
        439,
        `## Acceptance criteria\n\n- [ ] criteria\n\n## Child Work & History\n\n${staleLedger}`,
      ),
    }

    const report = validateIssueAgainstSdlc(goalRecord, config, { records })
    expect(report.ok).toBe(false)
    expect(report.findings.some((f) => f.code === 'issue.goal-ledger')).toBe(true)
  })
})

describe('syncGoalLedger', () => {
  it('updates goal body with synchronized parts ledger', () => {
    const records = [
      goal(439, '## Acceptance criteria\n\n- [ ] All done'),
      capability(440, { parent: 439, state: 'closed', deliveryPr: 445 }),
    ]
    const result = syncGoalLedger({
      goalNumber: 439,
      records,
      apply: false,
    })

    expect(result.status.readyForClosure).toBe(true)
    expect(result.updatedBody).toContain('## Child Work & History')
    expect(result.updatedBody).toContain(
      'All child capabilities delivered — ready for person review/closure',
    )
    expect(result.updatedBody).toContain('#440')
    expect(result.updatedBody).toContain('#445')
  })

  it('applies update via exec command when apply is true', () => {
    const records = [
      goal(439, '## Acceptance criteria\n\n- [ ] All done'),
      capability(440, { parent: 439, state: 'closed', deliveryPr: 445 }),
    ]
    let executedCommand = null
    const mockExec = (cmd) => {
      executedCommand = cmd
    }

    const result = syncGoalLedger({
      goalNumber: 439,
      records,
      apply: true,
      exec: mockExec,
    })

    expect(result.applied).toBe(true)
    expect(executedCommand).toContain('gh issue edit 439 --body-file')
  })
})

describe('integration-lifecycle with goals', () => {
  it('parses Part of #<goal> reference and includes affectedGoals in lifecycle plan', () => {
    const plan = planIntegrationLifecycle(
      {
        number: 445,
        url: 'https://github.com/smota/agentflow-sdlc/pull/445',
        body: 'Implements #440\nPart of #439',
        baseRefName: 'development',
        merged: true,
        mergeCommit: '573989c',
      },
      {
        integrationBranch: 'development',
        trunkBranch: 'main',
        addLabels: ['integrated:development', 'awaiting-release'],
        closeIntegratedIssues: true,
        referenceKeywords: ['Implements', 'Closes'],
      },
    )

    expect(plan.skipped).toBe(false)
    expect(plan.issues).toEqual(['#440'])
    // CRITICAL: Parent goal #439 must NEVER be auto-closed
    expect(plan.issues).not.toContain('#439')
    expect(plan.affectedGoals).toEqual([439])
    expect(plan.goalSyncInstruction).toContain('agentflow-sdlc goal sync 439 --apply')
  })
})
