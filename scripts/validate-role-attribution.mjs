#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractSection, fieldValue, parseMarkdownTable } from '../lib/markdown-sections.mjs'
import { rowsFromTable, validateRoleAttributionMatrix } from '../lib/role-attribution.mjs'

// Standalone role-attribution check for any markdown evidence surface (PR manifest,
// workflow-status comment export, or handover-comment export) — not only PR manifests, which
// `validate-pr-manifest.mjs` already gates on merge. Useful for validating a workflow-status
// comment body before it is posted.

function getArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return ''
  }
  return process.argv[index + 1] ?? ''
}

export function validateRoleAttributionFile(path) {
  const content = readFileSync(path, 'utf8')
  const agentReview =
    extractSection(content, 'Agent review') ?? extractSection(content, 'Workflow Status')
  const roleAttributionSection =
    extractSection(content, 'Role attribution matrix', 2) ??
    extractSection(content, 'Role attribution matrix', 3)
  const rows = rowsFromTable(parseMarkdownTable(roleAttributionSection))
  const modeValue = fieldValue(agentReview, 'Mode') ?? fieldValue(content, 'Mode')
  const multiAgentClaim = modeValue === 'multi-agent'

  return validateRoleAttributionMatrix({
    rows,
    multiAgentClaim,
    workflowProfile: fieldValue(agentReview, 'Workflow profile'),
    selfReviewDisclosure: fieldValue(agentReview, 'Self-review disclosure'),
  })
}

export function main() {
  const path = getArg('--path')
  if (!path) {
    process.stderr.write('[validate-role-attribution] --path <file> is required\n')
    process.exit(1)
  }
  if (!existsSync(path)) {
    process.stderr.write(`[validate-role-attribution] missing file: ${path}\n`)
    process.exit(1)
  }

  const result = validateRoleAttributionFile(path)

  process.stdout.write(`[validate-role-attribution] ${path}\n\n`)
  if (result.ok) {
    process.stdout.write('  PASS  role-attribution-matrix\n')
  } else {
    for (const error of result.errors) {
      process.stdout.write(`  FAIL  ${error}\n`)
    }
  }
  for (const warning of result.warnings) {
    process.stdout.write(`  WARN  ${warning}\n`)
  }

  process.stdout.write(`\nResult: ${result.ok ? 'READY' : 'FAILED'}\n`)
  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
