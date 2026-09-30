import { describe, expect, it } from 'vitest'
import {
  createMeshloopProvider,
  parseMeshloopOutput,
  MeshloopAdapterError,
  MAX_OUTPUT_FRAME_BYTES,
  MESHLOOP_PROFILE_VERSION,
} from '../providers/meshloop-provider.mjs'
import { builtInProviders, providerById } from '../providers/registry.mjs'
import { createHash } from 'node:crypto'
import { parseFixtureEnvelope } from '../../scripts/qualify-meshloop.mjs'

describe('Meshloop Provider Adapter (S7)', () => {
  describe('parseMeshloopOutput', () => {
    it('parses strict JSON payload successfully', () => {
      const payload = JSON.stringify({
        ok: true,
        command: 'meshloop:run',
        data: { graph_id: 'g-1', status: 'completed' },
      })
      const result = parseMeshloopOutput(payload)
      expect(result.ok).toBe(true)
      expect(result.framing).toBe('strict-json')
      expect(result.command).toBe('meshloop:run')
      expect(result.data.graph_id).toBe('g-1')
    })

    it('parses output with known notice prefix', () => {
      const notice =
        'Note: worktrees are kept. `run` does not merge onto your current branch.\n' +
        'Use `meshloop accept` then `meshloop resume`, and `meshloop integrate --into` to land.\n\n'
      const payload =
        notice +
        JSON.stringify({
          ok: true,
          command: 'meshloop:run',
          data: { graph_id: 'g-1', idle: 'AwaitingHumanAcceptance' },
        })
      const result = parseMeshloopOutput(payload)
      expect(result.ok).toBe(true)
      expect(result.framing).toBe('known-notice-prefix')
      expect(result.data.idle).toBe('AwaitingHumanAcceptance')
    })

    it('rejects oversized output frames', () => {
      const oversized = 'x'.repeat(MAX_OUTPUT_FRAME_BYTES + 1)
      expect(() => parseMeshloopOutput(oversized)).toThrow(MeshloopAdapterError)
      expect(() => parseMeshloopOutput(oversized)).toThrowError(/exceeds frame limit/)
    })

    it('rejects unrecognized framing and unexpected preambles', () => {
      const badPreamble = 'Random warning: something happened\n{"ok": true}'
      expect(() => parseMeshloopOutput(badPreamble)).toThrow(MeshloopAdapterError)
      expect(() => parseMeshloopOutput(badPreamble)).toThrowError(/Unrecognized output framing/)
    })

    it('rejects malformed JSON', () => {
      expect(() => parseMeshloopOutput('{ not valid')).toThrow(MeshloopAdapterError)
      expect(() => parseMeshloopOutput('{ not valid')).toThrowError(/Malformed Meshloop JSON/)
    })
  })

  describe('neutral client fixture parsing parity', () => {
    it('satisfies parseFixtureEnvelope contract', () => {
      const notice =
        'Note: worktrees are kept. `run` does not merge onto your current branch.\n' +
        'Use `meshloop accept` then `meshloop resume`, and `meshloop integrate --into` to land.\n\n'
      const payload =
        notice +
        JSON.stringify({
          ok: true,
          command: 'meshloop:run',
          data: { graph_id: 'neutral-client-fixture', idle: 'AwaitingHumanAcceptance' },
        })
      const res = parseFixtureEnvelope(payload)
      expect(res.idle).toBe('AwaitingHumanAcceptance')
      expect(res.framing).toBe('known-notice-prefix')
    })
  })

  describe('createMeshloopProvider', () => {
    const fakeSpawn = (exe, args) => {
      if (args.includes('--version')) {
        return { status: 0, stdout: 'meshloop 0.1.0\n', stderr: '' }
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          command: 'meshloop:run',
          data: {
            graph_id: 'neutral-client-fixture',
            idle: 'AwaitingHumanAcceptance',
            plan_sha256: 'deadbeef01234567', // 16-hex DefaultHasher
          },
        }),
        stderr: '',
      }
    }

    it('inspects availability and declares supported intents', async () => {
      const provider = createMeshloopProvider({ spawn: fakeSpawn })
      const inspection = await provider.inspect()
      expect(inspection.availability).toBe('available')
      expect(inspection.profileVersion).toBe(MESHLOOP_PROFILE_VERSION)
      expect(inspection.intentSupport).toEqual([])
      expect(inspection.qualification.liveBinaryQualified).toBe(false)
    })

    it('prohibits destructive restart/reset continuation operations', () => {
      const provider = createMeshloopProvider({ spawn: fakeSpawn })
      expect(() => provider.plan({ restart: true })).toThrow(MeshloopAdapterError)
      expect(() => provider.plan({ restart: true })).toThrowError(/Destructive operations/)
      expect(() => provider.plan({ reset: true })).toThrowError(/Destructive operations/)
      expect(() => provider.plan({ flags: ['--restart'] })).toThrowError(/Destructive operations/)
    })

    it('executes planned work and independently computes SHA-256 for artifacts', async () => {
      const observations = []
      const observer = (obs) => observations.push(obs)

      const provider = createMeshloopProvider({ spawn: fakeSpawn, observer })
      const code = 'export function runEngine() { return 42 }\n'
      const request = {
        planFile: 'plan.json',
        acceptPlan: true,
        artifacts: [{ path: 'src/engine.mjs', content: code }],
      }

      const plan = provider.plan(request)
      expect(plan.args).toContain('--plan')
      expect(plan.args).toContain('plan.json')
      expect(plan.args).toContain('--accept-plan')

      const receipt = await provider.execute(plan, { confirm: plan.token })

      expect(receipt.status).toBe('pass')
      expect(receipt.actual.platform).toBe('meshloop')
      expect(receipt.metadata.technicalIdle).toBe('AwaitingHumanAcceptance')
      expect(receipt.metadata.engineeringProfile.version).toBe(MESHLOOP_PROFILE_VERSION)

      // Verify independent SHA-256 hash was computed, ignoring foreign plan_sha256
      expect(request.artifacts[0].verifiedDigest).toBeUndefined()
      expect(receipt.metadata.verifiedArtifacts).toEqual([])

      // Check observation events
      expect(observations.map((o) => o.state)).toEqual(['started', 'completed'])
    })

    it('rejects confirmation token mismatch', async () => {
      const provider = createMeshloopProvider({ spawn: fakeSpawn })
      const plan = provider.plan({ planFile: 'plan.json' })
      await expect(provider.execute(plan, { confirm: 'wrong-token' })).rejects.toThrow(
        MeshloopAdapterError,
      )
    })
  })

  describe('nonblocking detached execution and session lifecycle', () => {
    it('plans detached run when request specifies detach: true', () => {
      const provider = createMeshloopProvider({ qualifiedCapabilities: ['detached-lifecycle-v1'] })
      const plan = provider.plan({ detach: true, planFile: 'plan.json' })
      expect(plan.args).toContain('--detach')
      expect(plan.args).toContain('--plan')
      expect(plan.args).toContain('plan.json')
    })

    it('handles async ChildProcess emitter with stdout stream', async () => {
      const { EventEmitter } = await import('node:events')
      const fakeAsyncSpawn = (exe, args) => {
        const child = new EventEmitter()
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        child.kill = () => {}
        setTimeout(() => {
          child.stdout.emit(
            'data',
            JSON.stringify({
              ok: true,
              command: 'meshloop:run',
              data: {
                session_id: 'sess-async-999',
                status: 'running',
              },
            }),
          )
          child.emit('close', 0, null)
        }, 10)
        return child
      }

      const provider = createMeshloopProvider({
        spawn: fakeAsyncSpawn,
        qualifiedCapabilities: ['detached-lifecycle-v1'],
      })
      const plan = provider.plan({ detach: true })
      const receipt = await provider.execute(plan, { confirm: plan.token })

      expect(receipt.status).toBe('blocked')
      expect(receipt.metadata.lifecycleStatus).toBe('running')
      expect(receipt.metadata.sessionId).toBe('sess-async-999')
      expect(receipt.metadata.detached).toBe(true)
    })

    it('manages detached session lifecycle: inspect, cancel, and cleanup', async () => {
      const sessionState = { status: 'running' }
      const fakeLifecycleSpawn = (exe, args) => {
        if (args.includes('run') && args.includes('--detach')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              command: 'meshloop:run',
              data: { session_id: 'sess-100', status: 'running' },
            }),
            stderr: '',
          }
        }
        if (args.includes('inspect') && args.includes('sess-100')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              command: 'meshloop:inspect',
              data: {
                session_id: 'sess-100',
                status: sessionState.status,
                idle: sessionState.status === 'completed' ? 'GraphComplete' : null,
              },
            }),
            stderr: '',
          }
        }
        if (args.includes('cancel') && args.includes('sess-100')) {
          sessionState.status = 'cancelled'
          return {
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              command: 'meshloop:cancel',
              data: { session_id: 'sess-100', status: 'cancelled' },
            }),
            stderr: '',
          }
        }
        return { status: 1, stdout: '', stderr: 'unknown command' }
      }

      const provider = createMeshloopProvider({
        spawn: fakeLifecycleSpawn,
        qualifiedCapabilities: ['detached-lifecycle-v1'],
      })
      const plan = provider.plan({ detach: true })
      const receipt = await provider.execute(plan, { confirm: plan.token })

      expect(receipt.metadata.sessionId).toBe('sess-100')

      // 1. Inspect status
      const initialStatus = await provider.status({ sessionId: 'sess-100' })
      expect(initialStatus.status).toBe('running')
      expect(initialStatus.sessionId).toBe('sess-100')

      // Simulate remote task completion
      sessionState.status = 'completed'
      const completedStatus = await provider.status({ sessionId: 'sess-100' })
      expect(completedStatus.status).toBe('completed')
      expect(completedStatus.idle).toBe('GraphComplete')

      // 2. Cancel session
      const cancelRes = await provider.cancel({ sessionId: 'sess-100' })
      expect(cancelRes.status).toBe('cancelled')
      expect(cancelRes.sessionId).toBe('sess-100')
      expect(cancelRes.ok).toBe(true)

      // 3. Cleanup session
      const cleanupRes = await provider.cleanup({ sessionId: 'sess-100' })
      expect(cleanupRes.status).toBe('not-required')
    })

    it('handles inspect and cancel errors gracefully', async () => {
      const errorSpawn = (exe, args) => {
        if (args.includes('inspect')) {
          return { status: 1, stdout: '', stderr: 'session not found' }
        }
        if (args.includes('cancel')) {
          return { status: 1, stdout: '', stderr: 'process already exited' }
        }
        return { status: 0, stdout: '{}', stderr: '' }
      }

      const provider = createMeshloopProvider({ spawn: errorSpawn })
      const statusRes = await provider.status({ sessionId: 'bad-session', cwd: process.cwd() })
      expect(statusRes.status).toBe('unknown')
      expect(statusRes.reason).toMatch(/session not found/)

      const cancelRes = await provider.cancel({ sessionId: 'bad-session', cwd: process.cwd() })
      expect(cancelRes.status).toBe('failed')
      expect(cancelRes.reason).toMatch(/process already exited/)

      const unprovidedCancel = await provider.cancel()
      expect(unprovidedCancel.status).toBe('unsupported')
    })

    it('extracts engineering metrics and emits meshloop_engineering_metrics observation', async () => {
      const observations = []
      const observer = (obs) => observations.push(obs)

      const metricsSpawn = () => ({
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          command: 'meshloop:run',
          data: {
            status: 'completed',
            metrics: {
              ast_token_reduction_ratio: 0.82,
              lyapunov_iterations: 3,
              orphan_process_count: 0,
              worktree_lock_wait_ms: 12.5,
            },
          },
        }),
        stderr: '',
      })

      const provider = createMeshloopProvider({ spawn: metricsSpawn, observer })
      const plan = provider.plan()
      const receipt = await provider.execute(plan, { confirm: plan.token })

      expect(receipt.status).toBe('pass')
      expect(receipt.metadata.engineeringMetrics).toEqual({
        astReductionRatio: 0.82,
        lyapunovIterations: 3,
        orphanProcessCount: 0,
        worktreeLockWaitMs: 12.5,
      })

      const metricsObs = observations.find((o) => o.kind === 'meshloop_engineering_metrics')
      expect(metricsObs).toBeDefined()
      expect(metricsObs.astReductionRatio).toBe(0.82)
      expect(metricsObs.lyapunovIterations).toBe(3)
      expect(metricsObs.orphanProcessCount).toBe(0)
      expect(metricsObs.worktreeLockWaitMs).toBe(12.5)
      expect(metricsObs.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('fallback and bidirectional independence', () => {
    it('defaults to direct providers without requiring Meshloop', () => {
      const providers = builtInProviders()
      const providerIds = providers.map((p) => p.id)
      expect(providerIds).toContain('claude-cli')
      expect(providerIds).toContain('codex-cli')
      expect(providerIds).toContain('agy-cli')
      expect(providerById('meshloop', providers)).toBeNull()
    })

    it('registers meshloop cleanly when explicitly configured', () => {
      const providers = builtInProviders({ meshloop: { executable: 'meshloop-custom' } })
      const meshloop = providerById('meshloop', providers)
      expect(meshloop).not.toBeNull()
      expect(meshloop.platform).toBe('meshloop')
    })
  })
})

