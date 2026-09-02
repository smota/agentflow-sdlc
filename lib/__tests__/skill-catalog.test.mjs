import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { loadSkillCatalog, validateSkillCatalog } from '../skill-catalog.mjs'
import { resolveCompositionProfile } from '../adoption/profiles.mjs'

const packageRoot = resolve(import.meta.dirname, '..', '..')

describe('AgentFlow skill catalog', () => {
  it('defines one namespaced identity for every non-overlapping role', () => {
    const catalog = loadSkillCatalog(packageRoot)
    const qualifiedNames = catalog.skills.map((skill) => skill.qualifiedName)
    const ownedAreas = catalog.skills.flatMap((skill) => skill.owns)

    expect(qualifiedNames).toHaveLength(6)
    expect(qualifiedNames.every((name) => name.startsWith('agentflow:'))).toBe(true)
    expect(new Set(qualifiedNames).size).toBe(qualifiedNames.length)
    expect(new Set(ownedAreas).size).toBe(ownedAreas.length)
  })

  it('makes every role recognize all peers and uses resolvable handoffs', () => {
    const catalog = loadSkillCatalog(packageRoot)
    const roles = new Set(catalog.skills.map((skill) => skill.role))

    for (const skill of catalog.skills) {
      expect(new Set(skill.recognizes)).toEqual(
        new Set([...roles].filter((role) => role !== skill.role)),
      )
    }
    for (const handoff of catalog.handoffs) {
      expect(roles.has(handoff.from)).toBe(true)
      expect(roles.has(handoff.to)).toBe(true)
      expect(handoff.artifact).toBeTruthy()
    }
  })

  it('validates the canonical skill structure and style', () => {
    expect(validateSkillCatalog({ packageRoot })).toMatchObject({ ok: true, findings: [] })
  })

  it('installs only the namespaced skill family', () => {
    const standard = resolveCompositionProfile('standard').managedFiles
    const canonical = [
      'skills/orchestrator/SKILL.md',
      'skills/collaborator/SKILL.md',
      'skills/scanner/SKILL.md',
      'skills/designer/SKILL.md',
      'skills/migrator/SKILL.md',
      'skills/auditor/SKILL.md',
    ]

    expect(standard).toEqual(expect.arrayContaining(canonical))
    expect(standard.some((path) => path.startsWith('skills/sdlc-'))).toBe(false)
    expect(standard.some((path) => path.startsWith('agents/workflows/'))).toBe(false)
  })
})
