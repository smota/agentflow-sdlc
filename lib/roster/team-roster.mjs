// Team roster (#585): who may answer which gate. The roster (.agentflow/team-roster.json) holds
// people, their source handles and scopes, and never an address. It is read from a commit
// (`git show <ref>:.agentflow/team-roster.json`, default HEAD of the primary checkout), so an
// uncommitted working-tree edit has no effect. No rig seat may write it or its schemas
// (governance-files-guard in manifests/path-ownership.json).
//
// Private channel addresses live in the overlay, outside the repository:
// ${XDG_CONFIG_HOME:-~/.config}/agentflow/<project-id>/team-roster.local.json. Only the person's own
// process may point elsewhere (AGENTFLOW_TEAM_ROSTER_OVERLAY or --overlay). The old in-repo name
// (.agentflow/team-roster.local.json) is never read; it stays gitignored and must not be tracked.
//
// Nothing here prints an overlay key or value: messages name roster ids and JSON paths only.
// Invalid JSON is reported without the parser's excerpt of the file.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { GATE_CLASSES } from '../core/gate.mjs'

export const TEAM_ROSTER_PATH = '.agentflow/team-roster.json'
// The old in-repo overlay name: never read, kept gitignored, refused when tracked.
export const TEAM_ROSTER_OVERLAY_PATH = '.agentflow/team-roster.local.json'
export const OVERLAY_FILE_NAME = 'team-roster.local.json'
export const OVERLAY_ENV = 'AGENTFLOW_TEAM_ROSTER_OVERLAY'
export const GATE_TYPES = Object.freeze([
  ...Object.values(GATE_CLASSES),
  'security-review',
  'acceptance-review',
  'merge',
])
export const HIGH_ASSURANCE_REVIEWS = Object.freeze(['security-review', 'acceptance-review'])
export const TIERS = Object.freeze(['bounded', 'standard', 'high-assurance'])
export const DEFAULT_TIMEOUT_MINUTES = 240
export const DEFAULT_CAPACITY = 3
export const PERSON_ID = /^[a-z0-9][a-z0-9-]{0,62}$/
// ASCII only: a resolved login is checked against this before lookup, so no Unicode case folding
// (for example the Kelvin sign lower-casing to k) can make one login match another person.
export const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
const SCHEMA_DIR = new URL('../../schemas/', import.meta.url)

export class TeamRosterError extends Error {
  constructor(message) {
    super(message)
    this.code = 'team-roster-invalid'
  }
}

let compiled = null
function schemas() {
  if (compiled) return compiled
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
  const read = (name) => JSON.parse(readFileSync(new URL(name, SCHEMA_DIR), 'utf8'))
  compiled = {
    roster: ajv.compile(read('team-roster.schema.json')),
    overlay: ajv.compile(read('team-roster-overlay.schema.json')),
  }
  return compiled
}

// Ajv messages name the JSON path and the rule, never the offending value. `segment` rewrites a
// path segment that must not be printed (an overlay key that is not a roster id).
function schemaErrors(validate, value, { segment = (part) => part, propertyNames = true } = {}) {
  if (validate(value)) return []
  const seen = new Set()
  for (const error of validate.errors ?? []) {
    const parts = error.instancePath ? error.instancePath.slice(1).split('/') : []
    const path = parts.length
      ? parts.map((part, index) => segment(part, index, parts)).join('.')
      : '(root)'
    let extra = ''
    if (error.keyword === 'additionalProperties' && propertyNames)
      extra = ` (${error.params.additionalProperty})`
    const message = error.keyword === 'pattern' ? 'has an invalid format' : error.message
    seen.add(`${path} ${message}${extra}`)
  }
  return [...seen]
}

// Every string in the committed roster is scanned: an address-shaped value is an error wherever it
// appears, even where the schema would also reject it.
function addressProblems(value, path, errors) {
  if (typeof value === 'string') {
    if (value.includes('@') || EMAIL.test(value)) errors.push(`${path} looks like an address`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => addressProblems(item, `${path}[${index}]`, errors))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key.includes('@')) errors.push(`${path} has an address-shaped key`)
      else addressProblems(item, path === '(root)' ? key : `${path}.${key}`, errors)
    }
  }
}

const lower = (value) => String(value).toLowerCase()

