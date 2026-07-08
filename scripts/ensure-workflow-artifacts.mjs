#!/usr/bin/env node
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

function runGit(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function getArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return ''
  }
  return process.argv[index + 1] ?? ''
}

function resolveIssueNumber() {
  const fromArg = getArg('--issue')
  if (fromArg.length > 0) {
    return fromArg
  }

  const branch = runGit(['branch', '--show-current'])
  const branchMatch = branch.match(/^issue\/([0-9]+)/)
  if (branchMatch?.[1]) {
    return branchMatch[1]
  }

  if (existsSync('SPEC.md')) {
    const contents = readFileSync('SPEC.md', 'utf8')
    const jsonMatch = contents.match(/"number"\s*:\s*([0-9]+)/)
    if (jsonMatch?.[1]) {
      return jsonMatch[1]
    }
    const markdownMatch = contents.match(/^# Issue #([0-9]+):/m)
    if (markdownMatch?.[1]) {
      return markdownMatch[1]
    }
  }

  return ''
}

function ensureFile(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(path)) {
    writeFileSync(path, content)
    return 'created'
  }
  return 'kept'
}

// Project-owned config: a project supplies its own CI-equivalent command list here so this
// generic script never needs to hardcode a package manager, workspace filter syntax, or package
// names. See docs/stack-conventions.md for the contract. Falls back to placeholders when absent.
const CONFIG_PATH = 'agent-workflow.config.json'

function loadCiCommands() {
  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
      if (Array.isArray(config.ciCommands) && config.ciCommands.length > 0) {
        return config.ciCommands
      }
    } catch {
      // fall through to placeholders on any parse/shape error
    }
  }
  return [
    '<lint command>',
    '<typecheck command(s), one per package>',
    '<test command>',
    '<build command>',
  ]
}

const issueNumber = resolveIssueNumber()
if (issueNumber.length === 0) {
  process.stderr.write('[ensure-workflow-artifacts] issue number could not be resolved\n')
  process.exit(1)
}

const branch = runGit(['branch', '--show-current'])
const title = getArg('--title') || `<title for #${issueNumber}>`
const issueDir = join('.agent-runs', 'issues', issueNumber)
const passesDir = join(issueDir, 'passes')
mkdirSync(passesDir, { recursive: true })

const workflowResult = ensureFile(
  join(issueDir, 'workflow.md'),
  `# Issue #${issueNumber} Workflow Ledger\n\n- Profile: <bounded | standard | high-assurance>\n- Risk: <low | medium | high>\n- Effort: <low | medium | high>\n- Change surface: <docs | ui | service | api | data | infra | security>\n- Branch: ${branch || '<branch>'}\n- State: planning\n\n## Passes\n\n1. Analyst — pending\n2. Architect — pending\n3. Developer planning — pending\n4. Developer — pending\n5. Tester — pending\n6. Review — pending\n7. Tech writer — pending\n8. PR readiness — pending\n\n## Notes\n\n- Issue: #${issueNumber} — ${title}\n`,
)

const ciCommandsBlock = loadCiCommands()
  .map((command) => `  - \`${command}\``)
  .join('\n')

const manifestResult = ensureFile(
  join(issueDir, 'pr-manifest.md'),
  `## Implemented issues\n\n- Closes #${issueNumber}\n\n## Related issues\n\n- none\n\n## Workflow evidence\n\n- Workflow-status comment: <GitHub issue comment URL or "to be posted before PR">\n- Handover comments: <GitHub issue comment/thread URL(s) for role handovers> | exception:<reason no role transition occurred>\n- Role-pass summary: <summarize phases completed and any blockers>\n- Validation evidence: <commands and results>\n\n## CI-equivalent validation\n\n- Status: passed | not-run-with-reason | expected-fail-with-follow-up\n- Commands:\n${ciCommandsBlock}\n- Notes: <none, reason not run, or expected failure summary with follow-up issue>\n\n## Role attribution matrix\n\n<!-- Required when Agent review's Mode is multi-agent; omit rows for single-agent runs. -->\n\n| Phase | Role | Planned owner | Actual agent | Executor | Context boundary | Independence boundary | Status |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| <number> | <role> | <agent> | <agent> | <executionTarget> | <contextBoundary> | independent \\| self-review \\| not-applicable | pass \\| blocked \\| returned \\| skipped |\n\n## Agent review\n\n- Implemented by: human | claude | codex | agy | pi\n- Launcher: human | claude | codex | agy | pi\n- Executor: claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | human\n- Transport: local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual\n- Delegation boundary: current-session | child-subagent | separate-local-session | child-worktree | human-handoff\n- Model / runtime: <freeform identifier>\n- Review: self-review | human-review-requested | human-reviewed\n- Workflow profile: bounded | standard | high-assurance\n- Merge owner: human/operator | auto-merge-requested:\`gh pr merge --squash --delete-branch --auto\`\n- Fallback chain: none | original agent -> backup agent\n- Mode: single-agent | multi-agent\n- Self-review disclosure: not-applicable | <rationale for developer and review sharing the same intelligence>\n\n## Follow-up issues\n\n- none\n`,
)

process.stdout.write(
  JSON.stringify(
    {
      issueNumber,
      branch,
      files: {
        workflow: workflowResult,
        manifest: manifestResult,
      },
      passesDir,
    },
    null,
    2,
  ),
)
