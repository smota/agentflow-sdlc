import { describe, it, expect } from 'vitest'
import { createGitHubDeliveryActions } from '../providers/github-delivery-actions.mjs'
import { operationDigest } from '../core/delegation-grant.mjs'

const operation = {
  id: 'create-one',
  action: 'pr:create',
  planDigest: 'a'.repeat(64),
  policyDigest: 'b'.repeat(64),
  repository: 'test/repo',
  base: 'main',
  delegate: 'codex',
  paths: ['src/a.js'],
  capabilities: ['pr:create'],
  candidateDigest: 'c'.repeat(64),
  workspaceDigest: 'd'.repeat(64),
  checks: [],
  review: {},
  arguments: {
    head: 'work/one',
    headSha: 'e'.repeat(40),
    title: 'Scoped change',
    body: 'Closes #1',
  },
}
function fixture(files = [{ filename: 'src/a.js' }]) {
  let prs = [],
    writes = 0
  const client = {
    request: async (path, options = {}) => {
      if (path.includes('/compare/'))
        return { files, total_commits: 1, commits: [{ sha: operation.arguments.headSha }] }
      if (path.includes('/git/ref/heads/')) return { object: { sha: operation.arguments.headSha } }
      if (options.method === 'POST') {
        writes++
        prs.push({
          ...options.body,
          number: 1,
          state: 'open',
          updated_at: '2026-09-28',
          head: { ref: 'work/one', sha: operation.arguments.headSha },
          base: { ref: 'main', repo: { full_name: 'test/repo' } },
        })
        return prs[0]
      }
      return prs
    },
  }
  return { adapter: createGitHubDeliveryActions({ client }), writes: () => writes }
}
describe('governed GitHub delivery action port', () => {
  it('creates one draft and independently reconciles the exact remote content', async () => {
    const f = fixture()
    await f.adapter.dispatch(operation)
    await f.adapter.dispatch(operation)
    expect(f.writes()).toBe(1)
    expect(
      await f.adapter.reconcile(
        { id: operation.id, payloadDigest: operationDigest(operation) },
        { operation, operationDigest: operationDigest(operation) },
      ),
    ).toMatchObject({ state: 'confirmed', verified: true })
  })
  it('refuses undeclared changed paths and rename source paths before effects', async () => {
    for (const files of [
      [{ filename: 'secret.js' }],
      [{ filename: 'src/a.js', previous_filename: 'private.js' }],
    ]) {
      const f = fixture(files)
      await expect(f.adapter.dispatch(operation)).rejects.toThrow(/scope/)
      expect(f.writes()).toBe(0)
    }
  })
  it('fails closed when changed-path enumeration is truncated', async () => {
    const f = fixture(Array.from({ length: 300 }, () => ({ filename: 'src/a.js' })))
    await expect(f.adapter.dispatch(operation)).rejects.toThrow(/Complete/)
    expect(f.writes()).toBe(0)
  })
})
