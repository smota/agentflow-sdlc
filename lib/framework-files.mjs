// The canonical list of framework-owned files. `sync` overwrites these whenever they are
// unmodified since the last install; `init` installs all of them plus the seed-once files below.
// Anything NOT in this list (docs/adr/, agent-workflow.config.json, docs/stack-conventions.md
// content, application code, etc.) is never touched by this CLI. AGENTS.md is seeded once on init
// as project-owned policy rather than framework-owned content.
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
  'docs/assisted-onboarding.md',
  'docs/assisted-update.md',
  'docs/environment-tools.md',
  'docs/release-versioning.md',
  'docs/agent-workflow.md',
  'docs/issue-standards.md',
  'docs/project-config.md',
  'docs/index.md',
  'docs/agent-routing.md',
  'docs/execution-targets.md',
  'docs/agents/agy-routing.md',
  'docs/agents/codex-routing.md',
  'docs/agents/claude-routing.md',
  'docs/agents/pi-routing.md',
  'docs/agents/qa-expert.md',
  'lib/role-routing.mjs',
  'lib/execution-targets.mjs',
  'lib/role-attribution.mjs',
  'lib/markdown-sections.mjs',
  'lib/branch-strategy.mjs',
  'lib/environment.mjs',
  'lib/release-versioning.mjs',
  'agents/workflows/orchestrate/SKILL.md',
  'agents/workflows/scan/SKILL.md',
  'agents/templates/role-pass.md',
  'agents/templates/pr-manifest.md',
  'agents/templates/workflow-status-comment.md',
  'agents/templates/handover-comment.md',
  'agents/templates/stack-conventions.md',
  'agents/tools/registry.md',
  'agents/evals/README.md',
  'scripts/validate-spec.mjs',
  'scripts/validate-bounded.mjs',
  'scripts/validate-pr-manifest.mjs',
  'scripts/validate-role-routing.mjs',
  'scripts/validate-role-attribution.mjs',
  'scripts/validate-release-versioning.mjs',
  'scripts/validate-release-closeout.mjs',
  'scripts/resolve-role-route.mjs',
  'scripts/resolve-execution-target.mjs',
  'scripts/validate-branch-strategy.mjs',
  'scripts/resolve-branch-strategy.mjs',
  'scripts/ensure-workflow-artifacts.mjs',
  'scripts/branch-cleanup-report.mjs',
  'scripts/issue-markdown.mjs',
  'scripts/integration-lifecycle.mjs',
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
  '.github/workflows/integration-lifecycle.yml',
]

// Copied by `init` and also by `sync` when the destination is missing. Existing destinations are
// never overwritten: the project owns and fills in the destination from first seed onward.
export const SEED_ONCE_FILES = [
  { from: 'AGENTS.md', to: 'AGENTS.md' },
  { from: 'agents/templates/stack-conventions.md', to: 'docs/stack-conventions.md' },
]

// Reconciliation note: if you manually merge framework content into a file a project already
// had (as opposed to letting `sync` install it verbatim), do NOT add that file's hash to the
// lockfile. A lockfile entry means "sync may safely fast-forward this to the framework's latest
// content" — for a hand-merged file, that would silently blow away the local additions on the
// next sync. Leave it unregistered so it keeps surfacing as a `conflicts` entry (never
// overwritten, always flagged) instead. Discovered the hard way piloting on a project with its
// own pre-existing CLAUDE.md/CODEX.md/.gitattributes.

export const LOCKFILE_NAME = 'agent-framework-lock.json'
