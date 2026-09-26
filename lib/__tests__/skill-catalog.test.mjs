import { afterEach, describe, expect, it } from 'vitest'
import { resolve, join } from 'node:path'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { loadSkillCatalog, validateSkillCatalog } from '../skill-catalog.mjs'
import { resolveCompositionProfile } from '../adoption/profiles.mjs'

const packageRoot = resolve(import.meta.dirname, '..', '..')
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('AgentFlow skill catalog', () => {
  it.each(['scanner', 'agentflow:scanner'])('rejects the legacy skill name %s', (legacyName) => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-name-contract-'))
    roots.push(root)
    mkdirSync(join(root, 'manifests'))
    cpSync(
      join(packageRoot, 'manifests/skill-catalog.json'),
      join(root, 'manifests/skill-catalog.json'),
    )
    cpSync(join(packageRoot, 'skills'), join(root, 'skills'), { recursive: true })
    const skillPath = join(root, 'skills/agentflow-scanner/SKILL.md')
    writeFileSync(
      skillPath,
      readFileSync(skillPath, 'utf8').replace('name: agentflow-scanner', `name: ${legacyName}`),
    )
    const result = validateSkillCatalog({ packageRoot: root })
    expect(result.ok).toBe(false)
    expect(result.findings.some((finding) => finding.code === 'skill.name')).toBe(true)
  })
  it('defines one namespaced identity for every non-overlapping role', () => {
    const catalog = loadSkillCatalog(packageRoot)
    const qualifiedNames = catalog.skills.map((skill) => skill.qualifiedName)
    const ownedAreas = catalog.skills.flatMap((skill) => skill.owns)

    expect(qualifiedNames).toHaveLength(6)
    expect(qualifiedNames.every((name) => name.startsWith('agentflow-'))).toBe(true)
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
      'skills/agentflow-orchestrator/SKILL.md',
      'skills/agentflow-collaborator/SKILL.md',
      'skills/agentflow-scanner/SKILL.md',
      'skills/agentflow-designer/SKILL.md',
      'skills/agentflow-migrator/SKILL.md',
      'skills/agentflow-auditor/SKILL.md',
    ]

    expect(standard).toEqual(expect.arrayContaining(canonical))
    expect(standard.some((path) => path.startsWith('skills/sdlc-'))).toBe(false)
    expect(standard.some((path) => path.startsWith('agents/workflows/'))).toBe(false)
  })
})