export function validateTeamRoster(roster, { botWriters = [] } = {}) {
  const errors = schemaErrors(schemas().roster, roster)
  addressProblems(roster, '(root)', errors)
  const people = Array.isArray(roster?.people) ? roster.people : []
  const ids = new Map()
  const handles = new Map()
  const bots = new Set(botWriters.map(lower))
  people.forEach((person, index) => {
    if (typeof person?.id !== 'string') return
    if (ids.has(person.id)) errors.push(`people[${index}].id duplicates ${person.id}`)
    else ids.set(person.id, index)
    for (const [system, login] of Object.entries(person.handles ?? {})) {
      if (typeof login !== 'string') continue
      const key = `${system}\u0000${lower(login)}`
      const owner = handles.get(key)
      if (owner !== undefined && owner !== person.id)
        errors.push(`people[${index}].handles.${system} is also the handle of ${owner}`)
      else handles.set(key, person.id)
      if (bots.has(lower(login)))
        errors.push(`people[${index}].handles.${system} is a bot writer and cannot be a person`)
    }
  })
  people.forEach((person, index) => {
    if (person?.backup === undefined || typeof person.backup !== 'string') return
    if (person.backup === person.id)
      errors.push(`people[${index}].backup cannot be ${person.id} itself`)
    else if (!ids.has(person.backup))
      errors.push(`people[${index}].backup names ${person.backup}, who is not on the roster`)
  })
  return { ok: errors.length === 0, errors: [...new Set(errors)] }
}

// Overlay errors never print a value, a channel name, or a key that is not a roster id: such a key
// is shown as <key>, and keys not on the roster are only counted.
export function validateRosterOverlay(overlay, roster) {
  const ids = new Set((roster?.people ?? []).map((person) => person?.id))
  const errors = schemaErrors(schemas().overlay, overlay, {
    propertyNames: false,
    segment: (part, index, parts) =>
      index === 1 && parts[0] === 'channels' && !(PERSON_ID.test(part) && ids.has(part))
        ? '<key>'
        : part,
  })
  const channels =
    overlay?.channels && typeof overlay.channels === 'object' && !Array.isArray(overlay.channels)
      ? overlay.channels
      : {}
  const strangers = Object.keys(channels).filter((key) => !(PERSON_ID.test(key) && ids.has(key)))
  if (strangers.length)
    errors.push(`channels has ${strangers.length} entry(ies) for someone not on the roster`)
  return { ok: errors.length === 0, errors: [...new Set(errors)] }
}

// Every channel key and value in the overlay, so callers and tests can prove none of them leaks.
// Keys that are roster ids are public and left out.
export function overlayValues(overlay, roster = null) {
  const ids = new Set((roster?.people ?? []).map((person) => person?.id))
  const values = []
  for (const [key, channel] of Object.entries(overlay?.channels ?? {})) {
    if (!ids.has(key)) values.push(key)
    if (!channel || typeof channel !== 'object') {
      if (typeof channel === 'string' && channel) values.push(channel)
      continue
    }
    for (const [name, value] of Object.entries(channel)) {
      if (name !== 'openrig') values.push(name)
      if (typeof value === 'string' && value) values.push(value)
    }
  }
  return values
}

function defaultGit(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 256 * 1024 * 1024,
  })
  return { status: result.error ? null : result.status, stdout: result.stdout ?? '' }
}

