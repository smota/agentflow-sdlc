import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { adapterStatus, syncSkillAdapters, HARNESS_TARGETS } from '../skill-adapters.mjs'
import { loadSkillCatalog } from '../skill-catalog.mjs'
import { validatePluginManifests } from '../plugin-manifests.mjs'

const packageRoot = resolve(import.meta.dirname, '..', '..')
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('productized AgentFlow skill adapters', () => {
  it.each(Object.keys(HARNESS_TARGETS))(
    'preserves all six source identities and renders discoverable %s names',
    (harness) => {
      const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-identities-'))
      roots.push(targetDir)
      const catalog = loadSkillCatalog(packageRoot)
      expect(catalog.skills).toHaveLength(6)
      syncSkillAdapters({ packageRoot, targetDir, harness, write: true })
      for (const skill of catalog.skills) {
        const source = readFileSync(join(packageRoot, skill.source, 'SKILL.md'), 'utf8')
        expect(source).toMatch(new RegExp(`^name: ${skill.qualifiedName}$`, 'm'))
        const adapter = readFileSync(
          join(targetDir, HARNESS_TARGETS[harness], `agentflow-${skill.role}`, 'SKILL.md'),
          'utf8',
        )
        expect(adapter).toMatch(new RegExp(`^name: agentflow-${skill.role}$`, 'm'))
        expect(adapter).toContain(skill.qualifiedName)
      }
      expect(adapterStatus({ packageRoot, targetDir, harness }).stale).toEqual([])
    },
  )
  it('projects all six skills and progressive-disclosure references', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-skills-'))
    roots.push(targetDir)
    const result = syncSkillAdapters({
      packageRoot,
      targetDir,
      harness: 'claude-code',
      write: true,
    })

    expect(new Set(result.entries.map((entry) => entry.qualifiedName))).toEqual(
      new Set([
        'agentflow-orchestrator',
        'agentflow-collaborator',
        'agentflow-scanner',
        'agentflow-designer',
        'agentflow-migrator',
        'agentflow-auditor',
      ]),
    )
    const orchestrator = readFileSync(
      join(targetDir, '.claude/skills/agentflow-orchestrator/SKILL.md'),
      'utf8',
    )
    expect(orchestrator.startsWith('---\n')).toBe(true)
    expect(orchestrator).toContain('name: agentflow-orchestrator')
    expect(orchestrator).toMatch(/qualified-name:\s*['"]agentflow-orchestrator['"]/)
    expect(
      readFileSync(
        join(targetDir, '.claude/skills/agentflow-collaborator/references/collaboration-modes.md'),
        'utf8',
      ),
    ).toContain('smallest sufficient mode')
    const skillCmd = join(targetDir, '.claude/commands/agentflow-orchestrator.md')
    expect(readFileSync(skillCmd, 'utf8')).toContain('Skill: agentflow-orchestrator')
    expect(adapterStatus({ packageRoot, targetDir, harness: 'claude-code' }).stale).toEqual([])
  })

  it('keeps every harness manifest aligned to the canonical catalog', () => {
    expect(validatePluginManifests({ packageRoot, harness: 'all' })).toMatchObject({
      ok: true,
      findings: [],
    })
    for (const skill of loadSkillCatalog(packageRoot).skills) {
      expect(
        readFileSync(join(packageRoot, 'adapters/claude-code', skill.source, 'SKILL.md'), 'utf8'),
      ).toBe(readFileSync(join(packageRoot, skill.source, 'SKILL.md'), 'utf8'))
    }
  })
})
