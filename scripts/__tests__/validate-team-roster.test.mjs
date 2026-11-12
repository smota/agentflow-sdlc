// `node scripts/validate-team-roster.mjs` and `agentflow-sdlc roster validate|route` (#585). Real git
// runs in temp dirs; no rig, no network.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { TEAM_ROSTER_OVERLAY_PATH, TEAM_ROSTER_PATH } from '../../lib/roster/team-roster.mjs'
import {
  addressFor,
  overlayFor,
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

function project(files = {}, { git = false, ignoreOverlay = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentflow-roster-cli-'))
  dirs.push(dir)
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    if (ignoreOverlay) writeFileSync(join(dir, '.gitignore'), `${TEAM_ROSTER_OVERLAY_PATH}\n`)
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

function sink() {
  let text = ''
  return { write: (chunk) => (text += chunk), text: () => text }
}

async function roster(argv, cwd, options = {}) {
  const stdout = sink()
  const stderr = sink()
  const code = await rosterMain(argv, { stdout, stderr, cwd, ...options })
  return { code, stdout: stdout.text(), stderr: stderr.text() }
}

describe('validate-team-roster', () => {
  it('exits 0 with the single-person message when there is no roster', () => {
    const out = sink()
    expect(validateMain([], { stdout: out, cwd: project() })).toBe(0)
    expect(out.text()).toBe(`${NO_ROSTER_MESSAGE}\n`)
  })

  it('passes this repository, which ships no roster', () => {
    const out = sink()
    expect(validateMain(['--target', repoRoot], { stdout: out, cwd: repoRoot })).toBe(0)
  })

  it('accepts a valid roster and overlay and lists reachable people by id only', () => {
    const overlay = overlayFor(sampleRoster())
    const dir = project(
      { [TEAM_ROSTER_PATH]: sampleRoster(), [TEAM_ROSTER_OVERLAY_PATH]: overlay },
      { git: true },
    )
    const out = sink()
    expect(validateMain(['--json'], { stdout: out, cwd: dir })).toBe(0)
    const report = JSON.parse(out.text())
    expect(report).toMatchObject({
      ok: true,
      status: 'valid',
      people: ['sam', 'ana'],
      reachable: ['sam', 'ana'],
    })
    expect(out.text()).not.toContain('@')
  })

  it('blocks an overlay that is not gitignored or is tracked', () => {
    const notIgnored = project(
      { [TEAM_ROSTER_PATH]: sampleRoster() },
      { git: true, ignoreOverlay: false },
    )
    expect(overlayExposure(notIgnored)).toEqual([
      `${TEAM_ROSTER_OVERLAY_PATH} is not gitignored; add it to .gitignore`,
    ])
    const tracked = project(
      {
        [TEAM_ROSTER_PATH]: sampleRoster(),
        [TEAM_ROSTER_OVERLAY_PATH]: { version: 1, channels: {} },
      },
      { git: true },
    )
    execFileSync('git', ['add', '-f', TEAM_ROSTER_OVERLAY_PATH], { cwd: tracked })
    expect(overlayExposure(tracked)).toEqual([
      `${TEAM_ROSTER_OVERLAY_PATH} is tracked by git; remove it from the index`,
    ])
    const out = sink()
    expect(validateMain([], { stdout: out, cwd: tracked })).toBe(1)
  })

  it('blocks a roster handle that is a configured bridge writer', () => {
    const dir = project({
      [TEAM_ROSTER_PATH]: sampleRoster(),
      'agent-workflow.config.json': {
        adapters: {
          openrig: {
            bridge: { rig: 'r', source: { adapter: 'filesystem', claimWriters: ['smota'] } },
          },
        },
      },
    })
    const out = sink()
    expect(validateMain([], { stdout: out, cwd: dir })).toBe(1)
    expect(out.text()).toContain('people[0].handles.github is a bot writer and cannot be a person')
  })

  it('reports invalid overlay entries by id and path, never by value', () => {
    const secret = addressFor('stranger-secret')
    const dir = project({
      [TEAM_ROSTER_PATH]: sampleRoster(),
      [TEAM_ROSTER_OVERLAY_PATH]: {
        version: 1,
        channels: { stranger: { openrig: secret }, sam: { openrig: 'bad value' } },
      },
    })
    const out = sink()
    expect(validateMain([], { stdout: out, cwd: dir })).toBe(1)
    expect(out.text()).toContain(
      'overlay: channels.stranger names someone who is not on the roster',
    )
    expect(out.text()).not.toContain(secret)
    expect(out.text()).not.toContain('bad value')
  })
})

describe('agentflow-sdlc roster', () => {
  it('says no roster and exits 0 for both subcommands', async () => {
    const dir = project()
    expect(await roster(['validate'], dir)).toMatchObject({
      code: 0,
      stdout: `${NO_ROSTER_MESSAGE}\n`,
    })
    expect(await roster(['route', '--gate', 'merge'], dir)).toMatchObject({
      code: 0,
      stdout: `${NO_ROSTER_MESSAGE}\n`,
    })
  })

  it('explains the routing by person id', async () => {
    const dir = project({
      [TEAM_ROSTER_PATH]: sampleRoster(),
      [TEAM_ROSTER_OVERLAY_PATH]: overlayFor(sampleRoster()),
    })
    const clock = () => new Date('2026-11-12T10:00:00.000Z')
    const text = await roster(
      ['route', '--gate', 'release-of-candidate', '--paths', 'lib/a.mjs'],
      dir,
      { clock },
    )
    expect(text.code).toBe(0)
    expect(text.stdout).toBe(
      'gate release-of-candidate (tier standard, paths lib/a.mjs): routed to sam; backup ana after 240 minutes\n' +
        '  sam: primary\n  ana: matches\n',
    )
    const json = await roster(['route', '--gate', 'merge', '--json'], dir, { clock })
    expect(JSON.parse(json.stdout)).toMatchObject({ status: 'no-match' })
    expect(json.stdout).not.toContain('@')
  })

  it('refuses usage errors with exit 2', async () => {
    const dir = project()
    expect((await roster([], dir)).code).toBe(2)
    expect((await roster(['route'], dir)).code).toBe(2)
    expect((await roster(['route', '--gate', 'approve-all'], dir)).code).toBe(2)
    expect((await roster(['route', '--gate', 'merge', '--tier', 'critical'], dir)).code).toBe(2)
  })

  it('is routed from bin/cli.mjs', () => {
    const dir = project()
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, 'bin/cli.mjs'), 'roster', 'validate', '--target', dir],
      {
        encoding: 'utf8',
      },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${NO_ROSTER_MESSAGE}\n`)
  })
})