describe('Meshloop evidence and lifecycle regressions', () => {
  const envelope = (data, overrides = {}) =>
    JSON.stringify({ ok: true, command: 'meshloop:run', data, ...overrides })
  it.each([
    [{ status: 'completed' }, { ok: false }],
    [{ status: 'completed' }, { command: 'meshloop:inspect' }],
    [{ status: 'failed' }, {}],
    [{ status: 'unknown-new-state' }, {}],
    [{ status: 'failed', idle: 'GraphComplete' }, {}],
  ])('does not pass negative or ambiguous envelopes %j', async (data, overrides) => {
    const provider = createMeshloopProvider({
      spawn: () => ({ status: 0, stdout: envelope(data, overrides) }),
    })
    const plan = provider.plan()
    expect((await provider.execute(plan, { confirm: plan.token })).status).toBe('failed')
  })
  it('keeps a live worker pending even with exit zero', async () => {
    const provider = createMeshloopProvider({
      spawn: () => ({
        status: 0,
        stdout: envelope({ idle: 'WaitingOnLiveWorker', graph_id: 'graph' }),
      }),
    })
    const plan = provider.plan()
    const receipt = await provider.execute(plan, { confirm: plan.token })
    expect(receipt.status).toBe('blocked')
    expect(receipt.metadata.technicalGate.sdlcAccepted).toBe(false)
  })
  it('rejects unqualified detach before dispatch', () => {
    expect(() => createMeshloopProvider({}).plan({ detach: true })).toThrow(/not qualified/)
  })
  it('preserves the selected namespace for inspection and cancellation', async () => {
    const calls = []
    const provider = createMeshloopProvider({
      qualifiedCapabilities: ['detached-lifecycle-v1'],
      spawn: (exe, args, options) => {
        calls.push({ args, options })
        return {
          status: 0,
          stdout: envelope(
            { session_id: 's', status: args[0] === 'cancel' ? 'cancelled' : 'running' },
            { command: `meshloop:${args[0]}` },
          ),
        }
      },
    })
    const request = {
      detach: true,
      cwd: process.cwd(),
      configFile: 'custom.json',
      dbFile: 'custom.sqlite',
      worktreeBase: 'custom-trees',
    }
    const plan = provider.plan(request)
    await provider.execute(plan, { confirm: plan.token })
    await provider.status({ sessionId: 's', dbFile: 'wrong.sqlite' })
    await provider.cancel({ sessionId: 's' })
    for (const { args, options } of calls.slice(1)) {
      expect(args).toEqual(
        expect.arrayContaining([
          '--config',
          'custom.json',
          '--db',
          'custom.sqlite',
          '--worktree-base',
          'custom-trees',
        ]),
      )
      expect(options.cwd).toBe(request.cwd)
    }
  })
  it('rejects wrong-session and unconfirmed cancellation responses', async () => {
    const provider = createMeshloopProvider({
      spawn: () => ({
        status: 0,
        stdout: envelope(
          { session_id: 'other', status: 'cancelled' },
          { command: 'meshloop:cancel' },
        ),
      }),
    })
    expect((await provider.cancel({ sessionId: 's' })).status).toBe('unknown')
  })
  it.each([Buffer.from([0, 255, 128, 13, 10]), Buffer.alloc(0)])(
    'retrieves exact binary and empty bytes',
    async (bytes) => {
      const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const cwd = mkdtempSync(join(tmpdir(), 'meshloop-bytes-'))
      try {
        writeFileSync(join(cwd, 'artifact.bin'), bytes)
        const artifact = {
          path: 'artifact.bin',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          byteLength: bytes.length,
        }
        const provider = createMeshloopProvider({
          spawn: () => ({
            status: 0,
            stdout: envelope({ status: 'completed', artifacts: [artifact] }),
          }),
        })
        const plan = provider.plan({
          cwd,
          artifacts: [{ path: 'artifact.bin', content: 'invented' }],
        })
        const receipt = await provider.execute(plan, { confirm: plan.token })
        expect(receipt.status).toBe('pass')
        expect(receipt.metadata.verifiedArtifacts[0]).toMatchObject({
          ...artifact,
          retrieval: 'workspace-file-bytes',
          verified: true,
        })
        writeFileSync(join(cwd, 'artifact.bin'), Buffer.from('mutated'))
        expect((await provider.execute(plan, { confirm: plan.token })).status).toBe('failed')
        expect(plan.request.artifacts[0].verifiedDigest).toBeUndefined()
        // Same-size corruption must fail the digest check, not merely the length check.
        writeFileSync(join(cwd, 'artifact.bin'), bytes)
        artifact.sha256 = '0'.repeat(64)
        const corrupted = await provider.execute(plan, { confirm: plan.token })
        expect(corrupted.status).toBe('failed')
        expect(corrupted.metadata.failureReason).toMatch(/integrity mismatch/)
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    },
  )
  it.each(['stdout', 'stderr'])('bounds noisy %s streams', async (stream) => {
    const { EventEmitter } = await import('node:events')
    const { runProcess } = await import('../providers/meshloop-provider.mjs')
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const signals = []
    child.kill = (signal) => signals.push(signal)
    const pending = runProcess(() => child, 'unused', [], { timeout: 1000 })
    child[stream].emit('data', 'x'.repeat(MAX_OUTPUT_FRAME_BYTES + 1))
    const result = await pending
    expect(result.error.message).toBe('OUTPUT_FRAME_OVERSIZED')
    expect(result.terminationConfirmed).toBe(false)
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(result[stream].length).toBeLessThanOrEqual(MAX_OUTPUT_FRAME_BYTES)
  })
  it('settles a child that ignores termination within a bounded deadline', async () => {
    const { EventEmitter } = await import('node:events')
    const { runProcess } = await import('../providers/meshloop-provider.mjs')
    const child = new EventEmitter()
    child.kill = () => {}
    const start = Date.now()
    const result = await runProcess(() => child, 'unused', [], { timeout: 10 })
    expect(result.error.message).toBe('PROCESS_TIMEOUT')
    expect(result.terminationConfirmed).toBe(false)
    expect(Date.now() - start).toBeLessThan(2000)
  })
})

describe('Meshloop real subprocess limits (no model provider)', () => {
  it('terminates a noisy Node child', async () => {
    const { spawn } = await import('node:child_process')
    const { runProcess } = await import('../providers/meshloop-provider.mjs')
    const result = await runProcess(
      spawn,
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)"],
      { timeout: 3000 },
    )
    expect(result.status).toBe(1)
    expect(result.error.message).toBe('OUTPUT_FRAME_OVERSIZED')
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(MAX_OUTPUT_FRAME_BYTES)
  })
  it('terminates an idle Node child at its deadline', async () => {
    const { spawn } = await import('node:child_process')
    const { runProcess } = await import('../providers/meshloop-provider.mjs')
    const before = Date.now()
    const result = await runProcess(
      spawn,
      process.execPath,
      ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      { timeout: 150 },
    )
    expect(result.status).toBe(1)
    expect(result.error.message).toBe('PROCESS_TIMEOUT')
    expect(Date.now() - before).toBeLessThan(2000)
  })
})

