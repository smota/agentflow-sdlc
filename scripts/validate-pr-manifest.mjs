#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import {
  extractSection,
  fieldValue,
  hasSection,
  parseMarkdownTable,
} from '../lib/markdown-sections.mjs'
import { rowsFromTable, validateRoleAttributionMatrix } from '../lib/role-attribution.mjs'

function getArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return ''
  }
  return process.argv[index + 1] ?? ''
}

const path = getArg('--path') || '.agent-runs/issues/unknown/pr-manifest.md'
if (!existsSync(path)) {
  process.stderr.write(`[validate-pr-manifest] missing file: ${path}\n`)
  process.exit(1)
}

const content = readFileSync(path, 'utf8')
const workflowEvidence = extractSection(content, 'Workflow evidence')
const agentReview = extractSection(content, 'Agent review')
const ciValidation = extractSection(content, 'CI-equivalent validation')

const agentReviewFields = {
  'Implemented by': /^(human|claude|codex|agy|pi)$/,
  Launcher: /^(human|claude|codex|agy|pi)$/,
  Executor:
    /^(claude-cli|anthropic-api|agy-cli|agy-session|pi-parent|pi-subagent|pi-session|pi-subagent-model|codex-cli|provider-api|human)$/,
  Transport: /^(local-cli|provider-api|pi-subagent|intercom-session|orchestrated-worktree|manual)$/,
  'Delegation boundary':
    /^(current-session|child-subagent|separate-local-session|child-worktree|human-handoff)$/,
  'Model / runtime': /^(?!<freeform identifier>$).+/,
  Review: /^(self-review|human-review-requested|human-reviewed)$/,
  'Workflow profile': /^(bounded|standard|high-assurance)$/,
  'Merge owner':
    /^(human\/operator|auto-merge-requested:`gh pr merge --squash --delete-branch --auto`)$/,
  Mode: /^(single-agent|multi-agent)$/,
}

// When a "Regression test:" field is present in Agent review, it must have a valid value.
// Bug fix PRs are required by AGENTS.md §17 to include this field (either "added" or
// "not-applicable:<explicit reason>"). The orchestrate skill enforces its presence for bugs;
// this validator enforces the value format when the field appears.
const regressionTestValue = fieldValue(agentReview, 'Regression test')
const regressionTestValid =
  regressionTestValue === null || /^(added|not-applicable:.+)$/.test(regressionTestValue)

const missingAgentFields = []
const invalidAgentFields = []
for (const [label, pattern] of Object.entries(agentReviewFields)) {
  const value = fieldValue(agentReview, label)
  if (value === null) {
    missingAgentFields.push(label)
  } else if (!pattern.test(value)) {
    invalidAgentFields.push(`${label}="${value}"`)
  }
}

const ciStatus = fieldValue(ciValidation, 'Status')
const ciStatusValid = /^(passed|not-run-with-reason|expected-fail-with-follow-up)$/.test(
  ciStatus ?? '',
)

const followUps = extractSection(content, 'Follow-up issues')
const hasConcreteFollowUp = followUps !== null && /#\d+/.test(followUps)
const expectedFailHasFollowUp = ciStatus !== 'expected-fail-with-follow-up' || hasConcreteFollowUp

// Role attribution matrix (issue #56): only required when the manifest claims multi-agent mode.
// Single-agent PRs remain valid without a matrix — see docs/agent-workflow.md §4a.
const multiAgentClaim = fieldValue(agentReview, 'Mode') === 'multi-agent'
const roleAttributionSection = extractSection(content, 'Role attribution matrix')
const roleAttributionRows = rowsFromTable(parseMarkdownTable(roleAttributionSection))
const roleAttribution = validateRoleAttributionMatrix({
  rows: roleAttributionRows,
  multiAgentClaim,
  workflowProfile: fieldValue(agentReview, 'Workflow profile'),
  selfReviewDisclosure: fieldValue(agentReview, 'Self-review disclosure'),
})

const checks = [
  {
    name: 'implemented-issues',
    ok: /## Implemented issues\s+[\s\S]*(Closes|Implements) #\d+/m.test(content),
  },
  { name: 'related-issues', ok: hasSection(content, 'Related issues') },
  {
    name: 'workflow-evidence',
    ok:
      workflowEvidence !== null &&
      /Workflow-status comment:/m.test(workflowEvidence) &&
      /Handover comments:\s*(https?:\/\/\S+|exception:.+)/m.test(workflowEvidence) &&
      /Role-pass summary:/m.test(workflowEvidence) &&
      /Validation evidence:/m.test(workflowEvidence),
  },
  {
    name: 'agent-review-section',
    ok: agentReview !== null,
  },
  {
    name: 'agent-review-fields',
    ok: missingAgentFields.length === 0 && invalidAgentFields.length === 0,
    detail:
      missingAgentFields.length === 0 && invalidAgentFields.length === 0
        ? 'Implemented by, Launcher, Executor, Transport, Delegation boundary, Model / runtime, Review, Workflow profile, Merge owner, and Mode are filled in'
        : [
            missingAgentFields.length > 0 ? `missing: ${missingAgentFields.join(', ')}` : '',
            invalidAgentFields.length > 0 ? `invalid: ${invalidAgentFields.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('; '),
  },
  {
    name: 'ci-equivalent-validation',
    ok:
      ciValidation !== null &&
      ciStatusValid &&
      /Commands:/m.test(ciValidation) &&
      expectedFailHasFollowUp,
    detail:
      ciValidation === null
        ? 'missing CI-equivalent validation section'
        : !ciStatusValid
          ? 'Status must be passed, not-run-with-reason, or expected-fail-with-follow-up'
          : !/Commands:/m.test(ciValidation)
            ? 'missing Commands field/list'
            : !expectedFailHasFollowUp
              ? 'expected-fail-with-follow-up requires a concrete follow-up issue reference'
              : `Status=${ciStatus}`,
  },
  { name: 'follow-up-issues', ok: hasSection(content, 'Follow-up issues') },
  {
    name: 'regression-test-field',
    ok: regressionTestValid,
    detail: regressionTestValid
      ? regressionTestValue === null
        ? 'field absent (only required for bug fixes)'
        : `Regression test=${regressionTestValue}`
      : `invalid value "${regressionTestValue}" — must be "added" or "not-applicable:<reason>"`,
  },
  {
    name: 'role-attribution-matrix',
    ok: roleAttribution.ok,
    detail: roleAttribution.ok
      ? multiAgentClaim
        ? `multi-agent claim verified across ${roleAttributionRows.length} role attribution matrix row(s)`
        : 'not-applicable:single-agent'
      : roleAttribution.errors.join('; '),
  },
]

let failed = false
process.stdout.write(`[validate-pr-manifest] ${path}\n\n`)
for (const check of checks) {
  const status = check.ok ? 'PASS' : 'FAIL'
  process.stdout.write(`  ${status}  ${check.name}`)
  if (check.detail !== undefined) {
    process.stdout.write(`  -  ${check.detail}`)
  }
  process.stdout.write('\n')
  if (!check.ok) {
    failed = true
  }
}

process.stdout.write(`\nResult: ${failed ? 'FAILED' : 'READY'}\n`)
process.exit(failed ? 1 : 0)
