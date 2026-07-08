import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FRAMEWORK_FILES, SEED_ONCE_FILES } from './framework-files.mjs'
import { hashContent, readLockfile, writeLockfile } from './lockfile.mjs'

function readSource(packageRoot, relPath) {
  return readFileSync(join(packageRoot, relPath), 'utf8')
}

function writeTarget(targetDir, relPath, content) {
  const fullPath = join(targetDir, relPath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content)
}

function seedOnceFiles(packageRoot, targetDir) {
  const seeded = []
  const seededSkipped = []

  for (const { from, to } of SEED_ONCE_FILES) {
    const targetPath = join(targetDir, to)
    if (existsSync(targetPath)) {
      seededSkipped.push(to)
      continue
    }
    writeTarget(targetDir, to, readSource(packageRoot, from))
    seeded.push(to)
  }

  return { seeded, seededSkipped }
}

/**
 * Installs every framework-owned file into targetDir, plus seed-once files that don't already
 * exist there. Always overwrites — intended for a fresh or already-in-sync target. Use `sync`
 * instead when a target may already have local edits worth protecting.
 */
export function init(packageRoot, targetDir) {
  const lockfile = { files: {}, merged: [] }
  const installed = []

  for (const relPath of FRAMEWORK_FILES) {
    const content = readSource(packageRoot, relPath)
    writeTarget(targetDir, relPath, content)
    lockfile.files[relPath] = hashContent(content)
    installed.push(relPath)
  }

  const { seeded, seededSkipped } = seedOnceFiles(packageRoot, targetDir)

  writeLockfile(targetDir, lockfile)
  return { installed, seeded, seededSkipped }
}

/**
 * Re-installs framework-owned files that are safe to overwrite (unmodified since the last
 * install/sync), reports — without touching — anything the project has locally edited or
 * intentionally removed, and seeds missing seed-once project files without overwriting existing
 * project-owned content.
 */
export function sync(packageRoot, targetDir) {
  const lockfile = readLockfile(targetDir)
  const merged = new Set(lockfile.merged ?? [])
  const report = {
    installed: [],
    updated: [],
    unchanged: [],
    conflicts: [],
    merged: [],
    removedByProject: [],
    seeded: [],
    seededSkipped: [],
  }

  const seededReport = seedOnceFiles(packageRoot, targetDir)
  report.seeded.push(...seededReport.seeded)
  report.seededSkipped.push(...seededReport.seededSkipped)

  for (const relPath of FRAMEWORK_FILES) {
    const sourceContent = readSource(packageRoot, relPath)
    const sourceHash = hashContent(sourceContent)
    const targetPath = join(targetDir, relPath)
    const targetExists = existsSync(targetPath)
    const lockedHash = lockfile.files[relPath]

    if (merged.has(relPath)) {
      if (targetExists) {
        report.merged.push(relPath)
      } else {
        report.removedByProject.push(relPath)
      }
      continue
    }

    if (!targetExists) {
      if (lockedHash) {
        report.removedByProject.push(relPath)
        continue
      }
      writeTarget(targetDir, relPath, sourceContent)
      lockfile.files[relPath] = sourceHash
      report.installed.push(relPath)
      continue
    }

    const currentHash = hashContent(readFileSync(targetPath, 'utf8'))

    if (!lockedHash) {
      report.conflicts.push(relPath)
      continue
    }

    if (currentHash !== lockedHash) {
      report.conflicts.push(relPath)
      continue
    }

    if (currentHash === sourceHash) {
      report.unchanged.push(relPath)
      continue
    }

    writeTarget(targetDir, relPath, sourceContent)
    lockfile.files[relPath] = sourceHash
    report.updated.push(relPath)
  }

  writeLockfile(targetDir, lockfile)
  return report
}

export function markMerged(targetDir, relPath) {
  const normalized = relPath.replace(/\\/g, '/')
  if (!FRAMEWORK_FILES.includes(normalized)) {
    throw new Error(`Cannot mark non-framework file as merged: ${normalized}`)
  }

  const lockfile = readLockfile(targetDir)
  delete lockfile.files[normalized]
  lockfile.merged = [...new Set([...(lockfile.merged ?? []), normalized])].sort()
  writeLockfile(targetDir, lockfile)
  return { merged: normalized }
}

/**
 * Read-only integrity check: compares the target's actual files against the lockfile (local
 * drift) and against this package's current source (update availability). Writes nothing.
 */
export function doctor(packageRoot, targetDir) {
  const lockfile = readLockfile(targetDir)
  const merged = new Set(lockfile.merged ?? [])
  const report = {
    ok: [],
    modified: [],
    merged: [],
    missing: [],
    notInstalled: [],
    updateAvailable: [],
  }

  for (const relPath of FRAMEWORK_FILES) {
    const targetPath = join(targetDir, relPath)
    const lockedHash = lockfile.files[relPath]
    const targetExists = existsSync(targetPath)

    if (merged.has(relPath)) {
      if (targetExists) {
        report.merged.push(relPath)
      } else {
        report.missing.push(relPath)
      }
      continue
    }

    if (!lockedHash && !targetExists) {
      report.notInstalled.push(relPath)
      continue
    }
    if (!lockedHash && targetExists) {
      report.modified.push(relPath) // present but never tracked by this CLI
      continue
    }
    if (lockedHash && !targetExists) {
      report.missing.push(relPath)
      continue
    }

    const currentHash = hashContent(readFileSync(targetPath, 'utf8'))
    if (currentHash !== lockedHash) {
      report.modified.push(relPath)
      continue
    }

    report.ok.push(relPath)
    const sourceHash = hashContent(readSource(packageRoot, relPath))
    if (sourceHash !== currentHash) {
      report.updateAvailable.push(relPath)
    }
  }

  return report
}
