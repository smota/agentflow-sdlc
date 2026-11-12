// Team roster (#585): loading, validation and handle lookup. No network, no rig.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GATE_TYPES,
  OVERLAY_ENV,
  TEAM_ROSTER_OVERLAY_PATH,
  TEAM_ROSTER_PATH,
  TIERS,
  loadTeamRoster,
  overlayPathFor,
  personForHandle,
  validateRosterOverlay,
  validateTeamRoster,
} from '../roster/team-roster.mjs'
import { addressFor, rosterProject, sampleRoster } from './fixtures/team-roster-fixtures.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function project(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentflow-roster-'))
  dirs.push(dir)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

describe('team roster vocabulary', () => {
  it('uses the person gate classes plus the review and merge gates', () => {
    expect(GATE_TYPES).toEqual([
      'adequacy-of-intent',
      'release-of-candidate',
      'agent-escalation',
      'security-review',
      'acceptance-review',
      'merge',
    ])
    expect(TIERS).toEqual(['bounded', 'standard', 'high-assurance'])
  })

  it('keeps the schema enums equal to the code vocabulary', () => {
    const schema = JSON.parse(
      readFileSync(join(repoRoot, 'schemas/team-roster.schema.json'), 'utf8'),
    )
    expect(schema.$defs.scope.properties.gates.items.enum).toEqual(GATE_TYPES)
    expect(schema.$defs.scope.properties.tiers.items.enum).toEqual(TIERS)
  })
})

describe('validateTeamRoster', () => {
  it('accepts the documented roster shape', () => {
    expect(validateTeamRoster(sampleRoster())).toEqual({ ok: true, errors: [] })
  })

  it('has no channel field: any address-carrying key is rejected', () => {
    const roster = sampleRoster()
    roster.people[0].channel = addressFor('sam')
    const result = validateTeamRoster(roster)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/channel/)
  })

  it.each([
    ['an e-mail handle', (r) => (r.people[0].handles.github = ['sam', 'example.org'].join('@'))],
    ['an @external handle', (r) => (r.people[0].handles.github = addressFor('sam'))],
    [
      'an address in a path',
      (r) => (r.people[0].scopes[0].paths = [`${['sam', 'example.org'].join('@')}/**`]),
    ],
  ])('rejects %s and never echoes the value', (_name, mutate) => {
    const roster = sampleRoster()
    mutate(roster)
    const result = validateTeamRoster(roster)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).not.toMatch(/@/)
  })

  it('rejects unknown gate types, unknown tiers and traversing paths', () => {
    for (const mutate of [
      (r) => (r.people[0].scopes[0].gates = ['approve-everything']),
      (r) => (r.people[0].scopes[0].tiers = ['critical']),
      (r) => (r.people[0].scopes[0].paths = ['../outside/**']),
      (r) => (r.people[0].scopes[0].paths = ['/etc/**']),
      (r) => (r.version = 2),
    ]) {
      const roster = sampleRoster()
      mutate(roster)
      expect(validateTeamRoster(roster).ok).toBe(false)
    }
  })

  it('rejects duplicate ids, a shared handle, a missing or self backup', () => {
    const duplicate = sampleRoster()
    duplicate.people[1].id = 'sam'
    expect(validateTeamRoster(duplicate).errors).toContain('people[1].id duplicates sam')

    const shared = sampleRoster()
    shared.people[1].handles.github = 'SMOTA'
    expect(validateTeamRoster(shared).errors).toContain(
      'people[1].handles.github is also the handle of sam',
    )

    const missing = sampleRoster()
    missing.people[0].backup = 'nobody'
    expect(validateTeamRoster(missing).errors).toContain(
      'people[0].backup names nobody, who is not on the roster',
    )

    const self = sampleRoster()
    self.people[0].backup = 'sam'
    expect(validateTeamRoster(self).errors).toContain('people[0].backup cannot be sam itself')
  })

  it('rejects a person whose handle is a bridge or bot writer', () => {
    const result = validateTeamRoster(sampleRoster(), { botWriters: ['SMota'] })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'people[0].handles.github is a bot writer and cannot be a person',
    )
  })
})

