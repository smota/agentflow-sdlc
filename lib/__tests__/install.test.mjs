import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FRAMEWORK_FILES, SEED_ONCE_FILES } from '../framework-files.mjs'
import { doctor, init, markMerged, sync } from '../install.mjs'
import { migrateRename } from '../rename-migration.mjs'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

describe('init/sync/doctor', () => {
  let targetDir

  beforeEach(() => {
    targetDir = mkdtempSync(join(tmpdir(), 'agentflow-sdlc-target-'))
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

  it('sync run twice with no local edits produces no framework diff on the second run', () => {
    init(packageRoot, targetDir)
    sync(packageRoot, targetDir) // first sync: framework == source, everything "unchanged"

    const second = sync(packageRoot, targetDir)

    expect(second.installed).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.conflicts).toEqual([])
    expect(second.removedByProject).toEqual([])
    expect(second.seeded).toEqual([])
    expect(second.seededSkipped).toEqual(SEED_ONCE_FILES.map((f) => f.to))
    expect(second.unchanged).toHaveLength(FRAMEWORK_FILES.length)
  })

  it('sync seeds missing seed-once project files without overwriting existing ones', () => {
    const partialDir = mkdtempSync(join(tmpdir(), 'agentflow-sdlc-sync-seed-'))
    try {
      writeFileSync(join(partialDir, 'README.md'), '# project\n')
      const report = sync(packageRoot, partialDir)

      expect(report.seeded).toEqual(SEED_ONCE_FILES.map((f) => f.to))
      expect(existsSync(join(partialDir, 'AGENTS.md'))).toBe(true)
      expect(existsSync(join(partialDir, 'docs', 'stack-conventions.md'))).toBe(true)

      const second = sync(packageRoot, partialDir)
      expect(second.seeded).toEqual([])
      expect(second.seededSkipped).toEqual(SEED_ONCE_FILES.map((f) => f.to))
    } finally {
      rmSync(partialDir, { recursive: true, force: true })
    }
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

  it('markMerged records a hand-merged framework file that sync and doctor never fast-forward', () => {
    init(packageRoot, targetDir)
    const targetPath = join(targetDir, 'CLAUDE.md')
    const localEdit = '# CLAUDE.md — hand merged project adapter\n'
    writeFileSync(targetPath, localEdit)

    const marked = markMerged(targetDir, 'CLAUDE.md')
    expect(marked).toEqual({ merged: 'CLAUDE.md' })

    const syncReport = sync(packageRoot, targetDir)
    expect(syncReport.conflicts).not.toContain('CLAUDE.md')
    expect(syncReport.merged).toContain('CLAUDE.md')
    expect(readFileSync(targetPath, 'utf8')).toBe(localEdit)

    const doctorReport = doctor(packageRoot, targetDir)
    expect(doctorReport.modified).not.toContain('CLAUDE.md')
    expect(doctorReport.merged).toContain('CLAUDE.md')
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
    const partialDir = mkdtempSync(join(tmpdir(), 'agentflow-sdlc-partial-'))
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

  it('migrateRename reports and rewrites legacy framework references in adopter files', () => {
    writeFileSync(
      join(targetDir, 'README.md'),
      'Use https://github.com/smota/multi-agent-sdlc and multi-agent-sdlc.\n',
    )
    writeFileSync(
      join(targetDir, 'agent-framework-lock.json'),
      JSON.stringify({ source: 'smota/multi-agent-sdlc', files: {}, merged: [] }, null, 2),
    )

    const check = migrateRename(targetDir)
    expect(check.mode).toBe('check')
    expect(check.changed).toEqual(['agent-framework-lock.json', 'README.md'])
    expect(readFileSync(join(targetDir, 'README.md'), 'utf8')).toContain('multi-agent-sdlc')

    const write = migrateRename(targetDir, { write: true })
    expect(write.mode).toBe('write')
    expect(write.changed).toEqual(['agent-framework-lock.json', 'README.md'])
    expect(readFileSync(join(targetDir, 'README.md'), 'utf8')).toContain(
      'https://github.com/smota/agentflow-sdlc',
    )
    expect(readFileSync(join(targetDir, 'README.md'), 'utf8')).toContain('agentflow-sdlc')
  })

  it('init and doctor report discovered extension packs without enabling them', () => {
    const initReport = init(packageRoot, targetDir)
    const doctorReport = doctor(packageRoot, targetDir)

    expect(initReport.extensionEnabledValid).toEqual([])
    expect(initReport.extensionDiscoveredDisabled).toContain(
      'extensions/evidence-driven-engineering',
    )
    expect(doctorReport.extensionDiscoveredDisabled).toContain(
      'extensions/agent-handoff-governance',
    )
  })

  it('doctor reports missing and invalid enabled extension packs', () => {
    init(packageRoot, targetDir)
    writeFileSync(
      join(targetDir, 'agent-workflow.config.json'),
      JSON.stringify({
        extensions: {
          enabledPacks: ['extensions/evidence-driven-engineering', 'extensions/missing'],
        },
      }),
    )
    rmSync(join(targetDir, 'extensions/evidence-driven-engineering/README.md'))

    const report = doctor(packageRoot, targetDir)

    expect(report.extensionEnabledMissing).toEqual(['extensions/missing'])
    expect(report.extensionEnabledInvalid.join('\n')).toContain(
      'extensions/evidence-driven-engineering',
    )
  })
})
