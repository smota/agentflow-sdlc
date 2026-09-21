#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyReviewRound, evaluateSparringGate } from '../lib/sparring-gate.mjs'
import {
  computeLedgerRevision,
  computeTargetIdentityDigest,
  createResolutionLedger,
  createReviewTargetIdentity,
  createSparringBrief,
  validateResolutionLedger,
  validateReviewRoundReceipt,
} from '../lib/core/sparring.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : (args[index + 1] ?? fallback)
}
const hasFlag = (name) => args.includes(name)
const json = hasFlag('--json')

const target = resolve(flag('--target', process.cwd()))
const ledgerPath = flag('--ledger')
const receiptPath = flag('--receipt')
const targetIdentityPath = flag('--target-identity')
const resolutionsPath = flag('--resolutions')
const waiversPath = flag('--waivers')
const profile = flag('--profile', 'standard')
const humanDecision = flag('--human-decision', null)

if (hasFlag('--help') || hasFlag('-h') || (!ledgerPath && !receiptPath && !hasFlag('--brief'))) {
  process.stdout.write(`Usage:
  node scripts/validate-sparring-gate.mjs --ledger <path> [--target-identity <path>] [--profile <standard|high-assurance>] [--human-decision <approved|waived>] [--json]
  node scripts/validate-sparring-gate.mjs --apply --ledger <path> --receipt <path> [--target-identity <path>] [--json]
  node scripts/validate-sparring-gate.mjs --brief --objective <text> --contract-slice <text> [--json]
`)
  process.exit(hasFlag('--help') || hasFlag('-h') ? 0 : 2)
}

function readJson(path) {
  const abs = resolve(target, path)
  if (!existsSync(abs)) throw new Error(`file not found: ${abs}`)
  return JSON.parse(readFileSync(abs, 'utf8'))
}

try {
  if (hasFlag('--brief')) {
    const brief = createSparringBrief({
      objective: flag('--objective', 'Specification Sparring'),
      contractSliceText: flag('--contract-slice', ''),
      contractSliceHash: flag('--slice-hash', null),
    })
    if (json) process.stdout.write(`${JSON.stringify(brief, null, 2)}\n`)
    else process.stdout.write(`Sparring brief created for ${brief.objective}\n`)
    process.exit(0)
  }

  let targetIdentity = null
  if (targetIdentityPath) {
    const raw = readJson(targetIdentityPath)
    targetIdentity = createReviewTargetIdentity(raw)
  }

  if (hasFlag('--apply')) {
    if (!receiptPath || !ledgerPath) {
      process.stderr.write('--apply requires both --ledger and --receipt\n')
      process.exit(2)
    }
    const receipt = readJson(receiptPath)
    const receiptValidation = validateReviewRoundReceipt(receipt)
    if (!receiptValidation.ok) {
      if (json) process.stdout.write(`${JSON.stringify(receiptValidation, null, 2)}\n`)
      else process.stderr.write(`Invalid receipt: ${receiptValidation.errors.join('; ')}\n`)
      process.exit(1)
    }

    let ledger
    const absLedger = resolve(target, ledgerPath)
    if (existsSync(absLedger)) {
      ledger = JSON.parse(readFileSync(absLedger, 'utf8'))
      const ledgerValidation = validateResolutionLedger(ledger)
      if (!ledgerValidation.ok) {
        if (json) process.stdout.write(`${JSON.stringify(ledgerValidation, null, 2)}\n`)
        else process.stderr.write(`Invalid ledger: ${ledgerValidation.errors.join('; ')}\n`)
        process.exit(1)
      }
    } else {
      if (!targetIdentity) {
        process.stderr.write('Creating new ledger requires --target-identity\n')
        process.exit(2)
      }
      ledger = createResolutionLedger({ targetIdentity })
    }

    const resolutionEvidences = resolutionsPath ? readJson(resolutionsPath) : {}
    const waivers = waiversPath ? readJson(waiversPath) : {}

    const currentIdentity = targetIdentity || ledger.targetIdentity
    const updated = applyReviewRound({
      ledger,
      receipt,
      currentTargetIdentity: currentIdentity,
      resolutionEvidences,
      waivers,
    })

    writeFileSync(absLedger, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
    const rev = computeLedgerRevision(updated)
    const result = {
      ok: true,
      status: updated.status,
      revision: rev,
      currentRound: updated.currentRound,
    }
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else
      process.stdout.write(
        `Applied round ${updated.currentRound} to ${ledgerPath} (status: ${updated.status}, rev: ${rev})\n`,
      )
    process.exit(0)
  }

  // Validate / evaluate gate
  if (receiptPath && !ledgerPath) {
    const receipt = readJson(receiptPath)
    const val = validateReviewRoundReceipt(receipt)
    if (json) process.stdout.write(`${JSON.stringify(val, null, 2)}\n`)
    else
      process.stdout.write(val.ok ? 'PASS: Receipt is valid\n' : `FAIL: ${val.errors.join('; ')}\n`)
    process.exit(val.ok ? 0 : 1)
  }

  const absLedger = resolve(target, ledgerPath)
  if (!existsSync(absLedger)) {
    process.stderr.write(`Ledger not found: ${absLedger}\n`)
    process.exit(1)
  }
  const ledger = JSON.parse(readFileSync(absLedger, 'utf8'))
  const ledgerValidation = validateResolutionLedger(ledger)
  if (!ledgerValidation.ok) {
    if (json) process.stdout.write(`${JSON.stringify(ledgerValidation, null, 2)}\n`)
    else process.stderr.write(`Invalid ledger: ${ledgerValidation.errors.join('; ')}\n`)
    process.exit(1)
  }

  const currentIdentity = targetIdentity || ledger.targetIdentity
  const targetDigest = computeTargetIdentityDigest(currentIdentity)
  const result = evaluateSparringGate({
    targetIdentity: currentIdentity,
    ledger,
    profile,
    humanDecision,
  })

  const output = {
    ok: result.unlocked,
    targetDigest,
    ...result,
  }

  if (json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  else {
    process.stdout.write(
      `Sparring Gate: ${result.unlocked ? 'UNLOCKED (PASS)' : 'LOCKED (BLOCKED)'}\n`,
    )
    if (result.errors?.length) {
      process.stdout.write(`Errors:\n${result.errors.map((e) => `  - ${e}`).join('\n')}\n`)
    }
    if (result.warnings?.length) {
      process.stdout.write(`Warnings:\n${result.warnings.map((w) => `  - ${w}`).join('\n')}\n`)
    }
  }
  process.exit(result.unlocked ? 0 : 1)
} catch (error) {
  if (json)
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`)
  else process.stderr.write(`Error: ${error.message}\n`)
  process.exit(1)
}
