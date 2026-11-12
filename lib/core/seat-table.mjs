// The canonical seat table (manifests/seats.json). One name per OpenRig seat: `pod.member`.
// Every other seat list in the repository (rig specs, presets, path ownership, policy text,
// execution distributions, code constants) is checked against this table, never the other way round.
// Pure: reading manifests/seats.json lives in lib/seat-table-io.mjs (lib/core does no file I/O).
const SEAT_ID_RE = /^[a-z]+\.[a-z][a-z0-9-]*$/
const PLANES = ['product', 'delivery', 'eval', 'steer']
// A seat id written in backticks in policy prose, e.g. `dev.build`. `pm.*` and `dev.build*` do not match.
const POLICY_SEAT_RE = /`((?:pm|dev|orch|rev|eval|steer|arch)\.[a-z][a-z0-9-]*)`/g

/** Canonical id for a canonical id or alias; null when the name is not in the table. */
export function canonicalSeat(table, id) {
  if ((table?.seats ?? []).some((seat) => seat.id === id)) return id
  return (table?.aliases ?? []).find((alias) => alias.id === id)?.canonical ?? null
}

export function seatIds(table, { aliases = true } = {}) {
  const ids = (table?.seats ?? []).map((seat) => seat.id)
  if (aliases) ids.push(...(table?.aliases ?? []).map((alias) => alias.id))
  return ids
}

export function validateSeatTable(table) {
  const errors = []
  if (table?.version !== 1) errors.push('seat table version must be 1')
  if (!Array.isArray(table?.seats) || table.seats.length === 0) {
    errors.push('seat table seats must be a non-empty array')
    return { ok: false, errors }
  }
  const seen = new Set()
  for (const seat of table.seats) {
    const id = seat?.id
    if (typeof id !== 'string' || !SEAT_ID_RE.test(id)) {
      errors.push(`seat id is invalid: ${JSON.stringify(id)}`)
      continue
    }
    if (seen.has(id)) errors.push(`seat id is duplicated: ${id}`)
    seen.add(id)
    if (id !== `${seat.pod}.${seat.member}`) errors.push(`${id}: id must equal pod.member`)
    if (!Array.isArray(seat.roles) || seat.roles.length === 0)
      errors.push(`${id}: roles must be a non-empty array`)
    if (
      !Array.isArray(seat.phases) ||
      seat.phases.some((phase) => !Number.isInteger(phase) || phase < 0 || phase > 8)
    )
      errors.push(`${id}: phases must be an array of integers 0-8`)
    if (!PLANES.includes(seat.plane))
      errors.push(`${id}: plane must be one of ${PLANES.join(', ')}`)
    if (typeof seat.writes?.rule !== 'string' || !seat.writes.rule)
      errors.push(`${id}: writes.rule is required`)
    for (const key of ['allow', 'deny']) {
      if (seat.writes?.[key] !== undefined && !Array.isArray(seat.writes[key]))
        errors.push(`${id}: writes.${key} must be an array`)
    }
    if (seat.writes?.defaultDeny !== undefined && typeof seat.writes.defaultDeny !== 'boolean')
      errors.push(`${id}: writes.defaultDeny must be a boolean`)
  }
  const aliasSeen = new Set()
  for (const alias of table.aliases ?? []) {
    if (typeof alias?.id !== 'string' || !SEAT_ID_RE.test(alias.id)) {
      errors.push(`alias id is invalid: ${JSON.stringify(alias?.id)}`)
      continue
    }
    if (seen.has(alias.id)) errors.push(`alias ${alias.id} collides with a canonical seat`)
    if (aliasSeen.has(alias.id)) errors.push(`alias id is duplicated: ${alias.id}`)
    aliasSeen.add(alias.id)
    if (!seen.has(alias.canonical))
      errors.push(
        `alias ${alias.id} names a canonical seat that does not exist: ${alias.canonical}`,
      )
    if (alias.status !== 'legacy') errors.push(`alias ${alias.id}: status must be legacy`)
  }
  return { ok: errors.length === 0, errors }
}

function sameSet(left = [], right = []) {
  return (
    left.length === right.length && [...left].sort().join('\0') === [...right].sort().join('\0')
  )
}

function ruleCoversSeat(rule, seat) {
  return (
    rule.seats?.includes(seat) ||
    rule.seatPrefixes?.some((prefix) => seat.startsWith(prefix)) === true
  )
}

/**
 * AC 3 and 4: path-ownership.json is the enforcement manifest and is checked against the table.
 * Every seat (and alias) is covered by the rule its `writes.rule` names, with the same
 * allow/deny/defaultDeny; knownSeats and governance-files-guard.seats are canonical + alias ids.
 */
