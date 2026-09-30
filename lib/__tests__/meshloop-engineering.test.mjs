import {
  createGovernedEngineeringAdapter,
  createSourceEngineeringReceiptResolver,
} from '../providers/governed-engineering.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import { resolveConfiguredEngineeringProvider } from '../providers/registry.mjs'
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createMeshloopEngineeringProvider,
  meshloopGraphId,
} from '../providers/meshloop-engineering.mjs'
import { dispatchToHarness } from '../providers/harness-dispatch.mjs'
const sha = (b) => createHash('sha256').update(b).digest('hex')
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'af-mesh-contract-'))
  roots.push(root)
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  writeFileSync(join(root, 'result.txt'), 'before')
  git('add', 'result.txt')
  git('commit', '-qm', 'base')
  const base = git('rev-parse', 'HEAD')
  git('checkout', '-qb', 'output')
  writeFileSync(join(root, 'result.txt'), 'after')
  git('commit', '-qam', 'output')
  const commit = git('rev-parse', 'HEAD')
  git('checkout', '-q', '--detach', base)
  const executable = join(root, 'binary')
  writeFileSync(executable, 'qualified-test-binary')
  const configFile = join(root, 'runtime.toml')
  writeFileSync(configFile, 'runtime')
  const planFile = join(root, 'plan.json')
  const identity = { version: 1, operationId: 'op-1', candidateDigest: sha('before') }
  const nodes = [{ id: 1, description: 'bounded edit', depends_on: [], tier: null }]
  const graphId = meshloopGraphId(identity, nodes, sha('runtime'))
  writeFileSync(planFile, JSON.stringify({ graph_id: graphId, nodes }))
  let state = 'absent',
    runs = 0,
    responseGraph = graphId
  const spawn = (_exe, args) => {
    if (args.includes('--version')) return { status: 0, stdout: 'meshloop 0.2.0', stderr: '' }
    const verb = args[0]
    if (verb === 'run') {
      runs++
      state = 'awaiting_acceptance'
    }
    if (verb === 'cancel') state = 'cancelled'
    if (state === 'ambiguous') return { status: 1, stdout: '', stderr: 'unavailable' }
    if (state === 'absent')
      return {
        status: 2,
        stdout: JSON.stringify({
          ok: false,
          command: 'meshloop:inspect',
          error: `MissingGraph("${graphId}")`,
        }),
        stderr: '',
      }
    return {
      status: 0,
      stderr: '',
      stdout: JSON.stringify({
        ok: true,
        command: `meshloop:${verb}`,
        data: {
          session_id: responseGraph,
          graph_id: responseGraph,
          status: state,
          git_export: { commit_sha: commit, branch_ref: 'refs/heads/output' },
        },
      }),
    }
  }
  const options = {
    cwd: root,
    executable,
    binarySha256: sha(readFileSync(executable)),
    configFile,
    dbFile: join(root, 'state.db'),
    worktreeBase: join(root, 'worktrees'),
    spawn,
  }
  const request = {
    planFile,
    allowedPaths: ['result.txt'],
    boundary: 'mutate-worktree',
    engineeringProfile: identity,
    timeoutMs: 1000,
  }
  return {
    root,
    options,
    request,
    identity,
    git,
    graphId,
    setState: (v) => {
      state = v
    },
    wrongGraph: () => {
      responseGraph = 'foreign'
    },
    runs: () => runs,
  }
}
describe('minimal Meshloop engineering boundary', () => {
  it('waits for technical acceptance, then observes exact bytes in a fresh adapter without redispatch', async () => {
    const f = fixture(),
      p = createMeshloopEngineeringProvider(f.options),
      plan = p.plan(f.request)
    expect((await p.execute(plan, { confirm: plan.token })).status).toBe('blocked')
    expect(f.runs()).toBe(1)
    f.setState('completed')
    const fresh = createMeshloopEngineeringProvider(f.options)
    const receipt = await fresh.observe(JSON.parse(JSON.stringify(plan)), plan.token)
    expect(receipt.status).toBe('pass')
    expect(receipt.metadata.sdlcAccepted).toBe(false)
    expect(fresh.readOutput(plan, receipt).artifacts[0]).toMatchObject({
      sha256: sha('after'),
      byteLength: 5,
    })
    const result = await dispatchToHarness({
      provider: fresh,
      executionTarget: 'meshloop-cli',
      requiredCapabilities: ['file-edit'],
      permissionBoundary: 'mutate-worktree',
      operationId: f.identity.operationId,
      candidateDigest: f.identity.candidateDigest,
      requestPayload: { planFile: f.request.planFile, allowedPaths: ['result.txt'] },
      expectedArtifacts: ['result.txt'],
    })
    expect(result.status).toBe('pass')
    expect(f.runs()).toBe(1)
    expect(readFileSync(join(f.root, 'result.txt'), 'utf8')).toBe('before')
  })
  it('refuses to retry when existence is unknown and confirms cancellation only from public response', async () => {
    const f = fixture(),
      p = createMeshloopEngineeringProvider(f.options),
      plan = p.plan(f.request)
    f.setState('ambiguous')
    await expect(p.execute(plan, { confirm: plan.token })).rejects.toThrow('existence is unknown')
    expect(f.runs()).toBe(0)
    f.setState('running')
    expect((await p.cancel({ sessionId: f.graphId })).status).toBe('cancelled')
  })
  it('rejects altered plan, changed binary, stale identity and foreign graph', async () => {
    const f = fixture(),
      p = createMeshloopEngineeringProvider(f.options),
      plan = p.plan(f.request)
    await expect(p.execute({ ...plan, timeoutMs: 2 }, { confirm: plan.token })).rejects.toThrow(
      'confirmation',
    )
    expect(() =>
      p.plan({ ...f.request, engineeringProfile: { ...f.identity, operationId: 'other' } }),
    ).toThrow('graph must bind')
    f.setState('completed')
    f.wrongGraph()
    expect((await p.status({ sessionId: f.graphId })).status).toBe('unknown')
    writeFileSync(f.options.executable, 'changed')
    await expect(p.execute(plan, { confirm: plan.token })).rejects.toThrow('binary changed')
  })
  it('rejects scope violations and stale exported branch binding', async () => {
    const f = fixture(),
      p = createMeshloopEngineeringProvider(f.options)
    const plan = p.plan({ ...f.request, allowedPaths: ['other.txt'] })
    f.setState('completed')
    await expect(p.observe(plan, plan.token)).rejects.toThrow('authorized paths')
    const valid = p.plan(f.request)
    f.git('branch', '-f', 'output', f.git('rev-parse', 'HEAD'))
    await expect(p.observe(valid, valid.token)).rejects.toThrow('branch no longer')
  })
})

