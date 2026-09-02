import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  createCollaborationIntent,
  validateCollaborationIntent,
} from '../core/collaboration-intent.mjs'
import { createExecutionReceipt, validateExecutionReceipt } from '../core/execution-receipt.mjs'
import {
  bindProvider,
  validateProviderBinding,
  validateProviderDescriptor,
} from '../core/provider-binding.mjs'
import { validateSourceAdapter } from '../core/source-adapter.mjs'
import {
  AI_FOUNDRY_DESK_CONTRACT,
  aiFoundryDeskHarnessCommand,
  createAiFoundryDeskProvider,
} from '../providers/ai-foundry-desk.mjs'
import { createGrokProvider } from '../providers/grok.mjs'
import { createLocalCliProvider, inspectExecutable } from '../providers/local-cli.mjs'
import { createManualProvider } from '../providers/manual.mjs'
import { createProviderApiProvider } from '../providers/provider-api.mjs'
import { builtInProviders } from '../providers/registry.mjs'
import { createGitHubSourceAdapter } from '../sources/github.mjs'
import { createGitHubCliSourceAdapter } from '../sources/github-cli.mjs'
import { createMemorySourceReceiptStore } from '../sources/receipt-store.mjs'
import { validateArtifactRef } from '../evidence-contracts.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const config = JSON.parse(readFileSync(resolve(repoRoot, 'defaults/sdlc.config.json'), 'utf8'))

function ref(relationship = 'output') {
  return {
    kind: 'implementation',
    system: 'git',
    uri: 'git:work/modular-agentflow-188:lib/core/provider-binding.mjs',
    authority: 'working-copy',
    relationship,
  }
}

describe('modular AgentFlow contracts', () => {
  it('creates provider-neutral collaboration intent', () => {
    const intent = createCollaborationIntent({
      issueNumber: 188,
      profile: 'high-assurance',
      changeSurface: ['security'],
    })
    expect(intent).toMatchObject({
      version: 1,
      mode: 'human-gated',
      writerPolicy: 'single-writer',
      humanGate: true,
    })
    expect(JSON.stringify(intent)).not.toMatch(/claude|codex|pi-parent|provider-api/)
    expect(validateCollaborationIntent(intent)).toEqual({ ok: true, errors: [] })
  })

  it('binds an available provider by execution intent', async () => {
    const intent = createCollaborationIntent({ requestedMode: 'advisory' })
    const provider = createLocalCliProvider({
      id: 'test-cli',
      platform: 'codex',
      executable: 'test-cli',
      executionTarget: 'codex-cli',
      intentSupport: [
        {
          id: 'workflow-orchestration',
          implementation: 'emulated',
          fidelity: 'full',
          evidence: 'contract-tested',
          limits: {},
        },
        {
          id: 'delegated-work',
          implementation: 'native',
          fidelity: 'full',
          evidence: 'probed',
          limits: { maxDelegates: 4 },
        },
      ],
      spawn: () => ({ status: 0, stdout: '1.2.3\n', stderr: '' }),
    })
    const binding = await bindProvider({ intent, providers: [provider] })
    expect(binding).toMatchObject({
      status: 'bound',
      provider: 'test-cli',
      availability: 'available',
      executionTarget: 'codex-cli',
    })
    expect(validateProviderBinding(binding)).toEqual({ ok: true, errors: [] })
  })

  it('binds provider-defined execution targets without changing core catalogs', async () => {
    const provider = createLocalCliProvider({
      id: 'future-cli',
      platform: 'chatgpt',
      executable: 'future-cli',
      executionTarget: 'future-cli-v2',
      spawn: () => ({ status: 0, stdout: '2.0.0\n', stderr: '' }),
    })
    const binding = await bindProvider({
      intent: createCollaborationIntent({ requestedMode: 'single-agent' }),
      providers: [provider],
    })

    expect(binding).toMatchObject({
      status: 'bound',
      provider: 'future-cli',
      executionTarget: 'future-cli-v2',
    })
  })

  it('degrades optional collaboration to a recorded manual path', async () => {
    const intent = createCollaborationIntent({ requestedMode: 'council' })
    const unavailable = createLocalCliProvider({
      id: 'missing-cli',
      platform: 'codex',
      executable: 'missing-cli',
      executionTarget: 'codex-cli',
      spawn: () => ({ status: 1, stdout: '', stderr: '' }),
    })
    const binding = await bindProvider({ intent, providers: [unavailable, createManualProvider()] })
    expect(binding).toMatchObject({
      status: 'degraded',
      provider: 'manual',
      degraded: true,
      transport: 'manual',
    })
  })

  it('never substitutes an explicitly named provider', async () => {
    const intent = createCollaborationIntent({ requestedMode: 'single-agent' })
    const binding = await bindProvider({ intent, providers: [], preferredProvider: 'xai-api' })
    expect(binding).toMatchObject({ status: 'blocked', provider: null })
    expect(binding.reason).toContain('not registered')
  })

  it('records execution through existing ArtifactRef vocabulary', () => {
    const receipt = createExecutionReceipt({
      subject: 'issue:188',
      intent: createCollaborationIntent({ requestedMode: 'single-agent' }),
      binding: {
        provider: 'codex-cli',
        executionTarget: 'codex-cli',
        transport: 'local-cli',
        delegationBoundary: 'current-session',
      },
      status: 'pass',
      startedAt: '2026-09-01T15:00:00Z',
      completedAt: '2026-09-01T15:01:00Z',
      inputRefs: [ref('input')],
      outputRefs: [ref()],
      requestDigest: 'a'.repeat(64),
      planDigest: 'b'.repeat(64),
      actual: { platform: 'codex', target: 'codex-cli', transport: 'local-cli', model: 'test' },
      boundaries: {
        requested: 'mutate-worktree',
        effective: 'mutate-worktree',
        enforced: 'mutate-worktree',
        observed: 'mutate-worktree',
        declared: 'mutate-worktree',
      },
      revision: { source: 'work/modular-agentflow-188', workspaceFingerprint: 'workspace:test' },
      writerLease: { id: 'lease-1', owner: 'codex', status: 'released' },
      timing: { timeoutMs: 120000, cancelled: false },
      digests: { artifacts: 'c'.repeat(64), changes: 'd'.repeat(64), output: 'e'.repeat(64) },
      executionIntentSource: {
        provider: 'codex-cli',
        declared: ['workflow-orchestration'],
        resolutions: [],
      },
      cleanup: { status: 'clean', actions: [] },
      disclosure: { authorized: false, scope: 'local-only' },
      redaction: { applied: true, policy: 'no-secrets' },
    })
    expect(validateExecutionReceipt(receipt, config)).toEqual({ ok: true, errors: [] })
    const malformed = structuredClone(receipt)
    delete malformed.actual.model
    malformed.writerLease.status = 'nonsense'
    malformed.timing.startedAt = 'not-a-date'
    delete malformed.cleanup.actions
    expect(validateExecutionReceipt(malformed, config).ok).toBe(false)
  })
})

