// `node scripts/validate-team-roster.mjs` and `agentflow-sdlc roster validate|route` (#585). Real git
// runs in temp dirs; the overlay lives in a temp config home. No rig, no network.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { TEAM_ROSTER_OVERLAY_PATH, TEAM_ROSTER_PATH } from '../../lib/roster/team-roster.mjs'
import {
  addressFor,
  overlayFor,
  rosterProject,
  sampleRoster,
} from '../../lib/__tests__/fixtures/team-roster-fixtures.mjs'
import { main as rosterMain } from '../roster.mjs'
import {
  NO_ROSTER_MESSAGE,
  main as validateMain,
  overlayExposure,
} from '../validate-team-roster.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentflow-roster-cli-'))
  dirs.push(dir)
  return dir
}

function sink() {
  let text = ''
  return { write: (chunk) => (text += chunk), text: () => text }
}

async function roster(argv, fx, options = {}) {
  const stdout = sink()
  const stderr = sink()
  const code = await rosterMain(argv, { stdout, stderr, cwd: fx.dir, env: fx.env, ...options })
  return { code, stdout: stdout.text(), stderr: stderr.text() }
}

function validate(argv, fx) {
  const out = sink()
  const code = validateMain(argv, { stdout: out, cwd: fx.dir, env: fx.env })
  return { code, text: out.text() }
}

describe('validate-team-roster', () => {
  it('exits 0 with the single-person message when there is no committed roster', () => {
    expect(validate([], { dir: temp(), env: {} })).toEqual({
      code: 0,
      text: `${NO_ROSTER_MESSAGE}\n`,
    })
    const fx = rosterProject(temp)
    expect(validate([], fx)).toEqual({ code: 0, text: `${NO_ROSTER_MESSAGE}\n` })
  })

  it('passes this repository, which ships no roster', () => {
    expect(validate(['--target', repoRoot], { dir: repoRoot, env: {} }).code).toBe(0)
  })

  it('accepts a valid roster and overlay and lists reachable people by id only', () => {
    const fx = rosterProject(temp, { roster: sampleRoster(), overlay: overlayFor(sampleRoster()) })
    const { code, text } = validate(['--json'], fx)
    expect(code).toBe(0)
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      status: 'valid',
      ref: 'refs/remotes/origin/development',
      people: ['sam', 'ana'],
      reachable: ['sam', 'ana'],
      overlaySource: 'config-home',
    })
    expect(text).not.toContain('@')
  })

  it('warns when the working tree roster differs from the commit, which has no effect', () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    const edited = sampleRoster()
    edited.people.pop()
    delete edited.people[0].backup
    writeFileSync(join(fx.dir, TEAM_ROSTER_PATH), JSON.stringify(edited))
    const { code, text } = validate(['--json'], fx)
    expect(code).toBe(0)
    const report = JSON.parse(text)
    expect(report.people).toEqual(['sam', 'ana'])
    expect(report.notes).toContain(
      `the working tree ${TEAM_ROSTER_PATH} differs from refs/remotes/origin/development; uncommitted changes have no effect`,
    )
    const uncommitted = rosterProject(temp, { roster: sampleRoster(), commit: false })
    expect(validate([], uncommitted)).toMatchObject({ code: 0 })
    expect(validate([], uncommitted).text).toContain('uncommitted changes have no effect')
  })

  it('exits 0 in a main-only repository without a roster and refuses one that has an unreadable roster', async () => {
    const plain = rosterProject(temp, { extra: { 'README.md': 'x' } })
    plain.git('update-ref', '-d', 'refs/remotes/origin/development')
    plain.git('branch', '-m', 'main')
    expect(validate([], plain)).toEqual({ code: 0, text: `${NO_ROSTER_MESSAGE}\n` })
    expect((await roster(['validate'], plain)).code).toBe(0)
    const held = rosterProject(temp, { roster: sampleRoster() })
    held.git('update-ref', '-d', 'refs/remotes/origin/development')
    held.git('branch', '-m', 'main')
    const result = validate([], held)
    expect(result.code).toBe(1)
    expect(result.text).toContain('HEAD holds a roster')
  })

  it('blocks the old in-repo overlay name when it is not gitignored or is tracked', () => {
    const notIgnored = rosterProject(temp, { roster: sampleRoster(), ignoreOverlay: false })
    expect(overlayExposure(notIgnored.dir)).toEqual([
      `${TEAM_ROSTER_OVERLAY_PATH} is not gitignored; add it to .gitignore`,
    ])
    const tracked = rosterProject(temp, {
      roster: sampleRoster(),
      extra: { [TEAM_ROSTER_OVERLAY_PATH]: { version: 1, channels: {} } },
    })
    execFileSync('git', ['add', '-f', TEAM_ROSTER_OVERLAY_PATH], { cwd: tracked.dir })
    expect(overlayExposure(tracked.dir)).toEqual([
      `${TEAM_ROSTER_OVERLAY_PATH} is tracked by git; remove it from the index`,
    ])
    const { code, text } = validate([], tracked)
    expect(code).toBe(1)
    expect(text).toContain('is not read; the overlay lives outside the repository')
  })

  it('blocks a roster handle that is a configured bridge writer', () => {
    const fx = rosterProject(temp, {
      roster: sampleRoster(),
      extra: {
        'agent-workflow.config.json': {
          adapters: {
            openrig: {
              bridge: { rig: 'r', source: { adapter: 'filesystem', claimWriters: ['smota'] } },
            },
          },
        },
      },
    })
    const { code, text } = validate([], fx)
    expect(code).toBe(1)
    expect(text).toContain('people[0].handles.github is a bot writer and cannot be a person')
  })

  it('reports invalid overlay entries by id and path, never by key or value', () => {
    const secret = addressFor('stranger-secret')
    const key = ['stranger', 'corp.example'].join('@')
    const fx = rosterProject(temp, {
      roster: sampleRoster(),
      overlay: {
        version: 1,
        channels: { [key]: { openrig: secret }, sam: { openrig: 'bad value', extra: 'x' } },
      },
    })
    const { code, text } = validate([], fx)
    expect(code).toBe(1)
    expect(text).toContain('overlay: channels has 1 entry(ies) for someone not on the roster')
    expect(text).toContain('overlay: channels.sam.openrig has an invalid format')
    for (const leak of [secret, key, 'bad value', 'extra', 'corp']) expect(text).not.toContain(leak)
  })
})