it('uses configured public routing and read-only observation with durable receipt reconciliation', async () => {
  const f = fixture()
  f.setState('completed')
  const configured = resolveConfiguredEngineeringProvider(
    {
      delivery: {
        engineeringProvider: {
          id: 'meshloop-engineering-cli',
          executionTarget: 'meshloop-cli',
          connection: {
            executable: f.options.executable,
            binarySha256: f.options.binarySha256,
            configFile: f.options.configFile,
            dbFile: f.options.dbFile,
            worktreeBase: f.options.worktreeBase,
          },
        },
      },
    },
    { cwd: f.root, meshloopEngineering: { spawn: f.options.spawn } },
  )
  const events = [
    createRunEvent({
      runId: 'run',
      id: 'start',
      kind: 'started',
      payload: {
        profile: 'standard',
        goalRef: 'test',
        owner: 'owner',
        boundary: 'mutate-worktree',
      },
    }),
  ]
  const resolver = createSourceEngineeringReceiptResolver({
    store: {
      durable: true,
      read: async () => ({ events }),
    },
  })
  const adapter = createGovernedEngineeringAdapter({ ...configured, resolveReceipt: resolver })
  const operation = {
    id: f.identity.operationId,
    action: 'edit',
    candidateDigest: f.identity.candidateDigest,
    paths: ['result.txt'],
    arguments: {
      requestPayload: { planFile: f.request.planFile },
      expectedArtifacts: ['result.txt'],
    },
  }
  await adapter.preflight(operation)
  const result = await adapter.observe(operation)
  expect(result.status).toBe('pass')
  expect(f.runs()).toBe(0)
  events.push(
    createRunEvent({
      runId: 'run',
      id: 'evidence',
      previousDigest: events[0].digest,
      kind: 'checkpoint',
      payload: {
        kind: 'engineering-result',
        operationId: operation.id,
        receipt: result.receipt,
        output: result.verifiedOutput,
      },
    }),
  )
  const digest = 'd'.repeat(64)
  expect(
    (
      await adapter.reconcile(
        { id: operation.id, payloadDigest: digest },
        { operation, operationDigest: digest },
      )
    ).state,
  ).toBe('confirmed')
})
