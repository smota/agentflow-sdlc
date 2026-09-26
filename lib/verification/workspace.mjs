import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createCandidateIdentity } from '../core/verification-observation.mjs'
import { emitObservation } from '../observability/observer.mjs'

export class WorktreeIngestionError extends Error {
  constructor(message, { code = 'WORKTREE_INGESTION_ERROR', details = null } = {}) {
    super(message)
    this.name = 'WorktreeIngestionError'
    this.code = code
    this.details = details
  }
}

export function containedPath(root, path, { allowMissing = false } = {}) {
  const base = resolve(root)
  const target = resolve(base, path)
  const rel = relative(base, target)
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel))
    throw new Error('Path must stay inside project')
  let current = base
  for (const part of ['', ...rel.split(sep)]) {
    current = part ? resolve(current, part) : current
    let info
    try {
      info = lstatSync(current)
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') continue
      throw error
    }
    if (info.isSymbolicLink()) throw new Error('Symlink or junction path is not permitted')
  }
  return target
}

export function fingerprintCandidate(root, definition, { observer } = {}) {
  if (!Array.isArray(definition.inputs) || !definition.inputs.length)
    throw new Error('Explicit candidate inputs are required')
  const inputs = {}
  for (const path of definition.inputs) {
    if (typeof path !== 'string' || path.replaceAll('\\', '/').split('/').includes('.git'))
      throw new Error('Invalid candidate input')
    const target = containedPath(root, path)
    if (!lstatSync(target).isFile()) throw new Error('Candidate input must be a regular file')
    const key = relative(resolve(root), target).replaceAll('\\', '/')
    if (Object.hasOwn(inputs, key)) throw new Error('Duplicate candidate input')
    const bytes = readFileSync(target)
    emitObservation(observer, {
      kind: 'file_read',
      bytes: bytes.length,
      files: 1,
      purpose: 'candidate',
    })
    inputs[key] = createHash('sha256').update(bytes).digest('hex')
  }
  return createCandidateIdentity({ inputs, context: definition.context ?? {} })
}

export function validateWorktreeGitExport(gitExport) {
  if (!gitExport || typeof gitExport !== 'object') {
    throw new WorktreeIngestionError('Git export metadata must be a non-null object', {
      code: 'INVALID_GIT_EXPORT',
    })
  }

  const commitSha = gitExport.commit_sha ?? gitExport.commitSha
  if (!commitSha || typeof commitSha !== 'string' || !/^[0-9a-fA-F]{40}$/.test(commitSha)) {
    throw new WorktreeIngestionError(
      'Git export commit SHA must be a 40-character hexadecimal string',
      {
        code: 'INVALID_COMMIT_SHA',
        details: { commitSha },
      },
    )
  }

  const branchRef = gitExport.branch_ref ?? gitExport.branchRef
  if (!branchRef || typeof branchRef !== 'string' || branchRef.trim() === '') {
    throw new WorktreeIngestionError('Git export branch reference must be a non-empty string', {
      code: 'INVALID_BRANCH_REF',
      details: { branchRef },
    })
  }

  const worktreePath = gitExport.worktree_path ?? gitExport.worktreePath ?? null
  const patchSha256 = gitExport.patch_sha256 ?? gitExport.patchSha256 ?? null

  return {
    commitSha: commitSha.toLowerCase(),
    branchRef: branchRef.trim(),
    worktreePath,
    patchSha256,
  }
}

export function ingestWorktreeCommit({
  root = process.cwd(),
  gitExport,
  gitExecutable = 'git',
  spawn = spawnSync,
  observer = null,
} = {}) {
  const normalizedExport = validateWorktreeGitExport(gitExport)
  const { commitSha, branchRef, worktreePath, patchSha256 } = normalizedExport

  // 1. Check that the commit SHA exists in the local Git repository
  const probe = spawn(gitExecutable, ['cat-file', '-e', commitSha], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })

  if (probe.error || probe.status !== 0) {
    throw new WorktreeIngestionError(
      `Commit ${commitSha} does not exist in the repository or failed verification probe`,
      {
        code: 'COMMIT_NOT_FOUND',
        details: { commitSha, error: probe.error?.message, stderr: probe.stderr },
      },
    )
  }

  // 2. Query commit files changed
  const diffTree = spawn(
    gitExecutable,
    ['diff-tree', '--no-commit-id', '--name-only', '-r', commitSha],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    },
  )

  const changedFiles =
    diffTree.status === 0 && typeof diffTree.stdout === 'string'
      ? diffTree.stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      : []

  emitObservation(observer, {
    kind: 'meshloop_commit_ingested',
    commitSha,
    branchRef,
    filesCount: changedFiles.length,
    worktreePath,
  })

  return {
    commitSha,
    branchRef,
    worktreePath,
    patchSha256,
    changedFiles,
    ingestedAt: new Date().toISOString(),
    verified: true,
  }
}

export function evaluateTechnicalReceiptGate({ receipt } = {}) {
  if (!receipt || typeof receipt !== 'object') {
    throw new WorktreeIngestionError('Execution receipt is required for gate evaluation', {
      code: 'MISSING_RECEIPT',
    })
  }

  const technicalIdle = receipt.metadata?.technicalIdle
  const gitExport = receipt.metadata?.gitExport
  const isMeshloop = receipt.actual?.platform === 'meshloop' || receipt.provider === 'meshloop'

  // An execution receipt from Meshloop carries technical status ('pass' if task graph finished),
  // but technical status or AwaitingHumanAcceptance NEVER bypasses Agentflow SDLC gates.
  const requiresHumanAcceptance =
    Boolean(technicalIdle === 'AwaitingHumanAcceptance') || Boolean(gitExport) || isMeshloop

  return {
    technicalPassed: receipt.status === 'pass',
    sdlcAccepted: false, // Never auto-accept SDLC gate from technical receipt alone
    requiresHumanAcceptance,
    gateClass: 'release-of-candidate',
    reason: requiresHumanAcceptance
      ? 'Technical work completed in isolated worktree; human acceptance gate is required before integration or PR merge'
      : 'Standard review gate evaluation',
    gitExport: gitExport ? validateWorktreeGitExport(gitExport) : null,
  }
}