describe('agentflow-sdlc roster', () => {
  it('says no roster and exits 0 for both subcommands', async () => {
    const fx = rosterProject(temp)
    expect(await roster(['validate'], fx)).toMatchObject({
      code: 0,
      stdout: `${NO_ROSTER_MESSAGE}\n`,
    })
    expect(await roster(['route', '--gate', 'merge'], fx)).toMatchObject({
      code: 0,
      stdout: `${NO_ROSTER_MESSAGE}\n`,
    })
  })

  it('explains the routing by person id', async () => {
    const fx = rosterProject(temp, { roster: sampleRoster(), overlay: overlayFor(sampleRoster()) })
    const clock = () => new Date('2026-11-12T10:00:00.000Z')
    const text = await roster(
      ['route', '--gate', 'release-of-candidate', '--paths', 'lib/a.mjs'],
      fx,
      { clock },
    )
    expect(text.code).toBe(0)
    expect(text.stdout).toBe(
      'gate release-of-candidate (tier standard, paths lib/a.mjs): routed to sam; backup ana after 240 minutes\n' +
        '  sam: primary\n  ana: matches\n',
    )
    const json = await roster(['route', '--gate', 'merge', '--json'], fx, { clock })
    expect(JSON.parse(json.stdout)).toMatchObject({ status: 'no-match' })
    expect(json.stdout).not.toContain('@')
  })

  it('reads a named ref', async () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    fx.git('tag', 'roster-v1')
    const edited = sampleRoster()
    edited.people[0].scopes[0].gates.push('merge')
    writeFileSync(join(fx.dir, TEAM_ROSTER_PATH), JSON.stringify(edited))
    fx.git('commit', '-qam', 'widen')
    fx.publish()
    const before = await roster(
      ['route', '--gate', 'merge', '--paths', 'lib/a', '--ref', 'roster-v1', '--json'],
      fx,
    )
    expect(JSON.parse(before.stdout)).toMatchObject({ status: 'no-match' })
    const now = await roster(['route', '--gate', 'merge', '--paths', 'lib/a', '--json'], fx)
    expect(JSON.parse(now.stdout)).toMatchObject({ status: 'routed', primary: 'sam' })
  })

  it('refuses an explicit --ref that does not resolve instead of reporting no roster', async () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    for (const argv of [
      ['validate', '--ref', 'nope'],
      ['route', '--gate', 'merge', '--ref', 'nope'],
    ]) {
      const result = await roster(argv, fx)
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('cannot resolve the roster ref (nope)')
    }
  })

  it('refuses usage errors with exit 2', async () => {
    const fx = rosterProject(temp)
    expect((await roster([], fx)).code).toBe(2)
    expect((await roster(['route'], fx)).code).toBe(2)
    expect((await roster(['route', '--gate', 'approve-all'], fx)).code).toBe(2)
    expect((await roster(['route', '--gate', 'merge', '--tier', 'critical'], fx)).code).toBe(2)
  })

  it('is routed from bin/cli.mjs', () => {
    const dir = temp()
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, 'bin/cli.mjs'), 'roster', 'validate', '--target', dir],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${NO_ROSTER_MESSAGE}\n`)
  })
})
