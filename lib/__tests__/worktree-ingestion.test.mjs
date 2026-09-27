import { describe, expect, it } from 'vitest'
import {
  validateWorktreeGitExport,
  ingestWorktreeCommit,
  evaluateTechnicalReceiptGate,
  WorktreeIngestionError,
} from '../verification/workspace.mjs'
import { createMeshloopProvider } from '../providers/meshloop-provider.mjs'

describe('Worktree Ingestion & Technical Gate Evaluation (#291)', () => {
  describe('validateWorktreeGitExport', () => {
    it('validates a correct git export metadata structure', () => {
      const gitExport = {
        commit_sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        branch_ref: 'refs/heads/meshloop/task-100',
        worktree_path: '.meshloop-worktrees/task-100',
        patch_sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      }
      const validated = validateWorktreeGitExport(gitExport)
      expect(validated.commitSha).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')
      expect(validated.branchRef).toBe('refs/heads/meshloop/task-100')
      expect(validated.worktreePath).toBe('.meshloop-worktrees/task-100')
      expect(validated.patchSha256).toBe(
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      )
    })

    it('rejects invalid or missing commit SHA', () => {
      expect(() =>
        validateWorktreeGitExport({ commit_sha: 'too-short', branch_ref: 'main' }),
      ).toThrow(WorktreeIngestionError)
      expect(() =>
        validateWorktreeGitExport({ commit_sha: 'too-short', branch_ref: 'main' }),
      ).toThrowError(/40-character hexadecimal/)
      expect(() => validateWorktreeGitExport({ branch_ref: 'main' })).toThrow(
        WorktreeIngestionError,
      )
    })

    it('rejects empty or missing branch ref', () => {
      expect(() =>
        validateWorktreeGitExport({
          commit_sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          branch_ref: '   ',
        }),
      ).toThrow(WorktreeIngestionError)
      expect(() =>
        validateWorktreeGitExport({ commit_sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' }),
      ).toThrowError(/branch reference must be a non-empty string/)
    })
  })

  describe('ingestWorktreeCommit', () => {
    it('ingests existing git commit and emits observation', () => {
      const fakeSpawn = (exe, args) => {
        if (args.includes('cat-file')) {
          return { status: 0, stdout: '', stderr: '' }
        }
        if (args.includes('diff-tree')) {
          return { status: 0, stdout: 'lib/core.js\nlib/utils.js\n', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      }

      const observations = []
      const observer = (obs) => observations.push(obs)

      const result = ingestWorktreeCommit({
        gitExport: {
          commit_sha: '1234567890abcdef1234567890abcdef12345678',
          branch_ref: 'refs/heads/worktree/123',
          worktree_path: '.meshloop-worktrees/123',
        },
        spawn: fakeSpawn,
        observer,
      })

      expect(result.verified).toBe(true)
      expect(result.commitSha).toBe('1234567890abcdef1234567890abcdef12345678')
      expect(result.changedFiles).toEqual(['lib/core.js', 'lib/utils.js'])
      expect(observations.map((o) => o.kind)).toContain('meshloop_commit_ingested')
    })

    it('throws when commit probe fails in Git', () => {
      const failingSpawn = (exe, args) => {
        if (args.includes('cat-file')) {
          return { status: 128, stdout: '', stderr: 'fatal: Not a valid object name' }
        }
        return { status: 0, stdout: '', stderr: '' }
      }

      expect(() =>
        ingestWorktreeCommit({
          gitExport: {
            commit_sha: '0000000000000000000000000000000000000000',
            branch_ref: 'refs/heads/missing',
          },
          spawn: failingSpawn,
        }),
      ).toThrow(WorktreeIngestionError)
      expect(() =>
        ingestWorktreeCommit({
          gitExport: {
            commit_sha: '0000000000000000000000000000000000000000',
            branch_ref: 'refs/heads/missing',
          },
          spawn: failingSpawn,
        }),
      ).toThrowError(/does not exist in the repository/)
    })
  })

  describe('evaluateTechnicalReceiptGate', () => {
    it('enforces that technical success in Meshloop never bypasses SDLC human gate', async () => {
      const fakeSpawn = () => ({
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          command: 'run',
          data: {
            idle: 'AwaitingHumanAcceptance',
            git_export: {
              commit_sha: 'fedcba0987654321fedcba0987654321fedcba09',
              branch_ref: 'refs/heads/meshloop/done',
            },
          },
        }),
        stderr: '',
      })

      const provider = createMeshloopProvider({ spawn: fakeSpawn })
      const plan = provider.plan()
      const receipt = await provider.execute(plan, { confirm: plan.token })

      expect(receipt.status).toBe('pass') // Technical execution succeeded

      // Gate evaluation must mandate human acceptance
      const gateEvaluation = evaluateTechnicalReceiptGate({ receipt })
      expect(gateEvaluation.technicalPassed).toBe(true)
      expect(gateEvaluation.sdlcAccepted).toBe(false)
      expect(gateEvaluation.requiresHumanAcceptance).toBe(true)
      expect(gateEvaluation.gateClass).toBe('release-of-candidate')
      expect(gateEvaluation.gitExport.commitSha).toBe('fedcba0987654321fedcba0987654321fedcba09')
    })
  })
})
