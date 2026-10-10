#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { allowedNext, currentPhase, seatsFor } from '../lib/core/phase-graph.mjs'
import { createFilesystemMedium } from '../lib/sources/filesystem-medium.mjs'
import { resolveGitHubToken } from '../lib/sources/github-credential.mjs'
import { createGitHubMedium } from '../lib/sources/github-medium.mjs'

function flag(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return null
  return args[index + 1]
}

function usage() {
  return [
    'Usage: agentflow-sdlc phase <append|read|integrate> --medium <filesystem|github> [options]',
    '  filesystem: --root <dir>',
    '  github: --repo <owner/repo> [--issue <n>]',
    '  append: --phase <0-8> --status <pass|skipped> --seat <id> --key <idempotency>',
    '          [--title <text>] [--body <text> | --body-file <path>] [--reason <text>]',
    '          [--kind <goal|capability|spec> [--parent <dir|issue>] [--change-class <class>]',
    '           [--gate-file <path> --attestation-file <path>]]',
    '  integrate: filesystem only. --line <integration line or trunk> [--ref <commit>]',
    '             records that the result is integrated. It is not a transition.',
    'A queue message is not a handoff. append writes the transition, then prints the queue body.',
  ].join('\n')
}

function mediumFrom(args) {
  const kind = flag(args, '--medium')
  if (kind === 'filesystem')
    return createFilesystemMedium({ root: resolve(flag(args, '--root') ?? '') })
  if (kind === 'github') {
    return createGitHubMedium({
      repo: flag(args, '--repo'),
      number: flag(args, '--issue') ? Number(flag(args, '--issue')) : null,
      token: resolveGitHubToken(),
    })
  }
  throw new Error('Set --medium filesystem or --medium github')
}

// Consent is a sealed gate plus a person's attestation, each read from its own JSON file.
function readConsent(args) {
  const gateFile = flag(args, '--gate-file')
  const attestationFile = flag(args, '--attestation-file')
  if (!gateFile && !attestationFile) return null
  if (!gateFile || !attestationFile) {
    throw new Error('Pass --gate-file and --attestation-file together')
  }
  return {
    gate: JSON.parse(readFileSync(resolve(gateFile), 'utf8')),
    attestation: JSON.parse(readFileSync(resolve(attestationFile), 'utf8')),
  }
}

// The parent is read through the same medium kind: a goal directory, or an issue in the same repo.
async function readParent(args) {
  const ref = flag(args, '--parent')
  if (!ref) return null
  const kind = flag(args, '--medium')
  const parentArgs =
    kind === 'github'
      ? ['--medium', kind, '--repo', flag(args, '--repo'), '--issue', ref]
      : ['--medium', kind, '--root', ref]
  return mediumFrom(parentArgs).readGoal()
}

function queueBody(result) {
  const next = allowedNext(result.goal.transitions)
  const nextSeats = [...new Set(next.flatMap((phase) => seatsFor(phase)))]
  return [
    `Phase ${result.transition.phase} ${result.transition.role} ${result.transition.status}`,
    `Goal: ${result.goal.uri}`,
    `Transition: ${result.transition.uri}`,
    `Revision: ${result.goal.revision}`,
    `Next phase: ${next.length ? next.join(', ') : 'none'}`,
    `Next seat: ${nextSeats.join(', ') || 'none'}`,
    'Do not start the next phase unless read shows this transition.',
  ].join('\n')
}

async function main(argv) {
  const [action, ...args] = argv
  if (!action || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${usage()}\n`)
    return action ? 0 : 1
  }
  const medium = mediumFrom(args)
  if (action === 'read') {
    const goal = await medium.readGoal()
    process.stdout.write(
      `${JSON.stringify({ goal, currentPhase: currentPhase(goal.transitions), allowedNext: allowedNext(goal.transitions) }, null, 2)}\n`,
    )
    return 0
  }
  if (action === 'integrate') {
    if (typeof medium.recordIntegration !== 'function') {
      throw new Error(
        'On GitHub the integration lifecycle records integration from the merged pull request',
      )
    }
    const goal = await medium.recordIntegration({
      line: flag(args, '--line'),
      ref: flag(args, '--ref'),
    })
    process.stdout.write(`${JSON.stringify({ goal }, null, 2)}\n`)
    return 0
  }
  if (action !== 'append') throw new Error(usage())
  const bodyFile = flag(args, '--body-file')
  const body = bodyFile ? readFileSync(resolve(bodyFile), 'utf8') : (flag(args, '--body') ?? '')
  if (!flag(args, '--issue') && flag(args, '--title')) {
    try {
      await medium.readGoal()
    } catch {
      await medium.createGoal({
        title: flag(args, '--title'),
        body,
        kind: flag(args, '--kind'),
        parent: await readParent(args),
        changeClass: flag(args, '--change-class'),
        consent: readConsent(args),
      })
    }
  }
  const result = await medium.appendTransition({
    phase: Number(flag(args, '--phase')),
    status: flag(args, '--status'),
    seat: flag(args, '--seat'),
    reason: flag(args, '--reason'),
    body,
    idempotencyKey: flag(args, '--key'),
  })
  process.stdout.write(`${JSON.stringify({ ...result, queueBody: queueBody(result) }, null, 2)}\n`)
  return 0
}

const invoked = process.argv[1]?.endsWith('phase-handoff.mjs')
if (invoked) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    },
  )
}

export { main }