describe('provider adapters', () => {
  it('conforms every built-in provider to SPI version 1', () => {
    for (const provider of builtInProviders()) {
      expect(validateProviderDescriptor(provider), provider.id).toEqual({ ok: true, errors: [] })
    }
  })

  it('uses a non-shell executable probe', () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: 'ok', stderr: '' }))
    expect(inspectExecutable({ executable: 'codex', args: ['--version'], spawn })).toMatchObject({
      availability: 'available',
    })
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['--version'],
      expect.objectContaining({ shell: false }),
    )
    expect(spawn.mock.calls[0][2].env).not.toHaveProperty('GITHUB_TOKEN')
    expect(spawn.mock.calls[0][2].env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(inspectExecutable({ executable: 'codex;whoami', spawn })).toMatchObject({
      availability: 'unavailable',
    })
  })

  it('emits a canonical ExecutionReceipt from local execution', () => {
    const provider = createLocalCliProvider({
      id: 'test-cli',
      platform: 'codex',
      executable: 'test-cli',
      executionTarget: 'codex-cli',
      spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
    })
    const plan = provider.plan({ args: ['review'], subject: 'issue:188' })
    const receipt = provider.execute(plan, { confirm: plan.token })
    expect(validateExecutionReceipt(receipt, config)).toEqual({ ok: true, errors: [] })
    expect(receipt.actual.platform).toBe('codex')
    expect(receipt.revision).toEqual({ source: null, workspaceFingerprint: null })
    expect(receipt.boundaries).toMatchObject({ effective: null, enforced: null, observed: null })
  })

  it('records provider API invocation failures and enforces timeouts', async () => {
    const failing = createProviderApiProvider({
      id: 'test-api',
      platform: 'chatgpt',
      executionTarget: 'provider-api',
      invoke: async () => {
        throw new TypeError('provider rejected request')
      },
    })
    const failedPlan = failing.plan({ subject: 'issue:188' })
    await expect(failing.execute(failedPlan, { confirm: failedPlan.token })).rejects.toThrow(
      'provider rejected request',
    )
    expect(failing.status()).toEqual({ status: 'failed' })
    expect(failing.receipt()).toMatchObject({ status: 'failed', actual: { platform: 'chatgpt' } })
    expect(validateExecutionReceipt(failing.receipt(), config)).toEqual({ ok: true, errors: [] })

    let settleTimedInvocation
    const timed = createProviderApiProvider({
      id: 'slow-api',
      platform: 'chatgpt',
      executionTarget: 'provider-api',
      invoke: () =>
        new Promise((resolve) => {
          settleTimedInvocation = resolve
        }),
    })
    const timedPlan = timed.plan({ timeoutMs: 5 })
    await expect(timed.execute(timedPlan, { confirm: timedPlan.token })).rejects.toThrow(
      'timed out',
    )
    expect(timed.receipt()).toMatchObject({
      status: 'failed',
      cleanup: { status: 'partial' },
      metadata: {
        failure: {
          errorName: 'TimeoutError',
          timedOut: true,
          cancellationObserved: false,
          executionMayContinue: true,
        },
      },
    })
    expect(timed.status()).toEqual({ status: 'timeout-pending' })
    settleTimedInvocation({ late: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(timed.status()).toEqual({ status: 'late-settled' })
  })

  it('cancels an active provider API invocation with a canonical receipt', async () => {
    const provider = createProviderApiProvider({
      id: 'cancel-api',
      platform: 'chatgpt',
      executionTarget: 'provider-api',
      invoke: (_request, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    })
    const plan = provider.plan({ timeoutMs: 1_000 })
    const execution = provider.execute(plan, { confirm: plan.token })
    await Promise.resolve()
    expect(provider.cancel()).toEqual({ status: 'cancellation-requested' })
    await expect(execution).rejects.toThrow('cancellation requested')
    expect(provider.receipt()).toMatchObject({ status: 'cancelled' })
    expect(validateExecutionReceipt(provider.receipt(), config)).toEqual({ ok: true, errors: [] })
  })

  it('does not claim cancellation when an invoker ignores the abort signal', async () => {
    let settle
    const provider = createProviderApiProvider({
      id: 'noncooperative-api',
      platform: 'chatgpt',
      executionTarget: 'provider-api',
      invoke: () =>
        new Promise((resolve) => {
          settle = resolve
        }),
    })
    const plan = provider.plan({ timeoutMs: 1_000 })
    const execution = provider.execute(plan, { confirm: plan.token })
    await Promise.resolve()
    provider.cancel()
    settle({ sideEffectMayHaveCompleted: true })

    await expect(execution).rejects.toThrow('completed after cancellation')
    expect(provider.receipt()).toMatchObject({
      status: 'failed',
      metadata: {
        failure: {
          cancellationRequested: true,
          cancellationObserved: false,
          executionMayContinue: false,
        },
      },
    })
  })

  it('records provider API cleanup failure on the retained receipt', async () => {
    const provider = createProviderApiProvider({
      id: 'cleanup-api',
      platform: 'chatgpt',
      executionTarget: 'provider-api',
      invoke: async () => ({ ok: true }),
      cleanup: async () => {
        throw new Error('cleanup failed')
      },
    })
    const plan = provider.plan()
    await provider.execute(plan, { confirm: plan.token })
    await expect(provider.cleanup()).rejects.toThrow('cleanup failed')
    expect(provider.receipt().cleanup).toEqual({
      status: 'failed',
      actions: ['provider-api-cleanup-failed'],
    })
  })

  it('records manual only as an explicit degraded fallback', async () => {
    const intent = createCollaborationIntent({ requestedMode: 'single-agent' })
    const binding = await bindProvider({ intent, providers: [createManualProvider()] })
    expect(binding).toMatchObject({ status: 'degraded', provider: 'manual', degraded: true })
  })

  it('models Grok explicitly without claiming AFD discovery support', async () => {
    const grok = createGrokProvider({ spawn: () => ({ status: 0, stdout: 'grok', stderr: '' }) })
    expect(await grok.inspect()).toMatchObject({
      availability: 'available',
      executionTarget: 'grok-cli',
    })
    expect(grok.plan({ args: ['review'] }).args.slice(0, 4)).toEqual([
      '--permission-mode',
      'plan',
      '--disable-web-search',
      '--no-subagents',
    ])
    expect(
      grok.plan({
        args: ['review'],
        executionPlan: {
          intentResolutions: [
            {
              id: 'delegated-work',
              status: 'satisfied',
              fidelity: 'full',
              implementation: 'native',
            },
          ],
        },
      }).args,
    ).not.toContain('--no-subagents')
    expect(grok.plan({ args: ['setup'] }).args.at(-1)).toBe('--single=setup')
    for (const bypass of [
      '--no-plan',
      '--permission-mode=full',
      '--tools=web',
      '--agents=enabled',
      '--disable-web-search=false',
    ]) {
      expect(grok.plan({ args: [bypass] }).args.at(-1), bypass).toBe(`--single=${bypass}`)
    }
    expect(() => grok.plan({ args: ['review', 'setup'] })).toThrow('exactly one single-turn prompt')
    expect(AI_FOUNDRY_DESK_CONTRACT.facets).not.toContain('execution')
    expect(AI_FOUNDRY_DESK_CONTRACT.facets).not.toContain('lifecycle')
  })

  it('discovers native Grok intents from the installed CLI help contract', async () => {
    const grok = createGrokProvider({
      spawn: (_executable, args) => ({
        status: 0,
        stdout:
          args[0] === '--help'
            ? '--no-plan --no-subagents --agents --worktree --json-schema'
            : 'grok 1.0.0',
        stderr: '',
      }),
    })
    expect((await grok.inspect()).intentSupport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'delegated-work', evidence: 'probed' }),
        expect.objectContaining({ id: 'parallel-fanout', implementation: 'native' }),
        expect.objectContaining({ id: 'isolated-workspace', fidelity: 'full' }),
      ]),
    )
  })

  it('pins AFD and exposes only its proven public CLI command shape', async () => {
    const provider = createAiFoundryDeskProvider({
      spawn: () => ({ status: 0, stdout: '0.6.4', stderr: '' }),
    })
    expect(AI_FOUNDRY_DESK_CONTRACT.commit).toBe('d5cb4588c33d4fb2ed7fdf589e42782e64b741fb')
    expect(AI_FOUNDRY_DESK_CONTRACT.facets).toEqual(['inventory', 'project-adapters', 'evidence'])
    expect(AI_FOUNDRY_DESK_CONTRACT.artifacts.map((item) => item.path)).toEqual([
      'README.md',
      'docs/PROJECT-HARNESSES.md',
      'docs/CLI.md',
      'agent-manager/src/harness-contracts.ts',
      'agent-manager/src/contracts.ts',
      'agent-manager/src/cli.ts',
    ])
    expect(validateProviderDescriptor(provider)).toEqual({ ok: true, errors: [] })
    expect(await provider.inspect()).toMatchObject({ availability: 'available' })
    expect(aiFoundryDeskHarnessCommand('audit', 'C:/project')).toEqual({
      executable: 'afd',
      args: ['harness', 'audit', 'C:/project', '--json'],
    })
  })
})

