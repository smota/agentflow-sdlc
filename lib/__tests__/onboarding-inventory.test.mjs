import { describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { inspectProject } from '../onboarding/project-reader.mjs'
import { hashContent, lockfileV2, serializeLockfile } from '../lockfile.mjs'
import { resolveCompositionProfile } from '../adoption/profiles.mjs'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const safeTmpBase = realpathSync(tmpdir())

function createTestDir(prefix) {
  return mkdtempSync(join(safeTmpBase, `agy-test-${prefix}-`))
}

function trySymlink(target, link, type = 'file') {
  try {
    symlinkSync(target, link, type)
    return true
  } catch {
    return false
  }
}

describe('inspectProject (S3 issue #253)', () => {
  it.each([null, [], 'text', 3])('rejects parseable non-object config %j', (value) => {
    const target = createTestDir('invalid-config')
    try {
      writeFileSync(join(target, 'agent-workflow.config.json'), JSON.stringify(value))
      expect(inspectProject(packageRoot, target).config.status).toBe('invalid')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it.each([[null], [{ target: 'x', hash: 'bad' }]])(
    'diagnoses invalid lock entries %j',
    (entry) => {
      const target = createTestDir('invalid-lock')
      try {
        writeFileSync(
          join(target, 'agent-framework-lock.json'),
          JSON.stringify({ version: 2, entries: [entry] }),
        )
        expect(inspectProject(packageRoot, target).lock.format).toBe('unknown')
      } finally {
        rmSync(target, { recursive: true, force: true })
      }
    },
  )
  it('classifies new empty directory as empty with missing lock and config', () => {
    const targetDir = createTestDir('empty')
    try {
      const result = inspectProject(packageRoot, targetDir)
      expect(result.version).toBe(1)
      expect(result.classification).toBe('empty')
      expect(result.lock).toEqual({ format: 'missing', hash: null })
      expect(result.config).toEqual({ status: 'missing' })
      expect(result.pendingJournal).toBe(false)
      expect(result.rootIdentity).toBeDefined()
      expect(typeof result.rootIdentity.dev).toBe('number')
      expect(typeof result.rootIdentity.ino).toBe('number')
      expect(result.entries.length).toBeGreaterThan(0)
      expect(result.entries.every((e) => e.kind === 'missing' && e.state === 'missing')).toBe(true)
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('classifies valid config without lock or files as partial', () => {
    const targetDir = createTestDir('partial-config')
    try {
      writeFileSync(
        join(targetDir, 'agent-workflow.config.json'),
        JSON.stringify({ defaultPlatform: 'agy' }, null, 2),
      )
      const result = inspectProject(packageRoot, targetDir)
      expect(result.classification).toBe('partial')
      expect(result.config.status).toBe('valid')
      expect(result.config.value).toEqual({ defaultPlatform: 'agy' })
      expect(result.lock.format).toBe('missing')
      expect(result.pendingJournal).toBe(false)
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('classifies complete installation matching v2 lock, config, and package bytes', () => {
    const targetDir = createTestDir('complete')
    try {
      const profile = resolveCompositionProfile('standard')
      writeFileSync(
        join(targetDir, 'agent-workflow.config.json'),
        JSON.stringify({ defaultPlatform: 'agy' }, null, 2),
      )

      const lockEntries = []
      for (const relPath of profile.managedFiles) {
        const sourcePath = join(packageRoot, relPath)
        const content = readFileSync(sourcePath)
        const hash = hashContent(content)
        const dest = join(targetDir, relPath)
        mkdirSync(resolve(dest, '..'), { recursive: true })
        writeFileSync(dest, content)
        lockEntries.push({
          source: relPath,
          target: relPath,
          ownership: 'managed',
          state: 'managed',
          hash,
        })
      }

      for (const entry of profile.seedOnceFiles) {
        const sourcePath = join(packageRoot, entry.from)
        const content = readFileSync(sourcePath)
        const dest = join(targetDir, entry.to)
        mkdirSync(resolve(dest, '..'), { recursive: true })
        writeFileSync(dest, content)
        lockEntries.push({
          source: entry.from,
          target: entry.to,
          ownership: 'seed-once',
          state: 'managed',
          hash: hashContent(content),
        })
      }

      const lockObj = lockfileV2({
        profile: 'standard',
        packageIdentity: { name: 'agentflow-sdlc', version: '0.1.0' },
        planToken: 'test-token',
        entries: lockEntries,
      })
      writeFileSync(join(targetDir, 'agent-framework-lock.json'), serializeLockfile(lockObj))

      const result = inspectProject(packageRoot, targetDir)
      expect(result.classification).toBe('complete')
      expect(result.lock.format).toBe('v2')
      expect(result.config.status).toBe('valid')
      expect(result.entries.every((e) => e.kind === 'file')).toBe(true)
      expect(
        result.entries.every((e) =>
          e.ownership === 'managed' ? e.state === 'managed' : e.state === 'authored',
        ),
      ).toBe(true)
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('handles malformed lockfile via diagnostics and classifies as unknown', () => {
    const targetDir = createTestDir('malformed-lock')
    try {
      writeFileSync(join(targetDir, 'agent-framework-lock.json'), '{ not valid json')
      const result = inspectProject(packageRoot, targetDir)
      expect(result.lock.format).toBe('unknown')
      expect(result.lock.error).toBeDefined()
      expect(result.classification).toBe('unknown')
      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.diagnostics.some((d) => d.includes('Malformed lockfile'))).toBe(true)
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('handles malformed config via diagnostics and classifies as unknown', () => {
    const targetDir = createTestDir('malformed-config')
    try {
      writeFileSync(join(targetDir, 'agent-workflow.config.json'), '{\\n  invalid')
      const result = inspectProject(packageRoot, targetDir)
      expect(result.config.status).toBe('invalid')
      expect(result.classification).toBe('unknown')
      expect(result.diagnostics.some((d) => d.includes('Malformed config file'))).toBe(true)
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('flags unmanaged existing file as conflict even when matching expected bytes', () => {
    const targetDir = createTestDir('unmanaged-conflict')
    try {
      const profile = resolveCompositionProfile('standard')
      const sampleFile = profile.managedFiles[0]
      const sourceContent = readFileSync(join(packageRoot, sampleFile))
      const dest = join(targetDir, sampleFile)
      mkdirSync(resolve(dest, '..'), { recursive: true })
      writeFileSync(dest, sourceContent)

      const result = inspectProject(packageRoot, targetDir)
      expect(result.classification).toBe('conflicting')
      const entry = result.entries.find((e) => e.target === sampleFile)
      expect(entry).toBeDefined()
      expect(entry.kind).toBe('file')
      expect(entry.hash).toBe(entry.expectedHash)
      expect(entry.state).toBe('conflict')
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('flags modified managed file drifting from v2 lock as conflict', () => {
    const targetDir = createTestDir('drift-conflict')
    try {
      const profile = resolveCompositionProfile('standard')
      const sampleFile = profile.managedFiles[0]
      const dest = join(targetDir, sampleFile)
      mkdirSync(resolve(dest, '..'), { recursive: true })
      writeFileSync(dest, 'modified content not matching lock')

      const lockObj = lockfileV2({
        profile: 'standard',
        packageIdentity: { name: 'agentflow-sdlc', version: '0.1.0' },
        planToken: 'test-token',
        entries: [
          {
            source: sampleFile,
            target: sampleFile,
            ownership: 'managed',
            state: 'managed',
            hash: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          },
        ],
      })
      writeFileSync(join(targetDir, 'agent-framework-lock.json'), serializeLockfile(lockObj))

      const result = inspectProject(packageRoot, targetDir)
      expect(result.classification).toBe('conflicting')
      const entry = result.entries.find((e) => e.target === sampleFile)
      expect(entry.state).toBe('conflict')
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('never traverses symlinks or broken links and performs zero writes', () => {
    const targetDir = createTestDir('links-target')
    const outsideDir = createTestDir('links-outside')
    try {
      const outsideSecret = join(outsideDir, 'external-secret.txt')
      writeFileSync(outsideSecret, 'super secret data')

      const profile = resolveCompositionProfile('standard')
      const linkTargetRel = profile.managedFiles[0]
      const linkPath = join(targetDir, linkTargetRel)
      mkdirSync(resolve(linkPath, '..'), { recursive: true })

      const symlinkCreated = trySymlink(outsideSecret, linkPath, 'file')
      const brokenPath = join(targetDir, profile.managedFiles[1] || 'broken-link.mjs')
      mkdirSync(resolve(brokenPath, '..'), { recursive: true })
      const brokenCreated = trySymlink(join(outsideDir, 'nonexistent.txt'), brokenPath, 'file')

      if (symlinkCreated) {
        const result = inspectProject(packageRoot, targetDir)
        const linkEntry = result.entries.find((e) => e.target === linkTargetRel)
        expect(linkEntry).toBeDefined()
        expect(linkEntry.kind).toBe('link')
        expect(linkEntry.hash).toBeNull()
        expect(linkEntry.state).toBe('conflict')
        expect(readFileSync(outsideSecret, 'utf8')).toBe('super secret data')
      }

      if (brokenCreated) {
        const result = inspectProject(packageRoot, targetDir)
        const brokenEntry = result.entries.find(
          (e) => e.target === (profile.managedFiles[1] || 'broken-link.mjs'),
        )
        if (brokenEntry) {
          expect(brokenEntry.kind).toBe('link')
          expect(brokenEntry.hash).toBeNull()
          expect(brokenEntry.state).toBe('conflict')
        }
      }
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects root symlink or junction', () => {
    const realDir = createTestDir('real-root')
    const linkDir = join(safeTmpBase, `agy-test-link-root-${Date.now()}`)
    try {
      const created =
        trySymlink(realDir, linkDir, 'junction') || trySymlink(realDir, linkDir, 'dir')
      if (created) {
        expect(() => inspectProject(packageRoot, linkDir)).toThrow(/symlink or junction/)
      }
    } finally {
      try {
        rmSync(linkDir, { force: true })
      } catch {}
      rmSync(realDir, { recursive: true, force: true })
    }
  })

  it('recognizes legacy lock format without migration and classifies as legacy', () => {
    const targetDir = createTestDir('legacy-lock')
    try {
      const legacyLock = {
        files: { 'AGENTS.md': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
        merged: [],
      }
      writeFileSync(
        join(targetDir, 'agent-framework-lock.json'),
        JSON.stringify(legacyLock, null, 2),
      )
      const result = inspectProject(packageRoot, targetDir)
      expect(result.lock.format).toBe('legacy')
      expect(result.lock.data).toEqual(legacyLock)
      expect(result.classification).toBe('legacy')
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('produces deterministic repeated snapshots with sorted entries', () => {
    const targetDir = createTestDir('deterministic')
    try {
      const snap1 = inspectProject(packageRoot, targetDir)
      const snap2 = inspectProject(packageRoot, targetDir)
      expect(snap1).toEqual(snap2)
      const targets = snap1.entries.map((e) => e.target)
      const sorted = [...targets].sort((a, b) => a.localeCompare(b))
      expect(targets).toEqual(sorted)
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })
})
