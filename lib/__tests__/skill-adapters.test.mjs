import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { adapterStatus, syncSkillAdapters } from '../skill-adapters.mjs'
import { validatePluginManifests } from '../plugin-manifests.mjs'

const packageRoot = resolve(import.meta.dirname, '..', '..')

describe('productized AgentFlow skill adapters', () => {
  it('projects all six skills and progressive-disclosure references', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-skills-'))
    const result = syncSkillAdapters({
      packageRoot,
      targetDir,
      harness: 'claude-code',
      write: true,
    })

    expect(new Set(result.entries.map((entry) => entry.qualifiedName))).toEqual(
      new Set([
        'agentflow:orchestrator',
        'agentflow:collaborator',
        'agentflow:scanner',
        'agentflow:designer',
        'agentflow:migrator',
        'agentflow:auditor',
      ]),
    )
    const orchestrator = readFileSync(
      join(targetDir, '.claude/skills/agentflow-orchestrator/SKILL.md'),
      'utf8',
    )
    expect(orchestrator.startsWith('---\n')).toBe(true)
    expect(orchestrator).toContain('name: agentflow-orchestrator')
    expect(orchestrator).toMatch(/qualified-name:\s*['"]agentflow:orchestrator['"]/)
    expect(
      readFileSync(
        join(targetDir, '.claude/skills/agentflow-collaborator/references/collaboration-modes.md'),
        'utf8',
      ),
    ).toContain('smallest sufficient mode')
    expect(adapterStatus({ packageRoot, targetDir, harness: 'claude-code' }).stale).toEqual([])
  })

  it('keeps every harness manifest aligned to the canonical catalog', () => {
    expect(validatePluginManifests({ packageRoot, harness: 'all' })).toMatchObject({
      ok: true,
      findings: [],
    })
  })
})
