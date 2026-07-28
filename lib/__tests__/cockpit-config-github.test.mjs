import { describe, expect, it } from 'vitest'
import { loadCockpitConfig, validateCockpitConfig } from '../cockpit-config.mjs'
import { createGitHubClient, loadRepositoryPermission } from '../cockpit-github.mjs'

describe('cockpit config', () => {
  it('requires OAuth/session config for remote mode', () => {
    const config = loadCockpitConfig({
      COCKPIT_REMOTE: 'true',
      AGENTFLOW_REPOSITORIES: 'smota/agentflow-sdlc',
    })
    expect(validateCockpitConfig(config).errors).toEqual(
      expect.arrayContaining([
        'GITHUB_CLIENT_ID required for remote mode',
        'GITHUB_CLIENT_SECRET required for remote mode',
      ]),
    )
  })

  it('accepts local read mode with registered repositories', () => {
    const result = validateCockpitConfig(
      loadCockpitConfig({ AGENTFLOW_REPOSITORIES: 'smota/agentflow-sdlc' }),
    )
    expect(result.ok).toBe(true)
  })
})

describe('cockpit github client', () => {
  it('sends bearer token and parses repo permission', async () => {
    const calls = []
    const client = createGitHubClient({
      token: 'test-token',
      fetchImpl: async (url, options) => {
        calls.push({ url, options })
        return response({ permissions: { pull: true, push: false } })
      },
    })
    await expect(loadRepositoryPermission({ client, repo: 'smota/agentflow-sdlc' })).resolves.toBe(
      'read',
    )
    expect(calls[0].options.headers.Authorization).toBe('Bearer test-token')
  })
})

function response(data, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(data),
  }
}
