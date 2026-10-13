#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { goalChildCompletionStatus, renderGoalPartsLedger } from '../lib/core/work-projection.mjs'
import { replaceMarkdownSection } from './issue-markdown.mjs'

export function syncGoalLedger({
  goalNumber,
  records,
  sectionName = 'Child Work & History',
  apply = false,
  exec = execSync,
} = {}) {
  if (!goalNumber) throw new Error('goalNumber is required')
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('records array is required to sync goal ledger')
  }

  const goalRecord = records.find((r) => String(r?.number) === String(goalNumber))
  if (!goalRecord) {
    throw new Error(`Goal #${goalNumber} not found in records`)
  }

  const status = goalChildCompletionStatus(records, goalNumber)
  const replacement = renderGoalPartsLedger(records, goalNumber, { sectionName })
  const updatedBody = replaceMarkdownSection(goalRecord.body ?? '', sectionName, replacement, true)

  let applied = false
  if (apply) {
    const tmp = join(tmpdir(), `goal-${goalNumber}-body-${Date.now()}.md`)
    try {
      writeFileSync(tmp, updatedBody, 'utf8')
      exec(`gh issue edit ${goalNumber} --body-file "${tmp}"`, { stdio: 'pipe' })
      applied = true
    } finally {
      try {
        unlinkSync(tmp)
      } catch {
        // ignore cleanup error
      }
    }
  }

  return {
    goalNumber: Number(goalNumber),
    status,
    sectionName,
    applied,
    updatedBody,
  }
}

function parseArgs(argv) {
  const args = {
    goalNumber: null,
    recordsPath: null,
    sectionName: 'Child Work & History',
    apply: false,
    json: false,
    target: process.cwd(),
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--goal') args.goalNumber = argv[++i]
    else if (arg === '--records') args.recordsPath = argv[++i]
    else if (arg === '--section') args.sectionName = argv[++i]
    else if (arg === '--apply') args.apply = true
    else if (arg === '--json') args.json = true
    else if (arg === '--target') args.target = argv[++i]
    else if (!args.goalNumber && /^\d+$/.test(arg)) args.goalNumber = arg
  }
  return args
}

function loadRecords(recordsPath) {
  if (recordsPath) {
    return JSON.parse(readFileSync(resolve(recordsPath), 'utf8'))
  }
  try {
    const raw = execSync(
      'gh issue list --state all --limit 100 --json number,title,body,labels,state,comments,closedAt',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Could not load records from GitHub (pass --records <file.json>): ${err.message}`,
    )
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.goalNumber) {
    process.stderr.write(
      'Usage: node scripts/sync-goal-ledger.mjs --goal <number> [--records <file.json>] [--section <name>] [--apply] [--json]\n',
    )
    process.exit(2)
  }

  try {
    const records = loadRecords(args.recordsPath)
    const result = syncGoalLedger({
      goalNumber: args.goalNumber,
      records,
      sectionName: args.sectionName,
      apply: args.apply,
    })

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      process.stdout.write(`[sync-goal-ledger] Goal #${result.goalNumber}\n`)
      process.stdout.write(`  Status: ${result.status.statusMessage}\n`)
      process.stdout.write(
        `  Progress: ${result.status.delivered}/${result.status.total} delivered\n`,
      )
      process.stdout.write(`  Ready for closure: ${result.status.readyForClosure ? 'YES' : 'NO'}\n`)
      process.stdout.write(`  Section "${result.sectionName}": rendered\n`)
      process.stdout.write(
        `Result: ${result.applied ? 'APPLIED TO GITHUB' : 'PREVIEW ONLY (run with --apply to commit)'}\n`,
      )
    }
    process.exit(0)
  } catch (err) {
    process.stderr.write(`[sync-goal-ledger] ERROR: ${err.message}\n`)
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
