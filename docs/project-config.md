# Project configuration contract

The engines in this framework (`scripts/ensure-workflow-artifacts.mjs`, `scripts/validate-bounded.mjs`)
are stack-agnostic. A consuming project supplies its own values in a single root-level
`agent-workflow.config.json`, which these scripts read at runtime. Start with the guided checklist in [`project-setup.md`](project-setup.md), then use this page for the full field contract. Nothing here is required —
every field has a safe, fails-closed default — but without it, bounded-work classification will
never mark anything as bounded, and PR manifests will use placeholder CI commands.

## Shape

```json
{
  "ciCommands": [
    "pnpm lint",
    "pnpm --filter @scope/pkg-a exec tsc --noEmit",
    "pnpm test:coverage",
    "pnpm build"
  ],
  "bounded": {
    "maxFiles": 50,
    "maxChangedLines": 10000,
    "defaultBase": "origin/main",
    "deniedPathFragments": ["/auth/", "/billing/", "/migrations/"],
    "allowedExactPaths": ["README.md"],
    "allowedPathPrefixes": ["docs/", "packages/ui/src/"],
    "allowedPathFragments": ["/test/fixtures/", "/__fixtures__/"],
    "sensitiveAdditionPattern": "(TenantGuard|stripe|process\\.env|secret)"
  },
  "branching": {
    "trunk": "main",
    "releaseCandidate": "staging",
    "integration": "development",
    "directEditDeniedBranches": ["main", "staging", "development"],
    "defaultPrTarget": "development",
    "promotionOrder": ["development", "staging", "main"],
    "workBranchPrefixes": ["work/", "feature/", "fix/", "hotfix/", "spike/"],
    "compatibilityBranchPrefixes": ["issue/", "wt/", "claude/"],
    "requireBoundedWorkBranch": true
  },
  "integrationLifecycle": {
    "integrationBranch": "development",
    "trunkBranch": "main",
    "referenceKeywords": ["Implements", "Closes"],
    "addLabels": ["integrated:development", "awaiting-release"],
    "closeIntegratedIssues": true
  },
  "releaseVersioning": {
    "strategy": "main.minor.fix",
    "segments": ["main", "minor", "fix"],
    "tagFormat": "v${version}",
    "packageVersionSource": "package.json",
    "requireExplicitApproval": true,
    "allowPrerelease": true
  },
  "routing": {
    "defaultMode": "single-agent",
    "agents": {
      "agy": {
        "enabled": true,
        "availabilityCommand": "agy --version",
        "callWorkflowDoc": "docs/agents/agy-routing.md",
        "defaultExecutionTarget": "agy-cli"
      },
      "codex": {
        "enabled": true,
        "availabilityCommand": "codex --version",
        "callWorkflowDoc": "docs/agents/codex-routing.md",
        "defaultExecutionTarget": "codex-cli"
      },
      "claude": {
        "enabled": true,
        "availabilityCommand": "claude --version",
        "callWorkflowDoc": "docs/agents/claude-routing.md",
        "defaultExecutionTarget": "claude-cli"
      },
      "pi": {
        "enabled": true,
        "availabilityCommand": "pi --version",
        "callWorkflowDoc": "docs/agents/pi-routing.md",
        "defaultExecutionTarget": "pi-parent"
      }
    },
    "roles": {
      "analyst": { "owner": "pi", "fallbacks": ["claude", "agy", "codex"] },
      "architect": { "owner": "agy", "fallbacks": ["pi", "claude", "codex"] },
      "developer-planning": { "owner": "pi", "fallbacks": ["claude", "agy", "codex"] },
      "developer": { "owner": "claude", "fallbacks": ["codex", "agy", "pi"] },
      "tester": { "owner": "pi", "fallbacks": ["claude", "codex"] },
      "review": { "owner": "agy", "fallbacks": ["codex", "pi"] },
      "tech-writer": { "owner": "claude", "fallbacks": ["agy", "codex", "pi"] },
      "pr-readiness": { "owner": "pi", "fallbacks": ["agy", "codex"] }
    }
  }
}
```

