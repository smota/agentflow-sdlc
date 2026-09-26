import { spawnSync } from 'node:child_process'
import { createProviderExecutionReceipt, providerDigest } from './provider-receipt.mjs'
import { emitObservation } from '../observability/observer.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import { safePath } from '../core/delegation-grant.mjs'
import { inspectExecutable } from './local-cli.mjs'

export const MESHLOOP_PROFILE_VERSION = 1
export const MAX_OUTPUT_FRAME_BYTES = 64 * 1024

const KNOWN_NOTICE_PREFIX =
  'Note: worktrees are kept. `run` does not merge onto your current branch.\n' +
  'Use `meshloop accept` then `meshloop resume`, and `meshloop integrate --into` to land.\n\n'

export class MeshloopAdapterError extends Error {
  constructor(message, { code = 'MESHLOOP_ADAPTER_ERROR', details = null } = {}) {
    super(message)
    this.name = 'MeshloopAdapterError'
    this.code = code
    this.details = details
  }
}

export function parseMeshloopOutput(stdout) {
  if (typeof stdout !== 'string') {
    throw new MeshloopAdapterError('Meshloop stdout must be a string', {
      code: 'INVALID_OUTPUT_TYPE',
    })
  }
  const byteLength = Buffer.byteLength(stdout)
  if (byteLength > MAX_OUTPUT_FRAME_BYTES) {
    throw new MeshloopAdapterError(
      `Meshloop output exceeds frame limit of ${MAX_OUTPUT_FRAME_BYTES} bytes`,
      {
        code: 'OUTPUT_FRAME_OVERSIZED',
        details: { byteLength },
      },
    )
  }

  const normalized = stdout.replace(/\r\n/g, '\n')
  let jsonString = normalized
  let framing = 'strict-json'

  if (normalized.startsWith(KNOWN_NOTICE_PREFIX)) {
    jsonString = normalized.slice(KNOWN_NOTICE_PREFIX.length)
    framing = 'known-notice-prefix'
  } else if (!normalized.trimStart().startsWith('{')) {
    throw new MeshloopAdapterError('Unrecognized output framing or invalid preamble', {
      code: 'UNQUALIFIED_OUTPUT_FRAMING',
    })
  }

  let parsed
  try {
    parsed = JSON.parse(jsonString)
  } catch (err) {
    throw new MeshloopAdapterError(`Malformed Meshloop JSON payload: ${err.message}`, {
      code: 'MALFORMED_OUTPUT_JSON',
    })
  }

  return {
    raw: parsed,
    framing,
    ok: parsed.ok === true,
    command: parsed.command,
    data: parsed.data ?? {},
  }
}

