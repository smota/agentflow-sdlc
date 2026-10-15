import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const roots = []
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-preview-'))
  roots.push(dir)
  const guard = join(dir, 'no-child-process.mjs'),
    marker = join(dir, 'unexpected-child')
  writeFileSync(
    guard,
    `import cp from 'node:child_process';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';cp.spawnSync=(...args)=>{fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify(args));throw Error('Preview must not launch children')};syncBuiltinESMExports();`,
  )
  const home = join(dir, 'home'),
    project = join(dir, 'project')
  mkdirSync(home)
  mkdirSync(project)
  const installed = `name: preserved-id\npods:\n  - id: dev\n    members:\n      - id: build\n        runtime: pi\n        model: munito/qwen/installed-only\n        effort: low\n        profile: actual-pi-profile\n`
  function spec(id) {
    const path = join(home, '.openrig/specs', id, 'rig.yaml')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, installed)
    return path
  }
  function snapshot(path) {
    return readdirSync(path, { withFileTypes: true }).flatMap((item) =>
      item.isDirectory()
        ? snapshot(join(path, item.name))
        : [[join(path, item.name), readFileSync(join(path, item.name), 'utf8')]],
    )
  }
  function run(args = []) {
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'bin/cli.mjs'),
        'adapters',
        'squads',
        'mutation-plan',
        'openrig',
        'sample',
        project,
        '--home',
        home,
        '--json',
        ...args,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          AGENTFLOW_NO_OPENRIG: '1',
          NODE_OPTIONS: `--import=${JSON.stringify(pathToFileURL(guard).href)}`,
        },
        encoding: 'utf8',
        timeout: 15000,
      },
    )
    expect(existsSync(marker), 'Preview attempted a child process').toBe(false)
    return result
  }
  return { home, project, installed, spec, run, snapshot }
}
describe('public read-only rig mutation preview (#523)', () => {
  it('reads installed bytes and literal tuple fields, preserves a supplied stable ID, and holds without source or executor authority', () => {
    const f = fixture()
    const path = f.spec('existing-production-id')
    const before = f.snapshot(f.home)
    const result = f.run(['--kind', 'delivery', '--rig', 'existing-production-id'])
    expect(result.status, result.stderr + result.stdout).toBe(0)
    const report = JSON.parse(result.stdout),
      item = report.plans[0],
      plan = item.plan
    expect(report).toMatchObject({ operation: 'mutation-plan', status: 'held', effects: [] })
    expect(item).toMatchObject({
      kind: 'delivery',
      rigName: 'existing-production-id',
      status: 'held',
    })
    expect(plan.rigName).toBe('existing-production-id')
    expect(plan.beforeRigText).toBe(readFileSync(path, 'utf8'))
    expect(plan.sourceRevision).toBe(createHash('sha256').update(f.installed).digest('hex'))
    expect(plan.beforeContracts).toContainEqual(
      expect.objectContaining({
        seat: 'dev.build',
        runtime: 'pi',
        model: 'qwen/installed-only',
        providerRoute: 'munito',
        profile: 'actual-pi-profile',
        effort: 'low',
      }),
    )
    expect(plan.beforeContracts.find((c) => c.seat === 'dev.build').executionTarget).toBeNull()
    expect(plan.workflowAnchor).toBeNull()
    expect(plan.executorIdentity).toBeNull()
    expect(plan.effects).toEqual([])
    expect(plan.admissionHolds.map((h) => h.code)).toEqual(
      expect.arrayContaining(['WORKFLOW_SOURCE_UNAVAILABLE', 'EXECUTOR_OBSERVATION_UNSUPPORTED']),
    )
    expect(parse(plan.afterRigText).name).toBe('existing-production-id')
    expect(f.snapshot(f.home)).toEqual(before)
  })
  it('previews the existing default three IDs without creating or repairing any spec', () => {
    const f = fixture()
    for (const id of ['agentflow-sample-dev', 'agentflow-sample-pm', 'agentflow-sample-steer'])
      f.spec(id)
    const before = f.snapshot(f.home),
      result = f.run(['--kind', 'all'])
    expect(result.status, result.stderr + result.stdout).toBe(0)
    expect(JSON.parse(result.stdout).plans.map((p) => p.rigName)).toEqual([
      'agentflow-sample-dev',
      'agentflow-sample-pm',
      'agentflow-sample-steer',
    ])
    expect(f.snapshot(f.home)).toEqual(before)
  })
  it('rejects ambiguous all-kind custom IDs and absent installed specs without writes', () => {
    const f = fixture(),
      before = f.snapshot(f.home)
    expect(f.run(['--kind', 'all', '--rig', 'other']).status).not.toBe(0)
    const missing = f.run(['--kind', 'delivery', '--rig', 'missing'])
    expect(missing.status).not.toBe(0)
    expect(missing.stderr + missing.stdout).toMatch(
      /installed.*(?:missing|not found|does not exist)/i,
    )
    expect(f.snapshot(f.home)).toEqual(before)
  })
})
