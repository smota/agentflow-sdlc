import { WORK_KINDS } from './work-altitude.mjs'

// One projection for a work record on GitHub. The body marker is the kind. The title prefix and
// the kind label must name that same kind. `Part of #n` is the only parent. `**Epic:**` may repeat
// that number and must not name another. A record with no kind is legacy and must not wear this
// projection.
//
// A not-yet-admitted part is a breakdown note: the capability title, the kind:capability label, one
// `Part of`, and no work marker. An admitted capability may name the one note it replaces with a
// `Replaces #<note>` line. That line is the only replacement authority. It sets no parent, and the
// note is never edited. A goal's current parts are its admitted records plus the notes nothing
// replaces.

const MARKER = /^<!-- agentflow-work:(\{.*\}) -->$/m
const KIND_LINE = /^\*\*Kind:\*\*\s*(\S+)\s*$/m
// A whole line, so prose that mentions a parent is not a claim.
const PART_OF = /^Part of #(\d+)[ \t]*$/gim
const EPIC = /\*\*Epic:\*\*\s*#(\d+)\b/g
// A whole line, so prose that mentions a replaced issue is not a claim.
const REPLACES = /^Replaces #(\d+)[ \t]*$/gim

export function kindLabel(kind) {
  return `kind:${kind}`
}

export function projectedTitle(kind, title) {
  const text = String(title ?? '').trim()
  const own = `${kind}:`
  if (text === own || text.startsWith(`${own} `)) return text
  const other = WORK_KINDS.find((item) => text === `${item}:` || text.startsWith(`${item}: `))
  if (other) throw new Error(`The title says ${other}, not ${kind}`)
  return `${own} ${text}`
}

function unique(values) {
  return [...new Set(values)]
}

export function parseWorkMarker(body = '') {
  const match = String(body).match(MARKER)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    return { kind: parsed.kind ?? null }
  } catch {
    return { kind: null, malformed: true }
  }
}

function proseKind(body = '') {
  return String(body).match(KIND_LINE)?.[1] ?? null
}

function parentNumbers(body = '') {
  return unique([...String(body).matchAll(PART_OF)].map((match) => match[1]))
}

function epicNumbers(body = '') {
  return unique([...String(body).matchAll(EPIC)].map((match) => match[1]))
}

function replacedNumbers(body = '') {
  return unique([...String(body).matchAll(REPLACES)].map((match) => match[1]))
}

// The body without its replacement line and the line breaks that set it apart. A replacement does
// not move what a person agreed. Every other byte is kept, so no existing subject moves.
const REPLACES_BLOCK = /(?:\r?\n)*^Replaces #\d+[ \t]*$/gim

export function withoutReplaces(body = '') {
  return String(body).replace(REPLACES_BLOCK, '')
}

function labelNames(labels = []) {
  return labels.map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean)
}

function kindLabels(labels = []) {
  return labelNames(labels).filter((label) => WORK_KINDS.some((kind) => label === kindLabel(kind)))
}

function titleKind(title = '') {
  return WORK_KINDS.find((kind) => title === `${kind}:` || String(title).startsWith(`${kind}: `))
}

// What a record is: a goal, a capability, a spec, a not-yet-admitted note, or legacy.
export function workShape({ title = '', body = '', labels = [] } = {}) {
  const marker = parseWorkMarker(body)
  if (marker) return WORK_KINDS.includes(marker.kind) ? marker.kind : 'invalid'
  const named = proseKind(body)
  const worn = kindLabels(labels)
  if (
    (named === null || named === 'capability') &&
    titleKind(title) === 'capability' &&
    worn.length === 1 &&
    worn[0] === kindLabel('capability')
  )
    return 'note'
  return named ? 'invalid' : 'legacy'
}

function parentFindings(body, kind, requirePartOf) {
  const parents = parentNumbers(body)
  const epics = epicNumbers(body)
  if (kind === 'goal') {
    return parents.length || epics.length ? ['a goal has no parent'] : []
  }
  if (parents.length > 1 || (requirePartOf && parents.length !== 1)) {
    return kind === 'note'
      ? ['a not-yet-admitted part needs one Part of #<parent>']
      : ['a capability or a spec needs one Part of #<parent>']
  }
  if (epics.length && parents.length !== 1) {
    return ['**Epic:** cannot name a parent without Part of #']
  }
  if (parents.length === 1 && epics.some((number) => number !== parents[0])) {
    return [`**Epic:** must repeat Part of #${parents[0]} and no other parent`]
  }
  return []
}

