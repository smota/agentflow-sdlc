import { COCKPIT_COMMENT_MARKERS } from './cockpit-domain.mjs'
import { extractSection } from './markdown-sections.mjs'

export function extractAgentFlowIssueSections(body = '') {
  const headings = [
    'Background & Problem Statement',
    'Proposed Solution',
    'Requirements',
    'Technical Design',
    'Acceptance criteria',
    'Open questions',
    'Feature Tracking',
    'Test plan',
    'Workflow classification',
  ]
  return Object.fromEntries(headings.map((heading) => [heading, safeGetSection(body, heading)]))
}

export function extractCommentMarkers(body = '') {
  const markerRegex = /<!--\s*([^>]+?)\s*-->/g
  return [...body.matchAll(markerRegex)].map((match) => match[1].trim())
}

export function classifyCommentLane(comment = {}) {
  const body = comment.body || ''
  const markers = extractCommentMarkers(body)
  if (markers.includes(COCKPIT_COMMENT_MARKERS.workflowStatus)) return 'Workflow Status'
  if (markers.includes(COCKPIT_COMMENT_MARKERS.handover)) return 'Handover'
  if (markers.includes(COCKPIT_COMMENT_MARKERS.humanReviewRequest)) return 'Review Findings'
  if (markers.includes(COCKPIT_COMMENT_MARKERS.validationSummary)) return 'Validation'
  if (markers.includes(COCKPIT_COMMENT_MARKERS.followUpProposal)) return 'Follow-ups'
  if (/clarification|question answered/i.test(body)) return 'Clarifications'
  if (/decision|adr|decided/i.test(body)) return 'Decisions'
  return 'Workflow Status'
}

export function groupCommentsByLane(comments = []) {
  return comments.reduce((lanes, comment) => {
    const lane = classifyCommentLane(comment)
    lanes[lane] ??= []
    lanes[lane].push(comment)
    return lanes
  }, {})
}

export function extractIssueRelationships({ body = '', comments = [], pullRequests = [] } = {}) {
  const text = [body, ...comments.map((comment) => comment.body || '')].join('\n')
  const issueRefs = [...new Set([...text.matchAll(/#(\d+)/g)].map((match) => Number(match[1])))]
  const followUps = [...text.matchAll(/follow-up[^#]*(#\d+)/gi)].map((match) =>
    Number(match[1].slice(1)),
  )
  return {
    issueRefs,
    followUps: [...new Set(followUps)],
    pullRequests: pullRequests.map((pr) => ({ number: pr.number, url: pr.url, state: pr.state })),
  }
}

function safeGetSection(body, heading) {
  try {
    return extractSection(body, heading) || ''
  } catch {
    return ''
  }
}