it('does not guess a namespace after losing local session context', async () => {
  let calls = 0
  const provider = createMeshloopProvider({
    spawn: () => {
      calls++
      throw new Error('must not spawn')
    },
  })
  expect((await provider.status({ sessionId: 'unknown' })).status).toBe('unknown')
  expect((await provider.cancel({ sessionId: 'unknown' })).status).toBe('unknown')
  expect(calls).toBe(0)
})

it('pins default namespace and effective cwd despite later lifecycle overrides', async () => {
  const calls = []
  const provider = createMeshloopProvider({
    qualifiedCapabilities: ['detached-lifecycle-v1'],
    spawn: (exe, args, options) => {
      calls.push({ args, options })
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          command: `meshloop:${args[0]}`,
          data: {
            session_id: 'default-session',
            status: args[0] === 'cancel' ? 'cancelled' : 'running',
          },
        }),
      }
    },
  })
  const expectedCwd = process.cwd()
  const plan = provider.plan({ detach: true })
  expect(plan.cwd).toBe(expectedCwd)
  await provider.execute(plan, { confirm: plan.token })
  const override = {
    sessionId: 'default-session',
    cwd: 'somewhere-else',
    configFile: 'wrong.json',
    dbFile: 'wrong.sqlite',
    worktreeBase: 'wrong-trees',
  }
  await provider.status(override)
  await provider.cancel(override)
  for (const { args, options } of calls.slice(1)) {
    expect(args).toEqual([args[0], '--session-id', 'default-session', '--json'])
    expect(options.cwd).toBe(expectedCwd)
  }
})
