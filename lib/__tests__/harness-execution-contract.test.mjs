import { describe, expect, it } from 'vitest'
import {
  HarnessContractError,
  MAX_CONTROL_CONTEXT_BYTES,
  MAX_ARTIFACT_BYTES,
  preflightHarnessCapability,
  validateDispatchContext,
  parseAndVerifyHarnessOutput,
  dispatchToHarness,
} from '../providers/harness-dispatch.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import { createLocalCliProvider } from '../providers/local-cli.mjs'

describe('Harness Execution Contract (S6)', () => {
  const fakeProvider = {
    id: 'test-harness',
    targets: ['test-cli'],
    intentSupport: [
      { id: 'plan-before-edit', implementation: 'native' },
      { id: 'workflow-orchestration', implementation: 'native' },
      { id: 'file-edit', implementation: 'native' },
    ],
    async inspect() {
      return { availability: 'available', reason: 'ready' }
    },
    plan(req) {
      return {
        provider: 'test-harness',
        token: 'test-token-123',
        req,
      }
    },
    async execute(plan, { confirm }) {
      if (confirm !== plan.token) throw new Error('Confirmation mismatch')
      return {
        provider: 'test-harness',
        status: 'pass',
        output: {
          stdout: JSON.stringify({
            status: 'success',
            artifacts: [
              {
                path: 'lib/example.mjs',
                content: 'export const hello = "world"\n',
              },
            ],
          }),
        },
      }
    },
  }

  describe('preflightHarnessCapability', () => {
    it('rejects missing provider', async () => {
      await expect(preflightHarnessCapability({ provider: null })).rejects.toThrow(
        HarnessContractError,
      )
      await expect(preflightHarnessCapability({ provider: null })).rejects.toMatchObject({
        code: 'INVALID_PROVIDER',
      })
    })

    it('rejects unavailable provider', async () => {
      const unavailableProvider = {
        ...fakeProvider,
        inspect: async () => ({ availability: 'unavailable', reason: 'binary missing' }),
      }
      await expect(
        preflightHarnessCapability({ provider: unavailableProvider }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      })
    })

    it('rejects unsupported execution target', async () => {
      await expect(
        preflightHarnessCapability({
          provider: fakeProvider,
          executionTarget: 'unsupported-target',
        }),
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED_TARGET',
      })
    })

    it('rejects missing capability', async () => {
      await expect(
        preflightHarnessCapability({
          provider: fakeProvider,
          requiredCapabilities: ['unsupported-cap'],
        }),
      ).rejects.toMatchObject({
        code: 'MISSING_CAPABILITY',
      })
    })

    it('accepts matching capability and target', async () => {
      const result = await preflightHarnessCapability({
        provider: fakeProvider,
        executionTarget: 'test-cli',
        requiredCapabilities: ['plan-before-edit'],
        requestedModel: 'test-model-4',
      })
      expect(result.ok).toBe(true)
      expect(result.executionTarget).toBe('test-cli')
      expect(result.requestedModel).toBe('test-model-4')
    })
  })

  describe('validateDispatchContext', () => {
    it('accepts small contexts', () => {
      expect(() => validateDispatchContext({ task: 'foo', budget: 100 })).not.toThrow()
      expect(() => validateDispatchContext('short string')).not.toThrow()
      expect(() => validateDispatchContext(null)).not.toThrow()
    })

    it('rejects contexts exceeding 32 KiB', () => {
      const oversized = 'x'.repeat(MAX_CONTROL_CONTEXT_BYTES + 1)
      expect(() => validateDispatchContext(oversized)).toThrow(HarnessContractError)
      expect(() => validateDispatchContext(oversized)).toThrowError(/exceeds bounded limit/)
      expect(() => validateDispatchContext({ data: oversized })).toThrowError(
        /exceeds bounded limit/,
      )
    })
  })

  describe('parseAndVerifyHarnessOutput', () => {
    it('rejects empty or null output', () => {
      expect(() => parseAndVerifyHarnessOutput(null)).toThrow(HarnessContractError)
      expect(() => parseAndVerifyHarnessOutput('')).toThrow(HarnessContractError)
    })

    it('rejects explicit truncation markers', () => {
      expect(() => parseAndVerifyHarnessOutput({ truncated: true })).toThrowError(/truncated/)
      expect(() => parseAndVerifyHarnessOutput('Some log ... [truncated]')).toThrowError(
        /truncated/,
      )
      expect(() =>
        parseAndVerifyHarnessOutput(JSON.stringify({ truncated: true, artifacts: [] })),
      ).toThrowError(/truncated/)
    })

    it('rejects malformed json string', () => {
      expect(() => parseAndVerifyHarnessOutput('{ not valid json')).toThrowError(/Malformed/)
    })

    it('handles failure status cleanly without applying artifacts', () => {
      const result = parseAndVerifyHarnessOutput({ status: 'failed', error: 'Syntax error' })
      expect(result.status).toBe('failed')
      expect(result.error).toBe('Syntax error')
      expect(result.artifacts).toEqual([])
    })

    it('rejects unsafe artifact paths', () => {
      const unsafe = {
        artifacts: [{ path: '../secret.env', content: 'SECRET=123' }],
      }
      expect(() => parseAndVerifyHarnessOutput(unsafe)).toThrowError(
        /Invalid or unsafe artifact path/,
      )
    })

    it('rejects oversized artifact', () => {
      const oversized = {
        artifacts: [{ path: 'lib/big.bin', content: 'x'.repeat(MAX_ARTIFACT_BYTES + 1) }],
      }
      expect(() => parseAndVerifyHarnessOutput(oversized)).toThrowError(/exceeds max size limit/)
    })

    it('detects artifact digest mismatch', () => {
      const content = 'clean code\n'
      const badDigest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      const payload = {
        artifacts: [{ path: 'lib/clean.mjs', content, digest: badDigest }],
      }
      expect(() => parseAndVerifyHarnessOutput(payload)).toThrowError(/digest mismatch/)
    })

    it('rejects when expected artifact is missing', () => {
      const payload = {
        artifacts: [{ path: 'lib/other.mjs', content: 'data' }],
      }
      expect(() =>
        parseAndVerifyHarnessOutput(payload, { expectedArtifacts: ['lib/expected.mjs'] }),
      ).toThrowError(/Required expected artifact missing/)
    })

    it('verifies valid artifacts and computes accurate digests', () => {
      const content = 'console.log("hello world")\n'
      const digest = recordDigest(content)
      const payload = {
        artifacts: [{ path: 'lib/hello.mjs', content, digest }],
      }
      const verified = parseAndVerifyHarnessOutput(payload, {
        expectedArtifacts: ['lib/hello.mjs'],
      })
      expect(verified.status).toBe('pass')
      expect(verified.artifacts).toHaveLength(1)
      expect(verified.artifacts[0].digest).toBe(digest)
      expect(verified.artifacts[0].path).toBe('lib/hello.mjs')
    })
  })

  describe('dispatchToHarness', () => {
    it('refuses edit capability when permission boundary is observe', async () => {
      await expect(
        dispatchToHarness({
          provider: fakeProvider,
          requiredCapabilities: ['file-edit'],
          permissionBoundary: 'observe',
        }),
      ).rejects.toMatchObject({
        code: 'BOUNDARY_DENIED',
      })
    })

    it('refuses execution when context budget is exceeded', async () => {
      await expect(
        dispatchToHarness({
          provider: fakeProvider,
          permissionBoundary: 'write',
          context: 'x'.repeat(MAX_CONTROL_CONTEXT_BYTES + 10),
        }),
      ).rejects.toMatchObject({
        code: 'CONTEXT_BUDGET_EXCEEDED',
      })
    })

    it('successfully dispatches, verifies output and returns artifacts', async () => {
      const result = await dispatchToHarness({
        provider: fakeProvider,
        executionTarget: 'test-cli',
        permissionBoundary: 'write',
        requiredCapabilities: ['plan-before-edit', 'file-edit'],
        expectedArtifacts: ['lib/example.mjs'],
      })

      expect(result.status).toBe('pass')
      expect(result.artifacts).toHaveLength(1)
      expect(result.artifacts[0].path).toBe('lib/example.mjs')
      expect(result.artifacts[0].content).toBe('export const hello = "world"\n')
      expect(result.artifacts[0].digest).toBe(recordDigest('export const hello = "world"\n'))
    })
  })

  describe('bounded real CLI smoke test', () => {
    it('dispatches to local cli provider for version inspection', async () => {
      const nodeCli = createLocalCliProvider({
        id: 'node-cli',
        platform: 'node',
        executable: process.execPath,
        executionTarget: 'node-cli',
        intentSupport: [{ id: 'plan-before-edit' }],
        prepareArgs: () => ['--version'],
      })

      const inspection = await nodeCli.inspect()
      expect(inspection.availability).toBe('available')
      expect(inspection.metadata?.version).toMatch(/^v\d+/)

      const plan = nodeCli.plan({ args: ['--version'] })
      const receipt = await nodeCli.execute(plan, { confirm: plan.token })
      expect(receipt.status).toBe('pass')
      expect(receipt.digests.output).toBeDefined()
      expect(receipt.actual.platform).toBe('node')
    })
  })
})
