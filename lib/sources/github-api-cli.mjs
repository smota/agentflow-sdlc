import { execFileSync } from 'node:child_process'
import { emitObservation } from '../observability/observer.mjs'

// Reuses gh's own authentication without reading or returning credentials.
export function createGitHubApiCli({ executable = 'gh', execFile = execFileSync, observer } = {}) {
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

      const requestBodyString = body === undefined ? undefined : JSON.stringify(body)
      const requestBytes = requestBodyString ? Buffer.byteLength(requestBodyString, 'utf8') : 0

      if (requestBodyString !== undefined) args.push('--input', '-')

      const start = Date.now()
      let status = null
      let responseBytes = null
      let errorType = null

      try {
        const result = execFile(executable, args, {
          input: requestBodyString,
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        responseBytes = Buffer.byteLength(result, 'utf8')
        const resultString = result.trim()
        return resultString ? JSON.parse(resultString) : null
      } catch (cause) {
        errorType = 'GitHubCliError'
        const error = new Error(`GitHub API ${method} failed; external outcome may be unknown`)
        const match = String(cause.stderr ?? '').match(/HTTP (\d{3})/)
        error.status = match ? Number(match[1]) : null
        status = error.status
        throw error
      } finally {
        const duration = Date.now() - start
        if (typeof observer === 'function') {
          try {
            emitObservation(observer, {
              kind: 'github_cli_request',
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
    },
  }
}
