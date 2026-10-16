import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  loadAuthoritativeConfigs,
  validateConfigAuthority,
} from '../../../lib/config/authority.mjs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  roots = []
afterEach(() => roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })))
function fixture(activation) {
  const base = mkdtempSync(join(tmpdir(), 'activation-guard-'))
  roots.push(base)
  const home = join(base, 'home'),
    project = join(base, 'project')
  mkdirSync(home)
  mkdirSync(project)
  if (activation !== undefined)
    writeFileSync(
      join(project, 'agent-workflow.config.json'),
      JSON.stringify({
        adapters: { openrig: { executionPolicy: { activation, preset: 'all-codex' } } },
      }),
    )
  const write = (path, text) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  const snapshot = (path) =>
    readdirSync(path, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? snapshot(join(path, e.name))
        : [
            [
              join(path, e.name),
              createHash('sha256')
                .update(readFileSync(join(path, e.name)))
                .digest('hex'),
            ],
          ],
    )
  const cli = (verb, options = []) =>
    spawnSync(
      process.execPath,
      [
        join(root, 'bin/cli.mjs'),
        'adapters',
        'squads',
        verb,
        'openrig',
        ...options,
        'sample',
        project,
        '--home',
        home,
      ],
      {
        cwd: root,
        env: { ...process.env, AGENTFLOW_NO_OPENRIG: '1' },
        encoding: 'utf8',
        timeout: 15000,
      },
    )
  return { home, project, write, snapshot, cli }
}
describe('source activation and existing-spec admission (#523/#526)', () => {
  for (const kind of ['delivery', 'all'])
    it(`holds ${kind} provision before any base, bridge, home or project write`, () => {
      const f = fixture('held'),
        beforeHome = f.snapshot(f.home),
        beforeProject = f.snapshot(f.project)
      const r = f.cli('provision', ['--kind', kind])
      expect(r.status).not.toBe(0)
      expect(r.stderr + r.stdout).toMatch(/activation.*held/i)
      expect(f.snapshot(f.home)).toEqual(beforeHome)
      expect(f.snapshot(f.project)).toEqual(beforeProject)
    })
  it('keeps held policy visible in desired-only planning and rejects invalid activation values', () => {
    const f = fixture('held'),
      r = f.cli('plan', ['--kind', 'all', '--json'])
    expect(r.status, r.stderr).toBe(0)
    const report = JSON.parse(r.stdout)
    expect(report.effects).toEqual([])
    expect(report.activation).toBe('held')
    expect(report.plans.every((p) => p.activation === 'held')).toBe(true)
    for (const activation of ['activate-anyway', null, false]) {
      const invalid = fixture(activation),
        bad = invalid.cli('provision', ['--kind', 'all'])
      expect(bad.status).not.toBe(0)
      expect(bad.stderr + bad.stdout).toMatch(/activation/i)
      expect(invalid.snapshot(invalid.home)).toEqual([])
      expect(
        validateConfigAuthority(loadAuthoritativeConfigs(invalid.project)).errors.join(' '),
      ).toMatch(/activation/)
    }
  })
  it('holds standalone existing-spec update and refuses provision overwrite even with active policy', () => {
    const f = fixture('active')
    f.write(join(f.home, '.openrig/specs/agentflow-sample/rig.yaml'), 'name: original\npods: []\n')
    f.write(join(f.home, '.openrig/state/pi/dev-build@agentflow-sample/marker'), 'retained-session')
    const before = f.snapshot(f.home)
    for (const verb of ['update', 'provision']) {
      const r = f.cli(verb, ['--kind', 'delivery'])
      expect(r.status).not.toBe(0)
      expect(r.stderr + r.stdout).toMatch(/source.bound|already exists/i)
      expect(f.snapshot(f.home)).toEqual(before)
    }
  })
  it('does not overwrite or roll back pre-existing all-kind specs and Pi bridges when a later target is blocked', () => {
    const f = fixture('active')
    for (const kind of ['pm', 'dev']) {
      f.write(
        join(f.home, `.openrig/specs/agentflow-sample-${kind}/rig.yaml`),
        `name: original-${kind}\n`,
      )
      f.write(
        join(f.home, `.openrig/state/pi/seat@agentflow-sample-${kind}/marker`),
        `retained-${kind}`,
      )
    }
    f.write(join(f.home, '.openrig/specs/agentflow-sample-steer'), 'blocked-target')
    const before = f.snapshot(f.home),
      r = f.cli('provision', ['--kind', 'all'])
    expect(r.status).not.toBe(0)
    expect(r.stderr + r.stdout).toMatch(/already exists/i)
    expect(f.snapshot(f.home)).toEqual(before)
  })
})

it('preserves orphan Pi bridges and steering state when no installed squad spec exists', () => {
  for (const kind of ['delivery', 'all'])
    for (const state of ['pi', 'steer']) {
      const f = fixture('active'),
        rig = kind === 'all' ? 'agentflow-sample-pm' : 'agentflow-sample'
      const path =
        state === 'pi' ? `.openrig/state/pi/seat@${rig}/marker` : `.openrig/steer/${rig}/marker`
      f.write(join(f.home, path), 'prior-partial-session-and-history')
      const before = f.snapshot(f.home),
        r = f.cli('provision', ['--kind', kind])
      expect(r.status).not.toBe(0)
      expect(r.stderr + r.stdout).toMatch(/existing.*state|source.bound.*recovery/i)
      expect(f.snapshot(f.home)).toEqual(before)
    }
})
