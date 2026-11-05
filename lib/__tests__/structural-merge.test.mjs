import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deepMerge, mergeHarnessSettings, validateSettingsManifest } from '../structural-merge.mjs'

describe('structural merge', () => {
  it('preserves project-owned keys and merges managed object', () => {
    const result = deepMerge(
      { permissions: { allow: ['Read'] }, projectOnly: true },
      { permissions: { allow: ['Read', 'Bash'] }, agentflowSdlc: { managedBy: 'agentflow-sdlc' } },
    )
    expect(result).toEqual({
      permissions: { allow: ['Read', 'Bash'] },
      projectOnly: true,
      agentflowSdlc: { managedBy: 'agentflow-sdlc' },
    })
  })

  it('blocks non-object settings roots instead of overwriting arrays', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'afsdlc-merge-'))
    writeFileSync(join(tmp, 'settings.json'), '[]\n')
    const packageRoot = mkdtempSync(join(tmpdir(), 'afsdlc-package-'))
    const manifests = join(packageRoot, 'manifests')
    mkdirSync(manifests, { recursive: true })
    writeFileSync(
      join(manifests, 'harness-settings.json'),
      JSON.stringify({
        version: 1,
        settings: {
          'claude-code': {
            path: 'settings.json',
            merge: { agentflowSdlc: { managedBy: 'agentflow-sdlc' } },
          },
          agy: { path: 'agy.json', merge: {} },
          codex: { path: 'codex.json', merge: {} },
          pi: { path: 'pi.json', merge: {} },
        },
      }),
    )
    const report = mergeHarnessSettings({ packageRoot, targetDir: tmp, harness: 'claude-code' })
    expect(report.ok).toBe(false)
    expect(report.entries[0].status).toBe('blocked-root-shape')
  })

  it('creates Codex hooks configuration without unsupported metadata', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'afsdlc-codex-new-'))
    const report = mergeHarnessSettings({
      packageRoot: process.cwd(),
      targetDir,
      harness: 'codex',
      write: true,
    })
    expect(report.ok).toBe(true)
    expect(JSON.parse(readFileSync(join(targetDir, '.codex/hooks.json'), 'utf8'))).toEqual({})
  })

  it('previews and repairs owned legacy Codex metadata while preserving hooks and description', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'afsdlc-codex-repair-'))
    mkdirSync(join(targetDir, '.codex'))
    const path = join(targetDir, '.codex/hooks.json')
    const preserved = {
      description: 'Project hooks',
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo ready' }] }] },
    }
    const before = JSON.stringify({
      ...preserved,
      agentflowSdlc: { managedBy: 'agentflow-sdlc', commands: ['legacy'] },
    })
    writeFileSync(path, before)
    const options = { packageRoot: process.cwd(), targetDir, harness: 'codex' }
    const preview = mergeHarnessSettings({ ...options, captureContent: true })
    expect(preview.entries[0].status).toBe('merge-planned')
    expect(preview.entries[0].preservesExistingKeys).toEqual(['description', 'hooks'])
    expect(JSON.parse(preview.captured[0].content)).toEqual(preserved)
    expect(readFileSync(path, 'utf8')).toBe(before)
    mergeHarnessSettings({ ...options, write: true })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(preserved)
    expect(readFileSync(path + '.bak', 'utf8')).toBe(before)
    expect(mergeHarnessSettings(options).entries[0].status).toBe('unchanged')
  })

  it('preserves foreign Codex metadata and unrelated fields', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'afsdlc-codex-foreign-'))
    mkdirSync(join(targetDir, '.codex'))
    const path = join(targetDir, '.codex/hooks.json')
    const original = {
      hooks: {},
      projectOnly: true,
      agentflowSdlc: { managedBy: 'another-owner', custom: true },
    }
    writeFileSync(path, JSON.stringify(original))
    mergeHarnessSettings({ packageRoot: process.cwd(), targetDir, harness: 'codex', write: true })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(original)
  })

  it('continues merging managed metadata for other harnesses', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'afsdlc-other-harnesses-'))
    const report = mergeHarnessSettings({
      packageRoot: process.cwd(),
      targetDir,
      harness: 'claude-code,agy,pi',
      write: true,
    })
    for (const entry of report.entries) {
      expect(JSON.parse(readFileSync(entry.target, 'utf8')).agentflowSdlc.managedBy).toBe(
        'agentflow-sdlc',
      )
    }
  })

  it('validates settings manifest against plugin manifest paths', () => {
    const report = validateSettingsManifest({
      packageRoot: process.cwd(),
      pluginManifests: [
        { harness: 'claude-code', settings: ['.claude/settings.json'] },
        { harness: 'agy', settings: ['.agy/settings.json'] },
        { harness: 'codex', settings: ['.codex/hooks.json'] },
        { harness: 'pi', settings: ['.pi/settings.json'] },
      ],
    })
    expect(report.ok).toBe(true)
  })
})
