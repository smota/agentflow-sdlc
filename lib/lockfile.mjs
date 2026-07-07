import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCKFILE_NAME } from './framework-files.mjs'

export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function lockfilePath(targetDir) {
  return join(targetDir, LOCKFILE_NAME)
}

export function readLockfile(targetDir) {
  const path = lockfilePath(targetDir)
  if (!existsSync(path)) {
    return { files: {} }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return { files: parsed.files ?? {} }
  } catch {
    return { files: {} }
  }
}

export function writeLockfile(targetDir, lockfile) {
  const sortedFiles = Object.fromEntries(Object.entries(lockfile.files).sort())
  writeFileSync(lockfilePath(targetDir), `${JSON.stringify({ files: sortedFiles }, null, 2)}\n`)
}
