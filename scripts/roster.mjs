#!/usr/bin/env node
// `agentflow-sdlc roster validate|route` (#585). See docs/team-roster.md. Both subcommands read
// only; neither delivers a gate nor resolves one. Output names roster ids, never an address.
import { resolve } from 'node:path'
import { routeGate } from '../lib/roster/gate-router.mjs'
import { GATE_TYPES, TIERS, TeamRosterError, loadTeamRoster } from '../lib/roster/team-roster.mjs'
import { NO_ROSTER_MESSAGE, renderReport, teamRosterReport } from './validate-team-roster.mjs'

export const ROSTER_USAGE = `Usage: agentflow-sdlc roster <validate|route> [options] [--target <dir>] [--json]
  roster validate [--ref <ref>] [--overlay <file>]  check the committed roster, the overlay, and the in-repo overlay name
  roster route --gate <type> [--paths a,b] [--tier <tier>] [--id <gate id>] [--ref <ref>]
                                                    explain who a gate goes to, by roster id
The roster is read from a commit (default HEAD of the primary checkout); uncommitted edits have no effect.
Gate types: ${GATE_TYPES.join(', ')}. Tiers: ${TIERS.join(', ')} (default standard).
Exit: 0 valid, routed, unmatched or no roster; 1 invalid roster; 2 usage.
`
const VALUE_FLAGS = new Set([
  '--gate',
  '--paths',
  '--tier',
  '--id',
  '--target',
  '--ref',
  '--overlay',
])

class UsageError extends Error {}

export function parseRosterArgs(argv) {
  const flags = {}
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`${arg} needs a value`)
      flags[arg.slice(2)] = value
      index += 1
    } else if (arg.startsWith('--')) flags[arg.slice(2)] = true
    else positional.push(arg)
  }
  return { subcommand: positional[0] ?? null, flags }
}

function renderRouting(routing, gate) {
  const head = `gate ${gate.type} (tier ${gate.tier}${gate.paths.length ? `, paths ${gate.paths.join(', ')}` : ', no paths'})`
  const lines = []
  if (routing.status === 'routed') {
    const minutes = Math.round((Date.parse(routing.escalateAt) - Date.parse(routing.now)) / 60_000)
    lines.push(
      `${head}: routed to ${routing.primary}; ${routing.backup ? `backup ${routing.backup} after ${minutes} minutes` : 'no backup'}`,
    )
  } else if (routing.status === 'no-capacity') {
    lines.push(`${head}: everyone in scope is at capacity (${routing.matching.join(', ')})`)
  } else {
    lines.push(`${head}: nobody on the roster covers it`)
  }
  for (const item of routing.considered) lines.push(`  ${item.personId}: ${item.outcome}`)
  return `${lines.join('\n')}\n`
}

export async function main(
  argv = process.argv.slice(2),
  {
    stdout = process.stdout,
    stderr = process.stderr,
    cwd = process.cwd(),
    clock = () => new Date(),
    env = process.env,
    home,
    git,
  } = {},
) {
  let parsed
  try {
    parsed = parseRosterArgs(argv)
  } catch (error) {
    stderr.write(`${error.message}\n${ROSTER_USAGE}`)
    return 2
  }
  const { subcommand, flags } = parsed
  if (flags.help || flags.h) {
    stdout.write(ROSTER_USAGE)
    return 0
  }
  if (!['validate', 'route'].includes(subcommand)) {
    stderr.write(ROSTER_USAGE)
    return 2
  }
  const json = flags.json === true
  const reportOptions = {
    ...(git ? { git } : {}),
    ref: typeof flags.ref === 'string' ? flags.ref : 'HEAD',
    overlayPath: typeof flags.overlay === 'string' ? flags.overlay : null,
    env,
    home,
  }
  const target = resolve(cwd, typeof flags.target === 'string' ? flags.target : '.')
  const emit = (value, text, code) => {
    stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : text)
    return code
  }

  if (subcommand === 'validate') {
    const report = teamRosterReport(target, reportOptions)
    return emit(report, renderReport(report), report.ok ? 0 : 1)
  }

  if (typeof flags.gate !== 'string') {
    stderr.write(`missing --gate\n${ROSTER_USAGE}`)
    return 2
  }
  const gate = {
    id: typeof flags.id === 'string' ? flags.id : `cli:${flags.gate}`,
    type: flags.gate,
    tier: typeof flags.tier === 'string' ? flags.tier : 'standard',
    paths:
      typeof flags.paths === 'string'
        ? flags.paths
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        : [],
  }
  if (!GATE_TYPES.includes(gate.type) || !TIERS.includes(gate.tier)) {
    stderr.write(`unknown gate type or tier\n${ROSTER_USAGE}`)
    return 2
  }
  let team
  try {
    team = loadTeamRoster(target, { ...reportOptions, overlay: false })
  } catch (error) {
    if (!(error instanceof TeamRosterError)) throw error
    return emit(
      { ok: false, status: 'invalid', errors: [error.message] },
      `team roster: invalid\n  error: ${error.message}\n`,
      1,
    )
  }
  if (!team)
    return emit(
      { ok: true, status: 'no-roster', message: NO_ROSTER_MESSAGE },
      `${NO_ROSTER_MESSAGE}\n`,
      0,
    )
  const report = teamRosterReport(target, reportOptions)
  if (!report.ok) return emit(report, renderReport(report), 1)
  const now = clock()
  // Routing reads the roster only; the overlay's channels are never consulted here.
  const routing = { ...routeGate({ gate, roster: team.roster, now }), now: now.toISOString() }
  return emit({ ok: true, gate, ...routing }, renderRouting(routing, gate), 0)
}

if (/(^|[\\/])roster\.mjs$/.test(process.argv[1] ?? '')) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    },
  )
}
