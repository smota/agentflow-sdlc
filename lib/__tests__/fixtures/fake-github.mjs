// In-memory GitHub REST fake for the source adapter tests (#581). No network. It implements the
// client methods the REST adapter uses, with monotonically increasing comment ids, an
// updated_at that moves on every write (so a test can prove revisions ignore it), and a per-call
// identity from as(login).
export function createFakeGitHub({ repo = 'smota/agentflow-fake', login = 'agentflow-bot' } = {}) {
  const issues = new Map()
  const comments = []
  const events = []
  let nextNumber = 1
  let nextCommentId = 1
  let tick = 0
  const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString()

  const shape = (issue) => ({
    ...issue,
    labels: issue.labels.map((name) => ({ name })),
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

  function clientFor(actor) {
    return {
      async issue(_repo, number) {
        return shape(find(number))
      },
      async pullRequest(_repo, number) {
        return shape(find(number))
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
        comments.push(comment)
        issue.updated_at = stamp()
        const { issue: _owner, ...visible } = comment
        return visible
      },
    }
  }

  const fake = {
    repo,
    client: clientFor(login),
    as: clientFor,
    comments,
    events,
    // Returns the issue number. Fields: title, body, labels (names), state, merged.
    seedIssue({
      title = 'Fake issue',
      body = '',
      labels = [],
      state = 'open',
      merged = false,
      pullRequest = false,
    } = {}) {
      const number = nextNumber++
      issues.set(number, {
        number,
        title,
        body,
        labels: [...labels],
        state,
        user: { login },
        html_url: `https://github.test/${repo}/issues/${number}`,
        updated_at: stamp(),
        ...(pullRequest || merged ? { pull_request: { merged_at: merged ? stamp() : null } } : {}),
      })
      return number
    },
    editIssue(number, fields) {
      Object.assign(find(number), fields, { updated_at: stamp() })
    },
  }
  return fake
}
