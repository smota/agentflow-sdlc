import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { catalog } from '../lifecycle.mjs'

const ADAPTER = resolve(import.meta.dirname, '..')

function withRepo(run) {
  const repo = mkdtempSync(join(tmpdir(), 'agentflow-catalog-'))
  try {
    return run(repo)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

function runCatalog(repo, options = {}) {
  const lines = []
  const code = catalog({
    adapterDir: ADAPTER,
    cwd: repo,
    options,
    out: (line = '') => lines.push(String(line)),
  })
  return { code, stdout: lines.join('\n') }
}

describe('openrig catalog seed (#567)', () => {
  it('preview writes no files and prints both schemas', () => {
    withRepo((repo) => {
      const name = basename(repo)
      const { code, stdout } = runCatalog(repo)
      expect(code).toBe(0)
      expect(readdirSync(repo)).toEqual([])
      expect(stdout).toContain('openrig.project/v0alpha1')
      expect(stdout).toContain('openrig.workspace/v0alpha1')
      const workspace = parse(stdout.slice(stdout.indexOf('schema: openrig.workspace/v0alpha1')))
      expect(workspace.projects).toEqual([{ id: name, root: '.', rigs: [name] }])
    })
  })

  it('writes project.yaml from the example and a workspace entry with root "."', () => {
    withRepo((repo) => {
      const { code } = runCatalog(repo, { write: true, id: 'adopter', rig: 'agentflow' })
      expect(code).toBe(0)
      expect(readFileSync(join(repo, 'project.yaml'))).toEqual(
        readFileSync(join(ADAPTER, 'examples/project.yaml')),
      )
      const workspace = parse(readFileSync(join(repo, 'workspace.yaml'), 'utf8'))
      expect(workspace.schema).toBe('openrig.workspace/v0alpha1')
      expect(workspace.projects).toEqual([{ id: 'adopter', root: '.', rigs: ['agentflow'] }])
    })
  })

  it('leaves both files byte-identical on a second write of the same id', () => {
    withRepo((repo) => {
      expect(runCatalog(repo, { write: true, id: 'adopter', rig: 'agentflow' }).code).toBe(0)
      const projectPath = join(repo, 'project.yaml')
      const workspacePath = join(repo, 'workspace.yaml')
      const projectBytes = readFileSync(projectPath)
      const workspaceBytes = readFileSync(workspacePath)
      expect(runCatalog(repo, { write: true, id: 'adopter', rig: 'agentflow' }).code).toBe(0)
      expect(readFileSync(projectPath)).toEqual(projectBytes)
      expect(readFileSync(workspacePath)).toEqual(workspaceBytes)
    })
  })

  it('refuses a project.yaml with a different schema and writes nothing', () => {
    withRepo((repo) => {
      const projectPath = join(repo, 'project.yaml')
      const workspacePath = join(repo, 'workspace.yaml')
      const projectBody = 'schema: other.project/v1\nkind: project\n'
      const workspaceBody =
        'schema: openrig.workspace/v0alpha1\nprojects:\n  - id: other\n    root: .\n    rigs:\n      - other\n'
      writeFileSync(projectPath, projectBody)
      writeFileSync(workspacePath, workspaceBody)
      expect(() => runCatalog(repo, { write: true, id: 'adopter', rig: 'agentflow' })).toThrow(
        /openrig\.project\/v0alpha1/,
      )
      expect(readFileSync(projectPath, 'utf8')).toBe(projectBody)
      expect(readFileSync(workspacePath, 'utf8')).toBe(workspaceBody)
    })
  })

  it('does not create a missing project.yaml when the workspace already has the id', () => {
    withRepo((repo) => {
      const workspacePath = join(repo, 'workspace.yaml')
      const workspaceBody = [
        'schema: openrig.workspace/v0alpha1',
        'projects:',
        '  - id: kept',
        '    root: projects/kept',
        '    rigs:',
        '      - kept',
        '',
      ].join('\n')
      writeFileSync(workspacePath, workspaceBody)
      expect(runCatalog(repo, { write: true, id: 'kept', rig: 'kept' }).code).toBe(0)
      expect(existsSync(join(repo, 'project.yaml'))).toBe(false)
      expect(readFileSync(workspacePath, 'utf8')).toBe(workspaceBody)
    })
  })

  it('appends a rig to an existing project and keeps an existing rig a no-op (#586)', () => {
    withRepo((repo) => {
      expect(runCatalog(repo, { write: true, id: 'adopter', rig: 'agentflow-adopter' }).code).toBe(
        0,
      )
      const projectPath = join(repo, 'project.yaml')
      const workspacePath = join(repo, 'workspace.yaml')
      const projectBytes = readFileSync(projectPath)
      for (const rig of ['agentflow-adopter-d1', 'agentflow-adopter-d2']) {
        expect(runCatalog(repo, { write: true, id: 'adopter', rig }).code).toBe(0)
      }
      expect(parse(readFileSync(workspacePath, 'utf8')).projects).toEqual([
        {
          id: 'adopter',
          root: '.',
          rigs: ['agentflow-adopter', 'agentflow-adopter-d1', 'agentflow-adopter-d2'],
        },
      ])
      expect(readFileSync(projectPath)).toEqual(projectBytes)
      const workspaceBytes = readFileSync(workspacePath)
      expect(
        runCatalog(repo, { write: true, id: 'adopter', rig: 'agentflow-adopter-d1' }).code,
      ).toBe(0)
      expect(readFileSync(workspacePath)).toEqual(workspaceBytes)
    })
  })

  it('previews the appended rig without writing', () => {
    withRepo((repo) => {
      runCatalog(repo, { write: true, id: 'adopter', rig: 'agentflow-adopter' })
      const before = readFileSync(join(repo, 'workspace.yaml'))
      const { stdout } = runCatalog(repo, { id: 'adopter', rig: 'agentflow-adopter-d1' })
      const workspace = parse(stdout.slice(stdout.indexOf('schema: openrig.workspace/v0alpha1')))
      expect(workspace.projects[0].rigs).toEqual(['agentflow-adopter', 'agentflow-adopter-d1'])
      expect(readFileSync(join(repo, 'workspace.yaml'))).toEqual(before)
    })
  })

  it('refuses a rig already attached to another project and writes nothing (#586)', () => {
    withRepo((repo) => {
      const workspacePath = join(repo, 'workspace.yaml')
      const workspaceBody = [
        'schema: openrig.workspace/v0alpha1',
        'projects:',
        '  - id: other',
        '    root: projects/other',
        '    rigs:',
        '      - agentflow-shared',
        '',
      ].join('\n')
      writeFileSync(workspacePath, workspaceBody)
      for (const id of ['adopter', 'fresh']) {
        expect(() => runCatalog(repo, { write: true, id, rig: 'agentflow-shared' })).toThrow(
          /already attached to project 'other'/,
        )
      }
      expect(readFileSync(workspacePath, 'utf8')).toBe(workspaceBody)
      expect(existsSync(join(repo, 'project.yaml'))).toBe(false)
    })
  })
})