This example alternates roles across `pi`, `claude`, and `agy` (with `codex` as a shared fallback),
and deliberately keeps `developer` (`claude`) and `review` (`agy`) on different agents — see
[`agent-workflow.md` §4a](agent-workflow.md#4a-role-alternation-and-attribution-multi-agent-mode)
and [`agent-routing.md`](agent-routing.md#example-pi--claude-cli--agy-role-alternation) for the
role-alternation-plan and attribution-matrix contract this table feeds. A project with no reason to
alternate roles can omit `routing` entirely or keep `routing.defaultMode: "single-agent"`; single-agent
mode never requires a role attribution matrix.

This repository commits its own `agent-workflow.config.json` with a two-tier policy:
`development -> main`. It sets `releaseCandidate` to `null` because this project does not use a
`staging` branch.

## Fields

- `ciCommands` — the exact lint/typecheck/test/build commands this project's CI runs, used to
  pre-fill the PR manifest template's `## CI-equivalent validation` section.
- `bounded.maxFiles` / `bounded.maxChangedLines` — hard limits on Lane B (bounded, self-reviewable)
  diffs.
- `bounded.defaultBase` — the branch bounded diffs are compared against when `--base` isn't passed.
- `bounded.deniedPathFragments` — any changed path containing one of these fragments is never
  bounded, regardless of the allow-list below.
- `bounded.allowedExactPaths` / `allowedPathPrefixes` / `allowedPathFragments` — the only paths
  eligible for bounded classification. With this empty (the default), nothing is bounded.
- `bounded.sensitiveAdditionPattern` — a regex (case-insensitive) checked against added diff lines;
  a match disqualifies the diff from bounded status even if every path is otherwise allowed.
- `branching.trunk` / `releaseCandidate` / `integration` — protected branch tiers. Missing config
  defaults to `main -> staging -> development`; set `releaseCandidate` to `null` for projects that
  do not use a staging/release-candidate branch.
- `branching.directEditDeniedBranches` — branches that reject direct implementation edits and
  direct pushes. By default this includes `main`, `staging`, and `development`; projects without a
  release-candidate branch should list only their actual protected branches.
- `branching.defaultPrTarget` — the target branch implementation PRs should use by default.
- `branching.promotionOrder` — ordered protected promotion path, defaulting to
  `development -> staging -> main`; for a two-tier project use `development -> main`.
- `branching.workBranchPrefixes` — prefixes for bounded feature/work branches where implementation
  edits are allowed by default.
- `branching.compatibilityBranchPrefixes` — temporary or agent-specific branch prefixes that remain
  accepted during migration.
- `branching.requireBoundedWorkBranch` — when true, implementation work must happen on a configured
  work or compatibility branch, never directly on protected branches.
- `integrationLifecycle.integrationBranch` — branch whose merged PRs mark implementation issues as
  integrated; defaults to the branch strategy's default PR target.
- `integrationLifecycle.trunkBranch` — final release/trunk branch named in integration comments.
- `integrationLifecycle.referenceKeywords` — PR-body implementation/closure keywords parsed by
  `scripts/integration-lifecycle.mjs`; defaults to `Implements` and `Closes`. Do not include
  related-reference keywords such as `Refs` unless the project intentionally wants those references
  to be labeled and closed as integrated work.
- `integrationLifecycle.addLabels` — labels applied to linked issues after integration, commonly
  `integrated:development` and `awaiting-release`.
- `integrationLifecycle.closeIntegratedIssues` — when true, linked implementation issues are closed
  after a merged integration PR is processed.
- `releaseVersioning.strategy` — release naming strategy; defaults to `main.minor.fix`.
- `releaseVersioning.segments` — ordered bump names. Defaults to `main`, `minor`, `fix`.
- `releaseVersioning.tagFormat` — tag template containing `${version}`; defaults to `v${version}`.
- `releaseVersioning.packageVersionSource` — package metadata source such as `package.json`, or `null`
  for non-package projects.
- `releaseVersioning.requireExplicitApproval` — when true, agents must not tag, push, or publish a
  release without explicit operator approval.
- `releaseVersioning.allowPrerelease` — whether pre-release suffixes such as `1.2.3-rc.1` are allowed.
- `routing.defaultMode` — defaults to `single-agent`; routing is optional and missing routing config
  keeps role execution with the current executor.
- `routing.agents.<slug>` — enables one supported local agent CLI (`agy`, `codex`, `claude`, or
  `pi`), names its setup/availability command, and points to its documented call/handover workflow.
  `doctor-env` uses `availabilityCommand` for read-only environment reporting and never executes
  installation commands.
- `routing.agents.<slug>.defaultExecutionTarget` — the `executionTarget` a bare mention of this
  agent slug resolves to (for example `claude-cli`, not `anthropic-api`) when routing selects it or
  when another agent asks "with `<slug>`" without an explicit target. Must be one of that slug's
  valid execution targets; omitting it falls back to the agent's built-in local-CLI default
  (`claude-cli`, `agy-cli`, `codex-cli`, or `pi-parent`). See
  [`execution-targets.md`](execution-targets.md).
- `routing.roles.<role>.owner` — the core owner agent for a workflow role. Together,
  `routing.roles` is the project's `roleAlternationPlan` — the planned role-to-agent assignment
  evaluated against actual execution evidence; see
  [`agent-workflow.md` §4a](agent-workflow.md#4a-role-alternation-and-attribution-multi-agent-mode).
- `routing.roles.<role>.fallbacks` — ordered fallback agents used when the owner is unavailable due
  to setup, quota, or local availability. The owner must not appear in its own fallback list.

Validate branching and routing with:

```bash
node scripts/validate-branch-strategy.mjs
node scripts/resolve-branch-strategy.mjs --json
node scripts/validate-role-routing.mjs
node scripts/resolve-role-route.mjs --role developer --current claude --json
node scripts/resolve-execution-target.mjs --agent claude --requested "with claude" --current-agent pi --json
node scripts/integration-lifecycle.mjs --event path/to/pull_request_event.json
node bin/cli.mjs doctor-env --json
```

See `docs/agent-routing.md` for the route-resolution and ticket handover comment workflow. See
`agents/templates/stack-conventions.md` for the companion doc that carries a project's role-persona
domain checklists (the parts of `docs/stack-conventions.md` this config file doesn't cover).

## Seed-once and hand-merged files

`init` and `sync` both seed missing seed-once files such as `AGENTS.md` and
`docs/stack-conventions.md`. Existing seed-once files are never overwritten because the consuming
project owns them after first creation.

When a project already had a file at a framework-owned path and you manually merge framework content
into that local file, mark it as hand-merged instead of registering its hash as normally tracked:

```bash
node bin/cli.mjs mark-merged CLAUDE.md --target /path/to/project
```

Hand-merged files are reported separately by `sync` and `doctor` and are never fast-forwarded over
local project additions.
