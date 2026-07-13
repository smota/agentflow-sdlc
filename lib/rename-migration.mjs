import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_FILES = [
  'agent-framework-lock.json',
  'AGENTS.md',
  'CLAUDE.md',
  'CODEX.md',
  'AGY.md',
  'README.md',
  'docs/assisted-onboarding.md',
  'docs/assisted-update.md',
  'docs/default-skills.md',
  '.github/workflows/integration-lifecycle.yml',
]

const REPLACEMENTS = [
  ['https://github.com/smota/multi-agent-sdlc', 'https://github.com/smota/agentflow-sdlc'],
  ['git@github.com:smota/multi-agent-sdlc.git', 'git@github.com:smota/agentflow-sdlc.git'],
  ['github.com:smota/multi-agent-sdlc.git', 'github.com:smota/agentflow-sdlc.git'],
  ['smota/multi-agent-sdlc', 'smota/agentflow-sdlc'],
  ['/path/to/multi-agent-sdlc', '/path/to/agentflow-sdlc'],
  ['multi-agent-sdlc', 'agentflow-sdlc'],
  ['Multi-Agent SDLC', 'AgentFlow SDLC'],
]

function migrateContent(content) {
  let next = content
  for (const [from, to] of REPLACEMENTS) next = next.split(from).join(to)
  return next
}

export function migrateRename(targetDir, { write = false } = {}) {
  const report = { mode: write ? 'write' : 'check', changed: [], unchanged: [], missing: [] }

  for (const relPath of DEFAULT_FILES) {
    const fullPath = join(targetDir, relPath)
    if (!existsSync(fullPath)) {
      report.missing.push(relPath)
      continue
    }

    const current = readFileSync(fullPath, 'utf8')
    const next = migrateContent(current)
    if (next === current) {
      report.unchanged.push(relPath)
      continue
    }

    report.changed.push(relPath)
    if (write) writeFileSync(fullPath, next)
  }

  return report
}
