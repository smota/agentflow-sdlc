import { getCurrentBranch, isAllowedBranch, isTrunkBranch } from './hook-utils.mjs'

const branch = getCurrentBranch()

if (branch.length === 0) {
  process.exit(0)
}

if (isTrunkBranch(branch)) {
  process.stderr.write(
    [
      `Cannot write code on '${branch}'. Trunk branches are read-only for direct work.`,
      'Identify the GitHub issue and create a branch:',
      '  git checkout development && git checkout -b work/<theme>',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

if (!isAllowedBranch(branch)) {
  process.stderr.write(
    [
      `Branch '${branch}' does not follow the required convention.`,
      'Valid patterns:',
      '  work/<theme>                 (default workstream branch)',
      '  hotfix/<theme>               (production fix workstream)',
      '  spike/<theme>                (disposable research branch)',
      '  issue/<number>-<short-desc>  (compatibility branch during migration)',
      '  wt/<slug>                    (agent worktrees)',
      '  claude/<slug>                (Claude Code sessions)',
      'Start from development: git checkout development && git checkout -b work/<theme>',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

process.exit(0)
