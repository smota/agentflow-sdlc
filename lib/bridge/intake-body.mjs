// The intake row body, `agentflow-intake/v1` (#582): one key=value per line. It carries a source
// reference and derived ids only, never artifact content; every reader re-reads the source.
const HEADER = 'agentflow-intake/v1'
const FIELDS = [
  ['ref', 'ref'],
  ['stable_id', 'stableId'],
  ['slice', 'slice'],
  ['resume_phase', 'resumePhase'],
  ['tier', 'tier'],
  ['workflow', 'workflow'],
  // Added by the worktree wiring (#584b), OpenRig convention EC-3.
  ['worktree_path', 'worktreePath'],
]

export function formatIntakeBody(fields) {
  const lines = [HEADER]
  for (const [key, name] of FIELDS) {
    const value = fields[name]
    if (value === undefined || value === null || value === '') continue
    const text = String(value)
    if (/[\r\n]/.test(text)) throw new Error(`${key} must be a single line`)
    lines.push(`${key}=${text}`)
  }
  return `${lines.join('\n')}\n`
}

export function parseIntakeBody(body) {
  if (typeof body !== 'string') return null
  const lines = body.split(/\r?\n/)
  if (lines[0]?.trim() !== HEADER) return null
  const values = {}
  for (const line of lines.slice(1)) {
    const at = line.indexOf('=')
    if (at <= 0) continue
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  const result = {}
  for (const [key, name] of FIELDS) if (values[key] !== undefined) result[name] = values[key]
  if (!result.ref || !result.stableId) return null
  if (result.resumePhase !== undefined) result.resumePhase = Number(result.resumePhase)
  return result
}
