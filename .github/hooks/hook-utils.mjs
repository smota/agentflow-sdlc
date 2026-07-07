import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const BRANCH_PATTERNS = [
  /^issue\/[0-9]+-[a-z][a-z0-9-]+$/,
  /^work\/[a-z][a-z0-9-]*$/,
  /^hotfix\/[a-z][a-z0-9-]*$/,
  /^spike\/[a-z][a-z0-9-]*$/,
  /^wt\/[0-9A-Za-z-]+$/,
  /^claude\//,
]

export function runGit(args, options = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      ...options,
    }).trim()
  } catch {
    return ''
  }
}

export function getCurrentBranch() {
  return runGit(['branch', '--show-current'])
}

export function getGitDir() {
  return runGit(['rev-parse', '--git-dir'])
}

export function isTrunkBranch(branch) {
  return ['main', 'master', 'staging', 'development'].includes(branch)
}

export function isAllowedBranch(branch) {
  return BRANCH_PATTERNS.some((pattern) => pattern.test(branch))
}

export function isPausedGitOperation() {
  const gitDir = getGitDir()
  if (gitDir.length === 0) {
    return false
  }

  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge/head-name'].some((relativePath) =>
    existsSync(`${gitDir}/${relativePath}`),
  )
}

export function printLines(lines) {
  process.stderr.write(`\n${lines.join('\n')}\n\n`)
}