export function createMeshloopProvider({
  id = 'meshloop',
  platform = 'meshloop',
  executable = 'meshloop',
  executionTarget = 'meshloop-cli',
  transport = 'local-cli',
  delegationBoundary = 'separate-process',
  intentSupport = [
    {
      id: 'plan-before-edit',
      implementation: 'native',
      fidelity: 'full',
      evidence: 'contract-tested',
      limits: {},
    },
    {
      id: 'workflow-orchestration',
      implementation: 'native',
      fidelity: 'full',
      evidence: 'contract-tested',
      limits: {},
    },
    {
      id: 'bounded-loop',
      implementation: 'native',
      fidelity: 'full',
      evidence: 'contract-tested',
      limits: {},
    },
    {
      id: 'isolated-workspace',
      implementation: 'native',
      fidelity: 'full',
      evidence: 'contract-tested',
      limits: {},
    },
  ],
  providerVersion = '1.0.0',
  profileVersion = MESHLOOP_PROFILE_VERSION,
  osSupport = ['win32', 'linux', 'darwin'],
  trustSource = 'optional Meshloop adapter configuration',
  spawn = spawnSync,
  observer = null,
} = {}) {
  let lastReceipt = null

  const inspect = async ({ cwd } = {}) => {
    const probe = inspectExecutable({ executable, args: ['--version'], cwd, spawn })
    return {
      ...probe,
      id,
      platform,
      executionTarget,
      transport,
      delegationBoundary,
      intentSupport,
      profileVersion,
    }
  }

  const plan = (request = {}) => {
    // Fencing: destructive operations (--restart / --reset) are prohibited as continuation
    if (
      request.restart === true ||
      request.reset === true ||
      request.flags?.includes('--restart') ||
      request.flags?.includes('--reset')
    ) {
      throw new MeshloopAdapterError(
        'Destructive operations (--restart / --reset) are prohibited as continuation; evidence preservation required',
        { code: 'DESTRUCTIVE_CONTINUATION_PROHIBITED' },
      )
    }

    const args = ['run', '--json']
    if (request.planFile) {
      args.push('--plan', request.planFile)
    }
    if (request.acceptPlan) {
      args.push('--accept-plan')
    }
    if (request.configFile) {
      args.push('--config', request.configFile)
    }
    if (request.worktreeBase) {
      args.push('--worktree-base', request.worktreeBase)
    }
    if (request.dbFile) {
      args.push('--db', request.dbFile)
    }
    if (request.fixtureOnly) {
      args.push('--fixture-only')
    }

    const base = {
      version: 1,
      provider: id,
      platform,
      executable,
      args,
      cwd: request.cwd ?? null,
      timeoutMs: request.timeoutMs ?? 30_000,
      profileVersion,
      request,
    }

    return { ...base, token: providerDigest(base) }
  }

  const execute = async (executionPlan, { confirm } = {}) => {
    const { token, ...base } = executionPlan ?? {}
    if (executionPlan?.provider !== id || confirm !== token || providerDigest(base) !== token) {
      throw new MeshloopAdapterError('Meshloop execution confirmation or plan digest is invalid', {
        code: 'INVALID_EXECUTION_CONFIRMATION',
      })
    }

    const startedAt = new Date().toISOString()
    const started = performance.now()
    emitObservation(observer, {
      kind: 'meshloop_execution_attempt',
      state: 'started',
      operationId: token,
    })

    let result
    try {
      result = spawn(executable, executionPlan.args, {
        cwd: executionPlan.cwd ?? undefined,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: executionPlan.timeoutMs,
        maxBuffer: MAX_OUTPUT_FRAME_BYTES * 2,
      })
    } catch (err) {
      result = { error: err, status: 1, stdout: '', stderr: err.message }
    }

    let parsedOutput = null
    let status = 'failed'
    if (!result.error && result.status === 0) {
      try {
        parsedOutput = parseMeshloopOutput(result.stdout ?? '')
        // Technical boundary: AwaitingHumanAcceptance is technical idle, not SDLC approval.
        // It maps to a successful technical execution receipt, but AgentFlow evaluates acceptance independently.
        status = 'pass'
      } catch (err) {
        status = 'failed'
      }
    }

    // Verify any returned artifacts independently via SHA-256
    const artifacts = executionPlan.request?.artifacts ?? []
    for (const art of artifacts) {
      if (art.path && safePath(art.path) && art.content) {
        art.verifiedDigest = recordDigest(art.content)
      }
    }

    lastReceipt = createProviderExecutionReceipt({
      provider: id,
      platform,
      intentSupport,
      executionTarget,
      transport,
      plan: executionPlan,
      request: executionPlan.request,
      status,
      startedAt,
      completedAt: new Date().toISOString(),
      output: {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        parsed: parsedOutput,
      },
      metadata: {
        exitCode: result.status,
        framing: parsedOutput?.framing ?? 'unknown',
        technicalIdle: parsedOutput?.data?.idle ?? null,
        engineeringProfile: {
          id,
          version: profileVersion,
          bindingRevision: 1,
        },
      },
    })

    emitObservation(observer, {
      kind: 'meshloop_execution_attempt',
      state: status === 'pass' ? 'completed' : 'failed',
      operationId: token,
      duration: performance.now() - started,
    })

    return lastReceipt
  }

  return {
    version: 1,
    id,
    platform,
    providerVersion,
    profileVersion,
    targets: [executionTarget],
    transports: [transport],
    intentSupport,
    osSupport,
    trust: { source: trustSource },
    inspect,
    plan,
    execute,
    status: () => (lastReceipt ? { status: lastReceipt.status } : { status: 'idle' }),
    cancel: () => ({
      status: 'unsupported',
      reason: 'Meshloop adapter CLI cancellation operates via OS process signals',
    }),
    cleanup: () => ({ status: 'clean', resources: [] }),
    receipt: () => lastReceipt,
  }
}
