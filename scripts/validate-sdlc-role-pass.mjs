#!/usr/bin/env node
import { existsSync, readFileSync, lstatSync } from 'node:fs'
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
import { verifyObservation } from '../lib/core/verification-observation.mjs'
import { containedPath, fingerprintCandidate } from '../lib/verification/workspace.mjs'

const OBSERVATION_REQUIRED_ROLES = ['developer', 'tester']

const args = process.argv.slice(2)
const json = args.includes('--json')
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : process.cwd()
const path = args.includes('--path') ? args[args.indexOf('--path') + 1] : ''
if (!path || !existsSync(path)) {
  process.stderr.write(
    'Usage: validate-sdlc-role-pass --path <role-pass.md> [--target <dir>] [--json]\n',
  )
  process.exit(2)
}
const text = readFileSync(path, 'utf8')
const config = loadSdlcConfig(target)
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

const projectConfig = loadProjectConfig(target)
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

// Independence is derived from evidence (Reviewed authors vs Executed by), never accepted as a bare
// claim (H5). A pass claiming "independent" without Reviewed authors to check it against is
// unverifiable and must block, regardless of workflow profile.
const independenceDeclared = fieldValue(text, 'Independence boundary')
const reviewedAuthorsRaw = fieldValue(text, 'Reviewed authors')
let derivedIndependence = null
if (reviewedAuthorsRaw && reviewedAuthorsRaw !== 'not-applicable:single-agent') {
  const authorIdentities = reviewedAuthorsRaw
    .split(',')
    .map((identity) => identity.trim())
    .filter(Boolean)
  derivedIndependence = deriveIndependenceBoundary({
    authorIdentities,
    reviewerIdentity: executedBy,
  })
}
if (independenceDeclared === 'independent' && !reviewedAuthorsRaw)
  findings.push(
    finding(
      'blocker',
      'role-pass.independence.unverifiable',
      'Independence boundary claims independent but no Reviewed authors were declared to verify it against',
    ),
  )

if (profile && !config.paths?.[profile])
  findings.push(finding('high', 'role-pass.profile', `unknown profile ${profile}`))
// High-assurance can never rely on self-review. Feed the DERIVED boundary in alongside the raw
// declared string: a pass that dishonestly declares "independent" while Reviewed authors shows the
// reviewer among the authors must be caught here too, not just honest self-review disclosures.
if (
  profile === 'high-assurance' &&
  (derivedIndependence === 'self-review' || /self-review/i.test(independenceDeclared || ''))
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

// H1: the requirement is decided from the canonical role, never the raw declared string — a role
// pass cannot dodge the developer/tester observation requirement by declaring "Developer" instead
// of "developer" (normalizeRole matches both the slug and the config's label, canonicalizing either
// spelling to the same slug).
const observationRequired = OBSERVATION_REQUIRED_ROLES.includes(roleIdentity.canonical)
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
  const observationRefValue = observationBlock.observationRef
  if (typeof observationRefValue !== 'string' || !observationRefValue.trim())
    findings.push(
      finding(
        'blocker',
        'role-pass.observation.reference',
        'verification observation is missing a reference to where the observation record lives',
      ),
    )

  // H7: observationRef is resolved, not merely validated as a non-empty string. Evidence that is
  // never read is not evidence: the ref must resolve under the target root, and the record it
  // resolves to must be the same record embedded in this role pass.
  let sourceVerified = false
  if (typeof observationRefValue === 'string' && observationRefValue.trim()) {
    try {
      const refPath = containedPath(target, observationRefValue, { allowMissing: true })
      if (!existsSync(refPath) || !lstatSync(refPath).isFile()) {
        findings.push(
          finding(
            'blocker',
            'role-pass.observation.reference-unresolved',
            `observationRef does not resolve to a file under the target root: ${observationRefValue}`,
          ),
        )
      } else {
        const referenced = JSON.parse(readFileSync(refPath, 'utf8'))
        if (referenced?.digest !== observationBlock.record?.digest) {
          findings.push(
            finding(
              'blocker',
              'role-pass.observation.reference-mismatch',
              'the record at observationRef does not match the verification observation embedded in this role pass',
            ),
          )
        } else {
          sourceVerified = true
        }
      }
    } catch (error) {
      findings.push(
        finding(
          'blocker',
          'role-pass.observation.reference-unresolved',
          `observationRef could not be resolved: ${error.message}`,
        ),
      )
    }
  }

  // H3: the candidate digest is computed from the actual working tree, over the inputs the
  // target's own agent-workflow.config.json declares under delivery.candidate.inputs — never taken
  // from the author-supplied envelope, which agrees with the embedded record by construction. If
  // the tree cannot be fingerprinted that is itself a finding, never a silent pass.
  let actualCandidateDigest = null
  try {
    actualCandidateDigest = fingerprintCandidate(
      target,
      projectConfig.delivery?.candidate ?? {},
    ).digest
  } catch (error) {
    findings.push(
      finding(
        'blocker',
        'role-pass.observation.candidate-unverifiable',
        `candidate could not be fingerprinted from the working tree: ${error.message}`,
      ),
    )
  }

  // H2: call the real verification-observation engine. Its checks (sourceVerified, non-empty
  // requiredAssertions, per-assertion pass, candidate/definition match, origin policy, outcome) are
  // not re-implemented here. H6: origin and outcome policy apply to ANY observation present in ANY
  // role pass, not only the developer/tester roles that require one.
  const deterministicOrigins = config.deliveryPolicy?.deterministicOrigins ?? []
  const requiredAssertions = [
    ...new Set(
      (observationBlock.record?.assertions ?? [])
        .map((assertion) => assertion?.id)
        .filter((id) => typeof id === 'string' && id),
    ),
  ]
  const resolution = verifyObservation({
    observation: observationBlock.record,
    candidateDigest: actualCandidateDigest,
    definitionDigest: observationBlock.definitionDigest,
    requiredAssertions,
    allowedOrigins: deterministicOrigins,
    sourceVerified,
  })
  if (resolution.status !== 'pass') {
    for (const error of resolution.errors)
      findings.push(finding('blocker', observationFindingCode(error), error))
  }
}

// False independence: derived independence contradicts a declared "independent" boundary even when
// Reviewed authors was supplied (kept general, not profile-gated — high-assurance already handled
// above alongside the derived boundary).
if (independenceDeclared === 'independent' && derivedIndependence === 'self-review')
  findings.push(
    finding(
      'blocker',
      'role-pass.independence.self-review',
      'Independence boundary claims independent but the reviewer identity appears among the reviewed authors',
    ),
  )

function observationFindingCode(message) {
  if (message === 'Candidate changed') return 'role-pass.observation.stale-candidate'
  if (message === 'Check definition changed') return 'role-pass.observation.definition-mismatch'
  if (message === 'Observation origin does not satisfy policy')
    return 'role-pass.observation.origin'
  if (message === 'Observation did not pass') return 'role-pass.observation.outcome'
  if (message === 'Immutable execution required') return 'role-pass.observation.isolation'
  if (message === 'At least one required assertion is necessary')
    return 'role-pass.observation.assertions-empty'
  if (message.startsWith('Assertion ')) return 'role-pass.observation.assertion-failed'
  if (message === 'Observation source was not resolved')
    return 'role-pass.observation.unverified-source'
  if (message === 'Observation freshness unavailable or expired')
    return 'role-pass.observation.stale'
  return 'role-pass.observation.invalid'
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