describe('validateRosterOverlay', () => {
  it('accepts channels for roster people', () => {
    const overlay = { version: 1, channels: { sam: { openrig: addressFor('sam-private') } } }
    expect(validateRosterOverlay(overlay, sampleRoster())).toEqual({ ok: true, errors: [] })
  })

  it('counts channels for people not on the roster and never prints their keys', () => {
    const keys = ['mallory', ['sam', 'corp.example'].join('@'), 'Not An Id']
    const overlay = {
      version: 1,
      channels: Object.fromEntries(keys.map((key) => [key, { openrig: addressFor('x') }])),
    }
    const result = validateRosterOverlay(overlay, sampleRoster())
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('channels has 3 entry(ies) for someone not on the roster')
    const text = result.errors.join('\n')
    for (const key of keys) expect(text).not.toContain(key)
    expect(text).not.toContain('@')
  })

  it('rejects a malformed address or an extra channel name without echoing either', () => {
    const extraName = ['sam', 'corp.example'].join('@')
    for (const overlay of [
      { version: 1, channels: { sam: { openrig: 'not an address secret-value' } } },
      { version: 1, channels: { sam: { openrig: '--help; rm -rf ~' } } },
      { version: 1, channels: { sam: { openrig: addressFor('s'), [extraName]: 'secret-value' } } },
    ]) {
      const result = validateRosterOverlay(overlay, sampleRoster())
      expect(result.ok).toBe(false)
      const text = result.errors.join('\n')
      expect(text).not.toContain('secret-value')
      expect(text).not.toContain('rm -rf')
      expect(text).not.toContain('@')
    }
  })
})

