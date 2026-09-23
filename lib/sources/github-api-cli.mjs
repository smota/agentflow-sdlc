import { execFileSync } from 'node:child_process'

// Reuses gh's own authentication without reading or returning credentials.
export function createGitHubApiCli({ executable = 'gh', execFile = execFileSync } = {}) {
  return {
    async request(path, { method = 'GET', body } = {}) {
      if (!path.startsWith('/repos/'))
        throw new Error('Only repository-scoped API requests are supported')
      const args = [
        'api',
        path,
        '--method',
        method,
        '--header',
        'Accept: application/vnd.github+json',
      ]
      if (body !== undefined) args.push('--input', '-')
      try {
        const result = execFile(executable, args, {
          input: body === undefined ? undefined : JSON.stringify(body),
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        return result.trim() ? JSON.parse(result) : null
      } catch (cause) {
        const error = new Error(`GitHub API ${method} failed; external outcome may be unknown`)
        const match = String(cause.stderr ?? '').match(/HTTP (\d{3})/)
        error.status = match ? Number(match[1]) : null
        throw error
      }
    },
  }
}
