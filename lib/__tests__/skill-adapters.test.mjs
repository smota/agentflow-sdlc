import { afterEach, describe, expect, it } from 'vitest'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { adapterStatus, syncSkillAdapters, HARNESS_TARGETS } from '../skill-adapters.mjs'
import { loadSkillCatalog } from '../skill-catalog.mjs'
import { validatePluginManifests } from '../plugin-manifests.mjs'

const packageRoot = resolve(import.meta.dirname, '..', '..')
const steeringSupport = [
  'references/envelope.md',
  'references/heartbeat.md',
  'assets/steer-state.yaml',
]
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('productized AgentFlow skill adapters', () => {
  it.each(Object.keys(HARNESS_TARGETS))(
    'preserves all canonical source identities and renders discoverable %s names',
    (harness) => {
      const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-identities-'))
      roots.push(targetDir)
      const catalog = loadSkillCatalog(packageRoot)
      expect(catalog.skills).toHaveLength(8)
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
  it('projects all canonical skills and progressive-disclosure references', () => {
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
        'agentflow-steerer',
        'agentflow-maintainer',
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

  it.each(Object.keys(HARNESS_TARGETS))(
    'copies complete steering support bytes and detects missing/stale %s support',
    (harness) => {
      const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-steering-support-'))
      roots.push(targetDir)
      syncSkillAdapters({ packageRoot, targetDir, harness, write: true })
      for (const path of steeringSupport) {
        const source = `skills/agentflow-steerer/${path}`
        const target = join(targetDir, HARNESS_TARGETS[harness], 'agentflow-steerer', path)
        const bytes = readFileSync(join(packageRoot, source))
        expect(readFileSync(target)).toEqual(bytes)
        writeFileSync(target, Buffer.concat([bytes, Buffer.from('\nStale consumer support.\n')]))
        expect(adapterStatus({ packageRoot, targetDir, harness }).stale).toEqual([
          expect.objectContaining({ source, target, harness, status: 'planned' }),
        ])
        syncSkillAdapters({ packageRoot, targetDir, harness, write: true })
        expect(readFileSync(target)).toEqual(bytes)
        rmSync(target)
        expect(adapterStatus({ packageRoot, targetDir, harness }).stale).toEqual([
          expect.objectContaining({ source, target, harness, status: 'planned' }),
        ])
        syncSkillAdapters({ packageRoot, targetDir, harness, write: true })
        expect(readFileSync(target)).toEqual(bytes)
      }
      expect(adapterStatus({ packageRoot, targetDir, harness }).stale).toEqual([])
    },
  )

  it('aligns native Claude plugin discovery with canonical distributed skill bytes', () => {
    const pluginRoot = join(packageRoot, 'adapters/claude-code')
    const plugin = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin/plugin.json'), 'utf8'))
    const catalog = loadSkillCatalog(packageRoot)
    expect(plugin.skills).toEqual(catalog.skills.map((skill) => `./${skill.source}`))
    for (const path of steeringSupport) {
      expect(readFileSync(join(pluginRoot, 'skills/agentflow-steerer', path))).toEqual(
        readFileSync(join(packageRoot, 'skills/agentflow-steerer', path)),
      )
    }
    for (const [index, directory] of plugin.skills.entries()) {
      expect(readFileSync(resolve(pluginRoot, directory, 'SKILL.md'))).toEqual(
        readFileSync(join(packageRoot, catalog.skills[index].source, 'SKILL.md')),
      )
    }
  })

  it('treats chained canonical skill links as current and never writes through them', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-linked-canonical-'))
    const middle = mkdtempSync(join(tmpdir(), 'agentflow-linked-middle-'))
    roots.push(targetDir, middle)
    const catalog = loadSkillCatalog(packageRoot)
    mkdirSync(join(targetDir, '.agents/skills'), { recursive: true })
    const before = new Map()
    for (const skill of catalog.skills) {
      const canonical = join(packageRoot, skill.source)
      before.set(skill.qualifiedName, readFileSync(join(canonical, 'SKILL.md')))
      const mid = join(middle, skill.qualifiedName)
      symlinkSync(canonical, mid, 'dir')
      symlinkSync(mid, join(targetDir, '.agents/skills', skill.qualifiedName), 'dir')
    }
    const status = adapterStatus({ packageRoot, targetDir, harness: 'agy' })
    expect(status.stale).toEqual([])
    expect(status.linkedCanonical.length).toBeGreaterThan(0)
    expect(status.linkedCanonical.every((entry) => entry.status === 'linked-canonical')).toBe(true)
    syncSkillAdapters({ packageRoot, targetDir, harness: 'agy', write: true })
    for (const skill of catalog.skills) {
      expect(readFileSync(join(packageRoot, skill.source, 'SKILL.md'))).toEqual(
        before.get(skill.qualifiedName),
      )
    }
  })

  it('reports noncanonical and broken skill links as stale and still refuses to write through them', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-linked-bad-'))
    const outside = mkdtempSync(join(tmpdir(), 'agentflow-linked-outside-'))
    roots.push(targetDir, outside)
    const skill = loadSkillCatalog(packageRoot).skills[0]
    const canonical = join(packageRoot, skill.source)
    const before = readFileSync(join(canonical, 'SKILL.md'))
    const copy = join(outside, 'copy')
    cpSync(canonical, copy, { recursive: true })
    writeFileSync(join(copy, 'SKILL.md'), 'not canonical\n')
    mkdirSync(join(targetDir, '.pi/skills'), { recursive: true })
    const linked = join(targetDir, '.pi/skills', skill.qualifiedName)
    symlinkSync(copy, linked, 'dir')
    const mismatch = adapterStatus({ packageRoot, targetDir, harness: 'pi' })
    expect(
      mismatch.stale.some(
        (entry) =>
          entry.status === 'linked-noncanonical' && entry.qualifiedName === skill.qualifiedName,
      ),
    ).toBe(true)
    expect(
      mismatch.linkedNonCanonical.some((entry) => entry.status === 'linked-noncanonical'),
    ).toBe(true)
    syncSkillAdapters({ packageRoot, targetDir, harness: 'pi', write: true })
    expect(readFileSync(join(copy, 'SKILL.md'), 'utf8')).toBe('not canonical\n')
    expect(readFileSync(join(canonical, 'SKILL.md'))).toEqual(before)

    rmSync(linked)
    symlinkSync(join(outside, 'missing-skill'), linked, 'dir')
    const broken = adapterStatus({ packageRoot, targetDir, harness: 'pi' })
    expect(
      broken.stale.some(
        (entry) => entry.status === 'linked-broken' && entry.qualifiedName === skill.qualifiedName,
      ),
    ).toBe(true)
    syncSkillAdapters({ packageRoot, targetDir, harness: 'pi', write: true })
    expect(readFileSync(join(canonical, 'SKILL.md'))).toEqual(before)
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
