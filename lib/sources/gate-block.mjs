import { projectGates } from '../core/person-gates.mjs'

// The product-owned block on an issue body. It is rewritten from the gate log every time, and the
// log travels inside it so a later read gets the same records. Ordinary comments are never read
// as answers.
export const GATE_BLOCK_START = '<!-- agentflow-gates -->'
export const GATE_BLOCK_END = '<!-- /agentflow-gates -->'
const RECORD = /<!-- agentflow-gates-record:([A-Za-z0-9+/=]*) -->/

const BLOCK = new RegExp(`\\n*${escape(GATE_BLOCK_START)}[\\s\\S]*?${escape(GATE_BLOCK_END)}\\n*`)

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const short = (digest) => `\`${String(digest).slice(0, 12)}\``

function who(entry) {
  const person = entry.who.person ? `${entry.who.person}, ` : ''
  return `${person}${entry.who.role} role on the ${entry.who.platform} platform`
}

function answered(gate) {
  if (!gate.answer) return 'none yet'
  const findings = gate.answer.findings.length ? `: ${gate.answer.findings.join('; ')}` : ''
  return `${gate.answer.decision} by ${gate.answer.person} at ${gate.answer.at}${findings}`
}

export function renderGateBlock(log = [], { subjects = {} } = {}) {
  const view = projectGates(log, { subjects })
  const lines = [
    GATE_BLOCK_START,
    '### Person gates',
    '',
    '| Gate | Status | Who must answer | Subject | Answer |',
    '| ---- | ------ | --------------- | ------- | ------ |',
    ...view.gates.map(
      (gate) =>
        `| ${gate.gateClass} | ${gate.status} | ${who(gate)} | ${gate.subjectKind} ${short(gate.subjectDigest)} | ${answered(gate)} |`,
    ),
  ]
  if (view.onBehalf.length) {
    lines.push('', 'Agent actions on behalf of a person. None of them is the person’s answer:', '')
    for (const entry of view.onBehalf) {
      lines.push(
        `- ${entry.actor.platform} (${entry.actor.executor}) acted for ${entry.principal} under grant ${entry.grantRef}: ${entry.action} on ${entry.subjectKind} ${short(entry.subjectDigest)}`,
      )
    }
  }
  lines.push(
    '',
    'A person answers with `agentflow-sdlc gates answer`. An agent must not run it. This record is not proof of identity.',
    `<!-- agentflow-gates-record:${Buffer.from(JSON.stringify(log)).toString('base64')} -->`,
    GATE_BLOCK_END,
  )
  return lines.join('\n')
}

export function parseGateLog(body = '') {
  const block = String(body ?? '').match(BLOCK)?.[0]
  const encoded = block?.match(RECORD)?.[1]
  if (!encoded) return []
  const log = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  return Array.isArray(log) ? log : []
}

export function stripGateBlock(body = '') {
  return String(body ?? '')
    .replace(BLOCK, '\n')
    .trim()
}

export function withGateBlock(body = '', log = [], options = {}) {
  return [stripGateBlock(body), renderGateBlock(log, options)].filter(Boolean).join('\n\n')
}
