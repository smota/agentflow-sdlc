import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { BASES, squadProvision } from '../lifecycle.mjs'

const ADAPTER = resolve(import.meta.dirname, '..')

describe('project workspace adoption (#557)', () => {
  it('parses the seeded project and workspace catalogs', () => {
    const project = parse(readFileSync(join(ADAPTER, 'examples/project.yaml'), 'utf8'))
    const workspace = parse(readFileSync(join(ADAPTER, 'examples/workspace.yaml'), 'utf8'))

    expect(project.schema).toBe('openrig.project/v0alpha1')
    expect(project.kind).toBe('project')
    expect(typeof project.install.intent).toBe('string')
    expect(project.install.context.length).toBeGreaterThan(0)
    expect(project.install.skills).toEqual(['agentflow-orchestrator', 'agentflow-steerer'])

    expect(workspace.schema).toBe('openrig.workspace/v0alpha1')
    expect(workspace.projects).toHaveLength(2)
    expect(workspace.projects.some((entry) => entry.root === '.')).toBe(true)
    const claimed = workspace.projects.find((entry) => entry.rigs)
    expect(claimed.rigs).toEqual(['agentflow'])
  })

  it('keeps the delivery, product, and steer specs as separate files', () => {
    const specs = ['agentflow', 'agentflow-product', 'agentflow-steer']
    const names = specs.map((spec) => {
      const path = join(ADAPTER, spec, 'rig.yaml')
      expect(existsSync(path)).toBe(true)
      return parse(readFileSync(path, 'utf8')).name
    })
    expect(new Set(names).size).toBe(specs.length)
    expect(names).toEqual(specs)
  })

  it('names the same squad kinds in the manifest and lifecycle BASES', () => {
    const manifest = JSON.parse(readFileSync(join(ADAPTER, 'manifest.json'), 'utf8'))
    const provision = manifest.commands.find((command) =>
      command.startsWith('agentflow-sdlc adapters squads provision '),
    )
    const kinds = provision
      .match(/--kind ([a-z|]+)/)[1]
      .split('|')
      .filter((kind) => kind !== 'all')
    expect(kinds.sort()).toEqual(Object.keys(BASES).sort())
    expect(manifest.rigs.slice().sort()).toEqual(Object.values(BASES).sort())
  })

  it('provisions --kind eval from the existing agentflow-eval base', () => {
    const home = mkdtempSync(join(tmpdir(), 'agentflow-eval-home-'))
    const project = mkdtempSync(join(tmpdir(), 'agentflow-eval-project-'))
    try {
      const logs = []
      const code = squadProvision({
        adapterDir: ADAPTER,
        home,
        options: { kind: 'eval', eval: 'agentflow-check' },
        operands: ['dogfood', project],
        cwd: project,
        env: process.env,
        out: (line) => logs.push(line),
      })
      expect(code).toBe(0)
      expect(logs.join('\n')).toContain('agentflow-dogfood')
      const squad = readFileSync(join(home, '.openrig/specs/agentflow-dogfood/rig.yaml'), 'utf8')
      expect(squad).toContain('name: agentflow-dogfood')
      expect(squad).toContain('profile: eval-tester')
      const note = readFileSync(join(home, '.openrig/specs/agentflow-dogfood/sibling.md'), 'utf8')
      expect(note).toContain('Evaluation rig: `agentflow-check`.')
      expect(existsSync(join(home, '.openrig/specs/agentflow-eval/rig.yaml'))).toBe(true)
      expect(existsSync(join(ADAPTER, 'agentflow/rig.yaml'))).toBe(true)
      expect(existsSync(join(ADAPTER, 'agentflow-product/rig.yaml'))).toBe(true)
      expect(existsSync(join(ADAPTER, 'agentflow-steer/rig.yaml'))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
  })
})
