import { spawnSync } from 'node:child_process'
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, delimiter } from 'node:path'
import { resolveExecutable } from '../../lib/environment.mjs'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

const roots = []
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'preflight-cli-'))
  roots.push(root)
  const home = join(root, 'home'),
    project = join(root, 'project'),
    bin = join(root, 'bin'),
    log = join(root, 'calls.jsonl')
  for (const path of [home, project, bin]) mkdirSync(path)
  const nodePath = join(bin, process.platform === 'win32' ? 'node.exe' : 'node')
  try {
    symlinkSync(process.execPath, nodePath)
  } catch {
    copyFileSync(process.execPath, nodePath)
  }
  const git = resolveExecutable('git')
  if (!git) throw new Error('Fixture requires native Git')
  writeFileSync(join(bin, 'package.json'), '{"type":"commonjs"}')
  writeFileSync(
    join(bin, 'rig'),
    `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');const rig=a[a.indexOf('--rig')+1];if(process.env.FIXTURE_BAD){console.log('PRIVATE_FIXTURE_RAW_ERROR');process.exit(2)}console.log(JSON.stringify({entries:[{rigName:rig,logicalId:'dev.build',runtime:'pi',model:'PRIVATE_FIXTURE_RAW_MODEL',startupStatus:'READY',resumeToken:'PRIVATE_FIXTURE_TOKEN'}],totalNodes:1,truncated:false}));\n`,
    { mode: 0o755 },
  )
  if (process.platform === 'win32')
    writeFileSync(join(bin, 'rig.cmd'), '@echo PRIVATE_FIXTURE_SHIM_MUST_NOT_RUN\r\n')
  return { root, home, project, bin, log, git }
}
function run(f, operation, { live = false, bad = false } = {}) {
  return spawnSync(
    process.execPath,
    [
      resolve('bin/cli.mjs'),
      'adapters',
      'squads',
      operation,
      'openrig',
      '--kind',
      'all',
      '--preset',
      'all-codex',
      '--home',
      f.home,
      ...(operation === 'preflight' ? ['--json'] : []),
      'fixture',
      f.project,
    ],
    {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        PATH: [f.bin, dirname(f.git)].join(delimiter),
        ...(process.platform === 'win32'
          ? { SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT }
          : {}),
        HOME: live ? f.home : join(f.root, 'user'),
        USERPROFILE: live ? f.home : join(f.root, 'user'),
        GIT_CEILING_DIRECTORIES: tmpdir(),
        ...(bad ? { FIXTURE_BAD: '1' } : {}),
      },
    },
  )
}
function tree(path) {
  return Object.fromEntries(
    readdirSync(path)
      .sort()
      .map((name) => {
        const p = join(path, name)
        return [name, statSync(p).isDirectory() ? tree(p) : readFileSync(p).toString('base64')]
      }),
  )
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
describe('public operational preflight CLI (#518)', () => {
  it('uses bounded read-only ps, returns hold exit3 and excludes raw observations', () => {
    const f = setup()
    expect(run(f, 'provision').status).toBe(0)
    const beforeHome = tree(f.home),
      beforeProject = tree(f.project)
    const result = run(f, 'preflight', { live: true })
    expect(result.status, result.stdout + result.stderr).toBe(3)
    const report = JSON.parse(result.stdout)
    expect(report).toMatchObject({ admitted: false, effects: [] })
    expect(report.reports).toHaveLength(3)
    expect(
      report.reports.every(
        (item) =>
          item.collection === (process.platform === 'win32' ? 'unavailable' : 'inventory-only'),
      ),
    ).toBe(true)
    for (const item of report.reports)
      for (const seat of item.seats) {
        expect(seat.observed).toBe(false)
        expect(seat.usable).toBe(false)
      }
    expect(result.stdout + result.stderr).not.toContain('PRIVATE_FIXTURE')
    const calls = existsSync(f.log)
      ? readFileSync(f.log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : []
    expect(calls).toHaveLength(process.platform === 'win32' ? 0 : 3)
    for (const args of calls) {
      expect(args.slice(0, 3)).toEqual(['ps', '--nodes', '--rig'])
      expect(args).toEqual(
        expect.arrayContaining(['--no-cleanup', '--json', '--limit', '200', '--fields']),
      )
      expect(args).not.toContain('--full')
      expect(args[args.indexOf('--fields') + 1]).not.toMatch(/resume|token|Command|model/)
    }
    expect(tree(f.home)).toEqual(beforeHome)
    expect(tree(f.project)).toEqual(beforeProject)
  })
  it('reports installed drift without repairing it', () => {
    const f = setup()
    expect(run(f, 'provision').status).toBe(0)
    const path = join(f.home, '.openrig/specs/agentflow-fixture-dev/rig.yaml')
    const rig = parse(readFileSync(path, 'utf8'))
    rig.pods[0].members[0].model = 'different-model'
    writeFileSync(path, stringify(rig))
    const before = tree(f.home)
    const result = run(f, 'preflight')
    expect(result.status).toBe(3)
    expect(
      JSON.parse(result.stdout)
        .reports.find((item) => item.kind === 'delivery')
        .seats.find((item) => item.seat === 'orch.arch').configured,
    ).toBe(false)
    expect(tree(f.home)).toEqual(before)
    expect(existsSync(f.log)).toBe(false)
  })
  it('holds failed collection and never echoes subprocess output', () => {
    const f = setup()
    const result = run(f, 'preflight', { live: true, bad: true })
    expect(result.status).toBe(3)
    expect(
      JSON.parse(result.stdout).reports.every((item) => item.collection === 'unavailable'),
    ).toBe(true)
    expect(result.stdout + result.stderr).not.toContain('PRIVATE_FIXTURE')
  })
})
