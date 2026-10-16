import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadConfiguredRunSource,
  readRunConfiguration,
} from '../application/configured-run-source.mjs'
import { createFileRunStore } from '../sources/run-store.mjs'
import { createGitHubRunStore, planGitHubCoordination } from '../sources/github-run-store.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import { fakeGitHub } from './github-run-store.fixture.mjs'
const roots = []
const root = () => {
  const value = mkdtempSync(join(tmpdir(), 'configured-source-'))
  roots.push(value)
  return value
}
afterEach(() => roots.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true })))
const configure = (path, source, file = 'agent-workflow.config.json') =>
  writeFileSync(
    join(path, file),
    JSON.stringify({ version: 1, delivery: { source, candidate: { inputs: [] } } }),
  )
const started = () =>
  createRunEvent({
    id: 'existing-start',
    timestamp: '2026-10-15T12:00:00.000Z',
    runId: 'existing',
    kind: 'started',
    payload: {
      goalRef: 'issue:521',
      owner: 'existing-writer',
      profile: 'standard',
      boundary: 'mutate-worktree',
    },
  })

describe('configured run source observation', () => {
  it('does not initialize a missing local run or create scratch history', async () => {
    const path = root()
    configure(path, { kind: 'local-preview' })
    const loaded = await loadConfiguredRunSource({ root: path, runId: 'existing' })
    expect(loaded.status).toBe('missing-run')
    expect(loaded.state).toBe(null)
    expect(existsSync(join(path, '.agent-runs'))).toBe(false)
    expect(loaded.store.append).toBeUndefined()
  })
  it('uses canonical unified source over stale legacy configuration', async () => {
    const path = root()
    configure(path, { kind: 'local-preview' })
    configure(
      path,
      { kind: 'github', repo: 'test/repo', branch: 'existing-state' },
      'agentflow.config.json',
    )
    const fake = fakeGitHub()
    const loaded = await loadConfiguredRunSource({
      root: path,
      runId: 'existing',
      client: fake.client,
    })
    expect(loaded.source).toMatchObject({
      kind: 'github',
      repo: 'test/repo',
      branch: 'existing-state',
      runId: 'existing',
    })
    expect(fake.requests.some((item) => item.path.endsWith('/git/ref/heads/existing-state'))).toBe(
      true,
    )
    expect(fake.requests.every((item) => !item.method || item.method === 'GET')).toBe(true)
    expect(existsSync(join(path, '.agent-runs'))).toBe(false)
    expect(readRunConfiguration(path).executionAdapter.delivery.source.kind).toBe('github')
  })
  it('preserves native generation zero and never invents epoch/fence/oracle author', async () => {
    const path = root()
    configure(path, { kind: 'local-preview' })
    await createFileRunStore({ root: path, runId: 'existing' }).append(started(), null)
    const loaded = await loadConfiguredRunSource({ root: path, runId: 'existing' })
    expect(loaded.status).toBe('observed')
    expect(loaded.state.runId).toBe('existing')
    expect(loaded.native).toMatchObject({
      generation: 0,
      revocationEpoch: 0,
      owner: 'existing-writer',
    })
    expect(loaded.bridge).toMatchObject({
      epoch: null,
      minimumEpoch: null,
      fencingToken: null,
      oracleOwner: null,
    })
    expect(loaded.gaps).toContain('oracle-custody-unbound')
    expect(loaded.gaps).toContain('bridge-authority-unbound')
  })
  it('reads an existing GitHub run with source and run revisions without mutations', async () => {
    const path = root()
    const source = { kind: 'github', repo: 'test/repo' }
    configure(path, source)
    const fake = fakeGitHub()
    const setupConfirm = (await planGitHubCoordination({ ...source, client: fake.client })).digest
    await createGitHubRunStore({
      ...source,
      runId: 'existing',
      client: fake.client,
      boundary: 'external-action',
      setupConfirm,
    }).append(started(), null)
    fake.requests.splice(0)
    const loaded = await loadConfiguredRunSource({
      root: path,
      runId: 'existing',
      client: fake.client,
    })
    expect(loaded.status).toBe('observed')
    expect(loaded.revision).toBe(started().digest)
    expect(loaded.sourceRevision).toBe(fake.refs.get('agentflow-state'))
    expect(loaded.source.durable).toBe(true)
    expect(fake.requests.every((item) => !item.method || item.method === 'GET')).toBe(true)
  })
  it('supports segmented source observation without initializing missing records', async () => {
    const path = root()
    configure(path, { kind: 'github', repo: 'test/repo', format: 'segmented-v2' })
    const fake = fakeGitHub()
    const loaded = await loadConfiguredRunSource({
      root: path,
      runId: 'existing',
      client: fake.client,
    })
    expect(loaded.status).toBe('missing-run')
    expect(loaded.source.format).toBe('segmented-v2')
    expect(fake.requests.every((item) => !item.method || item.method === 'GET')).toBe(true)
  })
  it('does not construct implicit authenticated clients and rejects unsupported source formats', async () => {
    const path = root()
    configure(path, { kind: 'github', repo: 'test/repo' })
    await expect(loadConfiguredRunSource({ root: path, runId: 'existing' })).rejects.toThrow(
      /client/i,
    )
    configure(path, { kind: 'github', repo: 'test/repo', format: 'invented' })
    await expect(
      loadConfiguredRunSource({ root: path, runId: 'existing', client: fakeGitHub().client }),
    ).rejects.toThrow(/format/i)
  })
})

it('rejects source configuration changing during asynchronous observation', async () => {
  const path = root()
  configure(path, { kind: 'github', repo: 'test/repo', branch: 'before' })
  const fake = fakeGitHub()
  const client = {
    request: async (...args) => {
      configure(path, { kind: 'github', repo: 'test/repo', branch: 'after' })
      return fake.client.request(...args)
    },
  }
  await expect(loadConfiguredRunSource({ root: path, runId: 'existing', client })).rejects.toThrow(
    /source.*changed/i,
  )
  expect(fake.requests.every((item) => !item.method || item.method === 'GET')).toBe(true)
})