describe('loadTeamRoster', () => {
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentflow-roster-'))
    dirs.push(dir)
    return dir
  }

  it('returns null outside git, without a committed roster, or with only an overlay', () => {
    expect(loadTeamRoster(project({ [TEAM_ROSTER_PATH]: sampleRoster() }))).toBeNull()
    const empty = rosterProject(temp)
    expect(loadTeamRoster(empty.dir, { env: empty.env })).toBeNull()
    const overlayOnly = rosterProject(temp, { overlay: { version: 1, channels: {} } })
    expect(loadTeamRoster(overlayOnly.dir, { env: overlayOnly.env })).toBeNull()
  })

  it('reads the roster from the integration branch and the overlay from the config home outside the repository', () => {
    const overlay = { version: 1, channels: { sam: { openrig: addressFor('s1') } } }
    const fx = rosterProject(temp, { roster: sampleRoster(), overlay })
    const loaded = loadTeamRoster(fx.dir, { env: fx.env })
    expect(loaded).toMatchObject({
      roster: sampleRoster(),
      overlay,
      ref: 'refs/heads/development',
    })
    expect(loaded.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(loaded.overlayPath).toBe(fx.overlayPath)
    expect(fx.overlayPath.startsWith(join(fx.env.XDG_CONFIG_HOME, 'agentflow'))).toBe(true)
    expect(fx.overlayPath.startsWith(fx.dir)).toBe(false)
    const noOverlay = rosterProject(temp, { roster: sampleRoster() })
    expect(loadTeamRoster(noOverlay.dir, { env: noOverlay.env }).overlay).toBeNull()
  })

  it('ignores an uncommitted working-tree change to the roster', () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    const edited = sampleRoster()
    edited.people.push({
      id: 'mallory',
      handles: { github: 'mallory' },
      scopes: [{ gates: ['merge'], tiers: ['high-assurance'] }],
    })
    writeFileSync(join(fx.dir, TEAM_ROSTER_PATH), JSON.stringify(edited))
    expect(loadTeamRoster(fx.dir, { env: fx.env }).roster).toEqual(sampleRoster())
    const uncommitted = rosterProject(temp, { roster: sampleRoster(), commit: false })
    expect(() => loadTeamRoster(uncommitted.dir, { env: uncommitted.env })).toThrow(
      /cannot resolve the roster ref/,
    )
  })

  it('a linked worktree reads the roster from the primary checkout, not its own branch', () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    const worktree = join(dirname(fx.dir), 'wt')
    fx.git('worktree', 'add', '-q', '-b', 'seat-branch', worktree)
    const edited = sampleRoster()
    edited.people[1].scopes[0].tiers = ['standard', 'high-assurance']
    writeFileSync(join(worktree, TEAM_ROSTER_PATH), JSON.stringify(edited))
    execFileSync('git', ['-C', worktree, 'commit', '-qam', 'seat edit'], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't',
      },
    })
    expect(loadTeamRoster(worktree, { env: fx.env }).roster).toEqual(sampleRoster())
  })

  it('a commit on the checked-out seat branch has no effect; the integration branch decides', () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    fx.git('checkout', '-q', '-b', 'feature/seat')
    const edited = sampleRoster()
    edited.people[1].scopes[0].tiers = ['standard', 'high-assurance']
    writeFileSync(join(fx.dir, TEAM_ROSTER_PATH), JSON.stringify(edited))
    fx.git('commit', '-qam', 'seat edit')
    expect(loadTeamRoster(fx.dir, { env: fx.env }).roster).toEqual(sampleRoster())
  })

  it('prefers origin/<integration branch> over the local branch', () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    const first = fx.git('rev-parse', 'HEAD').trim()
    const edited = sampleRoster()
    delete edited.people[0].backup
    edited.people.pop()
    writeFileSync(join(fx.dir, TEAM_ROSTER_PATH), JSON.stringify(edited))
    fx.git('commit', '-qam', 'local only')
    fx.git('update-ref', 'refs/remotes/origin/development', first)
    const loaded = loadTeamRoster(fx.dir, { env: fx.env })
    expect(loaded).toMatchObject({ ref: 'refs/remotes/origin/development', commit: first })
    expect(loaded.roster).toEqual(sampleRoster())
  })

  it('takes the integration branch from the project branching configuration', () => {
    const fx = rosterProject(temp, {
      roster: sampleRoster(),
      extra: { 'agent-workflow.config.json': { branching: { integration: 'develop' } } },
    })
    expect(() => loadTeamRoster(fx.dir, { env: fx.env })).toThrow(/refs\/heads\/develop\b/)
    fx.git('branch', 'develop')
    expect(loadTeamRoster(fx.dir, { env: fx.env }).ref).toBe('refs/heads/develop')
  })

  it('refuses an explicit ref that does not resolve, and never reads HEAD by default', () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    expect(() => loadTeamRoster(fx.dir, { env: fx.env, ref: 'no-such-ref' })).toThrow(
      /cannot resolve the roster ref \(no-such-ref\)/,
    )
    expect(() => loadTeamRoster(fx.dir, { env: fx.env, ref: '--output=x' })).toThrow(
      /cannot resolve/,
    )
  })

  it('reads the integration branch of the bare repository in a bare-plus-worktrees layout', () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    const bare = join(dirname(fx.dir), 'project.git')
    execFileSync('git', ['clone', '-q', '--bare', fx.dir, bare])
    const seat = join(dirname(fx.dir), 'seat')
    execFileSync('git', [
      '--git-dir',
      bare,
      'worktree',
      'add',
      '-q',
      '-b',
      'feature/seat',
      seat,
      'development',
    ])
    const edited = sampleRoster()
    edited.people[1].scopes[0].gates.push('merge')
    writeFileSync(join(seat, TEAM_ROSTER_PATH), JSON.stringify(edited))
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't',
    }
    execFileSync('git', ['-C', seat, 'commit', '-qam', 'seat edit'], { env })
    const loaded = loadTeamRoster(seat, { env: fx.env })
    expect(loaded.ref).toBe('refs/heads/development')
    expect(loaded.roster).toEqual(sampleRoster())
    expect(loaded.root).toBe(
      execFileSync(
        'git',
        ['--git-dir', bare, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        { encoding: 'utf8' },
      ).trim(),
    )
  })

  it('refuses a committed case variant of the roster path', () => {
    for (const variant of ['.AgentFlow/team-roster.json', '.agentflow/Team-Roster.json']) {
      const fx = rosterProject(temp, {
        roster: sampleRoster(),
        extra: { [variant]: sampleRoster() },
      })
      expect(() => loadTeamRoster(fx.dir, { env: fx.env })).toThrow(/case variant/)
    }
  })

  it('refuses a committed symlink at the roster path', () => {
    const fx = rosterProject(temp, { extra: { 'goals/team-roster.json': sampleRoster() } })
    mkdirSync(join(fx.dir, '.agentflow'), { recursive: true })
    symlinkSync('../goals/team-roster.json', join(fx.dir, TEAM_ROSTER_PATH))
    fx.git('add', '-A')
    fx.git('commit', '-qm', 'link')
    expect(() => loadTeamRoster(fx.dir, { env: fx.env })).toThrow(/not a regular file/)
  })

  it('fails closed on an invalid overlay and never echoes its content', () => {
    for (const overlay of [
      { version: 1, channels: { sam: { openrig: '--help; rm -rf ~' } } },
      `{"version":1,"channels":{"sam":{"openrig":"${addressFor('leak')}"`,
    ]) {
      const fx = rosterProject(temp, { roster: sampleRoster(), overlay })
      let message = ''
      try {
        loadTeamRoster(fx.dir, { env: fx.env })
      } catch (error) {
        message = error.message
      }
      expect(message).toMatch(/^the roster overlay is (invalid|not valid JSON)/)
      expect(message).not.toContain('rm -rf')
      expect(message).not.toContain('@')
    }
  })

  it('only the person can point the overlay elsewhere, by flag or environment', () => {
    const fx = rosterProject(temp, { roster: sampleRoster() })
    const elsewhere = join(dirname(fx.dir), 'mine.json')
    writeFileSync(elsewhere, JSON.stringify({ version: 1, channels: {} }))
    expect(loadTeamRoster(fx.dir, { env: fx.env, overlayPath: elsewhere }).overlayPath).toBe(
      elsewhere,
    )
    expect(
      loadTeamRoster(fx.dir, { env: { ...fx.env, [OVERLAY_ENV]: elsewhere } }).overlayPath,
    ).toBe(elsewhere)
    expect(overlayPathFor('/x/proj', { env: {}, home: '/home/p' })).toMatch(
      /^\/home\/p\/\.config\/agentflow\/proj-[0-9a-f]{8}\/team-roster\.local\.json$/,
    )
  })

  it('never reads the old in-repo overlay name', () => {
    const fx = rosterProject(temp, {
      roster: sampleRoster(),
      extra: {
        [TEAM_ROSTER_OVERLAY_PATH]: { version: 1, channels: { sam: { openrig: addressFor('a') } } },
      },
    })
    expect(loadTeamRoster(fx.dir, { env: fx.env }).overlay).toBeNull()
  })
})