// Findings for one issue. An empty list means the projection agrees, or the issue is legacy.
// `number`, when known, lets a record that replaces itself be refused without the record set.
export function workProjectionFindings(
  { number = null, title = '', body = '', labels = [] } = {},
  options = {},
) {
  const requirePartOf = options.requirePartOf !== false
  const findings = []
  const marker = parseWorkMarker(body)
  const named = proseKind(body)
  const worn = kindLabels(labels)
  const replaces = replacedNumbers(body)

  if (!marker && workShape({ title, body, labels }) === 'note') {
    findings.push(...parentFindings(body, 'note', true))
    if (replaces.length) findings.push('only an admitted capability can name Replaces #<note>')
    return findings
  }
  if (!marker && !named) {
    const legacyTitle = titleKind(title)
    if (legacyTitle)
      findings.push(`a record with no kind cannot use the title prefix ${legacyTitle}:`)
    if (worn.length) findings.push(`a record with no kind cannot wear ${worn.join(', ')}`)
    if (replaces.length) findings.push('only an admitted capability can name Replaces #<note>')
    return findings
  }
  if (marker?.malformed) findings.push('the work marker is not valid JSON')
  if (!marker) findings.push('the body names a kind but has no work marker')
  const kind = marker?.kind ?? null
  if (marker && !WORK_KINDS.includes(kind))
    findings.push(`the work marker kind is ${kind ?? 'missing'}`)
  if (named && kind && named !== kind) findings.push(`**Kind:** says ${named}, not ${kind}`)
  if (!WORK_KINDS.includes(kind)) return findings

  if (titleKind(title) !== kind) {
    findings.push(`the title must start with ${kind}:`)
  }
  const expected = kindLabel(kind)
  if (!worn.includes(expected) || worn.length !== 1) {
    findings.push(`the issue must wear ${expected} and no other kind label`)
  }
  findings.push(...parentFindings(body, kind, requirePartOf))

  if (replaces.length && kind !== 'capability') {
    findings.push(`a ${kind} cannot replace a record; only an admitted capability can`)
  } else if (replaces.length > 1) {
    findings.push('a capability replaces at most one note')
  } else if (replaces.length && number !== null && replaces[0] === String(number)) {
    findings.push('a record cannot replace itself')
  }
  return findings
}

const NOT_A_NOTE = {
  goal: 'a goal',
  spec: 'a spec',
  capability: 'an admitted capability',
}

// Which note each admitted capability replaces, over one set of records. Each record carries its
// issue number. The lower number keeps a contested note, so the result does not depend on the
// order a medium lists its records in.
function resolveReplacements(records = []) {
  const byNumber = new Map()
  for (const record of records) {
    if (record?.number !== undefined && record?.number !== null)
      byNumber.set(String(record.number), record)
  }
  const replacers = [...byNumber.entries()]
    .filter(([, record]) => workShape(record) === 'capability')
    .map(([number, record]) => ({ number, record, replaces: replacedNumbers(record.body) }))
    .filter((item) => item.replaces.length)
    .sort((a, b) => Number(a.number) - Number(b.number))

  const replacedBy = new Map()
  const findings = []
  const refuse = (number, message) => findings.push({ number: Number(number), message })
  for (const { number, record, replaces } of replacers) {
    if (replaces.length > 1) {
      refuse(number, 'a capability replaces at most one note')
      continue
    }
    const [note] = replaces
    if (note === number) {
      refuse(number, 'a record cannot replace itself')
      continue
    }
    const target = byNumber.get(note)
    if (!target) {
      refuse(number, `Replaces #${note}, which is not in the record set`)
      continue
    }
    const shape = workShape(target)
    if (shape !== 'note') {
      refuse(number, `cannot replace #${note}, ${NOT_A_NOTE[shape] ?? 'which is not a part'}`)
      continue
    }
    const [own] = parentNumbers(record.body)
    const [theirs] = parentNumbers(target.body)
    if (own !== theirs) {
      refuse(number, `cannot replace #${note}, which is part of #${theirs}, not #${own}`)
      continue
    }
    if (replacedBy.has(note)) {
      refuse(number, `#${note} is already replaced by #${replacedBy.get(note)}`)
      continue
    }
    replacedBy.set(note, number)
  }
  return { byNumber, replacedBy, findings }
}

// Findings for a set of records: a double, cross-parent, or invalid replacement. Each finding
// names the record that makes the claim.
export function replacementFindings(records) {
  return resolveReplacements(records).findings
}

// The record that replaces a note, or null. The note itself is read unchanged.
export function replacementOf(records, number) {
  const by = resolveReplacements(records).replacedBy.get(String(number))
  return by ? Number(by) : null
}

// The current parts of a parent: each admitted child once, and each note nothing replaces, marked
// as not yet admitted. A replaced note is listed under `replaced` with its replacement.
export function currentParts(records, parent) {
  const { byNumber, replacedBy } = resolveReplacements(records)
  const current = []
  const replaced = []
  for (const [number, record] of byNumber) {
    const parents = parentNumbers(record.body)
    if (parents.length !== 1 || parents[0] !== String(parent)) continue
    const shape = workShape(record)
    if (shape === 'note' && replacedBy.has(number)) {
      replaced.push({ number: Number(number), by: Number(replacedBy.get(number)) })
    } else if (shape === 'note' || shape === 'capability' || shape === 'spec') {
      current.push({
        number: Number(number),
        title: record.title,
        kind: shape === 'note' ? 'capability' : shape,
        admitted: shape !== 'note',
      })
    }
  }
  const byOrder = (a, b) => a.number - b.number
  return { current: current.sort(byOrder), replaced: replaced.sort(byOrder) }
}

export function assertWorkProjection(issue, options) {
  const findings = workProjectionFindings(issue, options)
  if (findings.length) throw new Error(findings.join('; '))
}
