import { classifyCommentLane, extractIssueRelationships } from './cockpit-markdown.mjs'

export function buildCockpitGraph({
  issue,
  comments = [],
  pullRequests = [],
  commits = [],
  followUps = [],
} = {}) {
  const nodes = []
  const edges = []
  const issueId = `issue:${issue.number}`
  nodes.push(node(issueId, 'issue', `#${issue.number} ${issue.title}`, issue.html_url || issue.url))

  const relationships = extractIssueRelationships({
    body: issue.body || '',
    comments,
    pullRequests,
  })
  for (const ref of relationships.issueRefs.filter((number) => number !== issue.number)) {
    const id = `issue:${ref}`
    nodes.push(node(id, 'linked-issue', `#${ref}`))
    edges.push(edge(issueId, id, 'references'))
  }

  for (const comment of comments) {
    const lane = classifyCommentLane(comment)
    const id = `comment:${comment.id}`
    nodes.push(
      node(id, lane.toLowerCase().replaceAll(' ', '-'), lane, comment.html_url || comment.url),
    )
    edges.push(edge(issueId, id, lane === 'Follow-ups' ? 'spawned-follow-up' : 'recorded-by'))
  }

  for (const pr of pullRequests) {
    const id = `pr:${pr.number}`
    nodes.push(node(id, 'pr', `PR #${pr.number} ${pr.title || ''}`.trim(), pr.html_url || pr.url))
    edges.push(
      edge(id, issueId, pr.merged_at || pr.mergedAt ? 'closes-or-implements' : 'implements'),
    )
  }

  for (const commit of commits) {
    const id = `commit:${commit.sha}`
    nodes.push(node(id, 'commit', (commit.sha || '').slice(0, 7), commit.html_url || commit.url))
    for (const pr of pullRequests) edges.push(edge(`pr:${pr.number}`, id, 'contains'))
  }

  for (const number of [...new Set([...relationships.followUps, ...followUps])]) {
    const id = `issue:${number}`
    nodes.push(node(id, 'follow-up', `#${number}`))
    edges.push(edge(issueId, id, 'spawned-follow-up'))
  }

  return dedupeGraph({ nodes, edges })
}

function node(id, type, label, url) {
  return { id, type, label, url }
}

function edge(from, to, type) {
  return { from, to, type }
}

function dedupeGraph(graph) {
  return {
    nodes: [...new Map(graph.nodes.map((item) => [item.id, item])).values()],
    edges: [
      ...new Map(
        graph.edges.map((item) => [`${item.from}:${item.type}:${item.to}`, item]),
      ).values(),
    ],
  }
}
