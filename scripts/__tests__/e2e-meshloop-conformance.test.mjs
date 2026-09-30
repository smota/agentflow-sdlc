import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtInProviders, providerById } from '../../lib/providers/registry.mjs'
import {
  createMeshloopProvider,
  MeshloopAdapterError,
  MESHLOOP_PROFILE_VERSION,
} from '../../lib/providers/meshloop-provider.mjs'
import { parseFixtureEnvelope } from '../qualify-meshloop.mjs'
import {
  ingestWorktreeCommit,
  evaluateTechnicalReceiptGate,
} from '../../lib/verification/workspace.mjs'

describe('E2E Meshloop Conformance & Adversarial Fault Injection Matrix (#293)', () => {
  // Scenario A: Agentflow Alone
  describe('Scenario A: Agentflow Standalone (No Meshloop Installed)', () => {
    it('executes full provider resolution without requiring Meshloop binary or packages', () => {
      const providers = builtInProviders()
      const providerIds = providers.map((p) => p.id)

      // Verified direct providers must be active
      expect(providerIds).toContain('claude-cli')
      expect(providerIds).toContain('codex-cli')
      expect(providerIds).toContain('agy-cli')

      // Meshloop is absent by default
      expect(providerById('meshloop', providers)).toBeNull()

      // Default executor operates cleanly
      const agy = providerById('agy-cli', providers)
      expect(agy.platform).toBe('agy')
      expect(agy.targets).toContain('agy-cli')
    })
  })

  // Scenario B: Meshloop Alone
  describe('Scenario B: Meshloop Standalone (Neutral Qualification)', () => {
    it('qualifies deterministic fixture envelope without importing Agentflow core', () => {
      const notice =
        'Note: worktrees are kept. `run` does not merge onto your current branch.\n' +
        'Use `meshloop accept` then `meshloop resume`, and `meshloop integrate --into` to land.\n\n'
      const envelope =
        notice +
        JSON.stringify({
          ok: true,
          command: 'meshloop:run',
          data: {
            graph_id: 'neutral-client-fixture',
            idle: 'AwaitingHumanAcceptance',
            status: 'awaiting_acceptance',
          },
        })

      const parsed = parseFixtureEnvelope(envelope)
      expect(parsed.idle).toBe('AwaitingHumanAcceptance')
      expect(parsed.framing).toBe('known-notice-prefix')
    })
  })

  // Scenario C: Integrated Happy Path
  describe('Scenario C: Integrated Happy Path (Dispatch -> Ingest -> Gate)', async () => {
    it('dispatches fixture task, inspects exported commit, and preserves separate acceptance', async () => {
      const observations = []
      const observer = (obs) => observations.push(obs)

      const mockCommitSha = '1111222233334444555566667777888899990000'
      const fakeIntegratedSpawn = (exe, args) => {
        if (args.includes('run')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              command: 'meshloop:run',
              data: {
                status: 'awaiting_acceptance',
                idle: 'AwaitingHumanAcceptance',
                git_export: {
                  commit_sha: mockCommitSha,
                  branch_ref: 'refs/heads/meshloop/feature-1',
                  worktree_path: '.meshloop-worktrees/feature-1',
                },
                metrics: {
                  ast_token_reduction_ratio: 0.88,
                  lyapunov_iterations: 2,
                  orphan_process_count: 0,
                  worktree_lock_wait_ms: 15.2,
                },
              },
            }),
            stderr: '',
          }
        }
        if (args.includes('cat-file')) {
          return { status: 0, stdout: 'commit', stderr: '' }
        }
        if (args.includes('rev-parse')) return { status: 0, stdout: mockCommitSha, stderr: '' }
        if (args.includes('diff-tree')) {
          return { status: 0, stdout: 'src/lib.rs\0src/engine.rs\0', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      }

      const provider = createMeshloopProvider({
        spawn: fakeIntegratedSpawn,
        gitSpawn: fakeIntegratedSpawn,
        observer,
      })
      const plan = provider.plan({ cwd: process.cwd() })
      const receipt = await provider.execute(plan, { confirm: plan.token })

      // 1. Receipt validation
      expect(receipt.status).toBe('pass')
      expect(receipt.metadata.gitExport.commit_sha).toBe(mockCommitSha)
      expect(receipt.metadata.engineeringMetrics.astReductionRatio).toBe(0.88)
      expect(receipt.metadata.engineeringMetrics.lyapunovIterations).toBe(2)

      // The actual receipt path inspects commit metadata; it does not integrate a worktree.
      const ingestion = receipt.metadata.verifiedCommit
      expect(ingestion.verified).toBe(true)
      expect(ingestion.integrated).toBe(false)
      expect(ingestion.artifactBytesVerified).toBe(false)
      expect(ingestion.changedFiles).toEqual(['src/lib.rs', 'src/engine.rs'])

      // 3. Gate evaluation: technical pass MUST NOT bypass SDLC gate
      const gate = evaluateTechnicalReceiptGate({ receipt })
      expect(gate.technicalPassed).toBe(true)
      expect(gate.sdlcAccepted).toBe(false)
      expect(gate.requiresHumanAcceptance).toBe(true)
      expect(gate.gateClass).toBe('release-of-candidate')

      // 4. Verify observation trail
      const kinds = observations.map((o) => o.kind)
      expect(kinds).toContain('meshloop_execution_attempt')
      expect(kinds).toContain('meshloop_engineering_metrics')
      expect(kinds).toContain('meshloop_commit_inspected')
    })
  })

  // Scenario D: Fault Injection - Abrupt Cancellation
  describe('Scenario D: Fault Injection - Abrupt Cancellation', () => {
    it('validates the cancellation acknowledgement without claiming process liveness', async () => {
      const fakeCancelSpawn = (exe, args) => {
        if (args.includes('cancel')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              command: 'meshloop:cancel',
              data: {
                session_id: 'session-cancel-test',
                status: 'cancelled',
                orphan_process_count: 0,
              },
            }),
            stderr: '',
          }
        }
        return { status: 0, stdout: '{}', stderr: '' }
      }

      const provider = createMeshloopProvider({ spawn: fakeCancelSpawn })
      const cancelResult = await provider.cancel({
        sessionId: 'session-cancel-test',
        cwd: process.cwd(),
      })

      expect(cancelResult.status).toBe('cancelled')
      expect(cancelResult.sessionId).toBe('session-cancel-test')
      expect(cancelResult.ok).toBe(true)
    })
  })

  // Scenario E: Fault Injection - Git Lock Contention
  describe('Scenario E: Fault Injection - Git Lock Contention', () => {
    it('leaves an existing index lock untouched during read-only metadata inspection', () => {
      const tempRepo = mkdtempSync(join(tmpdir(), 'git-lock-test-'))
      const gitDir = join(tempRepo, '.git')
      const { mkdirSync } = require('node:fs')
      mkdirSync(gitDir, { recursive: true })

      const lockFile = join(gitDir, 'index.lock')
      writeFileSync(lockFile, 'lock-active')

      try {
        const commit = '1234567890abcdef1234567890abcdef12345678'
        const inspected = ingestWorktreeCommit({
          root: tempRepo,
          gitExport: { commit_sha: commit, branch_ref: 'refs/heads/lock-test' },
          spawn: (exe, args) => ({
            status: 0,
            stdout:
              args[0] === 'cat-file' ? 'commit' : args[0] === 'rev-parse' ? commit : 'file.txt\0',
          }),
        })
        expect(inspected.verified).toBe(true)
        expect(inspected.integrated).toBe(false)
        expect(readFileSync(lockFile, 'utf8')).toBe('lock-active')
      } finally {
        // Cleanup lock file to verify recovery
        unlinkSync(lockFile)
      }
    })
  })

  // Scenario F: Fault Injection - Protocol Version Mismatch
  describe('Scenario F: Fault Injection - Version & Capability Mismatch', () => {
    it('rejects incompatible profile version before executing any work', () => {
      const provider = createMeshloopProvider()

      expect(() =>
        provider.plan({
          profileVersion: 999, // Incompatible future version
        }),
      ).toThrow(MeshloopAdapterError)

      expect(() =>
        provider.plan({
          profileVersion: 999,
        }),
      ).toThrowError(/Incompatible profile version/)
    })

    it('rejects destructive restart continuation commands', () => {
      const provider = createMeshloopProvider()
      expect(() => provider.plan({ restart: true })).toThrow(MeshloopAdapterError)
      expect(() => provider.plan({ reset: true })).toThrow(MeshloopAdapterError)
      expect(() => provider.plan({ flags: ['--restart'] })).toThrowError(
        /Destructive operations \(--restart \/ --reset\) are prohibited/,
      )
    })
  })
})
