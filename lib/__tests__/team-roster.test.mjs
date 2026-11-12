// Team roster (#585): loading, validation and handle lookup. No network, no rig.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GATE_TYPES,
  TEAM_ROSTER_OVERLAY_PATH,
  TEAM_ROSTER_PATH,
  TIERS,
  loadTeamRoster,
  personForHandle,
  validateRosterOverlay,
  validateTeamRoster,
} from '../roster/team-roster.mjs'
import { addressFor, sampleRoster } from './fixtures/team-roster-fixtures.mjs'

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

  it('rejects a channel for someone not on the roster, naming the id only', () => {
    const secret = addressFor('mallory-secret')
    const overlay = { version: 1, channels: { mallory: { openrig: secret } } }
    const result = validateRosterOverlay(overlay, sampleRoster())
    expect(result.errors).toEqual(['channels.mallory names someone who is not on the roster'])
  })

  it('rejects a malformed address without echoing it', () => {
    const overlay = { version: 1, channels: { sam: { openrig: 'not an address secret-value' } } }
    const result = validateRosterOverlay(overlay, sampleRoster())
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).not.toContain('secret-value')
  })

  it('rejects unknown channel kinds', () => {
    const overlay = { version: 1, channels: { sam: { openrig: addressFor('s'), email: 'x' } } }
    expect(validateRosterOverlay(overlay, sampleRoster()).ok).toBe(false)
  })
})

describe('loadTeamRoster', () => {
  it('returns null without a roster file, even when an overlay exists', () => {
    expect(loadTeamRoster(project())).toBeNull()
    const overlayOnly = project({
      [TEAM_ROSTER_OVERLAY_PATH]: { version: 1, channels: {} },
    })
    expect(loadTeamRoster(overlayOnly)).toBeNull()
  })

  it('reads the roster and the overlay from their fixed paths', () => {
    const overlay = { version: 1, channels: { sam: { openrig: addressFor('s1') } } }
    const dir = project({ [TEAM_ROSTER_PATH]: sampleRoster(), [TEAM_ROSTER_OVERLAY_PATH]: overlay })
    expect(loadTeamRoster(dir)).toEqual({ roster: sampleRoster(), overlay })
    const noOverlay = project({ [TEAM_ROSTER_PATH]: sampleRoster() })
    expect(loadTeamRoster(noOverlay)).toEqual({ roster: sampleRoster(), overlay: null })
  })

  it('reports invalid overlay JSON without echoing its content', () => {
    const dir = project({
      [TEAM_ROSTER_PATH]: sampleRoster(),
      [TEAM_ROSTER_OVERLAY_PATH]: `{"version":1,"channels":{"sam":{"openrig":"${addressFor('leak')}"`,
    })
    let message = ''
    try {
      loadTeamRoster(dir)
    } catch (error) {
      message = error.message
    }
    expect(message).toBe(`${TEAM_ROSTER_OVERLAY_PATH} is not valid JSON`)
  })

  it('refuses a roster reached through a symlink', () => {
    const dir = project({ 'goals/team-roster.json': sampleRoster() })
    mkdirSync(join(dir, '.agentflow'))
    symlinkSync(join(dir, 'goals/team-roster.json'), join(dir, TEAM_ROSTER_PATH))
    expect(() => loadTeamRoster(dir)).toThrow(/symlink/)

    const linkedDir = project({ 'goals/team-roster.json': sampleRoster() })
    symlinkSync(join(linkedDir, 'goals'), join(linkedDir, '.agentflow'))
    expect(() => loadTeamRoster(linkedDir)).toThrow(/symlink/)
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

  it('returns null when two people share a handle', () => {
    const roster = sampleRoster()
    roster.people[1].handles.github = 'smota'
    expect(personForHandle(roster, { system: 'github', login: 'smota' })).toBeNull()
  })
})
