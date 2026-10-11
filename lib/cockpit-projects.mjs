import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXECUTION_LAYERS } from './cockpit-actions.mjs'
import { recordDigest } from './core/record-digest.mjs'

// Project metadata (#417). The cockpit keeps one record per project, in its own data directory, so
// a project is supervised with no checkout. A record names the source adapter, the repository, and
// the execution layer (OpenRig or none). With OpenRig it may name the PM and DEV coordinators, and
// nothing else: no squad, no seat directory, no other seat. Execution control reads this record.
//
// Adding a project is preview first. Discovery reads the repository through its source adapter and
// writes nothing. Only the person's confirmation of that exact preview writes the record, and
// cancelling writes nothing.

export const PROJECT_RECORD_VERSION = 1

// GitHub is the only source adapter that works. A record may name another one, and that project
// alone shows as unsupported.
export const WORKING_SOURCE_ADAPTERS = Object.freeze(['github'])

export const COORDINATOR_ROLES = Object.freeze(['pm', 'dev'])

const INPUT_FIELDS = new Set(['sourceAdapter', 'repository', 'executionLayer', 'coordinators'])
const RECORD_FIELDS = new Set(['version', ...INPUT_FIELDS])
const ADAPTER = /^[a-z][a-z0-9-]{0,39}$/
// owner/name as GitHub spells them. A name of `.` or `..` is refused, since the repository is
// placed in source paths.
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/
// A coordinator is a session address, one word with no `<`, as the execution layer names it.
const COORDINATOR = /^[^\s<>]{1,200}$/u

function blank(value) {
  return value === undefined || value === null || value === ''
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The one record a project stores, from what the person entered. Anything the record does not
 * hold, such as a squad or another seat, is refused rather than dropped, so it is never stored.
 */
export function projectRecord(input = {}) {
  if (!plainObject(input)) throw new Error('A project record is an object')
  const extra = Object.keys(input).filter((key) => !RECORD_FIELDS.has(key))
  if (extra.length) {
    throw new Error(`A project record holds no ${extra.join(', ')}. It stores no squad or seat.`)
  }
  if (!blank(input.version) && input.version !== PROJECT_RECORD_VERSION) {
    throw new Error(`Unknown project record version ${input.version}`)
  }
  const sourceAdapter = blank(input.sourceAdapter) ? 'github' : input.sourceAdapter
  if (typeof sourceAdapter !== 'string' || !ADAPTER.test(sourceAdapter)) {
    throw new Error('Name the source adapter as one lowercase word')
  }
  const repository = typeof input.repository === 'string' ? input.repository.trim() : ''
  if (!REPOSITORY.test(repository)) throw new Error('Name the repository as owner/name')

  const layer = blank(input.executionLayer) || input.executionLayer === 'none'
  const executionLayer = layer ? null : input.executionLayer
  if (executionLayer !== null && !EXECUTION_LAYERS.includes(executionLayer)) {
    throw new Error(
      `${String(executionLayer)} is not an execution layer. The execution layer is openrig or none.`,
    )
  }

  const record = { version: PROJECT_RECORD_VERSION, sourceAdapter, repository, executionLayer }
  const given = plainObject(input.coordinators)
    ? Object.fromEntries(Object.entries(input.coordinators).filter(([, name]) => !blank(name)))
    : input.coordinators
  if (blank(given) || (plainObject(given) && !Object.keys(given).length)) return record
  if (!plainObject(given)) throw new Error('Coordinators are named as { pm, dev }')
  if (executionLayer === null) {
    throw new Error('A project with no execution layer names no coordinator')
  }
  const roles = Object.keys(given)
  const unknown = roles.filter((role) => !COORDINATOR_ROLES.includes(role))
  if (unknown.length) {
    throw new Error(`Only the PM and DEV coordinators are stored, not ${unknown.join(', ')}`)
  }
  for (const role of roles) {
    if (typeof given[role] !== 'string' || !COORDINATOR.test(given[role])) {
      throw new Error(`Name the ${role.toUpperCase()} coordinator as one session address`)
    }
  }
  record.coordinators = Object.fromEntries(
    COORDINATOR_ROLES.filter((role) => role in given).map((role) => [role, given[role]]),
  )
  return record
}

export function projectSupported(record) {
  return WORKING_SOURCE_ADAPTERS.includes(record?.sourceAdapter)
}

/**
 * The preview the person confirms. It reads the repository through its source adapter and writes
 * nothing. Its digest is what the person's confirmation must carry.
 */
export async function previewProject({ input, client } = {}) {
  const record = projectRecord(input)
  const preview = { record, digest: recordDigest(record), supported: projectSupported(record) }
  if (!preview.supported) {
    return { ...preview, discovered: null, unsupported: `${record.sourceAdapter} is not supported` }
  }
  const repo = await client.repo(record.repository)
  const issues = await client.issues(record.repository, { state: 'open', per_page: 50 })
  return {
    ...preview,
    discovered: {
      repository: repo?.full_name ?? record.repository,
      defaultBranch: repo?.default_branch ?? null,
      openItems: (Array.isArray(issues) ? issues : []).filter((issue) => !issue.pull_request)
        .length,
    },
  }
}

// The store lives in the cockpit's data directory: one file, one record per repository.
export function createProjectStore({ dir } = {}) {
  if (!dir) throw new Error('A project store needs the cockpit data directory')
  const path = join(dir, 'projects.json')

  // A file that cannot be read is never overwritten, so a confirmation cannot lose other projects.
  function readAll() {
    if (!existsSync(path)) return {}
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    if (!plainObject(stored?.projects)) throw new Error(`${path} holds no projects`)
    return stored.projects
  }

  // Reads fail closed: an unreadable file shows no project and turns nothing on.
  function readable() {
    try {
      return readAll()
    } catch {
      return {}
    }
  }

  // A stored record is checked again on every read. One that no longer validates, or that is filed
  // under another repository, is not used, so a hand edit that adds a squad or a wrong layer turns
  // nothing on.
  function valid(repository, record) {
    try {
      const checked = projectRecord(record)
      if (checked.repository !== repository) return null
      return recordDigest(checked) === recordDigest(record) ? checked : null
    } catch {
      return null
    }
  }

  return {
    path,
    list() {
      return Object.entries(readable())
        .map(([repository, record]) => valid(repository, record))
        .filter(Boolean)
    },
    get(repository) {
      const record = readable()[repository]
      return record ? valid(repository, record) : null
    },
    /** Writes the previewed record, and only when the confirmation carries its digest. */
    confirm({ record, digest } = {}) {
      const checked = projectRecord(record)
      if (!digest || digest !== recordDigest(checked)) {
        throw new Error('Confirm the preview you were shown. Nothing was written.')
      }
      const projects = { ...readAll(), [checked.repository]: checked }
      mkdirSync(dir, { recursive: true })
      const temp = `${path}.${process.pid}.tmp`
      writeFileSync(temp, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`)
      renameSync(temp, path)
      return checked
    },
  }
}

/** The workspaces the cockpit offers: configured repositories and stored projects it can read. */
export function workspaceRepositories({ configured = [], projects = [] } = {}) {
  const stored = projects.filter(projectSupported).map((record) => record.repository)
  return [...new Set([...configured, ...stored])]
}

/** The add-project form's fields as the record input. Blank coordinator fields name no one. */
export function projectInputFromForm(form = {}) {
  return {
    repository: form.repository,
    sourceAdapter: form.sourceAdapter,
    executionLayer: form.executionLayer,
    coordinators: { pm: form.pmCoordinator, dev: form.devCoordinator },
  }
}
