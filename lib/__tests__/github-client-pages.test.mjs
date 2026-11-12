import { describe, expect, it } from 'vitest'
import { createGitHubClient } from '../sources/github-client.mjs'

function client(pageSizes) {
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(url)
    const page = Number(new URL(url).searchParams.get('page'))
    const size = pageSizes(page)
    return { ok: true, status: 200, text: async () => JSON.stringify(Array(size).fill({ n: 1 })) }
  }
  return { api: createGitHubClient({ fetchImpl }), urls }
}

describe('github client pagination', () => {
  it('stops at a short page', async () => {
    const { api, urls } = client((page) => (page === 1 ? 100 : 7))
    expect(await api.issueComments('o/r', 1, { all: true })).toHaveLength(107)
    expect(urls).toHaveLength(2)
  })

  it('reads one more page when the total is an exact multiple of the page size', async () => {
    const { api, urls } = client((page) => (page <= 2 ? 100 : 0))
    expect(await api.issues('o/r', { all: true, state: 'open' })).toHaveLength(200)
    expect(urls).toHaveLength(3)
  })

  it('refuses a truncated read at the page cap', async () => {
    const { api, urls } = client(() => 100)
    await expect(api.issueComments('o/r', 1, { all: true })).rejects.toThrow('truncated')
    expect(urls).toHaveLength(100)
  })

  it('leaves the default single request alone', async () => {
    const { api, urls } = client(() => 100)
    expect(await api.issueComments('o/r', 1)).toHaveLength(100)
    expect(urls).toHaveLength(1)
  })
})
