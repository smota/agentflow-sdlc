import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { classifyBranch, loadProjectConfig } from '../../lib/branch-strategy.mjs'

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

export function getBranchClassification(branch) {
  try {
    return classifyBranch(branch, loadProjectConfig())
  } catch {
    return classifyBranch(branch, {})
  }
}

export function isTrunkBranch(branch) {
  return getBranchClassification(branch).classification === 'protected'
}

export function isAllowedBranch(branch) {
  return getBranchClassification(branch).allowedForImplementation
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
