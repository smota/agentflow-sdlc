import { WORK_KINDS } from './work-altitude.mjs'

// One projection for a work record on GitHub. The body marker is the kind. The title prefix and
// the kind label must name that same kind. `Part of #n` is the only parent. `**Epic:**` may repeat
// that number and must not name another. A record with no kind is legacy and must not wear this
// projection.

const MARKER = /^<!-- agentflow-work:(\{.*\}) -->$/m
const KIND_LINE = /^\*\*Kind:\*\*\s*(\S+)\s*$/m
const PART_OF = /Part of #(\d+)\b/gi
const EPIC = /\*\*Epic:\*\*\s*#(\d+)\b/g

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

function kindLabels(labels = []) {
  return labels.filter((label) => WORK_KINDS.some((kind) => label === kindLabel(kind)))
}

// Findings for one issue. An empty list means the projection agrees, or the issue is legacy.
export function workProjectionFindings({ title = '', body = '', labels = [] } = {}, options = {}) {
  const requirePartOf = options.requirePartOf !== false
  const findings = []
  const marker = parseWorkMarker(body)
  const named = proseKind(body)
  const worn = kindLabels(labels)
  const legacyTitle = WORK_KINDS.find(
    (kind) => title === `${kind}:` || String(title).startsWith(`${kind}: `),
  )

  if (!marker && !named) {
    if (legacyTitle)
      findings.push(`a record with no kind cannot use the title prefix ${legacyTitle}:`)
    if (worn.length) findings.push(`a record with no kind cannot wear ${worn.join(', ')}`)
    return findings
  }
  if (marker?.malformed) findings.push('the work marker is not valid JSON')
  if (!marker) findings.push('the body names a kind but has no work marker')
  const kind = marker?.kind ?? null
  if (marker && !WORK_KINDS.includes(kind))
    findings.push(`the work marker kind is ${kind ?? 'missing'}`)
  if (named && kind && named !== kind) findings.push(`**Kind:** says ${named}, not ${kind}`)
  if (!WORK_KINDS.includes(kind)) return findings

  if (!(title === `${kind}:` || String(title).startsWith(`${kind}: `))) {
    findings.push(`the title must start with ${kind}:`)
  }
  const expected = kindLabel(kind)
  if (!worn.includes(expected) || worn.length !== 1) {
    findings.push(`the issue must wear ${expected} and no other kind label`)
  }

  const parents = parentNumbers(body)
  const epics = epicNumbers(body)
  if (kind === 'goal') {
    if (parents.length || epics.length) findings.push('a goal has no parent')
  } else if (parents.length > 1 || (requirePartOf && parents.length !== 1)) {
    findings.push('a capability or a spec needs one Part of #<parent>')
  } else if (epics.length && parents.length !== 1) {
    findings.push('**Epic:** cannot name a parent without Part of #')
  } else if (parents.length === 1 && epics.some((number) => number !== parents[0])) {
    findings.push(`**Epic:** must repeat Part of #${parents[0]} and no other parent`)
  }
  return findings
}

export function assertWorkProjection(issue, options) {
  const findings = workProjectionFindings(issue, options)
  if (findings.length) throw new Error(findings.join('; '))
}
