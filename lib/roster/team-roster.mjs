// Team roster (#585): who may answer which gate. The committed roster
// (.agentflow/team-roster.json) holds people, their source handles and scopes, and never an
// address. Private channel addresses live only in the gitignored overlay
// (.agentflow/team-roster.local.json). No rig seat may write either file or their schemas
// (governance-files-guard in manifests/path-ownership.json).
//
// Nothing here prints or returns an overlay value in an error: messages name roster ids and JSON
// paths only. Invalid JSON is reported without the parser's excerpt of the file.
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { GATE_CLASSES } from '../core/gate.mjs'

export const TEAM_ROSTER_PATH = '.agentflow/team-roster.json'
export const TEAM_ROSTER_OVERLAY_PATH = '.agentflow/team-roster.local.json'
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

// Ajv messages name the JSON path and the rule, never the offending value.
function schemaErrors(validate, value) {
  if (validate(value)) return []
  const seen = new Set()
  for (const error of validate.errors ?? []) {
    const path = error.instancePath ? error.instancePath.slice(1).replace(/\//g, '.') : '(root)'
    const extra =
      error.keyword === 'additionalProperties' ? ` (${error.params.additionalProperty})` : ''
    seen.add(`${path} ${error.message}${extra}`)
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
      addressProblems(item, path === '(root)' ? key : `${path}.${key}`, errors)
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

export function validateRosterOverlay(overlay, roster) {
  const errors = schemaErrors(schemas().overlay, overlay)
  const ids = new Set((roster?.people ?? []).map((person) => person?.id))
  const channels =
    overlay?.channels && typeof overlay.channels === 'object' && !Array.isArray(overlay.channels)
      ? overlay.channels
      : {}
  for (const id of Object.keys(channels)) {
    if (!ids.has(id)) errors.push(`channels.${id} names someone who is not on the roster`)
  }
  // The schema's id pattern keeps keys printable; a key that fails it is reported by path only.
  return { ok: errors.length === 0, errors: [...new Set(errors)] }
}

// Every channel value in the overlay, so callers and tests can prove none of them leaks.
export function overlayValues(overlay) {
  const values = []
  for (const channel of Object.values(overlay?.channels ?? {})) {
    for (const value of Object.values(channel ?? {})) {
      if (typeof value === 'string' && value) values.push(value)
    }
  }
  return values
}

function refuseSymlink(targetDir, relativePath) {
  const parts = relativePath.split('/')
  for (let index = 1; index <= parts.length; index += 1) {
    let stat
    try {
      stat = lstatSync(join(targetDir, ...parts.slice(0, index)))
    } catch {
      return
    }
    if (stat.isSymbolicLink())
      throw new TeamRosterError(`${relativePath} is reached through a symlink; refusing to read it`)
  }
}

function readJson(targetDir, relativePath) {
  const path = join(targetDir, relativePath)
  refuseSymlink(targetDir, relativePath)
  if (!existsSync(path)) return null
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new TeamRosterError(`${relativePath} cannot be read`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new TeamRosterError(`${relativePath} is not valid JSON`)
  }
}

// null when the project has no roster file: every caller then keeps today's single-person path.
// A symlinked roster, overlay or .agentflow directory is refused, so a seat that may write
// elsewhere cannot point the fixed roster path at a file it controls.
export function loadTeamRoster(targetDir) {
  refuseSymlink(targetDir, TEAM_ROSTER_PATH)
  if (!existsSync(join(targetDir, TEAM_ROSTER_PATH))) return null
  const roster = readJson(targetDir, TEAM_ROSTER_PATH)
  const overlay = readJson(targetDir, TEAM_ROSTER_OVERLAY_PATH)
  return { roster, overlay }
}

export function personById(roster, id) {
  return (roster?.people ?? []).find((person) => person?.id === id) ?? null
}

// The roster person whose handle for the source system equals the login, case-insensitively.
// Null when nobody, or more than one person, has it.
export function personForHandle(roster, { system, login } = {}) {
  if (typeof system !== 'string' || typeof login !== 'string' || !login) return null
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
