#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { extractJsonBlock, extractSection, fieldValue } from '../lib/markdown-sections.mjs'
import { loadSdlcConfig, finding, report } from '../lib/sdlc-state.mjs'
import {
  ALL_EXECUTION_TARGETS,
  DELEGATION_BOUNDARIES,
  TRANSPORTS,
} from '../lib/execution-targets.mjs'
import { CONTEXT_BOUNDARIES, deriveIndependenceBoundary } from '../lib/role-attribution.mjs'
import { loadProjectConfig } from '../lib/role-routing.mjs'
import { runtimePlatformSlugs } from '../lib/runtime-platforms.mjs'
import { normalizeRole } from '../lib/sdlc-vocabulary.mjs'
import { validateObservation } from '../lib/core/verification-observation.mjs'

const OBSERVATION_REQUIRED_ROLES = ['developer', 'tester']

const args = process.argv.slice(2)
const json = args.includes('--json')
const path = args.includes('--path') ? args[args.indexOf('--path') + 1] : ''
if (!path || !existsSync(path)) {
  process.stderr.write('Usage: validate-sdlc-role-pass --path <role-pass.md> [--json]\n')
  process.exit(2)
}
const text = readFileSync(path, 'utf8')
const config = loadSdlcConfig()
const required = [
  'Issue',
  'Branch',
  'Phase',
  'Role',
  'Status',
  'Workflow profile',
  'Planned owner',
  'Launcher',
  'Executor',
  'Transport',
  'Delegation boundary',
  'Context boundary',
  'Model / runtime',
]
const findings = []
for (const label of required)
  if (fieldValue(text, label) === null)
    findings.push(finding('high', 'role-pass.field', `missing ${label}`))
const executedBy = fieldValue(text, 'Executed by') ?? fieldValue(text, 'Actual executor')
if (executedBy === null) findings.push(finding('high', 'role-pass.field', 'missing Executed by'))

const projectConfig = loadProjectConfig()
let registeredPlatforms = []
try {
  registeredPlatforms = runtimePlatformSlugs(projectConfig)
} catch (error) {
  findings.push(finding('high', 'role-pass.platform-registry', error.message))
}
for (const [label, value] of [
  ['Planned owner', fieldValue(text, 'Planned owner')],
  ['Executed by', executedBy],
  ['Launcher', fieldValue(text, 'Launcher')],
]) {
  if (
    value !== null &&
    value !== 'not-applicable:single-agent' &&
    !registeredPlatforms.includes(value)
  ) {
    findings.push(
      finding('high', 'role-pass.platform', `${label} uses unregistered platform slug: ${value}`),
    )
  }
}
for (const [label, values] of [
  ['Executor', ALL_EXECUTION_TARGETS],
  ['Transport', TRANSPORTS],
  ['Delegation boundary', DELEGATION_BOUNDARIES],
  ['Context boundary', CONTEXT_BOUNDARIES],
]) {
  const value = fieldValue(text, label)
  if (value !== null && !values.includes(value)) {
    findings.push(finding('high', 'role-pass.provenance', `${label} has invalid value: ${value}`))
  }
}
const profile = fieldValue(text, 'Workflow profile')
const role = fieldValue(text, 'Role')
if (profile && !config.paths?.[profile])
  findings.push(finding('high', 'role-pass.profile', `unknown profile ${profile}`))
if (
  profile === 'high-assurance' &&
  /self-review/i.test(fieldValue(text, 'Independence boundary') || '')
)
  findings.push(
    finding(
      'blocker',
      'role-pass.high-assurance.self-review',
      'high-assurance cannot rely on self-review',
    ),
  )
const roleIdentity = normalizeRole(role, config)
if (role && !roleIdentity.canonical)
  findings.push(finding('medium', 'role-pass.role', `role not in SDLC config: ${role}`))

const observationRequired = OBSERVATION_REQUIRED_ROLES.includes(role)
const observationSection = extractSection(text, 'Verification observation', 3)
const observationBlock = extractJsonBlock(observationSection)
if (!observationBlock) {
  if (observationRequired)
    findings.push(
      finding(
        'blocker',
        'role-pass.observation.missing',
        'developer and tester role passes require a Verification observation section',
      ),
    )
} else {
  if (
    typeof observationBlock.observationRef !== 'string' ||
    !observationBlock.observationRef.trim()
  )
    findings.push(
      finding(
        'blocker',
        'role-pass.observation.reference',
        'verification observation is missing a reference to where the observation record lives',
      ),
    )
  const { ok: observationOk, errors: observationErrors } = validateObservation(
    observationBlock.record,
  )
  if (!observationOk) {
    findings.push(finding('blocker', 'role-pass.observation.invalid', observationErrors.join('; ')))
  } else {
    if (observationBlock.candidateDigest !== observationBlock.record.candidateDigest)
      findings.push(
        finding(
          'blocker',
          'role-pass.observation.stale-candidate',
          'verification observation belongs to a stale candidate',
        ),
      )
    if (observationBlock.definitionDigest !== observationBlock.record.definitionDigest)
      findings.push(
        finding(
          'blocker',
          'role-pass.observation.definition-mismatch',
          'verification observation belongs to a stale check definition',
        ),
      )
    if (observationRequired) {
      const deterministicOrigins = config.deliveryPolicy?.deterministicOrigins ?? []
      if (!deterministicOrigins.includes(observationBlock.record.origin))
        findings.push(
          finding(
            'blocker',
            'role-pass.observation.origin',
            `verification observation origin is not deterministic: ${observationBlock.record.origin}`,
          ),
        )
      if (observationBlock.record.outcome !== 'pass')
        findings.push(
          finding(
            'blocker',
            'role-pass.observation.outcome',
            `verification observation did not pass: ${observationBlock.record.outcome}`,
          ),
        )
    }
  }
}

const independenceDeclared = fieldValue(text, 'Independence boundary')
const reviewedAuthorsRaw = fieldValue(text, 'Reviewed authors')
if (reviewedAuthorsRaw && reviewedAuthorsRaw !== 'not-applicable:single-agent') {
  const authorIdentities = reviewedAuthorsRaw
    .split(',')
    .map((identity) => identity.trim())
    .filter(Boolean)
  const derivedIndependence = deriveIndependenceBoundary({
    authorIdentities,
    reviewerIdentity: executedBy,
  })
  if (independenceDeclared === 'independent' && derivedIndependence === 'self-review')
    findings.push(
      finding(
        'blocker',
        'role-pass.independence.self-review',
        'Independence boundary claims independent but the reviewer identity appears among the reviewed authors',
      ),
    )
}

const result = report(findings, 'role-pass')
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else {
  process.stdout.write(`[validate-sdlc-role-pass] ${path}\n`)
  for (const item of result.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${result.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(result.ok ? 0 : 1)
