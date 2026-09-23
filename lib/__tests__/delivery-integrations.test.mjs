import { describe, it, expect } from 'vitest'
import { collectGitHubCheck, resolveGitHubCheck } from '../verification/github-checks.mjs'
import {
  observeGitHubLifecycle,
  observeDeployment,
  observeRollback,
} from '../verification/lifecycle-observer.mjs'
import { parseJUnitAssertions } from '../verification/junit-report.mjs'
import { createRunService } from '../application/run-service.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import {
  planProjection,
  publishProjection,
  reconcileProjection,
} from '../application/publication-service.mjs'
import { resolveDeliveryContract } from '../../scripts/run-delivery.mjs'
import { recordDigest } from '../core/record-digest.mjs'

const candidateDigest = 'a'.repeat(64),
  commit = 'b'.repeat(40)
describe('delivery integration boundaries', () => {
  it('publishes a completed run without reopening its development phases', async () => {
    const store = createMemoryRunStore({ durable: true }),
      authority = { owner: 'operator', generation: 0 }
    const comments = []
    const client = {
      request: async (path, options = {}) => {
        if (options.method === 'POST')
          comments.push({ id: 1, body: options.body.body, html_url: 'https://example.test/final' })
        return comments
      },
    }
    const service = createRunService({
      store,
      authorize: async () => true,
      reconcileOperation: async (op) => reconcileProjection({ client, plan: op.plan }),
    })
    await service.start({
      runId: 'final',
      goalRef: 'issue:1',
      owner: 'operator',
      boundary: 'external-action',
      authority,
    })
    const append = async (kind, payload) => {
      const { revision } = await store.read()
      await store.append(
        createRunEvent({
          runId: 'final',
          id: `fixture-${kind}-${payload.to ?? 0}`,
          kind,
          payload,
          previousDigest: revision,
        }),
        revision,
      )
    }
    await append('candidate', { digest: candidateDigest })
    for (let phase = 0; phase < 8; phase++)
      await append('advanced', {
        from: phase,
        to: phase + 1,
        candidateDigest,
        acceptanceDigest: 'd'.repeat(64),
      })
    await append('completed', { candidateDigest, acceptanceDigest: 'd'.repeat(64) })
    const plan = planProjection({
      status: await service.status(),
      repo: 'test/repo',
      issueNumber: 1,
    })
    expect(
      (await publishProjection({ service, client, plan, confirm: plan.digest, authority })).state,
    ).toBe('confirmed')
    expect((await service.status()).status).toBe('completed')
    expect(comments).toHaveLength(1)
    await expect(
      service.record(
        'candidate',
        { digest: 'b'.repeat(64) },
        { expectedRevision: (await service.read()).revision, authority },
      ),
    ).rejects.toThrow('Terminal')
  })
  it('requires exercised rollback evidence from the restored runtime', async () => {
    let exercised = false
    const args = {
      target: 'preview',
      candidateDigest,
      fromCandidateDigest: 'c'.repeat(64),
      requiredAssertions: ['search'],
    }
    const provider = {
      observeRollback: async () => ({
        ...args,
        id: 'rollback',
        verified: true,
        exercised,
        runtimeIdentity: 'restored-runtime',
        assertions: [{ id: 'search', outcome: 'pass' }],
        observedAt: '2026-01-01T00:00:00Z',
      }),
    }
    await expect(observeRollback({ ...args, provider })).rejects.toThrow('unverified')
    exercised = true
    expect((await observeRollback({ ...args, provider })).exercised).toBe(true)
  })
  it('binds checks to the producer and invalidates a changed external result', async () => {
    let conclusion = 'success'
    const definition = { commit, name: 'CI', appId: 7, criterionId: 'tests', assertionId: 'suite' }
    const client = {
      request: async () => ({
        check_runs: [
          {
            id: 1,
            name: 'CI',
            app: { id: 7 },
            head_sha: commit,
            status: 'completed',
            conclusion,
            started_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T00:01:00Z',
          },
        ],
      }),
    }
    const observation = await collectGitHubCheck({
      client,
      repo: 'test/repo',
      candidateDigest,
      definition,
    })
    expect(observation.outcome).toBe('pass')
    expect((await resolveGitHubCheck({ observation, client, definition })).verified).toBe(true)
    conclusion = 'failure'
    expect((await resolveGitHubCheck({ observation, client, definition })).verified).toBe(false)
    await expect(
      collectGitHubCheck({
        client,
        repo: 'test/repo',
        candidateDigest,
        definition: { ...definition, appId: 8 },
      }),
    ).rejects.toThrow('exactly one')
  })
  it('resolves annotated release tags and rejects a different deployment identity', async () => {
    const client = {
      request: async (path) =>
        path.includes('/releases/')
          ? { id: 1, tag_name: 'v2', draft: false, prerelease: true }
          : path.includes('/git/ref/')
            ? { object: { type: 'tag', sha: 'tag-object' } }
            : { object: { type: 'commit', sha: commit } },
    }
    expect(
      (
        await observeGitHubLifecycle({
          client,
          repo: 'test/repo',
          kind: 'release',
          target: 'v2',
          candidateDigest,
          commit,
        })
      ).outcome,
    ).toBe('pass')
    expect(
      (
        await observeGitHubLifecycle({
          client,
          repo: 'test/repo',
          kind: 'tag',
          target: 'v2',
          candidateDigest,
          commit: 'c'.repeat(40),
        })
      ).outcome,
    ).toBe('fail')
    await expect(
      observeDeployment({
        provider: {
          observeDeployment: async () => ({
            verified: true,
            candidateDigest: 'other',
            runtimeIdentity: 'runtime',
            assertions: [{ id: 'search', outcome: 'pass' }],
          }),
        },
        target: 'preview',
        candidateDigest,
        requiredAssertions: ['search'],
      }),
    ).rejects.toThrow('unverified')
  })
  it('does not overlook suite-level infrastructure errors', () => {
    expect(() =>
      parseJUnitAssertions('<testsuite errors="1"><testcase name="works"/></testsuite>'),
    ).toThrow('errors')
  })
  it('requires the current GitHub goal revision before freezing acceptance', async () => {
    const issue = { number: 1, title: 'Goal', body: 'Acceptance', updated_at: '2026-01-01' }
    const source = { kind: 'github', repo: 'test/repo' },
      state = { goalRef: 'issue:1' }
    const client = { request: async () => issue }
    const value = {
      version: 2,
      goalRevision: recordDigest({
        repo: source.repo,
        number: 1,
        title: issue.title,
        body: issue.body,
        updatedAt: issue.updated_at,
      }),
      criteria: [{ id: 'tests', definitionDigest: candidateDigest, assertions: ['works'] }],
    }
    expect((await resolveDeliveryContract({ value, state, source, client })).verified).toBe(true)
    issue.body = 'Human changed acceptance'
    expect((await resolveDeliveryContract({ value, state, source, client })).verified).toBe(false)
    await expect(
      resolveDeliveryContract({
        value,
        state: { goalRef: 'https://github.com/other/repo/issues/1' },
        source,
        client,
      }),
    ).rejects.toThrow('configured repository')
  })
  it('reconciles an uncertain comment once and persists acknowledgment without editing the issue', async () => {
    const comments = [{ id: 1, body: 'Human comment', html_url: 'https://example.test/1' }],
      requests = []
    const client = {
      request: async (path, options = {}) => {
        requests.push({ path, ...options })
        if (options.method === 'POST') {
          comments.push({ id: 2, body: options.body.body, html_url: 'https://example.test/2' })
          throw new Error('Response lost')
        }
        return comments
      },
    }
    const store = createMemoryRunStore()
    store.durable = true
    const authority = { owner: 'operator', generation: 0 }
    const service = createRunService({
      store,
      authorize: async () => true,
      reconcileOperation: async (op) => reconcileProjection({ client, plan: op.plan }),
    })
    await service.start({
      runId: 'demo',
      goalRef: 'issue:1',
      owner: 'operator',
      boundary: 'external-action',
      authority,
    })
    const plan = planProjection({
      status: await service.status(),
      repo: 'test/repo',
      issueNumber: 1,
    })
    const args = { service, client, plan, confirm: plan.digest, authority }
    expect((await publishProjection(args)).state).toBe('unknown')
    expect((await service.read()).state.operations[plan.id].state).toBe('unknown')
    expect((await publishProjection(args)).state).toBe('confirmed')
    expect((await service.read()).state.operations[plan.id].state).toBe('confirmed')
    expect((await publishProjection(args)).id).toBe(2)
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1)
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false)
    expect(comments[0].body).toBe('Human comment')
  })
  it('pauses before admitting work with unknown enforced usage', async () => {
    const store = createMemoryRunStore(),
      authority = { owner: 'operator', generation: 0 }
    let stopped = false
    const service = createRunService({
      store,
      authorize: async () => true,
      budget: { level: 'provider-enforced', limit: 100 },
      observeUsage: async () => ({ verified: false }),
      requestSafeStop: async () => {
        stopped = true
      },
    })
    await service.start({ runId: 'budget', goalRef: 'issue:1', owner: 'operator', authority })
    expect((await service.admitAttempt({ estimatedNext: 2, authority })).admitted).toBe(false)
    expect(stopped).toBe(true)
    expect((await service.status()).status).toBe('paused')
  })
})
