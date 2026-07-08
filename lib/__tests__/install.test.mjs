import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FRAMEWORK_FILES, SEED_ONCE_FILES } from '../framework-files.mjs'
import { doctor, init, sync } from '../install.mjs'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

describe('init/sync/doctor', () => {
  let targetDir

  beforeEach(() => {
    targetDir = mkdtempSync(join(tmpdir(), 'multi-agent-sdlc-target-'))
  })

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true })
  })

  it('init installs every framework file and seeds project-owned policy docs', () => {
    const report = init(packageRoot, targetDir)

    expect(report.installed).toHaveLength(FRAMEWORK_FILES.length)
    expect(report.seeded).toEqual(SEED_ONCE_FILES.map((f) => f.to))
    for (const relPath of FRAMEWORK_FILES) {
      expect(readFileSync(join(targetDir, relPath), 'utf8').length).toBeGreaterThan(0)
    }
    expect(readFileSync(join(targetDir, 'AGENTS.md'), 'utf8')).toContain(
      'required first-read policy document',
    )
  })

  it('doctor reports zero drift immediately after init', () => {
    init(packageRoot, targetDir)
    const report = doctor(packageRoot, targetDir)

    expect(report.modified).toEqual([])
    expect(report.missing).toEqual([])
    expect(report.notInstalled).toEqual([])
    expect(report.ok).toHaveLength(FRAMEWORK_FILES.length)
  })

  it('sync run twice with no local edits produces no diff on the second run', () => {
    init(packageRoot, targetDir)
    sync(packageRoot, targetDir) // first sync: framework == source, everything "unchanged"

    const second = sync(packageRoot, targetDir)

    expect(second.installed).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.conflicts).toEqual([])
    expect(second.removedByProject).toEqual([])
    expect(second.unchanged).toHaveLength(FRAMEWORK_FILES.length)
  })

  it('sync reports a conflict instead of overwriting a locally-modified file, and leaves it untouched', () => {
    init(packageRoot, targetDir)
    const targetPath = join(targetDir, 'CLAUDE.md')
    const localEdit = '# CLAUDE.md — locally customized\n'
    writeFileSync(targetPath, localEdit)

    const report = sync(packageRoot, targetDir)

    expect(report.conflicts).toContain('CLAUDE.md')
    expect(readFileSync(targetPath, 'utf8')).toBe(localEdit)
  })

  it('sync leaves seeded AGENTS.md project-owned after local edits', () => {
    init(packageRoot, targetDir)
    const targetPath = join(targetDir, 'AGENTS.md')
    const localEdit = '# AGENTS.md — project policy\n'
    writeFileSync(targetPath, localEdit)

    const report = sync(packageRoot, targetDir)

    expect(report.conflicts).not.toContain('AGENTS.md')
    expect(report.updated).not.toContain('AGENTS.md')
    expect(readFileSync(targetPath, 'utf8')).toBe(localEdit)
  })

  it('sync installs a framework file that did not exist in the target yet', () => {
    init(packageRoot, targetDir)
    // Simulate an older install: drop one file and its lock entry by re-running init into a
    // fresh dir that only has a subset, then syncing against the full package.
    const partialDir = mkdtempSync(join(tmpdir(), 'multi-agent-sdlc-partial-'))
    try {
      init(packageRoot, partialDir)
      rmSync(join(partialDir, 'CODEX.md'))
      // Remove the file's lock entry too so sync treats it as "never installed" rather than
      // "removed by project".
      const lockPath = join(partialDir, 'agent-framework-lock.json')
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
      delete lock.files['CODEX.md']
      writeFileSync(lockPath, JSON.stringify(lock, null, 2))

      const report = sync(packageRoot, partialDir)

      expect(report.installed).toContain('CODEX.md')
      expect(readFileSync(join(partialDir, 'CODEX.md'), 'utf8').length).toBeGreaterThan(0)
    } finally {
      rmSync(partialDir, { recursive: true, force: true })
    }
  })

  it('sync reports a file the project intentionally deleted as removedByProject, without recreating it', () => {
    init(packageRoot, targetDir)
    rmSync(join(targetDir, 'AGY.md'))

    const report = sync(packageRoot, targetDir)

    expect(report.removedByProject).toContain('AGY.md')
    expect(() => readFileSync(join(targetDir, 'AGY.md'), 'utf8')).toThrow()
  })
})
