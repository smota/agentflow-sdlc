// Gate router (#585): which roster person a gate goes to, who gets it after the timeout, and the
// delivery itself through an injected notifier. Pure functions over the roster; the clock and the
// load (open gates per person, derived from the source by the caller) are inputs.
//
// A person matches a gate when one of their scopes names the gate type and the tier, and every
// gate path is matched by a path glob of such a scope. A scope without paths covers every path; a
// gate without paths is covered only by such an unrestricted scope. The same rule decides
// authority (authority.mjs), so a gate is never delivered to someone who could not answer it.
//
// Results name roster ids only. The channel address is read from the overlay at the moment of
// delivery, handed to the notifier, and never returned, logged or written anywhere else.
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import {
  GATE_TYPES,
  TIERS,
  capacityFor,
  overlayValues,
  personById,
  timeoutMinutesFor,
} from './team-roster.mjs'

const GLOB_CACHE = new Map()

function globRegex(pattern) {
  if (GLOB_CACHE.has(pattern)) return GLOB_CACHE.get(pattern)
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') {
      const atStart = index === 0 || pattern[index - 1] === '/'
      if (pattern[index + 2] === '/' && atStart) {
        source += '(?:.*/)?'
        index += 2
      } else if (index + 2 === pattern.length && index > 0 && pattern[index - 1] === '/') {
        source = `${source.slice(0, -1)}(?:/.*)?`
        index += 1
      } else {
        source += '.*'
        index += 1
      }
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  const regex = new RegExp(`^${source}$`)
  GLOB_CACHE.set(pattern, regex)
  return regex
}

// A repository-relative path; null when it is absolute or leaves the repository.
function normalizePath(path) {
  if (typeof path !== 'string' || !path) return null
  const normalized = posix.normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '')
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) return null
  return normalized
}

export function globMatches(pattern, path) {
  if (typeof path !== 'string' || path.split(/[\\/]/).includes('..')) return false
  const normalized = normalizePath(path)
  return normalized !== null && globRegex(pattern).test(normalized)
}

function gateProblems(gate) {
  const problems = []
  if (typeof gate?.id !== 'string' || !gate.id.trim()) problems.push('gate.id is required')
  if (!GATE_TYPES.includes(gate?.type))
    problems.push(`gate.type must be one of ${GATE_TYPES.join(', ')}`)
  if (!TIERS.includes(gate?.tier)) problems.push(`gate.tier must be one of ${TIERS.join(', ')}`)
  if (
    gate?.paths !== undefined &&
    (!Array.isArray(gate.paths) || gate.paths.some((p) => typeof p !== 'string'))
  )
    problems.push('gate.paths must be an array of strings')
  return problems
}

export function requireGate(gate) {
  const problems = gateProblems(gate)
  if (problems.length) throw new TypeError(`invalid gate: ${problems.join('; ')}`)
  return { ...gate, paths: gate.paths ?? [] }
}

// Whether the person's scopes cover a gate of this type, tier and paths (see the module comment).
export function scopeCovers(person, { type, tier, paths = [] }) {
  const scopes = (person?.scopes ?? []).filter(
    (scope) => scope?.gates?.includes(type) && scope?.tiers?.includes(tier),
  )
  if (scopes.length === 0) return false
  if (scopes.some((scope) => !Array.isArray(scope.paths))) return true
  if (paths.length === 0) return false
  const globs = scopes.flatMap((scope) => scope.paths)
  return paths.every((path) => globs.some((glob) => globMatches(glob, path)))
}

function chooseBackup(roster, gate, primary, exclude, load) {
  const covering = (person) =>
    person && person.id !== primary.id && !exclude.includes(person.id) && scopeCovers(person, gate)
  const declared = personById(roster, primary.backup)
  if (covering(declared)) return declared.id
  const others = (roster.people ?? []).filter(covering)
  const withRoom = others.find((person) => (load[person.id] ?? 0) < capacityFor(person))
  return (withRoom ?? others[0])?.id ?? null
}

