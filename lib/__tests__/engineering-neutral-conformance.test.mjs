import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { dispatchToHarness, HarnessContractError } from '../providers/harness-dispatch.mjs'
import { createLocalCliProvider } from '../providers/local-cli.mjs'
import {
  createGovernedEngineeringAdapter,
  createSourceEngineeringReceiptResolver,
} from '../providers/governed-engineering.mjs'
import { createRunEvent } from '../core/run-state.mjs'
import { validateExecutionReceipt } from '../core/execution-receipt.mjs'

const operationId = 'run-1-edit-1'
const candidateDigest = 'c'.repeat(64)
const bytes = Buffer.from([0, 255, 10])
const sha256 = createHash('sha256').update(bytes).digest('hex')

function neutralProvider(id, mutate = (x) => x) {
  return {
    id,
    targets: [`${id}-cli`],
    intentSupport: [],
    async inspect() {
      return { availability: 'available', executionTarget: `${id}-cli` }
    },
    plan(request) {
      return { token: 'plan-token', request }
    },
    async execute(plan) {
      const output = mutate({
        status: 'pass',
        operationId,
        candidateDigest,
        artifacts: [
          {
            path: 'result.bin',
            contentBase64: bytes.toString('base64'),
            sha256,
            byteLength: bytes.length,
          },
        ],
      })
      return {
        status: 'pass',
        provider: id,
        executionTarget: `${id}-cli`,
        metadata: { engineeringProfile: plan.request.engineeringProfile },
        output: { stdout: JSON.stringify(output) },
      }
    },
  }
}

async function run(provider) {
  return dispatchToHarness({
    provider,
    executionTarget: `${provider.id}-cli`,
    operationId,
    candidateDigest,
    expectedArtifacts: ['result.bin'],
  })
}

