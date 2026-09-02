#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCollaborationPlan } from '../lib/collaboration-plan.mjs'
import { loadProjectConfig } from '../lib/role-routing.mjs'
import { validateRoleHandoff } from '../lib/role-catalog.mjs'
import { loadSdlcConfig } from '../lib/sdlc-state.mjs'
import {
  classifyRoleCollaboration,
  validateAcceptanceContract,
  validateAcceptanceDecision,
  validateCouncilRecord,
  validateDeliveryReceipt,
  validateReworkRequest,
  verifyRoleDelivery,
  verifyRoleAdvance,
} from '../lib/core/role-collaboration.mjs'

const args = process.argv.slice(2)
const value = (name, fallback = null) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : (args[index + 1] ?? fallback)
}
const flag = (name) => args.includes(name)
const list = (name) =>
  String(value(name, ''))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
const target = resolve(value('--target', process.cwd()))
const projectConfig = loadProjectConfig(target)
const domainConfig = loadSdlcConfig(target)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (name) => JSON.parse(readFileSync(resolve(target, value(name)), 'utf8'))
const [command] = args.filter((item) => !item.startsWith('--') && item !== value('--target'))

function output(result) {
  if (flag('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else
    process.stdout.write(
      `${result.ok === false ? 'BLOCKED' : 'READY'}\n${JSON.stringify(result, null, 2)}\n`,
    )
}

if (command === 'classify') {
  output(
    classifyRoleCollaboration({
      profile: value('--profile', 'standard'),
      risk: value('--risk', 'medium'),
      uncertainty: value('--uncertainty', 'medium'),
      changeSurface: list('--change-surface'),
      domains: list('--domains'),
      publicContract: flag('--public-contract'),
      migration: flag('--migration'),
      reversible: !flag('--irreversible'),
      evidenceComplete: !flag('--incomplete-evidence'),
      policy: projectConfig.collaboration,
    }),
  )
  process.exit(0)
}

if (command === 'plan') {
  const result = await resolveCollaborationPlan({
    issueNumber: value('--issue') ? Number(value('--issue')) : null,
    requestedMode: value('--mode', null),
    profile: value('--profile', 'standard'),
    risk: value('--risk', 'medium'),
    uncertainty: value('--uncertainty', 'medium'),
    effort: value('--effort', 'medium'),
    changeSurface: list('--change-surface'),
    preferredProvider: value('--provider', null),
    config: projectConfig,
  })
  output(result)
  process.exit(result.ok ? 0 : 1)
}

if (command === 'verify' || command === 'advance') {
  const handoff = readJson('--handoff')
  const handoffValidation = validateRoleHandoff({ handoff, packageRoot, config: domainConfig })
  if (!handoffValidation.ok) {
    output(handoffValidation)
    process.exit(1)
  }
  const delivery = readJson('--delivery')
  const councilRequest = value('--council-request') ? readJson('--council-request') : null
  const councilAdvice = value('--council-advice') ? readJson('--council-advice') : []
  const councilSynthesis = value('--council-synthesis') ? readJson('--council-synthesis') : null
  const sources = {
    handoff,
    contract: handoff.acceptanceContract,
    delivery,
    councilRequest,
    councilAdvice,
    councilSynthesis,
    config: domainConfig,
  }
  if (command === 'advance') {
    const decision = readJson('--decision')
    const openReworkRequests = value('--rework') ? readJson('--rework') : undefined
    const result = verifyRoleAdvance({ ...sources, decision, openReworkRequests })
    output(result)
    process.exit(result.ok ? 0 : 1)
  }
  const report = verifyRoleDelivery(sources)
  output({ ok: report.status !== 'fail', report })
  process.exit(report.status === 'fail' ? 1 : 0)
}

if (command === 'validate') {
  const record = readJson('--path')
  const validators = {
    'acceptance-contract': validateAcceptanceContract,
    'delivery-receipt': validateDeliveryReceipt,
    'acceptance-decision': validateAcceptanceDecision,
    'council-request': validateCouncilRecord,
    'council-advice': validateCouncilRecord,
    'council-synthesis': validateCouncilRecord,
    'rework-request': validateReworkRequest,
  }
  const validator = validators[record.type]
  if (!validator) throw new Error(`unsupported role collaboration record: ${record.type ?? ''}`)
  const result = validator(record, domainConfig)
  output(result)
  process.exit(result.ok ? 0 : 1)
}

process.stderr.write(
  'Usage: agentflow-sdlc collaboration <classify|plan|verify|advance|validate> [options] [--target <dir>] [--json]\n',
)
process.exit(2)