// The primary checkout of the repository that holds targetDir (the main worktree), or null when
// targetDir is not in a git checkout. A linked worktree reads the roster from the primary checkout,
// so a commit on a seat's own worktree branch does not change who may answer a gate.
export function primaryCheckout(targetDir, git = defaultGit) {
  const inside = git(targetDir, ['rev-parse', '--is-inside-work-tree'])
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') return null
  const common = git(targetDir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (common.status !== 0) return null
  const commonDir = common.stdout.trim()
  if (basename(commonDir) === '.git') return dirname(commonDir)
  const top = git(targetDir, ['rev-parse', '--show-toplevel'])
  return top.status === 0 ? top.stdout.trim() : null
}

export function projectId(primary) {
  let real = primary
  try {
    real = realpathSync(primary)
  } catch {
    // keep the given path
  }
  const slug =
    basename(real)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  return `${slug}-${createHash('sha256').update(real).digest('hex').slice(0, 8)}`
}

// Where the overlay is read from: --overlay, then AGENTFLOW_TEAM_ROSTER_OVERLAY (both only for the
// person's own process), then ${XDG_CONFIG_HOME:-~/.config}/agentflow/<project-id>/.
export function overlayPathFor(primary, { env = process.env, overlayPath = null, home } = {}) {
  const explicit = overlayPath || env[OVERLAY_ENV]
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(explicit)
  const base = env.XDG_CONFIG_HOME || join(home ?? homedir(), '.config')
  return join(base, 'agentflow', projectId(primary), OVERLAY_FILE_NAME)
}

function parseJson(text, label) {
  try {
    return JSON.parse(text)
  } catch {
    throw new TeamRosterError(`${label} is not valid JSON`)
  }
}

// The committed roster blob at ref: { text } | null. Refuses a symlink entry and any case variant
// of the roster path in the tree, so a differently cased file cannot stand in for it.
function committedRoster(primary, ref, git) {
  const listed = git(primary, ['ls-tree', '-r', '--full-tree', ref])
  if (listed.status !== 0) {
    const head = git(primary, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (head.status !== 0) return null
    throw new TeamRosterError(`cannot list ${ref}`)
  }
  let entry = null
  for (const line of listed.stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const path = line.slice(tab + 1)
    if (lower(path) !== lower(TEAM_ROSTER_PATH)) continue
    if (path !== TEAM_ROSTER_PATH)
      throw new TeamRosterError(
        `${ref} holds a case variant of ${TEAM_ROSTER_PATH}; refusing to read the roster`,
      )
    entry = line.slice(0, tab).split(' ')
  }
  if (!entry) return null
  if (entry[0] !== '100644' && entry[0] !== '100755')
    throw new TeamRosterError(`${TEAM_ROSTER_PATH} in ${ref} is not a regular file; refusing it`)
  const shown = git(primary, ['show', `${ref}:${TEAM_ROSTER_PATH}`])
  if (shown.status !== 0) throw new TeamRosterError(`cannot read ${TEAM_ROSTER_PATH} at ${ref}`)
  return { text: shown.stdout }
}

// null when there is no committed roster (or no git checkout): every caller then keeps today's
// single-person path. Otherwise { roster, overlay, ref, primary, overlayPath }.
// options: ref (default HEAD), overlay (false skips reading it), validateOverlay (default true:
// an invalid overlay throws, so no gate is ever delivered to an unchecked address), env,
// overlayPath, home, git.
export function loadTeamRoster(
  targetDir,
  {
    ref = 'HEAD',
    overlay: readOverlay = true,
    validateOverlay = true,
    env = process.env,
    overlayPath = null,
    home,
    git = defaultGit,
  } = {},
) {
  const primary = primaryCheckout(targetDir, git)
  if (!primary) return null
  const committed = committedRoster(primary, ref, git)
  if (!committed) return null
  const roster = parseJson(committed.text, `${TEAM_ROSTER_PATH} at ${ref}`)
  const path = overlayPathFor(primary, { env, overlayPath, home })
  let overlay = null
  if (readOverlay && existsSync(path)) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      throw new TeamRosterError('the roster overlay cannot be read')
    }
    overlay = parseJson(text, 'the roster overlay')
    if (validateOverlay && !validateRosterOverlay(overlay, roster).ok) {
      throw new TeamRosterError(
        'the roster overlay is invalid; run `agentflow-sdlc roster validate`',
      )
    }
  }
  return { roster, overlay, ref, primary, overlayPath: path }
}

export function personById(roster, id) {
  return (roster?.people ?? []).find((person) => person?.id === id) ?? null
}

// The roster person whose handle for the source system equals the login, case-insensitively over
// ASCII. Null when the login is not a valid handle, or when nobody or more than one person has it.
export function personForHandle(roster, { system, login } = {}) {
  if (typeof system !== 'string' || typeof login !== 'string' || !HANDLE.test(login)) return null
  const matches = (roster?.people ?? []).filter((person) => {
    const handle = person?.handles?.[system]
    return typeof handle === 'string' && lower(handle) === lower(login)
  })
  return matches.length === 1 ? matches[0] : null
}

export function timeoutMinutesFor(person) {
  return Number.isInteger(person?.timeoutMinutes) ? person.timeoutMinutes : DEFAULT_TIMEOUT_MINUTES
}

export function capacityFor(person) {
  return Number.isInteger(person?.capacity) ? person.capacity : DEFAULT_CAPACITY
}