describe('personForHandle', () => {
  it('matches a source handle case-insensitively and per system', () => {
    const roster = sampleRoster()
    expect(personForHandle(roster, { system: 'github', login: 'SMOTA' })?.id).toBe('sam')
    expect(personForHandle(roster, { system: 'filesystem', login: 'sam-writer' })?.id).toBe('sam')
    expect(personForHandle(roster, { system: 'gitlab', login: 'smota' })).toBeNull()
    expect(personForHandle(roster, { system: 'github', login: 'stranger' })).toBeNull()
    expect(personForHandle(roster, { system: 'github', login: '' })).toBeNull()
  })

  it('rejects a login outside the ASCII handle pattern before any case folding', () => {
    const roster = sampleRoster()
    roster.people[1].handles.github = 'kate'
    const kelvin = `${String.fromCharCode(0x212a)}ate`
    expect(kelvin.toLowerCase()).toBe('kate')
    expect(personForHandle(roster, { system: 'github', login: kelvin })).toBeNull()
    expect(personForHandle(roster, { system: 'github', login: 'smota ' })).toBeNull()
  })

  it('returns null when two people share a handle', () => {
    const roster = sampleRoster()
    roster.people[1].handles.github = 'smota'
    expect(personForHandle(roster, { system: 'github', login: 'smota' })).toBeNull()
  })
})