export function checkPathOwnershipAgainstTable(table, manifest) {
  const errors = []
  const everyId = seatIds(table)
  const rules = manifest?.rules ?? []
  const everyIdSet = new Set(everyId)

  if (!sameSet(manifest?.knownSeats ?? [], everyId))
    errors.push(
      `path-ownership knownSeats must equal the seat table ids: ${describeDiff(manifest?.knownSeats, everyId)}`,
    )
  const governance = rules.find((rule) => rule.id === 'governance-files-guard')
  if (!governance) errors.push('path-ownership rule is missing: governance-files-guard')
  else if (!sameSet(governance.seats ?? [], everyId))
    errors.push(
      `governance-files-guard seats must equal the seat table ids: ${describeDiff(governance.seats, everyId)}`,
    )

  const writeRuleIds = new Set((table?.seats ?? []).map((seat) => seat.writes?.rule))
  for (const seat of table?.seats ?? []) {
    const rule = rules.find((item) => item.id === seat.writes?.rule)
    if (!rule) {
      errors.push(`${seat.id}: no path-ownership rule ${seat.writes?.rule}`)
      continue
    }
    const names = [
      seat.id,
      ...(table.aliases ?? []).filter((a) => a.canonical === seat.id).map((a) => a.id),
    ]
    for (const name of names) {
      if (!ruleCoversSeat(rule, name))
        errors.push(`${name}: rule ${rule.id} does not name it in seats or seatPrefixes`)
    }
    if (!sameSet(rule.allow ?? [], seat.writes.allow ?? []))
      errors.push(`${seat.id}: rule ${rule.id} allow differs from the seat table`)
    if (!sameSet(rule.deny ?? [], seat.writes.deny ?? []))
      errors.push(`${seat.id}: rule ${rule.id} deny differs from the seat table`)
    if ((rule.defaultDeny ?? false) !== (seat.writes.defaultDeny ?? false))
      errors.push(`${seat.id}: rule ${rule.id} defaultDeny differs from the seat table`)
  }
  for (const rule of rules) {
    if (rule.id === 'governance-files-guard') continue
    if (!writeRuleIds.has(rule.id))
      errors.push(`path-ownership rule ${rule.id} is not used by any seat in the table`)
    for (const name of rule.seats ?? []) {
      if (!everyIdSet.has(name))
        errors.push(`rule ${rule.id} names a seat absent from the table: ${name}`)
      else {
        const canonical = canonicalSeat(table, name)
        const owner = table.seats.find((seat) => seat.id === canonical)
        if (owner.writes.rule !== rule.id)
          errors.push(`rule ${rule.id} names ${name} but the table assigns it ${owner.writes.rule}`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

function describeDiff(actual = [], expected = []) {
  const missing = expected.filter((id) => !actual.includes(id))
  const extra = actual.filter((id) => !expected.includes(id))
  return [
    missing.length ? `missing ${missing.join(', ')}` : '',
    extra.length ? `unexpected ${extra.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ')
}

/** Rig specs and configurations must use canonical ids only; aliases and unknown names fail. */
export function checkSeatKeys(table, keys, file, { allowAliases = false } = {}) {
  const errors = []
  for (const key of keys) {
    const canonical = canonicalSeat(table, key)
    if (canonical === null) errors.push(`${file}: seat ${key} is not in manifests/seats.json`)
    else if (canonical !== key && !allowAliases)
      errors.push(`${file}: seat ${key} is a legacy alias, use ${canonical}`)
  }
  return errors
}

/** Seat ids a rig spec provisions: pods[].members[] as `pod.member`. */
export function rigSpecSeats(rigDoc) {
  return (rigDoc?.pods ?? []).flatMap((pod) =>
    (pod?.members ?? []).map((member) => `${pod.id}.${member.id}`),
  )
}

/** Pods, members and edges of a rig spec: canonical seat ids only. */
export function checkRigSpecSeats(table, rigDoc, file) {
  const errors = checkSeatKeys(table, rigSpecSeats(rigDoc), file)
  for (const pod of rigDoc?.pods ?? []) {
    const members = new Set((pod?.members ?? []).map((member) => member.id))
    for (const edge of pod?.edges ?? []) {
      for (const end of [edge?.from, edge?.to]) {
        if (typeof end !== 'string') continue
        if (end.includes('.')) errors.push(...checkSeatKeys(table, [end], file))
        else if (!members.has(end))
          errors.push(
            `${file}: edge in pod ${pod.id} names unknown member ${end} (${pod.id}.${end})`,
          )
      }
    }
  }
  for (const edge of rigDoc?.edges ?? []) {
    for (const end of [edge?.from, edge?.to]) {
      const name = typeof end === 'string' ? end.split('@')[0] : null
      if (name?.includes('.')) errors.push(...checkSeatKeys(table, [name], file))
    }
  }
  return errors
}

/** Policy prose may name aliases (they are in the table) but never an unknown seat. */
export function checkPolicyTextSeats(table, text, file) {
  const errors = []
  const reported = new Set()
  for (const match of String(text).matchAll(POLICY_SEAT_RE)) {
    const name = match[1]
    if (canonicalSeat(table, name) !== null || reported.has(name)) continue
    reported.add(name)
    const line = String(text).slice(0, match.index).split(/\r?\n/).length
    errors.push(`${file}:${line}: seat ${name} is not in manifests/seats.json`)
  }
  return errors
}
