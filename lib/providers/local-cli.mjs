import { spawnSync } from 'node:child_process'
import { createProviderExecutionReceipt, providerDigest } from './provider-receipt.mjs'

function digest(value) {
  return providerDigest(value)
}

function safeEnvironment(source = process.env) {
  const allowed = [
    'PATH',
    'Path',
    'HOME',
    'USERPROFILE',
    'TMP',
    'TEMP',
    'SystemRoot',
    'ComSpec',
    'PATHEXT',
  ]
  return Object.fromEntries(allowed.filter((key) => source[key]).map((key) => [key, source[key]]))
}

export function inspectExecutable({ executable, args = ['--version'], cwd, spawn = spawnSync }) {
  if (!executable || /[;&|<>]/.test(executable)) {
    return { availability: 'unavailable', reason: 'executable must be a bare command or path' }
  }
  const result = spawn(executable, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10_000,
    env: safeEnvironment(),
  })
  if (result.error || result.status !== 0) {
    return {
      availability: 'unavailable',
      reason: result.error?.message ?? `probe exited ${result.status}`,
    }
  }
  return {
    availability: 'available',
    reason: `${executable} responded to a non-shell version probe`,
    metadata: { version: String(result.stdout || result.stderr || '').trim() || null },
  }
}

export function inspectFlagIntents({
  executable,
  cwd,
  spawn = spawnSync,
  declared = [],
  flags = {},
}) {
  const result = spawn(executable, ['--help'], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10_000,
    env: safeEnvironment(),
  })
  if (result.error || result.status !== 0) return declared
  const output = String(result.stdout || result.stderr || '')
  const support = new Map(declared.map((item) => [item.id, item]))
  for (const [id, markers] of Object.entries(flags)) {
    if ((Array.isArray(markers) ? markers : [markers]).every((marker) => output.includes(marker))) {
      support.set(id, {
        id,
        implementation: 'native',
        fidelity: 'full',
        evidence: 'probed',
        limits: {},
      })
    }
  }
  return [...support.values()]
}

export function createLocalCliProvider({
  id,
  platform,
  executable,
  executionTarget,
  transport = 'local-cli',
  delegationBoundary = 'current-session',
  intentSupport = [
    {
      id: 'plan-before-edit',
      implementation: 'emulated',
      fidelity: 'full',
      evidence: 'contract-tested',
      limits: {},
    },
    {
      id: 'workflow-orchestration',
      implementation: 'emulated',
      fidelity: 'full',
      evidence: 'contract-tested',
      limits: {},
    },
    {
      id: 'bounded-loop',
      implementation: 'emulated',
      fidelity: 'full',
      evidence: 'contract-tested',
      limits: { maxIterationsRequired: true },
    },
  ],
  providerVersion = '1.0.0',
  osSupport = ['win32', 'linux', 'darwin'],
  trustSource = 'project configuration',
  compatibility = '^1',
  policy = {},
  prepareArgs = (value) => value,
  inspectIntentSupport,
  args = ['--version'],
  cwd,
  spawn,
} = {}) {
  if (!platform) throw new Error('local CLI provider platform identity is required')
  let lastReceipt = null
  const plan = (request = {}) => {
    const base = {
      version: 1,
      provider: id,
      platform,
      executable,
      args: prepareArgs(Array.isArray(request.args) ? request.args : [], request),
      cwd: request.cwd ?? cwd ?? null,
      timeoutMs: request.timeoutMs ?? 120_000,
      policy,
      request,
    }
    return { ...base, token: digest(base) }
  }
  const execute = (executionPlan, { confirm } = {}) => {
    const { token, ...base } = executionPlan ?? {}
    if (executionPlan?.provider !== id || confirm !== token || digest(base) !== token) {
      throw new Error('provider execution confirmation or plan digest is invalid')
    }
    const startedAt = new Date().toISOString()
    const result = (spawn ?? spawnSync)(executable, executionPlan.args, {
      cwd: executionPlan.cwd ?? undefined,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: executionPlan.timeoutMs,
      maxBuffer: 1024 * 1024,
      env: safeEnvironment(),
    })
    lastReceipt = createProviderExecutionReceipt({
      provider: id,
      platform,
      intentSupport,
      executionTarget,
      transport,
      plan: executionPlan,
      request: executionPlan.request,
      status: result.error ? 'failed' : result.status === 0 ? 'pass' : 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      output: { stdout: result.stdout ?? '', stderr: result.stderr ?? '' },
      metadata: { exitCode: result.status, cleanup: { status: 'not-required', actions: [] } },
    })
    return lastReceipt
  }
  const operations = {
    execute,
    evidence: () => lastReceipt,
  }
  return {
    version: 1,
    id,
    platform,
    providerVersion,
    spiRange: { min: 1, max: 1 },
    facets: ['execution', 'evidence'],
    intentSupport,
    targets: executionTarget ? [executionTarget] : [],
    transports: transport ? [transport] : [],
    osSupport,
    trust: { source: trustSource },
    compatibility: { agentflow: compatibility },
    policy,
    operations,
    plan,
    execute,
    status: () => (lastReceipt ? { status: lastReceipt.status } : { status: 'idle' }),
    cancel: () => ({ status: 'unsupported', reason: 'local CLI execution is synchronous' }),
    cleanup: () => ({ status: 'clean', resources: [] }),
    receipt: operations.evidence,
    async inspect() {
      const executableResult = inspectExecutable({ executable, args, cwd, spawn })
      const observedSupport =
        executableResult.availability === 'available' && inspectIntentSupport
          ? await inspectIntentSupport({ executable, cwd, spawn, declared: intentSupport })
          : intentSupport
      return {
        ...executableResult,
        executionTarget,
        platform,
        transport,
        delegationBoundary,
        intentSupport: observedSupport,
      }
    },
  }
}
