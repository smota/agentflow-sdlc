import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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
