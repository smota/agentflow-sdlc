// The canonical list of framework-owned files. `sync` overwrites these whenever they are
// unmodified since the last install; `init` installs all of them plus the seed-once files below.
// Anything NOT in this list (a project's own AGENTS.md, docs/adr/, agent-workflow.config.json,
// docs/stack-conventions.md content, application code, etc.) is never touched by this CLI.
//
// Known limitation (tracked as a framework follow-up, not solved here): `.claude/settings.json`,
// `.codex/hooks.json`, and `.agy/settings.json` are deliberately NOT in this list. In practice
// every project layers its own additions onto the generic hook wiring in those files (a
// `permissions.allow` list, extra SessionStart/Stop hooks, etc.), and this CLI's whole-file
// replace model would silently delete those additions on `init`/`sync`. Until this CLI supports
// a merge-aware mode for those three files, a project installs/updates the generic hook-wiring
// block in them by hand, using this repo's copies as the reference, and keeps its own additions.
export const FRAMEWORK_FILES = [
  'CLAUDE.md',
  'CODEX.md',
  'AGY.md',
  '.gitattributes',
  'docs/agent-workflow.md',
  'docs/issue-standards.md',
  'docs/project-config.md',
  'agents/workflows/orchestrate/SKILL.md',
  'agents/workflows/scan/SKILL.md',
  'agents/templates/role-pass.md',
  'agents/templates/pr-manifest.md',
  'agents/templates/workflow-status-comment.md',
  'agents/templates/stack-conventions.md',
  'agents/tools/registry.md',
  'agents/evals/README.md',
  'scripts/validate-spec.mjs',
  'scripts/validate-bounded.mjs',
  'scripts/validate-pr-manifest.mjs',
  'scripts/ensure-workflow-artifacts.mjs',
  'scripts/branch-cleanup-report.mjs',
  'scripts/issue-markdown.mjs',
  'scripts/verify-hooks.mjs',
  'scripts/verify-agent-workflow.mjs',
  '.github/hooks/check-commit-ready.mjs',
  '.github/hooks/check-issue-branch.mjs',
  '.github/hooks/hook-utils.mjs',
  '.github/hooks/post-commit-summary.mjs',
  '.github/hooks/prettier-on-write.mjs',
  '.github/hooks/session-status.mjs',
  '.github/hooks/post-checkout',
  '.github/hooks/post-merge',
  '.github/hooks/pre-commit',
  '.github/hooks/pre-push',
  '.github/ISSUE_TEMPLATE/bug-report.md',
  '.github/ISSUE_TEMPLATE/chore.md',
  '.github/ISSUE_TEMPLATE/epic-spec.md',
  '.github/ISSUE_TEMPLATE/exploratory-qa-session.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/pull-request-agent-review-template.md',
  '.github/agent-run-comment-template.md',
  '.github/workflows/validate-pr.yml',
]

// Copied once during `init` only, to a *different* target path, and never touched again — the
// project owns and fills in the destination from here on. `sync` never revisits these.
export const SEED_ONCE_FILES = [
  { from: 'agents/templates/stack-conventions.md', to: 'docs/stack-conventions.md' },
]

export const LOCKFILE_NAME = 'agent-framework-lock.json'
