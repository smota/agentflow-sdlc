import { extractIssueRelationships } from './cockpit-markdown.mjs'
import { buildGoalStory } from './cockpit-replay.mjs'

export async function loadGoalStoryFromGitHub({
  client,
  repo,
  issueNumber,
  pullRequestNumber,
} = {}) {
  if (!client) throw new Error('GitHub client required')
  if (!repo) throw new Error('repo required')
  const goal = issueNumber ? await client.issue(repo, issueNumber) : null
  const comments = issueNumber
    ? await loadAllPages(() => client.issueComments(repo, issueNumber))
    : []
  const relationships = extractIssueRelationships({ body: goal?.body || '', comments })
  const childNumbers = relationships.issueRefs
    .filter((number) => number !== issueNumber)
    .slice(0, 50)
  const childIssues = await Promise.all(
    childNumbers.map((number) => client.issue(repo, number).catch(() => null)),
  ).then((items) => items.filter(Boolean))
  const pullRequests = pullRequestNumber
    ? [await client.pullRequest(repo, pullRequestNumber)]
    : await relatedPullRequests({ client, repo, issueNumber, goal })
  const commits = await loadPullRequestCommits({ client, repo, pullRequests })
  const checks = await loadCommitChecks({ client, repo, commits })
  return buildGoalStory({ goal, comments, pullRequests, commits, checks, childIssues })
}

export async function relatedPullRequests({ client, repo, issueNumber, goal }) {
  const pulls = await client.pullRequests(repo, { state: 'all', per_page: 100 })
  return pulls.filter((pr) => {
    const text = `${pr.title || ''}\n${pr.body || ''}`
    return (
      text.includes(`#${issueNumber}`) ||
      text.includes(`/${issueNumber}`) ||
      (goal?.title && text.includes(goal.title))
    )
  })
}

async function loadPullRequestCommits({ client, repo, pullRequests }) {
  const groups = await Promise.all(
    pullRequests.map((pr) => client.pullRequestCommits(repo, pr.number).catch(() => [])),
  )
  return groups.flat()
}

async function loadCommitChecks({ client, repo, commits }) {
  const refs = commits
    .map((commit) => commit.sha)
    .filter(Boolean)
    .slice(-10)
  const groups = await Promise.all(
    refs.map((ref) =>
      client
        .commitCheckRuns(repo, ref)
        .then((data) => data.check_runs || [])
        .catch(() => []),
    ),
  )
  return groups.flat()
}

async function loadAllPages(loader) {
  // Current GitHub client helpers request per_page=100. Keep wrapper so callers do not couple to that detail.
  return loader()
}
