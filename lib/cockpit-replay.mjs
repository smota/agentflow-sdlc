import { COCKPIT_PHASES } from './cockpit-domain.mjs'
import { extractCommentMarkers, extractIssueRelationships } from './cockpit-markdown.mjs'

export const REPLAY_EVENT_TYPES = [
  'goal.created',
  'scope.updated',
  'phase.recorded',
  'decision.recorded',
  'validation.recorded',
  'review.finding',
  'gate.requested',
  'pr.ready',
  'pr.merged',
  'followup.created',
]

export const REPLAY_SECTIONS = [
  'Goal',
  'Scope',
  'Role timeline',
  'Decisions',
  'Validation',
  'Review/Gates',
  'PR readiness',
  'Outcome',
  'Follow-ups',
]

export function buildGoalStory({
  goal,
  comments = [],
  pullRequests = [],
  commits = [],
  checks = [],
  childIssues = [],
} = {}) {
  const events = [
    issueEvent(goal, 'goal.created', 'Goal', 'Goal opened'),
    ...childIssues.map((issue) =>
      issueEvent(issue, 'scope.updated', 'Scope', `Child issue #${issue.number}: ${issue.title}`),
    ),
    ...comments.flatMap(commentEvents),
    ...pullRequests.flatMap((pr) => pullRequestEvents(pr, commits, checks)),
  ]
    .filter(Boolean)
    .sort(compareEvents)

  const relationships = extractIssueRelationships({
    body: goal?.body || '',
    comments,
    pullRequests,
  })
  const followUps = [
    ...new Set([
      ...relationships.followUps,
      ...events
        .filter((e) => e.type === 'followup.created')
        .map((e) => e.issue)
        .filter(Boolean),
    ]),
  ]
  const missing = missingReplayEvidence({ goal, events, pullRequests })

  return {
    goal: goalSummary(goal),
    events,
    compactEvents: compactEvents(events),
    sections: groupEventsBySection(events),
    followUps,
    missing,
    status: pullRequests.some((pr) => pr.merged_at || pr.mergedAt)
      ? 'merged'
      : missing.length
        ? 'incomplete'
        : 'reconstructed',
    readOnly: true,
  }
}

export function compactEvents(events = []) {
  const important = new Set([
    'goal.created',
    'scope.updated',
    'decision.recorded',
    'validation.recorded',
    'review.finding',
    'gate.requested',
    'pr.ready',
    'pr.merged',
    'followup.created',
  ])
  return events.filter((event) => important.has(event.type))
}

export function groupEventsBySection(events = []) {
  return Object.fromEntries(
    REPLAY_SECTIONS.map((section) => [
      section,
      events.filter((event) => event.section === section),
    ]),
  )
}

export function renderGoalStoryMarkdown(story) {
  return (
    `# Goal Story: ${story.goal.title}\n\n` +
    `- Goal: #${story.goal.number}\n` +
    `- Status: ${story.status}\n` +
    `- Replay mode: read-only reconstruction\n\n` +
    REPLAY_SECTIONS.map((section) =>
      renderSectionMarkdown(section, story.sections[section] || []),
    ).join('\n') +
    renderMissingMarkdown(story.missing) +
    renderFollowUpsMarkdown(story.followUps)
  )
}

function renderSectionMarkdown(section, events) {
  if (!events.length) return `## ${section}\n\n_No durable events found._\n`
  return `## ${section}\n\n${events.map((event) => `- ${eventBadge(event)} ${event.summary}${event.evidence?.url ? ` ([evidence](${event.evidence.url}))` : ''}`).join('\n')}\n`
}

function renderMissingMarkdown(missing = []) {
  if (!missing.length) return '\n## Evidence gaps\n\nNone detected.\n'
  return `\n## Evidence gaps\n\n${missing.map((item) => `- ${item}`).join('\n')}\n`
}

function renderFollowUpsMarkdown(followUps = []) {
  if (!followUps.length) return '\n## Follow-ups\n\nNone detected.\n'
  return `\n## Follow-ups\n\n${followUps.map((number) => `- #${number}`).join('\n')}\n`
}

function issueEvent(issue, type, section, summary) {
  if (!issue) return null
  return {
    id: `${type}:${issue.number}`,
    type,
    section,
    summary,
    timestamp: issue.created_at || issue.createdAt || issue.updated_at || issue.updatedAt || null,
    source: 'github',
    evidenceStatus: 'durable',
    issue: issue.number,
    evidence: { kind: 'issue', number: issue.number, url: issue.html_url || issue.url },
  }
}

