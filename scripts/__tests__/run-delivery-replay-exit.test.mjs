import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fingerprintCandidate } from '../../lib/verification/workspace.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
import { fakeGitHub } from '../../lib/__tests__/github-run-store.fixture.mjs'

let fake, state, reconciliationCalls
vi.mock('../../lib/sources/github-api-cli.mjs', () => ({ createGitHubApiCli: () => fake.client }))
vi.mock('../../lib/verification/observation-resolver.mjs', () => ({
  resolveObservation: async () => ({ verified: true }),
}))
vi.mock('../../lib/providers/github-delivery-actions.mjs', () => ({
  createGitHubDeliveryActions: () => ({
    preflight: async () => {},
    dispatch: async () => {
      throw new Error('Replay must not redispatch')
    },
  }),
}))
vi.mock('../../lib/application/run-service.mjs', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    createRunService: () => ({
      read: async () => ({ state, revision: state.revision }),
      executeDelegatedOperation: async () => ({
        replayed: true,
        receipt: { eventDigest: 'f'.repeat(64) },
        requiresOperationReconciliation: true,
      }),
      reconcileDelegatedOperation: async () => {
        reconciliationCalls++
        throw new Error('Unexpected automatic reconciliation')
      },
    }),
  }
})
const { runDelivery } = await import('../run-delivery.mjs')
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('public act replay exit state', () => {
  it('reports unknown/code 6 instead of success when admission replay needs provider reconciliation', async () => {
    fake = fakeGitHub()
    reconciliationCalls = 0
    const root = mkdtempSync(join(tmpdir(), 'af-replay-exit-'))
    roots.push(root)
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'candidate.js'), 'export const candidate = true\n')
    const policy = {
      version: 1,
      issuers: [
        {
          id: 'local',
          mode: 'local-cooperative',
          origin: 'cli',
          authorityRef: 'local',
          allowedActions: ['pr:create'],
          allowThroughMerge: false,
        },
      ],
      requiredChecks: ['test'],
      reviewPolicy: 'automated',
      materiality: 'fixed-scope-v1',
      allowSubdelegation: false,
      safetyReserve: 2,
    }
    writeFileSync(
      join(root, 'agent-workflow.config.json'),
      JSON.stringify({
        delivery: {
          source: { kind: 'github', repo: 'test/repo' },
          candidate: { inputs: ['src/candidate.js'] },
          delegation: { policy, issuerId: 'local', reviewCheck: 'review' },
        },
      }),
    )
    const git = (...args) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    git('add', '.')
    git('commit', '-m', 'candidate')
    const candidateDigest = fingerprintCandidate(root, { inputs: ['src/candidate.js'] }).digest
    state = {
      revision: 'a'.repeat(64),
      candidateDigest,
      observations: ['test', 'review'].map((criterionId) => ({
        criterionId,
        candidateDigest,
        outcome: 'pass',
      })),
    }
    writeFileSync(
      join(root, 'operation.json'),
      JSON.stringify({
        id: 'replay',
        planDigest: 'b'.repeat(64),
        policyDigest: recordDigest(policy),
        repository: 'test/repo',
        base: 'main',
        delegate: 'codex',
        action: 'pr:create',
        paths: ['src/candidate.js'],
        capabilities: ['pr:create'],
        candidateDigest,
        workspaceDigest: 'c'.repeat(64),
        checks: [],
        review: { policy: 'automated' },
        arguments: {
          headSha: git('rev-parse', 'HEAD'),
          head: 'main',
          title: 'Fixture',
          body: 'Fixture',
        },
      }),
    )
    const emitted = []
    const code = await runDelivery(
      [
        'act',
        'demo',
        '--target',
        root,
        '--json',
        '--execute',
        '--grant',
        'grant',
        '--operation',
        'operation.json',
      ],
      { emit: (value) => emitted.push(value) },
    )
    expect(code).toBe(6)
    expect(emitted.at(-1).result).toMatchObject({
      state: 'unknown',
      operationId: 'replay',
      requiresOperationReconciliation: true,
    })
    expect(reconciliationCalls).toBe(0)
  })
})
