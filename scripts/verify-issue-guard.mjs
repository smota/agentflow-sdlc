import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyBranch, loadProjectConfig } from '../lib/branch-strategy.mjs'

export function verifyIssueGuard({ cwd = process.cwd() } = {}) {
  let branch = ''
  try {
    branch = execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return { ok: true, reason: 'not in a git repository or git unavailable' }
  }

  // Detached HEAD (e.g. CI environments) is allowed
  if (!branch) {
    return { ok: true, reason: 'detached HEAD or no branch' }
  }

  const config = loadProjectConfig(cwd)
  const classification = classifyBranch(branch, config)

  if (classification.classification === 'protected') {
    return {
      ok: false,
      reason: `Direct edits/commits denied on protected branch '${branch}'. Use a work/ or issue/ branch.`,
      branch,
    }
  }

  if (!classification.allowedForImplementation) {
    return {
      ok: false,
      reason: `Branch '${branch}' does not conform to allowed workstream patterns (${classification.reason}).`,
      branch,
    }
  }

  // Check issue linkage in branch name or SPEC.md
  const isExplicitIssueBranch = /^issue\/[0-9]+-[a-z0-9-]+$/.test(branch)
  const hasSpec = existsSync(join(cwd, 'SPEC.md'))
  const specHasIssue =
    hasSpec &&
    /"number"\s*:\s*[0-9]+|# Issue #?[0-9]+/i.test(readFileSync(join(cwd, 'SPEC.md'), 'utf8'))

  // Work branches (e.g. work/<theme>) are valid, but must have an active task anchor or spec when working
  return {
    ok: true,
    branch,
    classification: classification.classification,
    isExplicitIssueBranch,
    hasIssueAnchor: isExplicitIssueBranch || specHasIssue,
  }
}

if (process.argv[1] && process.argv[1].endsWith('verify-issue-guard.mjs')) {
  const result = verifyIssueGuard()
  if (!result.ok) {
    process.stderr.write(`[ISSUE-GUARD ERROR] ${result.reason}\n`)
    process.exit(1)
  }
  process.stdout.write(`[ISSUE-GUARD OK] Branch '${result.branch}' verified.\n`)
  process.exit(0)
}
