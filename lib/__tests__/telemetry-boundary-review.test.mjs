import { describe, expect, it } from 'vitest'
import { createGitHubApiCli } from '../sources/github-api-cli.mjs'
import { createGitHubClient } from '../sources/github-client.mjs'
import { rejectForbiddenTelemetryFields } from '../cockpit-security.mjs'

describe('independent S1 boundary acceptance', () => {
  it('counts actual CLI stdout bytes and leaves unobserved HTTP status unknown', async () => {
    const observations = []
    const stdout = '  {"value":"é"}\r\n'
    const client = createGitHubApiCli({
      execFile: () => stdout,
      observer: (event) => observations.push(event),
    })
    expect(await client.request('/repos/example/project')).toEqual({ value: 'é' })
    expect(observations).toHaveLength(1)
    expect(observations[0].responseBytes).toBe(Buffer.byteLength(stdout, 'utf8'))
    expect(observations[0].status).toBeNull()
  })

  it('preserves source results when observation fails', async () => {
    const observer = () => {
      throw new Error('observer unavailable')
    }
    const cli = createGitHubApiCli({ execFile: () => '{"ok":true}', observer })
    const http = createGitHubClient({
      observer,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }),
    })
    await expect(cli.request('/repos/example/project')).resolves.toEqual({ ok: true })
    await expect(http.request('/repos/example/project')).resolves.toEqual({ ok: true })
  })

  it('contains rejected asynchronous observers without changing source results', async () => {
    const observer = async () => {
      throw new Error('private observer detail')
    }
    const cli = createGitHubApiCli({ execFile: () => '{"ok":true}', observer })
    const http = createGitHubClient({
      observer,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }),
    })
    await expect(cli.request('/repos/example/project')).resolves.toEqual({ ok: true })
    await expect(http.request('/repos/example/project')).resolves.toEqual({ ok: true })
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('records HTTP response bytes before parsing and never records body or credentials', async () => {
    const observations = []
    const raw = ' {"value":"PRIVATE_BODY"}\n'
    const client = createGitHubClient({
      token: 'PRIVATE_TOKEN',
      observer: (event) => observations.push(event),
      fetchImpl: async () => ({ ok: true, status: 201, text: async () => raw }),
    })
    await client.request('/repos/private/name', { method: 'POST', body: { value: 'é' } })
    expect(observations[0].responseBytes).toBe(Buffer.byteLength(raw))
    expect(observations[0].requestBytes).toBe(Buffer.byteLength(JSON.stringify({ value: 'é' })))
    expect(observations[0].status).toBe(201)
    expect(JSON.stringify(observations)).not.toMatch(/PRIVATE_BODY|PRIVATE_TOKEN|private\/name/)
  })

  it('does not export arbitrary transport exception names as labels', async () => {
    const observations = []
    const error = new Error('PRIVATE_MESSAGE')
    error.name = 'PRIVATE_TRANSPORT_NAME'
    const client = createGitHubClient({
      observer: (event) => observations.push(event),
      fetchImpl: async () => {
        throw error
      },
    })
    await expect(client.request('/repos/example/project')).rejects.toBe(error)
    expect(observations[0].responseBytes).toBeNull()
    expect(JSON.stringify(observations)).not.toMatch(/PRIVATE_MESSAGE|PRIVATE_TRANSPORT_NAME/)
  })

  it('does not whitelist secret-bearing token keys merely because they contain numbers', () => {
    for (const value of [123456, NaN, Infinity, -1]) {
      expect(rejectForbiddenTelemetryFields({ secretToken: value })).toContain('secretToken')
      expect(rejectForbiddenTelemetryFields({ passwordToken: value })).toContain('passwordToken')
    }
  })
})
