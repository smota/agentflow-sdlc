import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createCodexEngineeringProvider } from '../providers/codex-engineering.mjs'
import { dispatchToHarness } from '../providers/harness-dispatch.mjs'
import { resolveConfiguredEngineeringProvider } from '../providers/registry.mjs'

const candidateDigest = 'c'.repeat(64)

function writableFixture(prefix) {
  const cwd = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(cwd, '.git'))
  return cwd
}

function fakeSpawn(calls, mutate = (value) => value) {
  return (_binary, args) => {
    calls.push(args)
    if (args.includes('--version')) return { status: 0, stdout: 'codex-cli 0.154.0', stderr: '' }
    if (args.includes('--help'))
      return {
        status: 0,
        stdout:
          '--model --sandbox --output-schema --output-last-message --ephemeral --ignore-user-config',
        stderr: '',
      }
    const resultPath = args[args.indexOf('--output-last-message') + 1]
    writeFileSync(
      resultPath,
      JSON.stringify(
        mutate({ status: 'pass', operationId: 'edit-1', candidateDigest, artifacts: [] }),
      ),
    )
    return { status: 0, stdout: 'human progress text, ignored', stderr: '' }
  }
}

describe('explicit Codex engineering CLI', () => {
  it('keeps file editing unqualified without a live write attestation', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'codex-engineering-unqualified-'))
    try {
      const provider = createCodexEngineeringProvider({
        cwd,
        model: 'gpt-5.6-luna',
        executable: 'codex.exe',
        spawn: fakeSpawn([]),
      })
      const inspection = await provider.inspect()
      expect(inspection.qualification.capabilities).not.toContain('file-edit')
      await expect(
        dispatchToHarness({
          provider,
          executionTarget: 'codex-cli',
          requestedModel: 'gpt-5.6-luna',
          requiredCapabilities: ['file-edit'],
          permissionBoundary: 'mutate-worktree',
          operationId: 'edit-1',
          candidateDigest,
          requestPayload: { prompt: 'Edit test.txt', allowedPaths: ['test.txt'] },
        }),
      ).rejects.toMatchObject({ code: 'MISSING_CAPABILITY' })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
  it('selects the configured model and workspace sandbox, reading only final structured file', async () => {
    const cwd = writableFixture('codex-engineering-test-')
    try {
      const calls = []
      const provider = createCodexEngineeringProvider({
        cwd,
        model: 'gpt-6-luna',
        writeQualified: true,
        executable: 'codex.exe',
        spawn: fakeSpawn(calls),
      })
      const result = await dispatchToHarness({
        provider,
        executionTarget: 'codex-cli',
        requestedModel: 'gpt-6-luna',
        requiredCapabilities: ['file-edit'],
        permissionBoundary: 'mutate-worktree',
        operationId: 'edit-1',
        candidateDigest,
        requestPayload: { prompt: 'Make a harmless edit.', allowedPaths: ['test.txt'] },
      })
      expect(result.status).toBe('pass')
      expect(result.receipt.actual.model).toBe(null)
      const invocation = calls.at(-1)
      expect(invocation.slice(0, 7)).toEqual([
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--model',
        'gpt-6-luna',
        '--sandbox',
        'workspace-write',
      ])
      expect(invocation).toContain('--output-last-message')
      expect(result.verifiedOutput.stdout).not.toContain('human progress')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('rejects a stale structured result and an unselected model', async () => {
    const cwd = writableFixture('codex-engineering-test-')
    try {
      const provider = createCodexEngineeringProvider({
        cwd,
        model: 'gpt-6-luna',
        executable: 'codex.exe',
        spawn: fakeSpawn([], (result) => ({ ...result, candidateDigest: 'd'.repeat(64) })),
      })
      await expect(
        dispatchToHarness({
          provider,
          executionTarget: 'codex-cli',
          requestedModel: 'gpt-6-luna',
          permissionBoundary: 'mutate-worktree',
          operationId: 'edit-1',
          candidateDigest,
          requestPayload: { prompt: 'Make a harmless edit.', allowedPaths: ['test.txt'] },
        }),
      ).resolves.toMatchObject({ status: 'failed' })
      await expect(
        dispatchToHarness({
          provider,
          executionTarget: 'codex-cli',
          requestedModel: 'gpt-6-sol',
          permissionBoundary: 'mutate-worktree',
          operationId: 'edit-1',
          candidateDigest,
          requestPayload: { prompt: 'Make a harmless edit.', allowedPaths: ['test.txt'] },
        }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL' })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('reads actual bytes for an exact allowed edit', async () => {
    const cwd = writableFixture('codex-engineering-allowed-')
    try {
      const calls = []
      const baseSpawn = fakeSpawn(calls, (result) => ({
        ...result,
        artifacts: [{ path: 'allowed.txt' }],
      }))
      const spawn = (binary, args, options) => {
        if (!args.includes('--version') && !args.includes('--help'))
          writeFileSync(join(cwd, 'allowed.txt'), 'verified bytes\n')
        return baseSpawn(binary, args, options)
      }
      const provider = createCodexEngineeringProvider({
        cwd,
        model: 'gpt-5.6-luna',
        executable: 'codex.exe',
        writeQualified: true,
        spawn,
      })
      const result = await dispatchToHarness({
        provider,
        executionTarget: 'codex-cli',
        requestedModel: 'gpt-5.6-luna',
        requiredCapabilities: ['file-edit'],
        permissionBoundary: 'mutate-worktree',
        operationId: 'edit-1',
        candidateDigest,
        expectedArtifacts: ['allowed.txt'],
        requestPayload: { prompt: 'Edit allowed.txt', allowedPaths: ['allowed.txt'] },
      })
      expect(result.status).toBe('pass')
      expect(result.artifacts[0].sha256).toBe(
        createHash('sha256').update('verified bytes\n').digest('hex'),
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('registers only when explicitly selected with a workspace and model', () => {
    expect(resolveConfiguredEngineeringProvider({ delivery: {} }, { cwd: process.cwd() })).toBe(
      null,
    )
    const result = resolveConfiguredEngineeringProvider(
      {
        delivery: {
          engineeringProvider: {
            id: 'codex-engineering-cli',
            executionTarget: 'codex-cli',
            requestedModel: 'gpt-6-luna',
            requiredCapabilities: ['file-edit'],
            sourceEvidenceDisclosure: 'bounded-output-and-artifacts',
          },
        },
      },
      { cwd: process.cwd(), codexEngineering: { executable: 'codex.exe', spawn: fakeSpawn([]) } },
    )
    expect(result.provider.id).toBe('codex-engineering-cli')
    expect(result.requestedModel).toBe('gpt-6-luna')
    expect(result.sourceEvidenceDisclosure).toBe('bounded-output-and-artifacts')
  })

  it('refuses a successful model claim after an actual out-of-scope edit', async () => {
    const cwd = writableFixture('codex-engineering-scope-')
    try {
      const baseSpawn = fakeSpawn([])
      const spawn = (binary, args, options) => {
        if (!args.includes('--version') && !args.includes('--help'))
          writeFileSync(join(cwd, 'outside.txt'), 'unexpected edit\n')
        return baseSpawn(binary, args, options)
      }
      const provider = createCodexEngineeringProvider({
        cwd,
        model: 'gpt-5.6-luna',
        executable: 'codex.exe',
        writeQualified: true,
        spawn,
      })
      const result = await dispatchToHarness({
        provider,
        executionTarget: 'codex-cli',
        requestedModel: 'gpt-5.6-luna',
        requiredCapabilities: ['file-edit'],
        permissionBoundary: 'mutate-worktree',
        operationId: 'edit-1',
        candidateDigest,
        requestPayload: { prompt: 'Edit only allowed.txt', allowedPaths: ['allowed.txt'] },
      })
      expect(result.status).toBe('unknown')
      expect(result.receipt.metadata.failureReason).toBe('OUT_OF_SCOPE_WORKSPACE_EFFECT')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it.each(['delete', 'rename'])('keeps an out-of-scope %s outcome unknown', async (kind) => {
    const cwd = writableFixture('codex-engineering-scope-')
    try {
      writeFileSync(join(cwd, 'outside.txt'), 'baseline\n')
      const baseSpawn = fakeSpawn([])
      const spawn = (binary, args, options) => {
        if (!args.includes('--version') && !args.includes('--help')) {
          if (kind === 'delete') unlinkSync(join(cwd, 'outside.txt'))
          else renameSync(join(cwd, 'outside.txt'), join(cwd, 'renamed.txt'))
        }
        return baseSpawn(binary, args, options)
      }
      const provider = createCodexEngineeringProvider({
        cwd,
        model: 'gpt-5.6-luna',
        executable: 'codex.exe',
        writeQualified: true,
        spawn,
      })
      const result = await dispatchToHarness({
        provider,
        executionTarget: 'codex-cli',
        requestedModel: 'gpt-5.6-luna',
        requiredCapabilities: ['file-edit'],
        permissionBoundary: 'mutate-worktree',
        operationId: 'edit-1',
        candidateDigest,
        requestPayload: { prompt: 'Edit only allowed.txt', allowedPaths: ['allowed.txt'] },
      })
      expect(result.status).toBe('unknown')
      expect(result.receipt.metadata.failureReason).toBe('OUT_OF_SCOPE_WORKSPACE_EFFECT')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it.each(['.agent-runs/audit/record.json', '.git/config'])(
    'detects a runtime-owned %s change alongside an allowed edit',
    async (extra) => {
      const cwd = writableFixture('codex-engineering-runtime-')
      try {
        const baseSpawn = fakeSpawn([], (result) => ({
          ...result,
          artifacts: [{ path: 'allowed.txt' }],
        }))
        const spawn = (binary, args, options) => {
          if (!args.includes('--version') && !args.includes('--help')) {
            writeFileSync(join(cwd, 'allowed.txt'), 'allowed\n')
            const target = join(cwd, ...extra.split('/'))
            mkdirSync(dirname(target), { recursive: true })
            writeFileSync(target, 'unexpected\n')
          }
          return baseSpawn(binary, args, options)
        }
        const provider = createCodexEngineeringProvider({
          cwd,
          model: 'gpt-5.6-luna',
          executable: 'codex.exe',
          writeQualified: true,
          spawn,
        })
        const result = await dispatchToHarness({
          provider,
          executionTarget: 'codex-cli',
          requestedModel: 'gpt-5.6-luna',
          requiredCapabilities: ['file-edit'],
          permissionBoundary: 'mutate-worktree',
          operationId: 'edit-1',
          candidateDigest,
          requestPayload: { prompt: 'Edit only allowed.txt', allowedPaths: ['allowed.txt'] },
        })
        expect(result.status).toBe('unknown')
        expect(result.receipt.metadata.failureReason).toBe('OUT_OF_SCOPE_WORKSPACE_EFFECT')
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    },
  )

  it('does not qualify writes in a linked worktree with a .git pointer file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'codex-engineering-linked-'))
    try {
      writeFileSync(join(cwd, '.git'), 'gitdir: elsewhere\n')
      const provider = createCodexEngineeringProvider({
        cwd,
        model: 'gpt-5.6-luna',
        executable: 'codex.exe',
        writeQualified: true,
        spawn: fakeSpawn([]),
      })
      const inspection = await provider.inspect()
      expect(inspection.qualification.capabilities).not.toContain('file-edit')
      await expect(
        dispatchToHarness({
          provider,
          executionTarget: 'codex-cli',
          requestedModel: 'gpt-5.6-luna',
          requiredCapabilities: ['file-edit'],
          permissionBoundary: 'mutate-worktree',
          operationId: 'edit-1',
          candidateDigest,
          requestPayload: { prompt: 'Edit allowed.txt', allowedPaths: ['allowed.txt'] },
        }),
      ).rejects.toMatchObject({ code: 'MISSING_CAPABILITY' })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('checks workspace snapshot bounds before launching the editing process', async () => {
    const cwd = writableFixture('codex-engineering-bound-')
    try {
      writeFileSync(join(cwd, 'oversized.bin'), Buffer.alloc(10 * 1024 * 1024 + 1))
      const calls = []
      const provider = createCodexEngineeringProvider({
        cwd,
        model: 'gpt-5.6-luna',
        executable: 'codex.exe',
        writeQualified: true,
        spawn: fakeSpawn(calls),
      })
      const result = await dispatchToHarness({
        provider,
        executionTarget: 'codex-cli',
        requestedModel: 'gpt-5.6-luna',
        requiredCapabilities: ['file-edit'],
        permissionBoundary: 'mutate-worktree',
        operationId: 'edit-1',
        candidateDigest,
        requestPayload: { prompt: 'Edit allowed.txt', allowedPaths: ['allowed.txt'] },
      })
      expect(result.status).toBe('unknown')
      expect(calls.every((args) => args.includes('--version') || args.includes('--help'))).toBe(
        true,
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('rejects a tampered plan path list before process dispatch', () => {
    const cwd = writableFixture('codex-engineering-plan-')
    try {
      const calls = []
      const provider = createCodexEngineeringProvider({
        cwd,
        model: 'gpt-5.6-luna',
        executable: 'codex.exe',
        spawn: fakeSpawn(calls),
      })
      const plan = provider.plan({
        model: 'gpt-5.6-luna',
        boundary: 'mutate-worktree',
        prompt: 'Edit only allowed.txt',
        allowedPaths: ['allowed.txt'],
        engineeringProfile: { operationId: 'edit-1', candidateDigest },
      })
      plan.allowedPaths = ['outside.txt']
      expect(() => provider.execute(plan, { confirm: plan.token })).toThrow(/confirmation invalid/)
      expect(calls).toHaveLength(0)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
