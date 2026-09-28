import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
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
    it('inspects a real committed export without changing the checkout', () => {
      const parent = resolve(tmpdir())
      const root = mkdtempSync(join(parent, 'af-commit-inspect-'))
      const git = (...args) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
      try {
        git('init', '--quiet', '--initial-branch=fixture')
        writeFileSync(join(root, 'artifact.txt'), 'original bytes\n')
        git('add', 'artifact.txt')
        git(
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '--quiet',
          '-m',
          'fixture',
        )
        const commit = git('rev-parse', 'HEAD')
        const before = git('status', '--porcelain')
        const result = ingestWorktreeCommit({
          root,
          gitExport: { commit_sha: commit, branch_ref: 'refs/heads/fixture' },
        })
        expect(result.changedFiles).toEqual(['artifact.txt'])
        expect(result.integrated).toBe(false)
        expect(git('rev-parse', 'HEAD')).toBe(commit)
        expect(git('status', '--porcelain')).toBe(before)
      } finally {
        if (dirname(resolve(root)) !== parent || !basename(root).startsWith('af-commit-inspect-'))
          throw new Error('Unsafe fixture cleanup')
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('ingests existing git commit and emits observation', () => {
      const fakeSpawn = (exe, args) => {
        if (args.includes('cat-file')) {
          return { status: 0, stdout: 'commit', stderr: '' }
        }
        if (args.includes('rev-parse'))
          return { status: 0, stdout: '1234567890abcdef1234567890abcdef12345678', stderr: '' }
        if (args.includes('diff-tree')) {
          return { status: 0, stdout: 'lib/core.js\0lib/utils.js\0', stderr: '' }
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
      expect(observations.map((o) => o.kind)).toContain('meshloop_commit_inspected')
      expect(result.integrated).toBe(false)
      expect(result.artifactBytesVerified).toBe(false)
      expect(result.assurance).toBe('git-commit-metadata')
    })

    it.each([
      ['blob', '1234567890abcdef1234567890abcdef12345678', 0, /must be a commit/],
      ['commit', '0'.repeat(40), 0, /no longer identifies/],
      ['commit', '1234567890abcdef1234567890abcdef12345678', 1, /verification failed/],
    ])(
      'refuses invalid object, changed branch or failed diff',
      (type, branchSha, diffStatus, error) => {
        expect(() =>
          ingestWorktreeCommit({
            gitExport: {
              commit_sha: '1234567890abcdef1234567890abcdef12345678',
              branch_ref: 'refs/heads/test',
            },
            spawn: (_exe, args) => ({
              status: args[0] === 'diff-tree' ? diffStatus : 0,
              stdout: args[0] === 'cat-file' ? type : args[0] === 'rev-parse' ? branchSha : '',
              stderr: '',
            }),
          }),
        ).toThrow(error)
      },
    )

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
      ).toThrowError(/metadata verification failed/)
    })
  })

  describe('evaluateTechnicalReceiptGate', () => {
    it('does not invent a human mandate based on provider identity', () => {
      const gate = evaluateTechnicalReceiptGate({
        receipt: { status: 'pass', provider: 'meshloop' },
      })
      expect(gate.sdlcAccepted).toBe(false)
      expect(gate.requiresSdlcAcceptance).toBe(true)
      expect(gate.requiresHumanAcceptance).toBe(false)
    })

    it('enforces that technical success in Meshloop never bypasses SDLC human gate', async () => {
      const fakeSpawn = () => ({
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          command: 'meshloop:run',
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

      const provider = createMeshloopProvider({
        spawn: fakeSpawn,
        gitSpawn: (_exe, args) => ({
          status: 0,
          stdout:
            args[0] === 'cat-file'
              ? 'commit'
              : args[0] === 'rev-parse'
                ? 'fedcba0987654321fedcba0987654321fedcba09'
                : '',
        }),
      })
      const plan = provider.plan({ cwd: process.cwd() })
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
