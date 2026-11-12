#!/usr/bin/env node
// Validates the team roster (#585): .agentflow/team-roster.json against its schema and rules, the
// local overlay against the roster, and that the overlay can never be committed (gitignored, not
// tracked). With no roster file the project uses the single-person path and this exits 0.
// Output names roster ids and JSON paths only, never an overlay value.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readBridgeSection } from '../lib/bridge/config.mjs'
import { botWritersFromBridge } from '../lib/roster/authority.mjs'
import {
  TEAM_ROSTER_OVERLAY_PATH,
  TEAM_ROSTER_PATH,
  TeamRosterError,
  loadTeamRoster,
  validateRosterOverlay,
  validateTeamRoster,
} from '../lib/roster/team-roster.mjs'

export const NO_ROSTER_MESSAGE = `No team roster (${TEAM_ROSTER_PATH}); gates use the single-person path.`

function defaultGit(targetDir, args) {
  const result = spawnSync('git', ['-C', targetDir, ...args], { encoding: 'utf8', shell: false })
  return { status: result.error ? null : result.status }
}

// Problems that would let the overlay reach a commit. Outside a git checkout there are none.
export function overlayExposure(targetDir, git = defaultGit) {
  const inside = git(targetDir, ['rev-parse', '--is-inside-work-tree'])
  if (inside.status !== 0) return []
  const problems = []
  if (git(targetDir, ['ls-files', '--error-unmatch', TEAM_ROSTER_OVERLAY_PATH]).status === 0) {
    problems.push(`${TEAM_ROSTER_OVERLAY_PATH} is tracked by git; remove it from the index`)
  } else if (git(targetDir, ['check-ignore', '-q', TEAM_ROSTER_OVERLAY_PATH]).status !== 0) {
    problems.push(`${TEAM_ROSTER_OVERLAY_PATH} is not gitignored; add it to .gitignore`)
  }
  return problems
}

function bridgeBotWriters(targetDir) {
  try {
    return botWritersFromBridge(readBridgeSection(targetDir))
  } catch {
    return []
  }
}

export function teamRosterReport(targetDir, { git = defaultGit } = {}) {
  let loaded
  try {
    loaded = loadTeamRoster(targetDir)
  } catch (error) {
    if (error instanceof TeamRosterError)
      return { ok: false, status: 'invalid', errors: [error.message] }
    throw error
  }
  if (!loaded) {
    const notes = existsSync(join(targetDir, TEAM_ROSTER_OVERLAY_PATH))
      ? [`${TEAM_ROSTER_OVERLAY_PATH} exists without a roster and is ignored`]
      : []
    return { ok: true, status: 'no-roster', message: NO_ROSTER_MESSAGE, errors: [], notes }
  }
  const errors = [
    ...validateTeamRoster(loaded.roster, { botWriters: bridgeBotWriters(targetDir) }).errors,
  ]
  if (loaded.overlay !== null) {
    errors.push(
      ...validateRosterOverlay(loaded.overlay, loaded.roster).errors.map((e) => `overlay: ${e}`),
    )
  }
  errors.push(...overlayExposure(targetDir, git))
  const people = Array.isArray(loaded.roster?.people) ? loaded.roster.people : []
  const channels = Object.keys(loaded.overlay?.channels ?? {})
  const peopleIds = people.map((person) => person?.id).filter((id) => typeof id === 'string')
  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 'valid' : 'invalid',
    people: peopleIds,
    overlay: loaded.overlay === null ? 'absent' : 'present',
    // Who can be reached: roster ids with a channel, never the channel itself.
    reachable: peopleIds.filter((id) => channels.includes(id)),
    errors,
  }
}

export function renderReport(report) {
  if (report.status === 'no-roster')
    return [report.message, ...(report.notes ?? [])].join('\n') + '\n'
  const lines = [`team roster: ${report.status}`]
  if (report.people) lines.push(`  people: ${report.people.join(', ')}`)
  if (report.overlay)
    lines.push(
      `  overlay: ${report.overlay}; reachable: ${report.reachable?.join(', ') || 'nobody'}`,
    )
  for (const error of report.errors) lines.push(`  error: ${error}`)
  return `${lines.join('\n')}\n`
}

function flag(argv, name) {
  const index = argv.indexOf(name)
  return index === -1 ? null : (argv[index + 1] ?? '')
}

export function main(
  argv = process.argv.slice(2),
  { stdout = process.stdout, cwd = process.cwd(), git } = {},
) {
  const target = resolve(cwd, flag(argv, '--target') ?? '.')
  const report = teamRosterReport(target, git ? { git } : {})
  stdout.write(
    argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report),
  )
  return report.ok ? 0 : 1
}

if (process.argv[1]?.endsWith('validate-team-roster.mjs')) {
  process.exitCode = main()
}
