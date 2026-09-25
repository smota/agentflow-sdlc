import { emitObservation } from '../observability/observer.mjs'

export class GitHubApiError extends Error {
  constructor(message, { status, path } = {}) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
    this.path = path
  }
}

function query(params = {}) {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  )
  const value = search.toString()
  return value ? `?${value}` : ''
}

export function createGitHubClient({
  token,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = 'https://api.github.com',
  observer,
} = {}) {
  if (!fetchImpl) throw new Error('fetch implementation required')
  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const start = Date.now()
    const requestBodyString = body === undefined ? undefined : JSON.stringify(body)
    const requestBytes = requestBodyString ? Buffer.byteLength(requestBodyString, 'utf8') : 0
    let responseBytes = null
    let status = null
    let errorType = null
    try {
      const response = await fetchImpl(`${apiBaseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        ...(requestBodyString === undefined ? {} : { body: requestBodyString }),
      })
      status = response.status
      const text = await response.text()
      responseBytes = Buffer.byteLength(text, 'utf8')
      const data = text ? JSON.parse(text) : null
      if (!response.ok) {
        errorType = 'GitHubApiError'
        throw new GitHubApiError(data?.message || `GitHub API request failed: ${response.status}`, {
          status: response.status,
          path,
        })
      }
      return data
    } catch (error) {
      if (!errorType) errorType = 'TransportError'
      throw error
    } finally {
      const duration = Date.now() - start
      if (typeof observer === 'function') {
        try {
          emitObservation(observer, {
            kind: 'github_client_request',
            method,
            status,
            requestBytes,
            responseBytes,
            duration,
            errorType,
          })
        } catch {}
      }
    }
  }

  return {
    request,
    currentUser: () => request('/user'),
    orgs: () => request('/user/orgs'),
    repo: (repo) => request(`/repos/${repo}`),
    issues: (repo, params = {}) => request(`/repos/${repo}/issues${query(params)}`),
    issue: (repo, number) => request(`/repos/${repo}/issues/${number}`),
    issueComments: (repo, number) =>
      request(`/repos/${repo}/issues/${number}/comments?per_page=100`),
    pullRequests: (repo, params = {}) => request(`/repos/${repo}/pulls${query(params)}`),
    pullRequest: (repo, number) => request(`/repos/${repo}/pulls/${number}`),
    pullRequestCommits: (repo, number) =>
      request(`/repos/${repo}/pulls/${number}/commits?per_page=100`),
    commitCheckRuns: (repo, ref) =>
      request(`/repos/${repo}/commits/${ref}/check-runs`, {
        headers: { Accept: 'application/vnd.github+json' },
      }),
    createIssueComment: (repo, number, body) =>
      request(`/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: { body } }),
    createIssue: (repo, body) => request(`/repos/${repo}/issues`, { method: 'POST', body }),
  }
}

export async function loadRepositoryPermission({ client, repo }) {
  const data = await client.repo(repo)
  const permissions = data.permissions || {}
  if (permissions.admin) return 'admin'
  if (permissions.maintain) return 'maintain'
  if (permissions.push) return 'write'
  if (permissions.triage) return 'triage'
  if (permissions.pull) return 'read'
  return 'none'
}
