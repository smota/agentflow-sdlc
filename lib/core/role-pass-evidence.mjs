// Role-pass evidence comment (#580): the existing transition comment format (see
// lib/sources/github-medium.mjs parseTransition) plus provenance header lines. The writer is the
// source-provided identity of the comment (its author), never a line inside it.
import { createHash } from 'node:crypto'

const MARKER = /^<!-- agentflow-transition:(\S+) -->\r?(?:\n|$)/
const KEY = /^rp-[0-9a-f]{24}$/
const PROVENANCE = [
  'executedBy',
  'launcher',
  'executor',
  'transport',
  'delegationBoundary',
  'model',
]
const REQUIRED_TOKENS = ['role', 'status', 'seat']

export function rolePassIdempotencyKey({ stableId, phase, status, attempt = 1 }) {
  if (!stableId || !Number.isInteger(phase) || !status) {
    throw new Error('rolePassIdempotencyKey requires stableId, phase and status')
  }
  const hash = createHash('sha256')
    .update(JSON.stringify({ stableId, phase, status, attempt }))
    .digest('hex')
  return `rp-${hash.slice(0, 24)}`
}

function headerValue(name, value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[\r\n]/.test(text)) throw new Error(`${name} must be a single line`)
  return text.trim()
}

export function formatRolePassComment(record) {
  if (!KEY.test(record?.idempotencyKey ?? '')) {
    throw new Error('idempotencyKey must be rp- followed by 24 hex characters')
  }
  if (!Number.isInteger(record.phase) || record.phase < 0) {
    throw new Error('phase must be a non-negative integer')
  }
  for (const name of REQUIRED_TOKENS) {
    if (!/^\S+$/.test(record[name] ?? '')) throw new Error(`${name} must be a single token`)
  }
  const verified = record.seatVerified === true
  const lines = [
    `<!-- agentflow-transition:${record.idempotencyKey} -->`,
    `phase: ${record.phase}`,
    `role: ${record.role}`,
    `status: ${record.status}`,
    `seat: ${record.seat}`,
    `seatVerified: ${verified}`,
    `seatRig: ${verified ? headerValue('seatRig', record.seatRig) : ''}`,
    `reason: ${headerValue('reason', record.reason)}`,
    ...PROVENANCE.map((name) => `${name}: ${headerValue(name, record[name])}`),
    'body:',
    record.body ?? '',
  ]
  return lines.map((line) => line.replace(/[ \t]+$/, '')).join('\n')
}

// Header fields are read only above the body: line, so a body line cannot forge provenance.
export function parseRolePassComment(body, { writer = null, uri = null } = {}) {
  if (typeof body !== 'string') return null
  const match = body.match(MARKER)
  if (!match) return null
  const split = body.search(/^body:/m)
  const header = split === -1 ? body : body.slice(0, split)
  const field = (name) => {
    const value = header.match(new RegExp(`^${name}:[ \\t]*(.*?)[ \\t]*\\r?$`, 'm'))?.[1]
    return value ? value : null
  }
  const verified = field('seatVerified')
  const seatVerified = verified === 'true' ? true : verified === 'false' ? false : null
  const record = {
    idempotencyKey: match[1],
    phase: Number(field('phase')),
    role: field('role'),
    status: field('status'),
    seat: field('seat'),
    seatVerified,
    seatRig: seatVerified ? field('seatRig') : null,
    reason: field('reason'),
  }
  for (const name of PROVENANCE) record[name] = field(name)
  const text = split === -1 ? '' : body.slice(split).replace(/^body:[ \t]*\r?\n?/, '')
  return { version: 1, ...record, body: text.trim(), writer, uri }
}
