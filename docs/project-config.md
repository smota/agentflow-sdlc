# Project configuration contract

The engines in this framework (`scripts/ensure-workflow-artifacts.mjs`, `scripts/validate-bounded.mjs`)
are stack-agnostic. A consuming project supplies its own values in a single root-level
`agent-workflow.config.json`, which these scripts read at runtime. Nothing here is required —
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
  "routing": {
    "defaultMode": "single-agent",
    "agents": {
      "agy": {
        "enabled": true,
        "availabilityCommand": "agy --version",
        "callWorkflowDoc": "docs/agents/agy-routing.md"
      },
      "codex": {
        "enabled": true,
        "availabilityCommand": "codex --version",
        "callWorkflowDoc": "docs/agents/codex-routing.md"
      },
      "claude": {
        "enabled": true,
        "availabilityCommand": "claude --version",
        "callWorkflowDoc": "docs/agents/claude-routing.md"
      },
      "pi": {
        "enabled": true,
        "availabilityCommand": "pi --version",
        "callWorkflowDoc": "docs/agents/pi-routing.md"
      }
    },
    "roles": {
      "analyst": { "owner": "claude", "fallbacks": ["codex", "agy", "pi"] },
      "architect": { "owner": "claude", "fallbacks": ["codex", "agy", "pi"] },
      "developer-planning": { "owner": "claude", "fallbacks": ["codex", "agy", "pi"] },
      "developer": { "owner": "codex", "fallbacks": ["claude", "agy", "pi"] },
      "tester": { "owner": "codex", "fallbacks": ["claude", "agy", "pi"] },
      "review": { "owner": "claude", "fallbacks": ["codex"] },
      "tech-writer": { "owner": "agy", "fallbacks": ["claude", "codex", "pi"] },
      "pr-readiness": { "owner": "claude", "fallbacks": ["codex", "pi"] }
    }
  }
}
```

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
  defaults to `main -> staging -> development`.
- `branching.directEditDeniedBranches` — branches that reject direct implementation edits and
  direct pushes. By default this includes `main`, `staging`, and `development`.
- `branching.defaultPrTarget` — the target branch implementation PRs should use by default.
- `branching.promotionOrder` — ordered protected promotion path, defaulting to
  `development -> staging -> main`.
- `branching.workBranchPrefixes` — prefixes for bounded feature/work branches where implementation
  edits are allowed by default.
- `branching.compatibilityBranchPrefixes` — temporary or agent-specific branch prefixes that remain
  accepted during migration.
- `branching.requireBoundedWorkBranch` — when true, implementation work must happen on a configured
  work or compatibility branch, never directly on protected branches.
- `routing.defaultMode` — defaults to `single-agent`; routing is optional and missing routing config
  keeps role execution with the current executor.
- `routing.agents.<slug>` — enables one supported local agent CLI (`agy`, `codex`, `claude`, or
  `pi`), names its setup/availability command, and points to its documented call/handover workflow.
- `routing.roles.<role>.owner` — the core owner agent for a workflow role.
- `routing.roles.<role>.fallbacks` — ordered fallback agents used when the owner is unavailable due
  to setup, quota, or local availability. The owner must not appear in its own fallback list.

Validate branching and routing with:

```bash
node scripts/validate-branch-strategy.mjs
node scripts/resolve-branch-strategy.mjs --json
node scripts/validate-role-routing.mjs
node scripts/resolve-role-route.mjs --role developer --current claude --json
```

See `docs/agent-routing.md` for the route-resolution and ticket handover comment workflow. See
`agents/templates/stack-conventions.md` for the companion doc that carries a project's role-persona
domain checklists (the parts of `docs/stack-conventions.md` this config file doesn't cover).