// → { status: 'routed', gateId, primary, backup, escalateAt, considered }
//   | { status: 'no-capacity', gateId, matching, considered } | { status: 'no-match', gateId, considered }
export function routeGate({ gate, roster, load = {}, now = new Date(), exclude = [] }) {
  const checked = requireGate(gate)
  const considered = []
  let primary = null
  const matching = []
  for (const person of roster?.people ?? []) {
    if (exclude.includes(person.id)) {
      considered.push({ personId: person.id, outcome: 'excluded' })
      continue
    }
    if (!scopeCovers(person, checked)) {
      considered.push({ personId: person.id, outcome: 'out-of-scope' })
      continue
    }
    matching.push(person.id)
    if (primary) {
      considered.push({ personId: person.id, outcome: 'matches' })
    } else if ((load[person.id] ?? 0) >= capacityFor(person)) {
      considered.push({ personId: person.id, outcome: 'at-capacity' })
    } else {
      primary = person
      considered.push({ personId: person.id, outcome: 'primary' })
    }
  }
  if (!primary) {
    return matching.length
      ? { status: 'no-capacity', gateId: checked.id, matching, considered }
      : { status: 'no-match', gateId: checked.id, considered }
  }
  const escalateAt = new Date(new Date(now).getTime() + timeoutMinutesFor(primary) * 60_000)
  return {
    status: 'routed',
    gateId: checked.id,
    type: checked.type,
    tier: checked.tier,
    primary: primary.id,
    backup: chooseBackup(roster, checked, primary, exclude, load),
    escalateAt: escalateAt.toISOString(),
    considered,
  }
}

// Who the gate goes to now: the primary until escalateAt, then the backup; nobody once a decision
// is recorded in the source (the caller derives `decided` from the source, never from the queue).
export function nextRecipient({ routing, now = new Date(), decided = false }) {
  if (decided || routing?.status !== 'routed') return null
  return new Date(now).getTime() < Date.parse(routing.escalateAt) ? routing.primary : routing.backup
}

// With no roster file, a gate keeps today's single-person path: `singlePerson()` is
// resolveHumanDestination over `rig gateway participants --json`, injected by the caller.
export function routeGateOrSinglePerson({ team, gate, load, now, exclude, singlePerson }) {
  if (!team?.roster) return { status: 'single-person', destination: singlePerson() }
  return routeGate({ gate, roster: team.roster, load, now, exclude })
}

function carriesAny(text, secrets) {
  return typeof text === 'string' && secrets.some((secret) => text.includes(secret))
}

// notifier.deliver({ address, personId, gateId, summary, evidenceRef, wakeAfterMinutes }).
// Returns { delivered: personId, gateId } — never the address or the notifier's own result.
export async function deliverGate({
  routing,
  personId,
  roster,
  overlay,
  notifier,
  summary,
  evidenceRef,
}) {
  if (
    routing?.status !== 'routed' ||
    ![routing.primary, routing.backup].includes(personId) ||
    !personId
  ) {
    throw new Error(`person ${personId ?? '(none)'} is not routed for this gate`)
  }
  const person = personById(roster, personId)
  if (!person) throw new Error(`person ${personId} is not on the roster`)
  if (
    carriesAny(summary, overlayValues(overlay)) ||
    carriesAny(evidenceRef, overlayValues(overlay))
  ) {
    throw new Error(
      'the summary or evidence reference carries a private address; refusing to deliver',
    )
  }
  const address = overlay?.channels?.[personId]?.openrig
  if (typeof address !== 'string' || !address) {
    return { delivered: null, personId, gateId: routing.gateId, reason: 'no-channel' }
  }
  await notifier.deliver({
    address,
    personId,
    gateId: routing.gateId,
    summary,
    evidenceRef: evidenceRef ?? null,
    wakeAfterMinutes: timeoutMinutesFor(person),
  })
  return { delivered: personId, gateId: routing.gateId }
}

const oneLine = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()

export function gateDigest(gateId) {
  return createHash('sha256').update(String(gateId)).digest('hex').slice(0, 12)
}

// Notifier over the OpenRig queue: one row per gate and person (a repeat is a re-delivery), parked
// with --wake-after so the timeout is a rig timer, not a poll. The address is only the row's
// destination; the id, tags, summary and body carry gate digests and roster ids.
export function createQueueNotifier({ queue, source }) {
  if (!queue || typeof source !== 'string' || !source) {
    throw new Error('createQueueNotifier requires a queue port and a source session')
  }
  return {
    async deliver({ address, personId, gateId, summary, evidenceRef, wakeAfterMinutes }) {
      const digest = gateDigest(gateId)
      const id = `af-gate-${digest}-${personId}`
      const created = await queue.create({
        id,
        destination: address,
        source,
        summary: oneLine(summary),
        body: `agentflow-gate/v1\ngate=${oneLine(gateId)}\nperson=${personId}\n`,
        tags: [`af-gate:${digest}`],
        humanIntent: 'decision',
        ...(evidenceRef ? { evidenceRef } : {}),
      })
      if (created.created) {
        await queue.block(id, { on: `external:gate:${digest}`, wakeAfter: `${wakeAfterMinutes}m` })
      }
      return { qitemId: created.qitemId, created: created.created }
    },
  }
}
