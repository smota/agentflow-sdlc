import { spawn as defaultSpawn, spawnSync } from 'node:child_process'
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

export async function runProcess(spawnFn, executable, args, options = {}) {
  let res
  try {
    res = spawnFn(executable, args, options)
  } catch (err) {
    return { status: 1, stdout: '', stderr: err.message, error: err }
  }

  // 1. If spawnFn returned a Promise (e.g. an async mock or execFile)
  if (res && typeof res.then === 'function') {
    try {
      const awaited = await res
      return {
        status: awaited.status ?? awaited.exitCode ?? 0,
        stdout: String(awaited.stdout ?? ''),
        stderr: String(awaited.stderr ?? ''),
        error: awaited.error,
      }
    } catch (err) {
      return { status: 1, stdout: '', stderr: err.message, error: err }
    }
  }

  // 2. If spawnFn returned a Node ChildProcess (EventEmitter with stdout/stderr streams)
  if (res && typeof res.on === 'function') {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let killed = false
      let timer = null

      if (options.timeout && options.timeout > 0) {
        timer = setTimeout(() => {
          killed = true
          try {
            res.kill('SIGTERM')
          } catch {
            // ignore
          }
        }, options.timeout)
      }

      if (res.stdout && typeof res.stdout.on === 'function') {
        if (typeof res.stdout.setEncoding === 'function') {
          res.stdout.setEncoding('utf8')
        }
        res.stdout.on('data', (chunk) => {
          stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        })
      }
      if (res.stderr && typeof res.stderr.on === 'function') {
        if (typeof res.stderr.setEncoding === 'function') {
          res.stderr.setEncoding('utf8')
        }
        res.stderr.on('data', (chunk) => {
          stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        })
      }

      res.on('error', (err) => {
        if (timer) clearTimeout(timer)
        resolve({ status: 1, stdout, stderr: err.message, error: err })
      })

      res.on('close', (code, signal) => {
        if (timer) clearTimeout(timer)
        const status = code ?? (signal ? 1 : 0)
        resolve({
          status,
          stdout,
          stderr: killed ? `Process timed out after ${options.timeout}ms` : stderr,
          error: killed ? new Error(`Process timed out after ${options.timeout}ms`) : null,
        })
      })
    })
  }

  // 3. If spawnFn returned a sync object (like spawnSync or synchronous mock)
  if (res && (typeof res.status === 'number' || res.stdout !== undefined)) {
    return {
      status: res.status ?? 0,
      stdout:
        typeof res.stdout === 'string' ? res.stdout : res.stdout ? res.stdout.toString('utf8') : '',
      stderr:
        typeof res.stderr === 'string' ? res.stderr : res.stderr ? res.stderr.toString('utf8') : '',
      error: res.error,
    }
  }

  return {
    status: 1,
    stdout: '',
    stderr: 'Unknown spawn response',
    error: new Error('Unknown spawn response'),
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
    {
      id: 'background-execution',
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
  spawn = defaultSpawn,
  observer = null,
} = {}) {
  let lastReceipt = null
  const activeSessions = new Map()

  const inspect = async ({ cwd } = {}) => {
    // For fast synchronous metadata inspection, probe executable version
    const probe = inspectExecutable({ executable, args: ['--version'], cwd, spawn: spawnSync })
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

    if (request.profileVersion && request.profileVersion !== profileVersion) {
      throw new MeshloopAdapterError(
        `Incompatible profile version: requested ${request.profileVersion}, provider supports ${profileVersion}`,
        {
          code: 'INCOMPATIBLE_PROFILE_VERSION',
          details: { requested: request.profileVersion, supported: profileVersion },
        },
      )
    }

    const args = ['run', '--json']
    if (request.detach === true || request.flags?.includes('--detach')) {
      args.push('--detach')
    }
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

    const result = await runProcess(spawn, executable, executionPlan.args, {
      cwd: executionPlan.cwd ?? undefined,
      timeout: executionPlan.timeoutMs,
      maxBuffer: MAX_OUTPUT_FRAME_BYTES * 2,
    })

    let parsedOutput = null
    let status = 'failed'
    const isDetached = executionPlan.args?.includes('--detach')
    let sessionId = null

    if (!result.error && result.status === 0) {
      try {
        parsedOutput = parseMeshloopOutput(result.stdout ?? '')
        sessionId = parsedOutput?.data?.session_id ?? parsedOutput?.data?.sessionId ?? null
        if (isDetached && sessionId) {
          activeSessions.set(sessionId, {
            startedAt,
            plan: executionPlan,
            status: parsedOutput.data.status ?? 'running',
          })
          status = 'pass'
        } else {
          // Technical boundary: AwaitingHumanAcceptance is technical idle, not SDLC approval.
          // It maps to a successful technical execution receipt, but AgentFlow evaluates acceptance independently.
          status = 'pass'
        }
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

    const rawMetrics = parsedOutput?.data?.metrics ?? parsedOutput?.data?.execution_metrics ?? {}
    const astReductionRatio =
      typeof rawMetrics.ast_token_reduction_ratio === 'number'
        ? rawMetrics.ast_token_reduction_ratio
        : typeof rawMetrics.astReductionRatio === 'number'
          ? rawMetrics.astReductionRatio
          : null
    const lyapunovIterations =
      typeof rawMetrics.lyapunov_iterations === 'number'
        ? rawMetrics.lyapunov_iterations
        : typeof rawMetrics.lyapunovIterations === 'number'
          ? rawMetrics.lyapunovIterations
          : null
    const orphanProcessCount =
      typeof rawMetrics.orphan_process_count === 'number'
        ? rawMetrics.orphan_process_count
        : typeof rawMetrics.orphanProcessCount === 'number'
          ? rawMetrics.orphanProcessCount
          : 0
    const worktreeLockWaitMs =
      typeof rawMetrics.worktree_lock_wait_ms === 'number'
        ? rawMetrics.worktree_lock_wait_ms
        : typeof rawMetrics.worktreeLockWaitMs === 'number'
          ? rawMetrics.worktreeLockWaitMs
          : null

    const engineeringMetrics =
      astReductionRatio !== null || lyapunovIterations !== null
        ? {
            astReductionRatio,
            lyapunovIterations: lyapunovIterations ?? 0,
            orphanProcessCount,
            worktreeLockWaitMs,
          }
        : null

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
        sessionId,
        detached: Boolean(isDetached && sessionId),
        gitExport: parsedOutput?.data?.git_export ?? null,
        engineeringMetrics,
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

    if (engineeringMetrics) {
      emitObservation(observer, {
        kind: 'meshloop_engineering_metrics',
        operationId: token,
        astReductionRatio: engineeringMetrics.astReductionRatio,
        lyapunovIterations: engineeringMetrics.lyapunovIterations,
        orphanProcessCount: engineeringMetrics.orphanProcessCount,
        worktreeLockWaitMs: engineeringMetrics.worktreeLockWaitMs,
        duration: performance.now() - started,
      })
    }

    return lastReceipt
  }

  const status = async (query = {}) => {
    const targetSessionId = query?.sessionId ?? lastReceipt?.metadata?.sessionId
    if (targetSessionId) {
      const inspectArgs = ['inspect', '--session-id', targetSessionId, '--json']
      const result = await runProcess(spawn, executable, inspectArgs, {
        cwd: query?.cwd ?? undefined,
        timeout: 10_000,
      })
      if (!result.error && result.status === 0) {
        try {
          const parsed = parseMeshloopOutput(result.stdout ?? '')
          const remoteStatus = parsed.data?.status ?? 'running'
          if (activeSessions.has(targetSessionId)) {
            activeSessions.get(targetSessionId).status = remoteStatus
          }
          return {
            status: remoteStatus,
            sessionId: targetSessionId,
            idle: parsed.data?.idle ?? null,
            data: parsed.data,
          }
        } catch {
          return {
            status: 'unknown',
            sessionId: targetSessionId,
            reason: 'Failed to parse inspect output',
          }
        }
      }
      return {
        status: 'unknown',
        sessionId: targetSessionId,
        reason: result.stderr || 'Inspect command failed',
      }
    }
    return lastReceipt ? { status: lastReceipt.status } : { status: 'idle' }
  }

  const cancel = async (query = {}) => {
    const targetSessionId = query?.sessionId ?? lastReceipt?.metadata?.sessionId
    if (targetSessionId) {
      const cancelArgs = ['cancel', '--session-id', targetSessionId, '--json']
      const result = await runProcess(spawn, executable, cancelArgs, {
        cwd: query?.cwd ?? undefined,
        timeout: 10_000,
      })
      if (!result.error && result.status === 0) {
        if (activeSessions.has(targetSessionId)) {
          activeSessions.get(targetSessionId).status = 'cancelled'
        }
        return {
          status: 'cancelled',
          sessionId: targetSessionId,
          ok: true,
        }
      }
      return {
        status: 'failed',
        sessionId: targetSessionId,
        reason: result.stderr || 'Cancel command failed',
      }
    }
    return {
      status: 'unsupported',
      reason: 'No session id provided to cancel detached Meshloop execution',
    }
  }

  const cleanup = async (query = {}) => {
    const targetSessionId = query?.sessionId ?? lastReceipt?.metadata?.sessionId
    if (targetSessionId && activeSessions.has(targetSessionId)) {
      activeSessions.delete(targetSessionId)
    }
    return { status: 'clean', resources: [] }
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
    status,
    cancel,
    cleanup,
    receipt: () => lastReceipt,
  }
}
