import { describe, expect, it } from 'vitest'
import { resolveGitHubToken } from '../sources/github-credential.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'

const SECRET = 'gho_hostcredentialforthetestonly0000000'

function fakeGh(result) {
  const calls = []
  const execFile = (command, args) => {
    calls.push([command, ...args])
    if (result instanceof Error) throw result
    return result
  }
  return { calls, execFile }
}

function fakeFetch(status, data) {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url, options })
    return { ok: status < 400, status, text: async () => JSON.stringify(data) }
  }
  return { requests, fetchImpl }
}

describe('host GitHub credential', () => {
  it('prefers an environment token and does not ask gh', () => {
    const gh = fakeGh('gh-token\n')
    expect(resolveGitHubToken({ env: { GH_TOKEN: 'from-env' }, execFile: gh.execFile })).toBe(
      'from-env',
    )
    expect(
      resolveGitHubToken({
        env: { GITHUB_TOKEN: 'github-token', GH_TOKEN: 'gh-env-token' },
        execFile: gh.execFile,
      }),
    ).toBe('github-token')
    expect(gh.calls).toEqual([])
  })

  it('uses the trimmed stdout of gh auth token when the environment has none', () => {
    const gh = fakeGh(`${SECRET}\n`)
    const token = resolveGitHubToken({
      env: { GITHUB_TOKEN: '', GH_TOKEN: '  ' },
      execFile: gh.execFile,
    })
    expect(token).toBe(SECRET)
    expect(gh.calls).toEqual([['gh', 'auth', 'token']])
  })

  it('yields no token when gh is missing, logged out, or prints nothing', () => {
    const missing = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
    const loggedOut = new Error(`Command failed: gh auth token ${SECRET}`)
    for (const result of [missing, loggedOut, '', '\n']) {
      expect(resolveGitHubToken({ env: {}, execFile: fakeGh(result).execFile })).toBeUndefined()
    }
  })

  it('sends the host token as a header and keeps it out of the error', async () => {
    const api = fakeFetch(401, { message: 'Bad credentials' })
    const medium = createGitHubMedium({
      repo: 'owner/repo',
      number: 1,
      token: resolveGitHubToken({ env: {}, execFile: fakeGh(`${SECRET}\n`).execFile }),
      fetchImpl: api.fetchImpl,
    })
    const error = await medium.readGoal().catch((caught) => caught)
    expect(api.requests[0].options.headers.Authorization).toBe(`Bearer ${SECRET}`)
    expect(error.message).toBe('Bad credentials')
    expect(`${error.message}\n${error.stack}\n${JSON.stringify(error)}`).not.toContain(SECRET)
  })

  it('still fails with Requires authentication when the host has no credential', async () => {
    const api = fakeFetch(401, { message: 'Requires authentication' })
    const medium = createGitHubMedium({
      repo: 'owner/repo',
      number: 1,
      token: resolveGitHubToken({ env: {}, execFile: fakeGh(new Error('not logged in')).execFile }),
      fetchImpl: api.fetchImpl,
    })
    await expect(medium.readGoal()).rejects.toThrow('Requires authentication')
    expect(api.requests[0].options.headers).not.toHaveProperty('Authorization')
  })
})
