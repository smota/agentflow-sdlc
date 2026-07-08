#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { doctor, init, markMerged, sync } from '../lib/install.mjs'
import { validateEnvironment } from '../lib/environment.mjs'
import { buildReleasePlan } from '../lib/release-versioning.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function getFlag(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  return args[index + 1] ?? fallback
}

function printReport(title, report) {
  process.stdout.write(`${title}\n`)
  for (const [key, list] of Object.entries(report)) {
    if (!Array.isArray(list) || list.length === 0) continue
    process.stdout.write(`  ${key} (${list.length}):\n`)
    for (const item of list) {
      process.stdout.write(`    - ${item}\n`)
    }
  }
}

function printEnvironmentReport(report) {
  process.stdout.write(`Environment validation\n`)
  process.stdout.write(`${report.note}\n\n`)
  for (const required of [true, false]) {
    process.stdout.write(`${required ? 'Required' : 'Optional'}:\n`)
    for (const tool of report.tools.filter((item) => item.required === required)) {
      process.stdout.write(
        `  - ${tool.name}: ${tool.found ? `found ${tool.version}` : 'missing'}\n`,
      )
      process.stdout.write(`    Why: ${tool.why}\n`)
      if (!tool.found) {
        process.stdout.write(`    Install options:\n`)
        for (const option of tool.installOptions) process.stdout.write(`      - ${option}\n`)
      }
    }
    process.stdout.write(`\n`)
  }
}

function printReleasePlan(plan) {
  process.stdout.write(`Release plan preview\n`)
  process.stdout.write(`${plan.message}\n\n`)
  process.stdout.write(`Strategy: ${plan.strategy}\n`)
  process.stdout.write(`Bump: ${plan.bump}\n`)
  process.stdout.write(`Current version: ${plan.currentVersion}\n`)
  process.stdout.write(`Next version: ${plan.nextVersion}\n`)
  process.stdout.write(`Tag: ${plan.tag}\n`)
  if (plan.previousTag) process.stdout.write(`Previous tag: ${plan.previousTag}\n`)
  process.stdout.write(`Release notes draft: ${plan.notesPath}\n`)
  process.stdout.write(`Approval required: ${plan.approvalRequired ? 'yes' : 'no'}\n`)
}

function printOnboardingPrompt(targetDir) {
  process.stdout.write(`Use the multi-agent-sdlc assisted onboarding guide:\n`)
  process.stdout.write(
    `https://github.com/smota/multi-agent-sdlc/blob/main/docs/assisted-onboarding.md\n\n`,
  )
  process.stdout.write(`Apply it to this existing project: ${targetDir}\n`)
  process.stdout.write(
    `First inspect existing agent instructions and project docs. Validate the environment read-only. Ask me to choose agents, execution mode, branch strategy, validation commands, and GitHub automation. Propose install/setup commands but do not execute them without explicit approval. Preserve or merge existing instructions instead of overwriting them.\n`,
  )
}

function printUpdatePrompt(targetDir) {
  process.stdout.write(`Use the multi-agent-sdlc assisted update guide:\n`)
  process.stdout.write(
    `https://github.com/smota/multi-agent-sdlc/blob/main/docs/assisted-update.md\n\n`,
  )
  process.stdout.write(`Apply it to this already-adopted project: ${targetDir}\n`)
  process.stdout.write(
    `Start read-only. Inspect agent-framework-lock.json, existing agent instructions, project docs, and local workflow configuration. Run doctor-env and doctor read-only. Compare the installed framework state with this source framework checkout/version. Classify every proposed update as safe fast-forward, conflict, seed-once skip, hand-merged, removed/missing, or validation blocker. Present an update plan and ask for approval before running sync, editing files, marking hand merges, committing, pushing, or opening a PR. Preserve project-owned conventions and record update evidence in the PR.\n`,
  )
}

function positionalArgs(args) {
  const result = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--target') {
      index += 1
      continue
    }
    if (!args[index].startsWith('--')) result.push(args[index])
  }
  return result
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  const targetDir = resolve(getFlag(rest, '--target', process.cwd()))

  if (command === 'init') {
    const report = init(packageRoot, targetDir)
    printReport(`Installed framework into ${targetDir}`, report)
    process.exit(0)
  }

  if (command === 'sync') {
    const report = sync(packageRoot, targetDir)
    printReport(`Synced framework in ${targetDir}`, report)
    process.exit(report.conflicts.length > 0 ? 1 : 0)
  }

  if (command === 'doctor') {
    const report = doctor(packageRoot, targetDir)
    printReport(`Framework status for ${targetDir}`, report)
    const drifted = report.modified.length + report.missing.length + report.notInstalled.length
    process.exit(drifted > 0 ? 1 : 0)
  }

  if (command === 'doctor-env') {
    const report = validateEnvironment(targetDir)
    if (rest.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else printEnvironmentReport(report)
    process.exit(report.ok ? 0 : 1)
  }

  if (command === 'onboarding-prompt') {
    printOnboardingPrompt(targetDir)
    process.exit(0)
  }

  if (command === 'update-prompt') {
    printUpdatePrompt(targetDir)
    process.exit(0)
  }

  if (command === 'release-plan') {
    const plan = buildReleasePlan({
      repoRoot: targetDir,
      bump: getFlag(rest, '--bump', 'fix'),
      currentVersion: getFlag(rest, '--current', undefined),
      notesPath: getFlag(rest, '--notes', undefined),
    })
    if (rest.includes('--json')) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    else printReleasePlan(plan)
    process.exit(0)
  }

  if (command === 'mark-merged') {
    const path = positionalArgs(rest)[0]
    if (!path) {
      process.stderr.write('Usage: multi-agent-sdlc mark-merged <path> [--target <dir>]\n')
      process.exit(2)
    }
    const report = markMerged(targetDir, path)
    printReport(`Marked hand-merged framework file in ${targetDir}`, { merged: [report.merged] })
    process.exit(0)
  }

  process.stderr.write(
    'Usage: multi-agent-sdlc <init|sync|doctor|doctor-env|onboarding-prompt|update-prompt|release-plan|mark-merged> [path] [--target <dir>] [--json]\n',
  )
  process.exit(2)
}

main()