describe('neutral engineering process boundary', () => {
  for (const id of ['direct', 'alternate']) {
    it(`${id} translates exact bytes and identity to a canonical receipt`, async () => {
      const result = await run(neutralProvider(id))
      expect(result.engineeringReceipt).toMatchObject({
        version: 1,
        provider: id,
        operationId,
        candidateDigest,
        status: 'pass',
        artifacts: [{ path: 'result.bin', sha256, byteLength: 3 }],
      })
    })
    it.each([
      ['negative', (output) => ({ ...output, ok: false })],
      ['running', (output) => ({ ...output, status: 'running' })],
      ['stale candidate', (output) => ({ ...output, candidateDigest: 'd'.repeat(64) })],
      [
        'tampered bytes',
        (output) => ({ ...output, artifacts: [{ ...output.artifacts[0], contentBase64: 'AAE=' }] }),
      ],
      [
        'oversized envelope',
        (output) => ({ ...output, metadata: { padding: 'x'.repeat(33 * 1024) } }),
      ],
    ])(`${id} refuses %s`, async (_name, mutate) => {
      const result = run(neutralProvider(id, mutate))
      if (_name === 'negative' || _name === 'running')
        expect((await result).status).not.toBe('pass')
      else await expect(result).rejects.toBeInstanceOf(HarnessContractError)
    })
  }

  it('binds a qualified requested model to real CLI invocation arguments', async () => {
    const calls = []
    const provider = createLocalCliProvider({
      id: 'model-cli',
      platform: 'model-cli',
      executable: 'model-cli',
      executionTarget: 'model-cli',
      modelFlag: '--model',
      qualifiedModels: ['qualified-model'],
      spawn: (_exe, args) => {
        calls.push(args)
        if (args.includes('--version')) return { status: 0, stdout: 'model-cli 1', stderr: '' }
        return {
          status: 0,
          stdout: JSON.stringify({ status: 'pass', operationId, candidateDigest, artifacts: [] }),
          stderr: '',
        }
      },
    })
    const result = await dispatchToHarness({
      provider,
      executionTarget: 'model-cli',
      requestedModel: 'qualified-model',
      operationId,
      candidateDigest,
    })
    expect(result.status).toBe('pass')
    expect(calls.at(-1).slice(0, 2)).toEqual(['--model', 'qualified-model'])
    await expect(
      dispatchToHarness({
        provider,
        executionTarget: 'model-cli',
        requestedModel: 'unqualified-model',
        operationId,
        candidateDigest,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL' })
  })

  it('dispatches through a real child process but requires independent durable reconciliation', async () => {
    const code = `const r = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify({ status:'pass', operationId:r.operationId, candidateDigest:r.candidateDigest, artifacts:[] }))`
    const provider = createLocalCliProvider({
      id: 'node-fixture',
      platform: 'node',
      executable: process.execPath,
      executionTarget: 'node-fixture-cli',
      intentSupport: [
        {
          id: 'file-edit',
          implementation: 'adapter',
          fidelity: 'full',
          evidence: 'contract-tested',
        },
      ],
      qualifiedCapabilities: ['file-edit'],
      prepareArgs: (_args, request) => ['-e', code, JSON.stringify(request.engineeringProfile)],
    })
    const operation = { id: operationId, action: 'edit', candidateDigest, arguments: {} }
    const admission = { operation, operationDigest: 'a'.repeat(64) }
    const record = { id: operation.id, payloadDigest: admission.operationDigest }
    let durable = null
    const adapter = createGovernedEngineeringAdapter({
      provider,
      executionTarget: 'node-fixture-cli',
      resolveReceipt: async () => durable,
    })
    const dispatched = await adapter.dispatch(operation)
    expect(dispatched.status).toBe('pass')
    expect(dispatched.receipt.disclosure).toEqual({ authorized: false, scope: 'local-only' })
    const optedIn = createGovernedEngineeringAdapter({
      provider,
      executionTarget: 'node-fixture-cli',
      sourceEvidenceDisclosure: 'bounded-output-and-artifacts',
      resolveReceipt: async () => durable,
    })
    const disclosed = await optedIn.dispatch({
      ...operation,
      arguments: {
        requestPayload: {
          disclosure: { authorized: false, scope: 'caller-forged' },
          allowedPaths: ['caller-forged.txt'],
        },
      },
    })
    expect(disclosed.receipt.disclosure).toEqual({
      authorized: true,
      scope: 'configured-source:bounded-output-and-artifacts',
    })
    expect(validateExecutionReceipt(disclosed.receipt).ok).toBe(true)
    expect(disclosed.receipt.requestDigest).not.toBe(dispatched.receipt.requestDigest)
    expect(await adapter.reconcile(record, admission)).toMatchObject({ verified: false })
    durable = {
      verified: true,
      sourceRevision: 'f'.repeat(64),
      receipt: dispatched.receipt,
      output: JSON.stringify({ status: 'pass', operationId, candidateDigest, artifacts: [] }),
    }
    expect(await adapter.reconcile(record, admission)).toMatchObject({
      verified: true,
      state: 'confirmed',
      operationId,
      payloadDigest: admission.operationDigest,
      candidateDigest,
      sourceRevision: 'f'.repeat(64),
    })
    durable = {
      ...durable,
      output: JSON.stringify({ status: 'running', operationId, candidateDigest, artifacts: [] }),
    }
    expect(await adapter.reconcile(record, admission)).toMatchObject({ verified: false })
    durable = {
      ...durable,
      receipt: {
        ...dispatched.receipt,
        metadata: {
          ...dispatched.receipt.metadata,
          engineeringProfile: { operationId, candidateDigest: 'd'.repeat(64) },
        },
      },
    }
    expect(await adapter.reconcile(record, admission)).toMatchObject({ verified: false })
    expect(
      await adapter.reconcile({ ...record, payloadDigest: 'b'.repeat(64) }, admission),
    ).toMatchObject({ verified: false })
  })

  it('keeps a process deadline uncertain until independently reconciled', async () => {
    const provider = createLocalCliProvider({
      id: 'slow-fixture',
      platform: 'node',
      executable: process.execPath,
      executionTarget: 'slow-fixture-cli',
      prepareArgs: () => ['-e', 'setTimeout(() => {}, 1000)'],
    })
    const result = await dispatchToHarness({
      provider,
      executionTarget: 'slow-fixture-cli',
      timeoutMs: 10,
      operationId,
      candidateDigest,
    })
    expect(result.status).toBe('unknown')
  })

  it('resolves only one fresh, digest-valid source checkpoint with verified output', async () => {
    const code = `const r = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify({ status:'pass', operationId:r.operationId, candidateDigest:r.candidateDigest, artifacts:[] }))`
    const provider = createLocalCliProvider({
      id: 'node-source-fixture',
      platform: 'node',
      executable: process.execPath,
      executionTarget: 'node-source-fixture-cli',
      prepareArgs: (_args, request) => ['-e', code, JSON.stringify(request.engineeringProfile)],
    })
    const operation = { id: operationId, action: 'edit', candidateDigest, arguments: {} }
    const admission = { operation, operationDigest: 'a'.repeat(64) }
    const record = { id: operation.id, payloadDigest: admission.operationDigest }
    const dispatched = await dispatchToHarness({
      provider,
      executionTarget: 'node-source-fixture-cli',
      operationId,
      candidateDigest,
    })
    expect(dispatched.verifiedOutput.stdout).toContain(operationId)
    const start = createRunEvent({
      runId: 'engineering-run',
      id: 'start',
      kind: 'started',
      payload: {
        profile: 'standard',
        boundary: 'mutate-worktree',
        goalRef: 'issue:302',
        owner: 'codex',
      },
    })
    const checkpoint = (output) =>
      createRunEvent({
        runId: 'engineering-run',
        id: 'receipt-1',
        previousDigest: start.digest,
        kind: 'checkpoint',
        payload: { kind: 'engineering-result', operationId, receipt: dispatched.receipt, output },
      })
    let events = [start]
    const resolver = createSourceEngineeringReceiptResolver({
      store: { durable: true, read: async () => ({ events }) },
    })
    expect(await resolver(record, admission)).toMatchObject({ verified: false })
    events = [start, checkpoint(dispatched.verifiedOutput)]
    expect(await resolver(record, admission)).toMatchObject({
      verified: true,
      sourceRevision: events[1].digest,
    })
    events[1].payload.output = 'tampered'
    expect(await resolver(record, admission)).toMatchObject({ verified: false })
    events = [start, checkpoint('x'.repeat(32 * 1024 + 1))]
    expect(await resolver(record, admission)).toMatchObject({ verified: false })
    events = [
      start,
      checkpoint(JSON.stringify({ status: 'running', operationId, candidateDigest })),
    ]
    expect(await resolver(record, admission)).toMatchObject({ verified: false })
    const first = checkpoint(dispatched.verifiedOutput)
    events = [
      start,
      first,
      createRunEvent({
        runId: 'engineering-run',
        id: 'receipt-2',
        previousDigest: first.digest,
        kind: 'checkpoint',
        payload: {
          kind: 'engineering-result',
          operationId,
          receipt: dispatched.receipt,
          output: dispatched.verifiedOutput,
        },
      }),
    ]
    expect(await resolver(record, admission)).toMatchObject({ verified: false })
  })
})
