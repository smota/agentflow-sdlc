// In-memory GitHub REST fake for the source adapter tests (#581). No network. It implements the
// client methods the REST adapter uses, with monotonically increasing comment ids, an
// updated_at that moves on every write (so a test can prove revisions ignore it), and a per-call
// identity from as(login). Assignee writes record GitHub-shaped issue events; reassign() plays a
// person changing the assignee in the GitHub UI.
export function createFakeGitHub({ repo = 'smota/agentflow-fake', login = 'agentflow-bot' } = {}) {
  const issues = new Map()
  const comments = []
  const events = []
  let nextNumber = 1
  let nextCommentId = 1
  let nextEventId = 1
  let tick = 0
  const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString()

  const shape = (issue) => ({
    ...issue,
    labels: issue.labels.map((name) => ({ name })),
    assignees: issue.assignees.map((login) => ({ login })),
    pull_request: issue.pull_request ? { ...issue.pull_request } : undefined,
  })
  const find = (number) => {
    const issue = issues.get(Number(number))
    if (!issue) {
      const error = new Error('Not Found')
      error.status = 404
      throw error
    }
    return issue
  }
  const page = (rows, params = {}) => {
    const size = Number(params.per_page ?? 30)
    const index = Number(params.page ?? 1)
    return rows.slice((index - 1) * size, index * size)
  }

  const same = (a, b) => a.toLowerCase() === b.toLowerCase()
  function recordEvent(issue, event, assignee, actor) {
    events.push({
      id: nextEventId++,
      issue: issue.number,
      event,
      actor: { login: actor },
      assignee: { login: assignee },
      created_at: stamp(),
    })
  }
  function assign(number, logins, actor) {
    const issue = find(number)
    for (const login of logins) {
      if (issue.assignees.some((current) => same(current, login))) continue
      issue.assignees.push(login)
      recordEvent(issue, 'assigned', login, actor)
    }
    return shape(issue)
  }
  function unassign(number, logins, actor) {
    const issue = find(number)
    for (const login of logins) {
      const index = issue.assignees.findIndex((current) => same(current, login))
      if (index === -1) continue
      const [removed] = issue.assignees.splice(index, 1)
      recordEvent(issue, 'unassigned', removed, actor)
    }
    return shape(issue)
  }

  function clientFor(actor) {
    return {
      async currentUser() {
        return { login: actor }
      },
      async issue(_repo, number) {
        return shape(find(number))
      },
      // GitHub's /pulls/{n}: `merged` and `head.sha` are only on this resource, not on the issue.
      async pullRequest(_repo, number) {
        const issue = find(number)
        return {
          ...shape(issue),
          // editIssue(n, { pullMerged: false }) makes the two resources disagree.
          merged: issue.pullMerged ?? Boolean(issue.pull_request?.merged_at),
          head: { sha: issue.headSha },
          base: { ref: issue.baseRef ?? 'development' },
        }
      },
      async issues(_repo, { all = false, state = 'open', per_page, page: index } = {}) {
        const rows = [...issues.values()]
          .filter((issue) => state === 'all' || issue.state === state)
          .map(shape)
        if (!all) return page(rows, { per_page, page: index })
        return rows
      },
      async issueComments(_repo, number, { all = false } = {}) {
        find(number)
        const rows = comments.filter((comment) => comment.issue === Number(number))
        return (all ? rows : rows.slice(0, 100)).map(({ issue, ...comment }) => ({ ...comment }))
      },
      async createIssueComment(_repo, number, body) {
        const issue = find(number)
        const comment = {
          id: nextCommentId++,
          issue: issue.number,
          body,
          user: { login: actor },
          created_at: stamp(),
          html_url: `https://github.test/${repo}/issues/${issue.number}#issuecomment-${nextCommentId - 1}`,
        }
        comment.updated_at = comment.created_at
        comments.push(comment)
        issue.updated_at = stamp()
        const { issue: _owner, ...visible } = comment
        return visible
      },
      async issueEvents(_repo, number) {
        find(number)
        return events
          .filter((event) => event.issue === Number(number))
          .map(({ issue, ...event }) => structuredClone(event))
      },
      async addAssignees(_repo, number, logins) {
        return assign(number, logins, actor)
      },
      async removeAssignees(_repo, number, logins) {
        return unassign(number, logins, actor)
      },
    }
  }

  const fake = {
    repo,
    client: clientFor(login),
    as: clientFor,
    comments,
    events,
    // Returns the issue number. Fields: title, body, labels (names), state, merged, headSha.
    seedIssue({
      title = 'Fake issue',
      body = '',
      labels = [],
      state = 'open',
      merged = false,
      pullRequest = false,
      headSha = undefined,
    } = {}) {
      const number = nextNumber++
      issues.set(number, {
        number,
        title,
        body,
        labels: [...labels],
        assignees: [],
        state,
        user: { login },
        ...(headSha ? { headSha } : {}),
        html_url: `https://github.test/${repo}/issues/${number}`,
        updated_at: stamp(),
        ...(pullRequest || merged ? { pull_request: { merged_at: merged ? stamp() : null } } : {}),
      })
      return number
    },
    // A collaborator with write access edits a comment; GitHub keeps the author and moves updated_at.
    editComment(id, body) {
      const comment = comments.find((item) => item.id === id)
      comment.body = body
      comment.updated_at = stamp()
    },
    // A person replaces the assignees in the GitHub UI.
    reassign(number, login, actor) {
      unassign(number, [...find(number).assignees], actor)
      if (login) assign(number, [login], actor)
    },
    assignees: (number) => [...find(number).assignees],
    editIssue(number, fields) {
      Object.assign(find(number), fields, { updated_at: stamp() })
    },
  }
  return fake
}
