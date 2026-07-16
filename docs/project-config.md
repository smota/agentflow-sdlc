# Project configuration contract

The engines in this framework (`scripts/ensure-workflow-artifacts.mjs`, `scripts/validate-bounded.mjs`)
are stack-agnostic. A consuming project supplies its own values in a single root-level
`agent-workflow.config.json`, which these scripts read at runtime. Start with the guided checklist in [`project-setup.md`](project-setup.md), then use this page for the full field contract. Nothing here is required —
every field has a safe, fails-closed default — but without it, bounded-work classification will
never mark anything as bounded, and PR manifests will use placeholder CI commands.

## Shape

````json
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
  "capabilities": {
    "plan-before-edit": {
      "requiredFor": ["architect", "developer-planning", "developer"],
      "fallback": "framework-emulated"
    },
    "workflow-orchestration": {
      "preferred": "framework",
      "allowNative": true
    },
    "bounded-loop": {
      "allowedLoops": ["review-loop", "test-fix-loop"],
      "maxIterationsDefault": 3,
      "requiresStopCondition": true
    },
    "delegated-subagents": {
      "default": "optional",
      "maxParallel": 3,
      "readOnlyByDefault": true,
      "singleWriterRule": true
    }
  },
  "extensions": {
    "enabledPacks": ["extensions/my-engineering-approach"]
  },
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
node scripts/resolve-capability.mjs --capability plan-before-edit --execution-target claude-cli --required --json
node scripts/validate-extension-packs.mjs --allow-emptynode scripts/integration-lifecycle.mjs --event path/to/pull_request_event.json
node bin/cli.mjs doctor-env --json
````

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
