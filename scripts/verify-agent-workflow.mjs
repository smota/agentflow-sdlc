import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = process.cwd()
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-workflow-'))

function run(command, args, cwd = tempRoot) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

try {
  run('git', ['init', '--initial-branch=development'])
  run('git', ['config', 'user.name', 'Codex'])
  run('git', ['config', 'user.email', 'codex@example.com'])
  writeFileSync(join(tempRoot, 'README.md'), '# temp\n')
  run('git', ['add', 'README.md'])
  run('git', ['commit', '-m', 'init'])

  writeFileSync(
    join(tempRoot, 'SPEC.md'),
    JSON.stringify({
      number: 496,
      title: 'chore: automate deterministic workflow tracking and enforcement',
      body: '## Open questions\n\nNone.\n',
    }),
  )

  run('git', ['checkout', '-b', 'work/agent-workflow'])
  mkdirSync(join(tempRoot, '.agent-runs'), { recursive: true })

  const ensureScript = resolve(repoRoot, 'scripts', 'ensure-workflow-artifacts.mjs')
  const validateScript = resolve(repoRoot, 'scripts', 'validate-pr-manifest.mjs')
  const cleanupScript = resolve(repoRoot, 'scripts', 'branch-cleanup-report.mjs')

  const ensureOutput = run(process.execPath, [
    ensureScript,
    '--issue',
    '496',
    '--title',
    'workflow automation',
  ])
  const ensureJson = JSON.parse(ensureOutput)
  assert.equal(ensureJson.issueNumber, '496')

  const workflowPath = join(tempRoot, '.agent-runs', 'issues', '496', 'workflow.md')
  const manifestPath = join(tempRoot, '.agent-runs', 'issues', '496', 'pr-manifest.md')
  assert.match(readFileSync(workflowPath, 'utf8'), /Branch: work\/agent-workflow/)
  const manifestTemplate = readFileSync(manifestPath, 'utf8')
  assert.match(manifestTemplate, /Closes #496/)
  assert.match(manifestTemplate, /## Agent review/)
  assert.match(manifestTemplate, /## CI-equivalent validation/)

  writeFileSync(
    manifestPath,
    manifestTemplate
      .replace('Implemented by: human | claude | codex | agy | pi', 'Implemented by: codex')
      .replace('Launcher: human | claude | codex | agy | pi', 'Launcher: codex')
      .replace(
        'Executor: claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | human',
        'Executor: codex-cli',
      )
      .replace(
        'Transport: local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual',
        'Transport: local-cli',
      )
      .replace(
        'Delegation boundary: current-session | child-subagent | separate-local-session | child-worktree | human-handoff',
        'Delegation boundary: current-session',
      )
      .replace('<freeform identifier>', 'workflow verifier')
      .replace(
        '<GitHub issue comment/thread URL(s) for role handovers> | exception:<reason no role transition occurred>',
        'https://github.com/example/example-repo/issues/496#issuecomment-2',
      )
      .replace('self-review | human-review-requested | human-reviewed', 'self-review')
      .replace('bounded | standard | high-assurance', 'bounded')
      .replace('single-agent | multi-agent', 'single-agent')
      .replace(
        'human/operator | auto-merge-requested:`gh pr merge --squash --delete-branch --auto`',
        'human/operator',
      )
      .replace('passed | not-run-with-reason | expected-fail-with-follow-up', 'passed')
      .replace(
        '<GitHub issue comment URL or "to be posted before PR">',
        'https://github.com/example/example-repo/issues/496#issuecomment-1',
      )
      .replace('<summarize phases completed and any blockers>', 'Verifier completed phases.')
      .replace('<commands and results>', 'Verifier commands passed.')
      .replace('<none, reason not run, or expected failure summary with follow-up issue>', 'none'),
  )

  const validateOutput = run(process.execPath, [validateScript, '--path', manifestPath])
  assert.match(validateOutput, /Result: READY/)

  run('git', ['remote', 'add', 'origin', tempRoot])
  const cleanupOutput = run(process.execPath, [cleanupScript, '--base', 'origin/development'])
  assert.match(cleanupOutput, /Branch cleanup candidates merged into/)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}

process.stdout.write('Agent workflow verification passed.\n')
