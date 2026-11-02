import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const adapterRoot = join(import.meta.dirname, '..')

function filesUnder(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...filesUnder(path))
    else found.push(path)
  }
  return found
}

function posixRelative(file) {
  return relative(adapterRoot, file).split(sep).join('/')
}

const vendoredOpenRigSkills = [
  'openrig-user',
  'messaging-the-human',
  'openrig-skills',
  'agent-operated-software',
  'agent-operated-workflows',
  'applying-a-permission-policy',
  'claude-compaction-restore',
  'delegating-work',
  'forming-an-openrig-mental-model',
  'loading-addressable-markdown',
  'mission-slice-sop',
  'openrig-operating-model',
  'orienting-to-an-inherited-seat',
  'queue-handoff',
  'refocusing',
  'retiring-and-inheriting-a-seat',
  'seat-continuity-and-handover',
  'session-compaction-and-restore',
  'software-for-agents',
]

describe('OpenRig skill loadout (#556)', () => {
  it('does not vendor OpenRig core skills', () => {
    const rels = filesUnder(adapterRoot).map(posixRelative)
    for (const name of vendoredOpenRigSkills) {
      expect(
        rels.filter((file) => file.endsWith(`skills/${name}/SKILL.md`)),
        name,
      ).toEqual([])
    }
  })

  it('ships agentflow-orchestrator and writing-for-agents', () => {
    const rels = filesUnder(adapterRoot).map(posixRelative)
    expect(rels.some((file) => file.endsWith('skills/agentflow-orchestrator/SKILL.md'))).toBe(true)
    expect(rels.some((file) => file.endsWith('skills/writing-for-agents/SKILL.md'))).toBe(true)
  })

  it('does not point agent.yaml at vendored OpenRig skill paths', () => {
    const yamls = filesUnder(adapterRoot).filter((file) => file.endsWith(`${sep}agent.yaml`))
    expect(yamls.length).toBeGreaterThan(0)
    for (const file of yamls) {
      const text = readFileSync(file, 'utf8')
      for (const name of vendoredOpenRigSkills) {
        expect(text.includes(`skills/${name}`), `${posixRelative(file)} ${name}`).toBe(false)
      }
    }
  })

  it('tells delivery, steer, and eval seats to use the managed loadout', () => {
    const guidance = [
      'agentflow/README.md',
      'agentflow-steer/agents/agentflow-steer/guidance/lead.md',
      'agentflow-eval/agents/agentflow-eval/guidance/role.md',
    ]
    for (const file of guidance) {
      const text = readFileSync(join(adapterRoot, file), 'utf8')
      expect(text.includes('rig skill loadout --seat'), file).toBe(true)
      expect(text.includes('rig context get'), file).toBe(true)
    }
  })
})
