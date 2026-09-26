import { describe, expect, it } from 'vitest'
import {
  createMeshloopProvider,
  parseMeshloopOutput,
  MeshloopAdapterError,
  MAX_OUTPUT_FRAME_BYTES,
  MESHLOOP_PROFILE_VERSION,
} from '../providers/meshloop-provider.mjs'
import { builtInProviders, providerById } from '../providers/registry.mjs'
import { recordDigest } from '../core/record-digest.mjs'
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
      expect(inspection.intentSupport.map((i) => i.id)).toContain('plan-before-edit')
      expect(inspection.intentSupport.map((i) => i.id)).toContain('workflow-orchestration')
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
      expect(request.artifacts[0].verifiedDigest).toBe(recordDigest(code))

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
      const provider = createMeshloopProvider()
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

      const provider = createMeshloopProvider({ spawn: fakeAsyncSpawn })
      const plan = provider.plan({ detach: true })
      const receipt = await provider.execute(plan, { confirm: plan.token })

      expect(receipt.status).toBe('pass')
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
              command: 'run',
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
              command: 'inspect',
              data: {
                session_id: 'sess-100',
                status: sessionState.status,
                idle: sessionState.status === 'completed' ? 'AwaitingHumanAcceptance' : null,
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
              command: 'cancel',
              data: { session_id: 'sess-100', status: 'cancelled' },
            }),
            stderr: '',
          }
        }
        return { status: 1, stdout: '', stderr: 'unknown command' }
      }

      const provider = createMeshloopProvider({ spawn: fakeLifecycleSpawn })
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
      expect(completedStatus.idle).toBe('AwaitingHumanAcceptance')

      // 2. Cancel session
      const cancelRes = await provider.cancel({ sessionId: 'sess-100' })
      expect(cancelRes.status).toBe('cancelled')
      expect(cancelRes.sessionId).toBe('sess-100')
      expect(cancelRes.ok).toBe(true)

      // 3. Cleanup session
      const cleanupRes = await provider.cleanup({ sessionId: 'sess-100' })
      expect(cleanupRes.status).toBe('clean')
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
      const statusRes = await provider.status({ sessionId: 'bad-session' })
      expect(statusRes.status).toBe('unknown')
      expect(statusRes.reason).toMatch(/session not found/)

      const cancelRes = await provider.cancel({ sessionId: 'bad-session' })
      expect(cancelRes.status).toBe('failed')
      expect(cancelRes.reason).toMatch(/process already exited/)

      const unprovidedCancel = await provider.cancel()
      expect(unprovidedCancel.status).toBe('unsupported')
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
