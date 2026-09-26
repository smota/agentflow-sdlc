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
      const payload = notice + JSON.stringify({
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
      const payload = notice + JSON.stringify({
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
        artifacts: [
          { path: 'src/engine.mjs', content: code },
        ],
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
