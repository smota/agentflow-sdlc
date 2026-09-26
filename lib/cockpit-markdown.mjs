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
  const partOfMatch = text.match(/part of[^#]*(#\d+)/i)

  const blockedByMatches = [...text.matchAll(/(?:blocked[ _-]by|blocks):?\s*#?(\d+)/gi)].map(
    (match) => Number(match[1]),
  )
  const derivedFromMatches = [...text.matchAll(/derived[ _-]from:?\s*#?(\d+)/gi)].map((match) =>
    Number(match[1]),
  )
  const discoveredFromMatches = [...text.matchAll(/discovered[ _-]from:?\s*#?(\d+)/gi)].map(
    (match) => Number(match[1]),
  )

  return {
    issueRefs,
    followUps: [...new Set(followUps)],
    partOfIssue: partOfMatch ? Number(partOfMatch[1].slice(1)) : null,
    blockedBy: [...new Set(blockedByMatches)],
    derivedFrom: [...new Set(derivedFromMatches)],
    discoveredFrom: [...new Set(discoveredFromMatches)],
    pullRequests: pullRequests.map((pr) => ({ number: pr.number, url: pr.url, state: pr.state })),
  }
}

export function extractIssueTaxonomy({ body = '', comments = [], labels = [] } = {}) {
  const text = [body, ...comments.map((comment) => comment.body || '')].join('\n')
  const labelNames = labels
    .map((label) => (typeof label === 'string' ? label : label?.name))
    .filter(Boolean)

  const riskMatch = text.match(/(?:risk[ _-]level|risk):?\s*(low|medium|high|critical)/i)
  const pathMatch = text.match(
    /(?:path|assurance[ _-]path|workflow[ _-]classification|profile):?\s*(light|bounded|standard|high-assurance|exploratory)/i,
  )

  const riskLevel = riskMatch ? riskMatch[1].toLowerCase() : null
  const assurancePath = pathMatch ? pathMatch[1].toLowerCase() : null

  return {
    riskLevel,
    assurancePath,
    labels: labelNames,
  }
}

function safeGetSection(body, heading) {
  try {
    return extractSection(body, heading) || ''
  } catch {
    return ''
  }
}
