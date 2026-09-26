import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyIssueGuard } from '../../scripts/verify-issue-guard.mjs'

const repos = []

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true })
  }
})

describe('verify-issue-guard script', () => {
  it('blocks direct edits on protected development/main branch', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentflow-guard-'))
    repos.push(tempDir)
    runGit(['init', '--initial-branch=development'], tempDir)
    runGit(['config', 'user.name', 'Tester'], tempDir)
    runGit(['config', 'user.email', 'tester@example.com'], tempDir)
    writeFileSync(join(tempDir, 'file.txt'), 'content')
    runGit(['add', 'file.txt'], tempDir)
    runGit(['commit', '-m', 'initial'], tempDir)

    const result = verifyIssueGuard({ cwd: tempDir })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("Direct edits/commits denied on protected branch 'development'")
  })

  it('allows work branches and compatibility issue branches', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentflow-guard-'))
    repos.push(tempDir)
    runGit(['init', '--initial-branch=development'], tempDir)
    runGit(['config', 'user.name', 'Tester'], tempDir)
    runGit(['config', 'user.email', 'tester@example.com'], tempDir)
    writeFileSync(join(tempDir, 'file.txt'), 'content')
    runGit(['add', 'file.txt'], tempDir)
    runGit(['commit', '-m', 'initial'], tempDir)

    runGit(['checkout', '-b', 'work/fix-issue'], tempDir)
    const workResult = verifyIssueGuard({ cwd: tempDir })
    expect(workResult.ok).toBe(true)
    expect(workResult.classification).toBe('work')

    runGit(['checkout', '-b', 'issue/42-fix-bug'], tempDir)
    const issueResult = verifyIssueGuard({ cwd: tempDir })
    expect(issueResult.ok).toBe(true)
    expect(issueResult.isExplicitIssueBranch).toBe(true)
    expect(issueResult.hasIssueAnchor).toBe(true)
  })

  it('fails non-conforming branches when bounded work branch is required', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentflow-guard-'))
    repos.push(tempDir)
    runGit(['init', '--initial-branch=development'], tempDir)
    runGit(['config', 'user.name', 'Tester'], tempDir)
    runGit(['config', 'user.email', 'tester@example.com'], tempDir)
    writeFileSync(join(tempDir, 'file.txt'), 'content')
    runGit(['add', 'file.txt'], tempDir)
    runGit(['commit', '-m', 'initial'], tempDir)

    runGit(['checkout', '-b', 'random-feature-branch'], tempDir)
    const result = verifyIssueGuard({ cwd: tempDir })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('does not conform')
  })
})
