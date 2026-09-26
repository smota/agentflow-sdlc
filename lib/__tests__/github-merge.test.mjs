import { describe, it, expect } from 'vitest'
import { createGitHubMergeAdapter } from '../providers/github-merge.mjs'
import { operationDigest } from '../core/delegation-grant.mjs'

const head = 'a'.repeat(40)
const operation = () => ({
  id: 'merge1',
  planDigest: 'b'.repeat(64),
  policyDigest: 'c'.repeat(64),
  candidateDigest: 'd'.repeat(64),
  workspaceDigest: 'e'.repeat(64),
  repository: 'owner/repo',
  base: 'development',
  delegate: 'codex',
  action: 'merge',
  paths: ['lib/file.mjs'],
  capabilities: ['merge'],
  checks: [],
  review: {},
  arguments: { prNumber: 123, headSha: head, mergeMethod: 'squash' },
})
const pull = () => ({
  number: 123,
  state: 'open',
  head: { sha: head },
  base: { ref: 'development', repo: { full_name: 'owner/repo' } },
  merged: false,
})
const evidence = (op) => [
  { id: op.id, payloadDigest: operationDigest(op) },
  { operation: op, operationDigest: operationDigest(op) },
]

describe('conditional GitHub merge adapter', () => {
  it('sends the exact head condition and never treats request return as confirmation', async () => {
    const calls = []
    const adapter = createGitHubMergeAdapter({
      client: {
        request: async (path, opts) => {
          calls.push({ path, opts })
          return opts ? { merged: true } : pull()
        },
      },
    })
    expect(await adapter.dispatch(operation())).toEqual({ state: 'requires-reconciliation' })
    expect(calls[1]).toEqual({
      path: '/repos/owner/repo/pulls/123/merge',
      opts: { method: 'PUT', body: { sha: head, merge_method: 'squash' } },
    })
  })
  it.each(['head', 'base'])('rejects a changed %s before sending merge', async (field) => {
    const pr = pull()
    if (field === 'head') pr.head.sha = 'f'.repeat(40)
    else pr.base.ref = 'main'
    let calls = 0
    const adapter = createGitHubMergeAdapter({
      client: {
        request: async () => {
          calls++
          return pr
        },
      },
    })
    await expect(adapter.dispatch(operation())).rejects.toThrow('changed')
    expect(calls).toBe(1)
  })
  it('confirms only a bound merged pull request observed from the provider', async () => {
    const pr = pull(),
      op = operation()
    const adapter = createGitHubMergeAdapter({ client: { request: async () => pr } })
    expect(await adapter.reconcile(...evidence(op))).toEqual({ state: 'unknown' })
    Object.assign(pr, {
      merged: true,
      merged_at: '2026-09-25T20:00:00Z',
      merge_commit_sha: 'f'.repeat(40),
    })
    expect(await adapter.reconcile(...evidence(op))).toMatchObject({
      verified: true,
      state: 'confirmed',
      operationId: op.id,
      candidateDigest: op.candidateDigest,
    })
    pr.head.sha = 'c'.repeat(40)
    expect(await adapter.reconcile(...evidence(op))).toEqual({ state: 'unknown' })
  })
  it('does not retry after a lost merge response', async () => {
    let calls = 0
    const adapter = createGitHubMergeAdapter({
      client: {
        request: async (_path, opts) => {
          calls++
          if (opts) throw new Error('lost response')
          return pull()
        },
      },
    })
    await expect(adapter.dispatch(operation())).rejects.toThrow('lost response')
    expect(calls).toBe(2)
  })
})
