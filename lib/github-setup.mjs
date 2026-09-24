import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CANONICAL_LABELS = [
  {
    name: 'epic',
    color: '3E4B9E',
    description: 'Parent tracking issue orchestrating child features',
  },
  { name: 'feature', color: '1D76DB', description: 'User-facing product capability' },
  { name: 'bug', color: 'D93F0B', description: 'Defect, regression, or security bug' },
  { name: 'dx', color: '0E8A16', description: 'Developer experience or workflow maintenance' },
  { name: 'tooling', color: '5319E7', description: 'CLI tooling, automation, and CI scripts' },
  { name: 'documentation', color: '0075CA', description: 'Documentation-first deliverables' },
  { name: 'qa', color: 'FBCA04', description: 'Exploratory QA sessions or evidence work' },
  { name: 'needs-test', color: 'B60205', description: 'Regression test needed before fix merges' },
  { name: 'role:product-manager', color: 'C5DEF5', description: 'Phase 0 Product Manager handoff' },
  { name: 'role:analyst', color: 'BFD4F2', description: 'Phase 1 Analyst acceptance criteria' },
  { name: 'role:architect', color: 'D4C5F9', description: 'Phase 2 Architecture design & ADRs' },
  { name: 'role:planner', color: 'F9D0C4', description: 'Phase 3 Implementation plan' },
  { name: 'role:developer', color: 'C2E0C6', description: 'Phase 4 Code implementation' },
  { name: 'role:tester', color: 'FEF2C0', description: 'Phase 5 Verification & test evidence' },
  { name: 'role:reviewer', color: 'BFDADC', description: 'Phase 6 Independent review' },
  { name: 'role:writer', color: 'E99695', description: 'Phase 7 Technical documentation' },
]

export const ISSUE_TEMPLATES = {
  'feature-request.md': `---
name: Feature request
about: Suggest a new capability or feature
title: 'feat: '
labels: feature
assignees: ''
---

## Background & Problem Statement

_Why is this needed? What problem does it solve?_

## Proposed Solution

_High-level summary of the proposed solution._

## Acceptance criteria

- [ ] Clear observable behavior 1
- [ ] Clear observable behavior 2

## Workflow classification

- **Profile:** bounded | standard | high-assurance
- **Change surfaces:** docs | UI | service | API | data | infra | security
`,
  'bug-report.md': `---
name: Bug report
about: Report a defect or regression
title: 'fix: '
labels: bug
assignees: ''
---

## Problem statement

**Expected behavior:**

**Actual behavior:**

## Steps to reproduce

1. Step 1
2. Step 2

## Acceptance criteria

- [ ] Defect resolved with regression test proving the fix

## Workflow classification

- **Profile:** bounded | standard | high-assurance
`,
  'chore.md': `---
name: Chore
about: Maintenance, process, documentation, or tooling
title: 'chore: '
labels: dx
assignees: ''
---

## Background & Problem Statement

_Describe the maintenance or tooling work._

## Proposed Solution

## Acceptance criteria

- [ ] Maintenance task complete and verified

## Workflow classification

- **Profile:** bounded | standard | high-assurance
`,
}

export const PR_TEMPLATE = `## Summary

<!-- High-level summary of changes -->

Closes #<issue-number>

## Workflow Evidence

- **Phase Passes:** Phase 1-5 completed
- **Role Verification:** Tested against canonical acceptance criteria

## Agent Review

- **Implemented by:** <runtime-platform>
- **Executor:** <execution-target>
- **Reviewed by:** <runtime-platform>
- **Independent reviewer:** YES | NO

## Checks

- [ ] All CI and repository validators pass
- [ ] No regression in test suite
`

export function setupGitHubGovernance({ targetDir = process.cwd(), write = false } = {}) {
  const operations = []

  // 1. Issue Templates
  const issueTemplateDir = join(targetDir, '.github', 'ISSUE_TEMPLATE')
  for (const [filename, content] of Object.entries(ISSUE_TEMPLATES)) {
    const targetPath = join(issueTemplateDir, filename)
    const exists = existsSync(targetPath)
    const matches = exists && readFileSync(targetPath, 'utf8') === content
    const status = matches ? 'unchanged' : exists ? 'conflict' : 'planned'

    operations.push({
      type: 'issue-template',
      path: targetPath,
      filename,
      status,
      content,
    })

    if (write && status === 'planned') {
      mkdirSync(issueTemplateDir, { recursive: true })
      writeFileSync(targetPath, content)
    }
  }

  // 2. PR Template
  const prTemplatePath = join(targetDir, '.github', 'pull_request_template.md')
  const prExists = existsSync(prTemplatePath)
  const prMatches = prExists && readFileSync(prTemplatePath, 'utf8') === PR_TEMPLATE
  const prStatus = prMatches ? 'unchanged' : prExists ? 'conflict' : 'planned'

  operations.push({
    type: 'pr-template',
    path: prTemplatePath,
    filename: 'pull_request_template.md',
    status: prStatus,
    content: PR_TEMPLATE,
  })

  if (write && prStatus === 'planned') {
    mkdirSync(join(targetDir, '.github'), { recursive: true })
    writeFileSync(prTemplatePath, PR_TEMPLATE)
  }

  // 3. Label manifest (can be applied via gh label create / gh cli)
  const labelManifestPath = join(targetDir, '.github', 'labels.json')
  const labelJson = `${JSON.stringify(CANONICAL_LABELS, null, 2)}\n`
  const labelExists = existsSync(labelManifestPath)
  const labelMatches = labelExists && readFileSync(labelManifestPath, 'utf8') === labelJson
  const labelStatus = labelMatches ? 'unchanged' : labelExists ? 'conflict' : 'planned'

  operations.push({
    type: 'labels-manifest',
    path: labelManifestPath,
    filename: 'labels.json',
    status: labelStatus,
    content: labelJson,
  })

  if (write && labelStatus === 'planned') {
    mkdirSync(join(targetDir, '.github'), { recursive: true })
    writeFileSync(labelManifestPath, labelJson)
  }

  return {
    ok: true,
    mode: write ? 'apply' : 'dry-run',
    targetDir,
    operations,
    labels: CANONICAL_LABELS,
    summary: {
      plannedCount: operations.filter((op) => op.status === 'planned').length,
      unchangedCount: operations.filter((op) => op.status === 'unchanged').length,
      conflictCount: operations.filter((op) => op.status === 'conflict').length,
    },
  }
}
