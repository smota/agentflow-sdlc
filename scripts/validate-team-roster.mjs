#!/usr/bin/env node
// Validates the team roster (#585): .agentflow/team-roster.json as committed at a ref (default HEAD
// of the primary checkout), the person's overlay outside the repository against the roster, and
// that the old in-repo overlay name can never be committed. With no committed roster the project
// uses the single-person path and this exits 0. Output names roster ids and JSON paths only, never
// an overlay key or value.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readBridgeSection } from '../lib/bridge/config.mjs'
import { botWritersFromBridge } from '../lib/roster/authority.mjs'
import {
  OVERLAY_ENV,
  TEAM_ROSTER_OVERLAY_PATH,
  TEAM_ROSTER_PATH,
  TeamRosterError,
  loadTeamRoster,
  primaryCheckout,
  validateRosterOverlay,
  validateTeamRoster,
} from '../lib/roster/team-roster.mjs'

export const NO_ROSTER_MESSAGE = `No team roster (${TEAM_ROSTER_PATH}); gates use the single-person path.`

function defaultGit(targetDir, args) {
  const result = spawnSync('git', ['-C', targetDir, ...args], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 256 * 1024 * 1024,
  })
  return { status: result.error ? null : result.status, stdout: result.stdout ?? '' }
}

// Problems that would let the old in-repo overlay name reach a commit. Outside git there are none.
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

function workingTreeNotes(targetDir, roster, ref) {
  const path = join(targetDir, TEAM_ROSTER_PATH)
  if (!existsSync(path)) return []
  let same = false
  try {
    same = JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) === JSON.stringify(roster)
  } catch {
    same = false
  }
  return same
    ? []
    : [
        `the working tree ${TEAM_ROSTER_PATH} differs from ${ref}; uncommitted changes have no effect`,
      ]
}

// options: ref, overlayPath, env, home, git.
export function teamRosterReport(
  targetDir,
  { git = defaultGit, ref = 'HEAD', overlayPath = null, env = process.env, home } = {},
) {
  const notes = []
  if (existsSync(join(targetDir, TEAM_ROSTER_OVERLAY_PATH)))
    notes.push(
      `${TEAM_ROSTER_OVERLAY_PATH} is not read; the overlay lives outside the repository (see docs/team-roster.md)`,
    )
  if (!primaryCheckout(targetDir, git)) {
    if (existsSync(join(targetDir, TEAM_ROSTER_PATH)))
      notes.push(`not a git checkout: ${TEAM_ROSTER_PATH} is read only from a commit`)
    return { ok: true, status: 'no-roster', message: NO_ROSTER_MESSAGE, errors: [], notes }
  }
  let loaded
  try {
    loaded = loadTeamRoster(targetDir, { ref, overlayPath, env, home, git, validateOverlay: false })
  } catch (error) {
    if (error instanceof TeamRosterError)
      return { ok: false, status: 'invalid', errors: [error.message], notes }
    throw error
  }
  const exposure = overlayExposure(targetDir, git)
  if (!loaded) {
    notes.push(...workingTreeNotes(targetDir, undefined, ref))
    return {
      ok: exposure.length === 0,
      status: exposure.length ? 'invalid' : 'no-roster',
      message: NO_ROSTER_MESSAGE,
      errors: exposure,
      notes,
    }
  }
  notes.push(...workingTreeNotes(targetDir, loaded.roster, ref))
  const errors = [
    ...validateTeamRoster(loaded.roster, { botWriters: bridgeBotWriters(targetDir) }).errors,
  ]
  if (loaded.overlay !== null) {
    errors.push(
      ...validateRosterOverlay(loaded.overlay, loaded.roster).errors.map((e) => `overlay: ${e}`),
    )
  }
  errors.push(...exposure)
  const people = Array.isArray(loaded.roster?.people) ? loaded.roster.people : []
  const peopleIds = people.map((person) => person?.id).filter((id) => typeof id === 'string')
  const channels = Object.keys(loaded.overlay?.channels ?? {})
  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 'valid' : 'invalid',
    ref,
    people: peopleIds,
    overlay: loaded.overlay === null ? 'absent' : 'present',
    overlaySource: overlayPath ? 'flag' : env[OVERLAY_ENV] ? 'environment' : 'config-home',
    // Who can be reached: roster ids with a channel, never the channel itself.
    reachable: peopleIds.filter((id) => channels.includes(id)),
    errors,
    notes,
  }
}

export function renderReport(report) {
  const notes = (report.notes ?? []).map((note) => `  note: ${note}`)
  if (report.status === 'no-roster') return [report.message, ...notes].join('\n') + '\n'
  const lines = [`team roster: ${report.status}${report.ref ? ` (${report.ref})` : ''}`]
  if (report.people) lines.push(`  people: ${report.people.join(', ')}`)
  if (report.overlay)
    lines.push(
      `  overlay: ${report.overlay} (${report.overlaySource}); reachable: ${report.reachable?.join(', ') || 'nobody'}`,
    )
  for (const error of report.errors) lines.push(`  error: ${error}`)
  return `${[...lines, ...notes].join('\n')}\n`
}

function flag(argv, name) {
  const index = argv.indexOf(name)
  return index === -1 ? null : (argv[index + 1] ?? '')
}

export function main(
  argv = process.argv.slice(2),
  { stdout = process.stdout, cwd = process.cwd(), git, env = process.env, home } = {},
) {
  const target = resolve(cwd, flag(argv, '--target') ?? '.')
  const report = teamRosterReport(target, {
    ...(git ? { git } : {}),
    ref: flag(argv, '--ref') || 'HEAD',
    overlayPath: flag(argv, '--overlay') || null,
    env,
    home,
  })
  stdout.write(
    argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report),
  )
  return report.ok ? 0 : 1
}

if (process.argv[1]?.endsWith('validate-team-roster.mjs')) {
  process.exitCode = main()
}
