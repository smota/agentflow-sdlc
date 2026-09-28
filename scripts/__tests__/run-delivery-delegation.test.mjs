import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fakeGitHub } from '../../lib/__tests__/github-run-store.fixture.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
import { fingerprintCandidate } from '../../lib/verification/workspace.mjs'
import { createRunEvent } from '../../lib/core/run-state.mjs'

let fake
vi.mock('../../lib/sources/github-api-cli.mjs', () => ({
  createGitHubApiCli: () => fake.client,
}))
const { runDelivery } = await import('../run-delivery.mjs')
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const policy = {
  version: 1,
  issuers: [
    {
      id: 'local',
      mode: 'local-cooperative',
      origin: 'cli',
      authorityRef: 'local',
      allowedActions: ['edit', 'commit', 'push', 'pr:create', 'pr:update'],
      allowThroughMerge: false,
    },
  ],
  requiredChecks: ['test'],
  reviewPolicy: 'automated',
  materiality: 'fixed-scope-v1',
  allowSubdelegation: false,
  safetyReserve: 2,
}

function project() {
  fake = fakeGitHub()
  const root = mkdtempSync(join(tmpdir(), 'agentflow-public-delegation-'))
  roots.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'candidate.js'), 'export const candidate = true\n')
  writeFileSync(
    join(root, 'agent-workflow.config.json'),
    JSON.stringify({
      posture: 'assisted',
      delivery: {
        source: {
          kind: 'github',
          format: 'segmented-v2',
          repo: 'test/repo',
          branch: 'agentflow-state',
        },
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
  return { root, git }
}

async function call(root, command, options = []) {
  const emitted = []
  const code = await runDelivery(
    [command, 'public-run', '--target', root, '--json', '--writer', 'writer', ...options],
    {
      emit: (value) => emitted.push(value),
    },
  )
  return { code, result: emitted.at(-1)?.result }
}

async function started() {
  const { root, git } = project()
  const setup = await call(root, 'source-plan')
  await call(root, 'start', [
    '--execute',
    '--goal',
    'issue:297',
    '--setup-confirm',
    setup.result.digest,
  ])
  return { root, git }
}

async function issued() {
  const context = await started()
  writeFileSync(join(context.root, 'request.json'), JSON.stringify(grantRequest()))
  const planned = await call(context.root, 'grant-plan', ['--request', 'request.json'])
  writeFileSync(join(context.root, 'plan.json'), JSON.stringify(planned.result.plan))
  const result = await call(context.root, 'grant-issue', [
    '--execute',
    '--plan',
    'plan.json',
    '--confirm',
    planned.result.confirm,
  ])
  return { ...context, grantId: result.result.grantId }
}

function grantRequest() {
  return {
    issuerMode: 'local-cooperative',
    planDigest: 'a'.repeat(64),
    policyDigest: recordDigest(policy),
    repository: 'test/repo',
    base: 'main',
    delegate: 'codex',
    allowedPaths: ['src/*'],
    allowedActions: ['edit'],
    capabilities: ['edit'],
    requiredChecks: ['test'],
    reviewPolicy: 'automated',
    materiality: 'fixed-scope-v1',
    allowSubdelegation: false,
    maxAttempts: 2,
    maxExternalEffects: 1,
    expiry: '2099-01-01T00:00:00.000Z',
  }
}

function seedLegacy(events) {
  const blobContent = JSON.stringify(events)
  const blobSha = recordDigest(blobContent)
  fake.objects.set(blobSha, { content: blobContent })
  const tree = [{ path: 'runs/public-run.json', mode: '100644', type: 'blob', sha: blobSha }]
  const treeSha = recordDigest({ tree })
  fake.objects.set(treeSha, { tree })
  const previous = fake.refs.get('agentflow-state')
  const commit = { tree: { sha: treeSha }, parents: previous ? [previous] : [] }
  const commitSha = recordDigest(commit)
  fake.objects.set(commitSha, commit)
  fake.refs.set('agentflow-state', commitSha)
  return commitSha
}

describe('public run delegation with a fake GitHub source', () => {
  it('requires the current plan digest and rejects stale grant approval before source write', async () => {
    const { root } = await started()
    writeFileSync(join(root, 'request.json'), JSON.stringify(grantRequest()))
    const planned = await call(root, 'grant-plan', ['--request', 'request.json'])
    expect(planned.result.plan.candidateDigest).toBe(
      fingerprintCandidate(root, { inputs: ['src/candidate.js'] }).digest,
    )
    writeFileSync(join(root, 'plan.json'), JSON.stringify(planned.result.plan))
    const before = fake.refs.get('agentflow-state')
    await expect(
      call(root, 'grant-issue', ['--execute', '--plan', 'plan.json', '--confirm', 'f'.repeat(64)]),
    ).rejects.toThrow(/approval is stale or mismatched/)
    expect(fake.refs.get('agentflow-state')).toBe(before)
    const issued = await call(root, 'grant-issue', [
      '--execute',
      '--plan',
      'plan.json',
      '--confirm',
      planned.result.confirm,
    ])
    expect(issued.result.grantId).toBeTruthy()
    const status = await call(root, 'grant-status', ['--grant', issued.result.grantId])
    expect(status.result.envelope.binding.issuerBinding.decisionRef).toBe(
      `local-cooperative:${planned.result.confirm}`,
    )
  })

  it('rejects a recomputed confirmation for another run or repository', async () => {
    const { root } = await started()
    writeFileSync(join(root, 'request.json'), JSON.stringify(grantRequest()))
    const planned = (await call(root, 'grant-plan', ['--request', 'request.json'])).result.plan
    const before = fake.refs.get('agentflow-state')
    for (const forged of [
      { ...planned, runId: 'other-run' },
      {
        ...planned,
        request: { ...planned.request, repository: 'other/repo' },
        requestDigest: recordDigest({ intent: { ...planned.request, repository: 'other/repo' } }),
      },
    ]) {
      writeFileSync(join(root, 'forged-plan.json'), JSON.stringify(forged))
      await expect(
        call(root, 'grant-issue', [
          '--execute',
          '--plan',
          'forged-plan.json',
          '--confirm',
          recordDigest(forged),
        ]),
      ).rejects.toThrow(/plan|repository|mismatch/i)
      expect(fake.refs.get('agentflow-state')).toBe(before)
    }
  })

  it('revokes a source-backed grant with a typed issuer decision', async () => {
    const { root, grantId } = await issued()
    const before = await call(root, 'grant-status', ['--grant', grantId])
    expect(before.result.status).toBe('active')
    await call(root, 'grant-revoke', [
      '--execute',
      '--grant',
      grantId,
      '--reason',
      'Fixture revocation',
    ])
    const after = await call(root, 'grant-status', ['--grant', grantId])
    expect(after.result.status).toBe('revoked')
    expect(after.result.revocationEpoch).toBeGreaterThan(before.result.revocationEpoch)
  })

  it('refuses an action before exact candidate checks and review exist', async () => {
    const { root, git, grantId } = await issued()
    const candidateDigest = fingerprintCandidate(root, { inputs: ['src/candidate.js'] }).digest
    writeFileSync(
      join(root, 'operation.json'),
      JSON.stringify({
        id: 'unreviewed',
        planDigest: 'a'.repeat(64),
        policyDigest: recordDigest(policy),
        repository: 'test/repo',
        base: 'main',
        delegate: 'codex',
        action: 'push',
        paths: ['src/candidate.js'],
        capabilities: ['push'],
        candidateDigest,
        workspaceDigest: 'b'.repeat(64),
        checks: [],
        review: { policy: 'automated' },
        arguments: { headSha: git('rev-parse', 'HEAD'), branch: 'main' },
      }),
    )
    const before = fake.refs.get('agentflow-state')
    await expect(
      call(root, 'act', ['--execute', '--grant', grantId, '--operation', 'operation.json']),
    ).rejects.toThrow(/Fresh exact-candidate checks and review required/)
    expect(fake.refs.get('agentflow-state')).toBe(before)
  })

  it('refuses an untracked candidate input even when a claimed HEAD and digest are supplied', async () => {
    const { root, git, grantId } = await issued()
    writeFileSync(join(root, 'src', 'untracked.js'), 'export const hidden = true\n')
    const configPath = join(root, 'agent-workflow.config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.delivery.candidate.inputs.push('src/untracked.js')
    writeFileSync(configPath, JSON.stringify(config))
    const candidateDigest = fingerprintCandidate(root, config.delivery.candidate).digest
    writeFileSync(
      join(root, 'operation.json'),
      JSON.stringify({
        id: 'untracked-candidate',
        planDigest: 'a'.repeat(64),
        policyDigest: recordDigest(policy),
        repository: 'test/repo',
        base: 'main',
        delegate: 'codex',
        action: 'push',
        paths: ['src/candidate.js'],
        capabilities: ['push'],
        candidateDigest,
        workspaceDigest: 'b'.repeat(64),
        checks: [],
        review: { policy: 'automated' },
        arguments: { headSha: git('rev-parse', 'HEAD'), branch: 'main' },
      }),
    )
    const before = fake.refs.get('agentflow-state')
    await expect(
      call(root, 'act', ['--execute', '--grant', grantId, '--operation', 'operation.json']),
    ).rejects.toThrow()
    expect(fake.refs.get('agentflow-state')).toBe(before)
  })

  it('requires a continuation packet for durable public resume', async () => {
    const { root } = await started()
    const before = fake.refs.get('agentflow-state')
    await expect(call(root, 'resume', ['--execute'])).rejects.toThrow(/--packet required/)
    expect(fake.refs.get('agentflow-state')).toBe(before)
  })

  it('keeps default context and reuses only an exact digest of actual policy files in compact mode', async () => {
    const { root } = await started()
    for (const path of [
      'AGENTS.md',
      'docs/agent-workflow.md',
      'docs/issue-standards.md',
      'roles/product-manager/ROLE.md',
    ]) {
      const target = join(root, ...path.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, `# ${path}\nCurrent policy text.\n`)
    }
    const defaultContext = (await call(root, 'context')).result
    expect(defaultContext.commonDigest).toBeUndefined()
    expect(defaultContext.authorityReferences).toContain('AGENTS.md')
    const first = (await call(root, 'context', ['--compact'])).result
    expect(first.common.policyIndex.references).toHaveLength(4)
    expect(first.bytes).toBe(Buffer.byteLength(JSON.stringify(first)))
    const repeated = (
      await call(root, 'context', ['--compact', '--known-common', first.commonDigest])
    ).result
    expect(repeated.common).toBeUndefined()
    expect(repeated.commonRef.digest).toBe(first.commonDigest)
    expect(repeated.revision).toBe(defaultContext.revision)
    expect(repeated.generation).toBe(defaultContext.generation)
    expect(repeated.bytes).toBeLessThan(first.bytes)
    writeFileSync(join(root, 'AGENTS.md'), '# AGENTS.md\nChanged current policy.\n')
    const drifted = (
      await call(root, 'context', ['--compact', '--known-common', first.commonDigest])
    ).result
    expect(drifted.common).toBeDefined()
    expect(drifted.commonDigest).not.toBe(first.commonDigest)
    rmSync(join(root, 'AGENTS.md'))
    await expect(call(root, 'context', ['--compact'])).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await call(root, 'context')).result.revision).toBe(defaultContext.revision)
  })

  it('refuses a migration confirmation after source drift and accepts the current preview', async () => {
    const { root } = project()
    const configPath = join(root, 'agent-workflow.config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.delivery.source.format = 'v1'
    writeFileSync(configPath, JSON.stringify(config))
    const first = createRunEvent({
      runId: 'public-run',
      id: 'start',
      generation: 0,
      kind: 'started',
      payload: {
        goalRef: 'issue:297',
        owner: 'writer',
        profile: 'standard',
        boundary: 'external-action',
      },
      timestamp: '2026-09-28T00:00:00.000Z',
    })
    seedLegacy([first])
    const oldPreview = await call(root, 'migrate')
    const second = createRunEvent({
      runId: 'public-run',
      id: 'checkpoint',
      previousDigest: first.digest,
      generation: 0,
      kind: 'checkpoint',
      payload: { seq: 1 },
      timestamp: '2026-09-28T00:00:01.000Z',
    })
    const changedRef = seedLegacy([first, second])
    const writesBefore = fake.requests.filter((request) => request.method).length
    await expect(
      call(root, 'migrate', ['--execute', '--confirm', oldPreview.result.confirm]),
    ).rejects.toThrow(/Current migration preview confirmation required/)
    expect(fake.refs.get('agentflow-state')).toBe(changedRef)
    expect(fake.requests.filter((request) => request.method)).toHaveLength(writesBefore)
    const currentPreview = await call(root, 'migrate')
    const migrated = await call(root, 'migrate', [
      '--execute',
      '--confirm',
      currentPreview.result.confirm,
    ])
    expect(migrated.result.verified).toBe(true)
    expect(migrated.result.priorRevision).toBe(changedRef)
  })

  it('reconciles a persisted pending journal event on a fresh CLI invocation after lost ACK', async () => {
    const { root } = await started()
    const original = fake.client.request.bind(fake.client)
    let failConfirmationRead = false
    fake.client.request = async (path, options) => {
      if (
        failConfirmationRead &&
        path.endsWith('/git/ref/heads/agentflow-state') &&
        !options?.method
      ) {
        failConfirmationRead = false
        throw new Error('temporary source read outage')
      }
      try {
        return await original(path, options)
      } catch (error) {
        if (options?.method === 'PATCH' && path.endsWith('/git/refs/heads/agentflow-state'))
          failConfirmationRead = true
        throw error
      }
    }
    fake.uncertain = true
    await expect(call(root, 'checkpoint', ['--execute', '--reason', 'lost ACK'])).rejects.toThrow(
      /source read outage/,
    )
    const recovered = await call(root, 'journal-reconcile', ['--execute'])
    expect(recovered.result.state).toBe('acknowledged')
    const status = await call(root, 'status')
    expect(status.result.revision).toBeTruthy()
  })
})
