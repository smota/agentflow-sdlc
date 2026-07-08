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

export function normalizeLockfile(parsed) {
  const files = parsed?.files && typeof parsed.files === 'object' ? parsed.files : {}
  const merged = Array.isArray(parsed?.merged) ? [...new Set(parsed.merged)].sort() : []
  return { files, merged }
}

export function readLockfile(targetDir) {
  const path = lockfilePath(targetDir)
  if (!existsSync(path)) {
    return { files: {}, merged: [] }
  }
  try {
    return normalizeLockfile(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { files: {}, merged: [] }
  }
}

export function writeLockfile(targetDir, lockfile) {
  const sortedFiles = Object.fromEntries(Object.entries(lockfile.files ?? {}).sort())
  const merged = [...new Set(lockfile.merged ?? [])].sort()
  writeFileSync(
    lockfilePath(targetDir),
    `${JSON.stringify({ files: sortedFiles, merged }, null, 2)}\n`,
  )
}
