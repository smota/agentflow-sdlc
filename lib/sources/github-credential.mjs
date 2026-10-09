import { execFileSync } from 'node:child_process'

// Resolve the GitHub credential the host already holds. AgentFlow does not store credentials:
// it reads GITHUB_TOKEN, then GH_TOKEN, then asks a logged-in `gh`. No token means undefined,
// and the GitHub API decides (an unauthenticated write fails with "Requires authentication").
export function resolveGitHubToken({ env = process.env, execFile = execFileSync } = {}) {
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN']) {
    const value = env[name]?.trim()
    if (value) return value
  }
  try {
    const value = String(
      execFile('gh', ['auth', 'token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
      }),
    ).trim()
    return value || undefined
  } catch {
    // gh missing, logged out, or timed out: fall through without a token. The error is dropped
    // rather than rethrown so nothing from the child process reaches a log or error string.
    return undefined
  }
}
