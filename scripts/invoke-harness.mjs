import { spawn } from 'node:child_process'

export const QUOTA_PATTERNS = [
  /hit your weekly limit/i,
  /hit your session limit/i,
  /weekly limit/i,
  /rate limit/i,
  /insufficient_quota/i,
  /status code 429/i,
  /quota exceeded/i,
]

export function isQuotaError(output = '') {
  return QUOTA_PATTERNS.some((p) => p.test(output))
}

export async function invokeHarness({
  executable,
  args = [],
  stdinContent = null,
  timeoutMs = 60000,
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const startTime = Date.now()
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    if (child.stdin) {
      if (stdinContent !== null) {
        child.stdin.write(stdinContent)
      }
      child.stdin.end()
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      const executionTimeMs = Date.now() - startTime
      resolve({
        ok: false,
        disposition: 'error',
        error: err.message,
        exitCode: -1,
        stdout,
        stderr,
        executionTimeMs,
      })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const executionTimeMs = Date.now() - startTime

      if (timedOut) {
        return resolve({
          ok: false,
          disposition: 'timeout',
          error: `execution timed out after ${timeoutMs}ms`,
          exitCode: code,
          stdout,
          stderr,
          executionTimeMs,
        })
      }

      const combinedOutput = stdout + '\n' + stderr
      if (isQuotaError(combinedOutput)) {
        return resolve({
          ok: false,
          disposition: 'quota_exhausted',
          error: 'harness quota or rate limit exceeded',
          exitCode: code,
          stdout,
          stderr,
          executionTimeMs,
        })
      }

      const ok = code === 0
      return resolve({
        ok,
        disposition: ok ? 'success' : 'error',
        exitCode: code,
        stdout,
        stderr,
        executionTimeMs,
      })
    })
  })
}