describe('GitHub source adapter', () => {
  it('normalizes reads and enforces mutation boundaries', async () => {
    const client = {
      issue: vi.fn(async () => ({
        number: 188,
        html_url: 'https://github.com/smota/agentflow-sdlc/issues/188',
        state: 'open',
        updated_at: '2026-09-01T15:00:00Z',
      })),
      createIssueComment: vi.fn(async () => ({
        id: 10,
        html_url: 'https://github.com/smota/agentflow-sdlc/issues/188#issuecomment-10',
      })),
      issueComments: vi.fn(async () => []),
    }
    const adapter = createGitHubSourceAdapter({
      repo: 'smota/agentflow-sdlc',
      client,
      receiptStore: createMemorySourceReceiptStore(),
    })
    expect(validateSourceAdapter(adapter)).toEqual({ ok: true, errors: [] })
    const result = await adapter.readArtifact({ kind: 'issue', number: 188 })
    expect(result.ref).toMatchObject({ system: 'github', revision: '188' })
    expect(validateArtifactRef(result.ref, config).ok).toBe(true)
    await expect(
      adapter.previewMutation({
        operation: 'add-comment',
        parameters: { number: 188, body: 'test' },
        actionBoundary: { effective: 'observe' },
      }),
    ).rejects.toThrow('requires an open-pr or external-action boundary')
    const preview = await adapter.previewMutation({
      operation: 'add-comment',
      parameters: { number: 188, body: 'test' },
      actionBoundary: { effective: 'external-action' },
    })
    const receipt = await adapter.applyMutation(preview, { confirm: preview.token })
    expect(await adapter.flushReceipt(receipt)).toMatchObject({ status: 'flushed' })
    expect(await adapter.flushReceipt(receipt)).toMatchObject({ status: 'already-flushed' })
    expect(client.createIssueComment).toHaveBeenCalledOnce()
  })

  it('keeps lifecycle CLI operations behind the source contract without a shell', async () => {
    const calls = []
    const adapter = createGitHubCliSourceAdapter({
      repo: 'smota/agentflow-sdlc',
      receiptStore: createMemorySourceReceiptStore(),
      execFile(executable, args, options) {
        calls.push({ executable, args, options })
        return JSON.stringify({ number: 188, url: 'https://example.test/188' })
      },
    })
    await adapter.readArtifact({ kind: 'issue', number: 188 })
    const preview = await adapter.previewMutation({
      operation: 'add-labels',
      parameters: { number: 188, labels: ['dx'] },
      actionBoundary: { effective: 'external-action' },
    })
    await adapter.applyMutation(preview, { confirm: preview.token })
    expect(calls.every((call) => call.executable === 'gh')).toBe(true)
    expect(calls.every((call) => call.options.shell === undefined)).toBe(true)
    expect(
      calls.some(
        (call) =>
          call.args.join(' ') ===
          ['issue', 'edit', '188', '--repo', 'smota/agentflow-sdlc', '--add-label', 'dx'].join(' '),
      ),
    ).toBe(true)
  })

  it('rejects a stale source mutation preview before writing', async () => {
    let updatedAt = '2026-09-01T15:00:00Z'
    const client = {
      issue: vi.fn(async () => ({ number: 188, state: 'open', updated_at: updatedAt })),
      issueComments: vi.fn(async () => []),
      createIssueComment: vi.fn(),
    }
    const adapter = createGitHubSourceAdapter({
      repo: 'smota/agentflow-sdlc',
      client,
      receiptStore: createMemorySourceReceiptStore(),
    })
    const preview = await adapter.previewMutation({
      operation: 'add-comment',
      parameters: { number: 188, body: 'test' },
      actionBoundary: { effective: 'external-action' },
    })
    updatedAt = '2026-09-01T15:01:00Z'
    await expect(adapter.applyMutation(preview, { confirm: preview.token })).rejects.toThrow(
      'stale',
    )
    expect(client.createIssueComment).not.toHaveBeenCalled()
  })

  it('reuses a durable receipt after an adapter restart', async () => {
    const store = createMemorySourceReceiptStore()
    const client = {
      issue: vi.fn(async () => ({
        number: 188,
        state: 'open',
        updated_at: '2026-09-01T15:00:00Z',
      })),
      issueComments: vi.fn(async () => []),
      createIssueComment: vi.fn(async () => ({ id: 10, html_url: 'https://example.test/10' })),
    }
    const first = createGitHubSourceAdapter({ repo: 'owner/repo', client, receiptStore: store })
    const plan = await first.previewMutation({
      operation: 'add-comment',
      parameters: { number: 188, body: 'once' },
      actionBoundary: { effective: 'external-action' },
    })
    const receipt = await first.applyMutation(plan, { confirm: plan.token })
    await first.flushReceipt(receipt)
    const restarted = createGitHubSourceAdapter({ repo: 'owner/repo', client, receiptStore: store })
    const retry = await restarted.previewMutation({
      operation: 'add-comment',
      parameters: { number: 188, body: 'once' },
      actionBoundary: { effective: 'external-action' },
    })
    expect(await restarted.applyMutation(retry, { confirm: retry.token })).toEqual(receipt)
    expect(client.createIssueComment).toHaveBeenCalledOnce()
  })

  it('propagates ensure-label failures instead of emitting a false receipt', async () => {
    const adapter = createGitHubCliSourceAdapter({
      repo: 'owner/repo',
      receiptStore: createMemorySourceReceiptStore(),
      execFile(executable, args) {
        if (args[0] === 'label' && args[1] === 'create') throw new Error('permission denied')
        return '[]'
      },
    })
    const plan = await adapter.previewMutation({
      operation: 'ensure-label',
      parameters: { label: 'integrated' },
      actionBoundary: { effective: 'external-action' },
    })
    await expect(adapter.applyMutation(plan, { confirm: plan.token })).rejects.toThrow(
      'permission denied',
    )
  })
})
