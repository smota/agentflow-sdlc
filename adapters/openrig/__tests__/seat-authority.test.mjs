import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const adapterRoot = join(import.meta.dirname, '..')

const requiredFacts = [
  'claude_permissions',
  'rig seat set-permissions',
  'never writes',
  'defaultMode',
  'acceptEdits',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'rig up --env',
  'rig seat set-typing-guard',
  'rig seat set-terminal-policy',
  'full-control',
  'Hosted members stay off',
]

function filesUnder(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...filesUnder(path))
    else found.push(path)
  }
  return found
}

function startupFileLists(yaml) {
  const lists = []
  const re = /^    startup:\r?\n      files:\r?\n([\s\S]*?)\r?\n      actions:/gm
  for (const match of yaml.matchAll(re)) lists.push(match[1])
  return lists
}

describe('seat authority (#558)', () => {
  it('states seat-authority facts in the delivery README and seat guidance', () => {
    const files = [
      join(adapterRoot, 'agentflow/README.md'),
      join(adapterRoot, 'agentflow/agents/agentflow/guidance/seat-authority.md'),
    ]
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const fact of requiredFacts) {
        expect(text.includes(fact), `${file} missing ${fact}`).toBe(true)
      }
    }
  })

  it.each(['\n', '\r\n'])(
    'loads guidance/seat-authority.md on every agentflow profile startup with %j line endings',
    (lineEnding) => {
      const yaml = readFileSync(
        join(adapterRoot, 'agentflow/agents/agentflow/agent.yaml'),
        'utf8',
      ).replace(/\r?\n/g, lineEnding)
      const lists = startupFileLists(yaml)
      expect(lists.length).toBeGreaterThan(0)
      expect(lists.length).toBe((yaml.match(/^    startup:/gm) ?? []).length)
      for (const list of lists) {
        expect(list.includes('guidance/seat-authority.md')).toBe(true)
      }
    },
  )

  it('keeps account homes out of rig.yaml', () => {
    const rigs = filesUnder(adapterRoot).filter((file) => file.endsWith(`${sep}rig.yaml`))
    expect(rigs.length).toBeGreaterThan(0)
    for (const file of rigs) {
      const text = readFileSync(file, 'utf8')
      expect(text.includes('CLAUDE_CONFIG_DIR:'), file).toBe(false)
      expect(text.includes('CODEX_HOME:'), file).toBe(false)
    }
  })
})
