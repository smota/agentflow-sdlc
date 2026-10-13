import { afterEach, describe, expect, it } from 'vitest'
import { resolve, join } from 'node:path'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { loadSkillCatalog, validateSkillCatalog } from '../skill-catalog.mjs'
import { resolveCompositionProfile } from '../adoption/profiles.mjs'
import prettier from 'prettier'

const steeringFiles = [
  'skills/agentflow-steerer/references/envelope.md',
  'skills/agentflow-steerer/references/heartbeat.md',
  'skills/agentflow-steerer/assets/steer-state.yaml',
]

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

    expect(qualifiedNames).toHaveLength(7)
    expect(qualifiedNames.every((name) => name.startsWith('agentflow-'))).toBe(true)
    expect(new Set(qualifiedNames).size).toBe(qualifiedNames.length)
    expect(new Set(ownedAreas).size).toBe(ownedAreas.length)
  })

  it('registers the optional steerer with distinct advisory ownership', () => {
    const catalog = loadSkillCatalog(packageRoot)
    const steerer = catalog.skills.find((skill) => skill.role === 'steerer')
    expect(steerer).toMatchObject({
      qualifiedName: 'agentflow-steerer',
      source: 'skills/agentflow-steerer',
      owns: [
        'steering.job-framing',
        'steering.capability-grooming',
        'steering.dependency-reasoning',
        'steering.tradeoff-rationale',
      ],
    })
    const peerOwnership = catalog.skills
      .filter((skill) => skill.role !== 'steerer')
      .flatMap((skill) => skill.owns)
    expect(steerer.owns.some((area) => peerOwnership.includes(area))).toBe(false)
  })

  it.each(['standard', 'github', 'cockpit'])(
    'registers every steering support byte in %s and the packed payload',
    (profile) => {
      const selected = resolveCompositionProfile(profile).managedFiles
      const payload = JSON.parse(readFileSync(join(packageRoot, 'manifests/product-payload.json')))
      const required = JSON.parse(readFileSync(join(packageRoot, 'manifests/npm-package.json')))
      for (const path of steeringFiles) {
        expect(selected).toContain(path)
        expect(payload.entries).toContainEqual({ source: path, target: path, ownership: 'managed' })
        expect(required.requiredFiles).toContain(path)
        expect(required.requiredFiles).toContain(`adapters/claude-code/${path}`)
        expect(readFileSync(join(packageRoot, path)).length).toBeGreaterThan(0)
      }
      expect(selected).toContain('docs/sources/product-discipline.md')
    },
  )

  it('resolves all local steering disclosure pointers against actual support files', () => {
    const directory = join(packageRoot, 'skills/agentflow-steerer')
    for (const path of ['SKILL.md', 'references/envelope.md', 'references/heartbeat.md']) {
      const text = readFileSync(join(directory, path), 'utf8')
      for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        expect(readFileSync(resolve(directory, path, '..', match[1])).length).toBeGreaterThan(0)
      }
    }
  })

  it('parses the actual inert template and rejects missing required customer keys', () => {
    const state = JSON.parse(readFileSync(join(packageRoot, steeringFiles[2]), 'utf8'))
    const customerKeys = [
      'phase',
      'envelope_hash',
      'approved_by',
      'items',
      'seats',
      'open_escalations',
      'next_tick_hint',
    ]
    const assertTemplateShape = (value) => {
      for (const key of customerKeys) {
        if (!Object.hasOwn(value, key)) throw new Error(`Missing state field: ${key}`)
      }
    }
    assertTemplateShape(state)
    expect(Object.keys(state).sort()).toEqual(
      [...customerKeys, 'version', 'tick', 'recovery', 'archive_refs'].sort(),
    )
    expect(state.version).toBe(1)
    expect(state.phase).toEqual({ value: null, source: null, revision: null })
    expect(state.envelope_hash).toBeNull()
    expect(state.approved_by).toEqual({
      principal: null,
      source: null,
      revision: null,
      confirmation_ref: null,
      gate_digest: null,
      goal_subject_digest: null,
    })
    for (const key of ['items', 'seats', 'open_escalations', 'recovery']) {
      expect(state[key]).toEqual({ source: null, revision: null, entries: [] })
    }
    expect(state.next_tick_hint).toBeNull()
    expect(state.tick).toEqual({
      id: null,
      status: 'inert',
      actions_used: 0,
      journal_lines_used: 0,
      state_generation: 0,
      journal_generation: 0,
      intent_refs: [],
      receipt_refs: [],
    })
    expect(state.archive_refs).toEqual([])
    for (const key of customerKeys) {
      const missing = { ...state }
      delete missing[key]
      expect(() => assertTemplateShape(missing)).toThrow(`Missing state field: ${key}`)
    }
  })

  it('formats only the two state assets as JSON and preserves parseable actual bytes', async () => {
    const paths = [steeringFiles[2], `adapters/claude-code/${steeringFiles[2]}`]
    const { default: config } = await import('../../prettier.config.js')
    expect(config.overrides).toEqual([{ files: paths, options: { parser: 'json' } }])
    for (const path of paths) {
      const filepath = join(packageRoot, path)
      const configuration = await prettier.resolveConfig(filepath)
      expect(configuration.parser).toBe('json')
      const source = readFileSync(filepath, 'utf8')
      const formatted = await prettier.format(source, { ...configuration, filepath })
      expect(JSON.parse(formatted)).toEqual(JSON.parse(source))
      expect(await prettier.check(source, { ...configuration, filepath })).toBe(true)
    }
    const unrelated = await prettier.resolveConfig(join(packageRoot, 'defaults/yaml-probe.yaml'))
    expect(unrelated.parser).toBeUndefined()
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
      'skills/agentflow-steerer/SKILL.md',
    ]

    expect(standard).toEqual(expect.arrayContaining(canonical))
    expect(standard).toContain('docs/sources/product-discipline.md')
    expect(standard.some((path) => path.startsWith('skills/sdlc-'))).toBe(false)
    expect(standard.some((path) => path.startsWith('agents/workflows/'))).toBe(false)
  })
})