function commentEvents(comment) {
  const body = comment.body || ''
  const markers = extractCommentMarkers(body)
  const timestamp =
    comment.created_at || comment.createdAt || comment.updated_at || comment.updatedAt || null
  const evidence = { kind: 'comment', id: comment.id, url: comment.html_url || comment.url }
  const summaryText = summarize(body)
  const events = []
  if (markers.includes('agent-handover') || markers.includes('agentflow:role-pass')) {
    events.push(
      commentEvent(
        'phase.recorded',
        'Role timeline',
        `Role evidence recorded: ${summaryText}`,
        timestamp,
        evidence,
      ),
    )
  }
  if (
    markers.includes('agentflow:validation-summary') ||
    /\b(validation|test|tests)\b/i.test(body)
  ) {
    events.push(
      commentEvent(
        'validation.recorded',
        'Validation',
        `Validation recorded: ${summaryText}`,
        timestamp,
        evidence,
      ),
    )
  }
  if (
    markers.includes('agentflow:human-review-request') ||
    /\b(review|gate|finding)\b/i.test(body)
  ) {
    events.push(
      commentEvent(
        'review.finding',
        'Review/Gates',
        `Review/gate recorded: ${summaryText}`,
        timestamp,
        evidence,
      ),
    )
  }
  if (markers.includes('agentflow:follow-up-proposal') || /follow-up|follow up/i.test(body)) {
    const ref = body.match(/#(\d+)/)?.[1]
    events.push({
      ...commentEvent(
        'followup.created',
        'Follow-ups',
        `Follow-up recorded: ${summaryText}`,
        timestamp,
        evidence,
      ),
      issue: ref ? Number(ref) : undefined,
    })
  }
  if (/decision|decided|ADR/i.test(body)) {
    events.push(
      commentEvent(
        'decision.recorded',
        'Decisions',
        `Decision recorded: ${summaryText}`,
        timestamp,
        evidence,
      ),
    )
  }
  return events
}

function commentEvent(type, section, summary, timestamp, evidence) {
  return {
    id: `${type}:${evidence.id}:${summary.slice(0, 24)}`,
    type,
    section,
    summary,
    timestamp,
    source: 'github',
    evidenceStatus: 'durable',
    evidence,
  }
}

function pullRequestEvents(pr, commits, checks) {
  const events = []
  events.push({
    id: `pr.ready:${pr.number}`,
    type: 'pr.ready',
    section: 'PR readiness',
    summary: `PR #${pr.number} opened: ${pr.title || ''}`.trim(),
    timestamp: pr.created_at || pr.createdAt || null,
    source: 'github',
    evidenceStatus: 'durable',
    evidence: { kind: 'pr', number: pr.number, url: pr.html_url || pr.url },
  })
  if (pr.merged_at || pr.mergedAt) {
    events.push({
      id: `pr.merged:${pr.number}`,
      type: 'pr.merged',
      section: 'Outcome',
      summary: `PR #${pr.number} merged${pr.merge_commit_sha ? ` at ${pr.merge_commit_sha.slice(0, 7)}` : ''}`,
      timestamp: pr.merged_at || pr.mergedAt,
      source: 'github',
      evidenceStatus: 'durable',
      evidence: { kind: 'pr', number: pr.number, url: pr.html_url || pr.url },
    })
  }
  for (const check of checks) {
    events.push({
      id: `validation.recorded:${check.id || check.name}`,
      type: 'validation.recorded',
      section: 'Validation',
      summary: `Check ${check.name || check.context}: ${check.conclusion || check.state || check.status}`,
      timestamp: check.completed_at || check.updated_at || null,
      source: 'github',
      evidenceStatus: 'durable',
      evidence: { kind: 'check', url: check.html_url || check.target_url },
    })
  }
  return events
}

function missingReplayEvidence({ goal, events, pullRequests }) {
  const missing = []
  if (!goal?.body?.includes('## Acceptance criteria'))
    missing.push('Acceptance criteria section missing')
  if (!events.some((event) => event.type === 'validation.recorded'))
    missing.push('Validation evidence missing or inferred')
  if (!events.some((event) => event.type === 'review.finding'))
    missing.push('Review/gate evidence missing or inferred')
  if (!pullRequests.length) missing.push('PR evidence missing')
  return missing
}

function compareEvents(a, b) {
  if (!a.timestamp && !b.timestamp) return a.id.localeCompare(b.id)
  if (!a.timestamp) return 1
  if (!b.timestamp) return -1
  return new Date(a.timestamp) - new Date(b.timestamp) || a.id.localeCompare(b.id)
}

function goalSummary(goal = {}) {
  return {
    number: goal.number,
    title: goal.title || 'Untitled goal',
    url: goal.html_url || goal.url,
  }
}

function summarize(markdown = '') {
  return markdown
    .replace(/<!--.*?-->/gs, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 180)
}

function eventBadge(event) {
  return event.evidenceStatus === 'durable'
    ? '[durable]'
    : `[${event.evidenceStatus || 'inferred'}]`
}
