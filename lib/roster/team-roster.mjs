// Team roster (#585): who may answer which gate. The roster (.agentflow/team-roster.json) holds
// people, their source handles and scopes, and never an address. It is read from a protected ref
// (default origin/<integration branch>, else the local integration branch) through the shared git
// directory, so neither an uncommitted edit nor a commit on a seat's own branch has any effect.
// No rig seat may write it or its schemas
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
import { DEFAULT_BRANCH_STRATEGY, resolveBranchStrategy } from '../branch-strategy.mjs'
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
// Unicode case folding for path comparison (for example the long s folds to s).
const fold = (value) => String(value).toUpperCase().toLowerCase()

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

// --no-replace-objects: `git replace` cannot substitute the roster blob or tree.
function defaultGit(cwd, args) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', cwd, ...args], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
  })
  return { status: result.error ? null : result.status, stdout: result.stdout ?? '' }
}

// The repository that holds targetDir: { commonDir, root } or null outside a git checkout.
// commonDir is the shared git directory every worktree reads (a bare repository in a bare layout);
// root names the project for the overlay path (the main worktree, or the bare repository).
export function repositoryOf(targetDir, git = defaultGit) {
  const inside = git(targetDir, ['rev-parse', '--is-inside-work-tree'])
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') return null
  const common = git(targetDir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (common.status !== 0 || !common.stdout.trim()) return null
  const commonDir = common.stdout.trim()
  return { commonDir, root: basename(commonDir) === '.git' ? dirname(commonDir) : commonDir }
}

// Kept for callers that only need the project root.
export function primaryCheckout(targetDir, git = defaultGit) {
  return repositoryOf(targetDir, git)?.root ?? null
}

const CONFIG_FILE = 'agent-workflow.config.json'
// The refs whose committed configuration names the integration branch: the remote default branch,
// then the shared git directory's own HEAD (the main worktree, or the bare repository). Never the
// target worktree, which a seat may edit or commit to.
const CONFIG_REFS = ['refs/remotes/origin/HEAD', 'HEAD']
const BRANCH_NAME = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/

function resolveCommit(targetDir, repository, ref, git) {
  if (ref.startsWith('-')) return null
  const resolved = git(targetDir, [
    `--git-dir=${repository.commonDir}`,
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^{commit}`,
  ])
  const commit = resolved.stdout.trim()
  return resolved.status === 0 && /^[0-9a-f]{40,64}$/.test(commit) ? commit : null
}

// The branching strategy from the protected configuration (see CONFIG_REFS); defaults when none.
function protectedBranching(targetDir, repository, git) {
  for (const ref of CONFIG_REFS) {
    const commit = resolveCommit(targetDir, repository, ref, git)
    if (!commit) continue
    const shown = git(targetDir, [
      `--git-dir=${repository.commonDir}`,
      'show',
      `${commit}:${CONFIG_FILE}`,
    ])
    if (shown.status !== 0) return resolveBranchStrategy({})
    try {
      return resolveBranchStrategy(JSON.parse(shown.stdout))
    } catch {
      return resolveBranchStrategy({})
    }
  }
  return resolveBranchStrategy({})
}

function checkedOutBranch(targetDir, git) {
  const head = git(targetDir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return head.status === 0 ? head.stdout.trim() : null
}

// Whether the target worktree's own HEAD tree holds a roster path (any case variant).
function headHoldsRoster(targetDir, git) {
  const listed = git(targetDir, ['ls-tree', '-r', '--name-only', '--full-tree', 'HEAD'])
  if (listed.status !== 0) return false
  return listed.stdout.split('\n').some((path) => fold(path) === fold(TEAM_ROSTER_PATH))
}

// The protected ref the roster is read from: { ref, commit } | null.
// - An explicit ref (from the person's own process, never from a seat) must resolve, else throws.
// - Otherwise origin/<integration branch>, else the local integration branch unless it is checked
//   out in the target worktree (whose commits would move it). The integration branch comes from
//   the protected configuration and may not look like a work branch.
// - With no resolvable ref the project has no roster (single-person path), unless the target's
//   HEAD holds a roster file: then the roster exists but cannot be read safely, so this throws.
export function rosterRef(targetDir, repository, { ref = null, git = defaultGit } = {}) {
  if (ref) {
    const commit = resolveCommit(targetDir, repository, ref, git)
    if (commit) return { ref, commit }
    throw new TeamRosterError(`cannot resolve the roster ref (${ref}); refusing to read the roster`)
  }
  const branching = protectedBranching(targetDir, repository, git)
  const branch = branching.integration || 'development'
  const prefixes = [
    ...new Set([
      ...DEFAULT_BRANCH_STRATEGY.workBranchPrefixes,
      ...DEFAULT_BRANCH_STRATEGY.compatibilityBranchPrefixes,
      ...(branching.workBranchPrefixes ?? []),
      ...(branching.compatibilityBranchPrefixes ?? []),
    ]),
  ]
  if (!BRANCH_NAME.test(branch) || prefixes.some((prefix) => branch.startsWith(prefix))) {
    throw new TeamRosterError(
      `the integration branch ${JSON.stringify(branch)} looks like a work branch; refusing to read the roster from it`,
    )
  }
  const candidates = [`refs/remotes/origin/${branch}`]
  if (checkedOutBranch(targetDir, git) !== branch) candidates.push(`refs/heads/${branch}`)
  for (const candidate of candidates) {
    const commit = resolveCommit(targetDir, repository, candidate, git)
    if (commit) return { ref: candidate, commit }
  }
  if (headHoldsRoster(targetDir, git)) {
    throw new TeamRosterError(
      `cannot resolve the roster ref (${candidates.join(' or ')}) but HEAD holds a roster; refusing to read it`,
    )
  }
  return null
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

// The committed roster blob at a resolved commit: { text } | null. Refuses a symlink entry and
// any case variant of the roster path in the tree, so a differently cased file cannot stand in.
function committedRoster(targetDir, repository, { ref, commit }, git) {
  const gitDir = `--git-dir=${repository.commonDir}`
  const listed = git(targetDir, [gitDir, 'ls-tree', '-r', '--full-tree', commit])
  if (listed.status !== 0) throw new TeamRosterError(`cannot list ${ref}`)
  let entry = null
  for (const line of listed.stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const path = line.slice(tab + 1)
    if (fold(path) !== fold(TEAM_ROSTER_PATH)) continue
    if (path !== TEAM_ROSTER_PATH)
      throw new TeamRosterError(
        `${ref} holds a case variant of ${TEAM_ROSTER_PATH}; refusing to read the roster`,
      )
    entry = line.slice(0, tab).split(' ')
  }
  if (!entry) return null
  if (entry[0] !== '100644' && entry[0] !== '100755')
    throw new TeamRosterError(`${TEAM_ROSTER_PATH} in ${ref} is not a regular file; refusing it`)
  const shown = git(targetDir, [gitDir, 'show', `${commit}:${TEAM_ROSTER_PATH}`])
  if (shown.status !== 0) throw new TeamRosterError(`cannot read ${TEAM_ROSTER_PATH} at ${ref}`)
  return { text: shown.stdout }
}

// null when targetDir is not in a git checkout, or the protected ref has no roster: every caller
// then keeps today's single-person path. Otherwise { roster, overlay, ref, commit, root,
// overlayPath }. The roster comes from the protected ref (rosterRef), read through the shared git
// directory, so neither the working tree nor a commit on a seat's own branch changes it.
// options: ref (explicit protected ref), overlay (false skips reading it), validateOverlay (default
// true: an invalid overlay throws, so no gate is delivered to an unchecked address), env,
// overlayPath, home, git.
export function loadTeamRoster(
  targetDir,
  {
    ref = null,
    overlay: readOverlay = true,
    validateOverlay = true,
    env = process.env,
    overlayPath = null,
    home,
    git = defaultGit,
  } = {},
) {
  const repository = repositoryOf(targetDir, git)
  if (!repository) return null
  const resolved = rosterRef(targetDir, repository, { ref, git })
  if (!resolved) return null
  const committed = committedRoster(targetDir, repository, resolved, git)
  if (!committed) return null
  const roster = parseJson(committed.text, `${TEAM_ROSTER_PATH} at ${resolved.ref}`)
  const path = overlayPathFor(repository.root, { env, overlayPath, home })
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
  return {
    roster,
    overlay,
    ref: resolved.ref,
    commit: resolved.commit,
    root: repository.root,
    overlayPath: path,
  }
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
