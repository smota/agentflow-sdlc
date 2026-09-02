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
  "collaboration": {
    "defaultMode": "auto-minimal",
    "sensitiveSurfaces": ["security", "auth", "data", "infra", "billing"],
    "councilDomainThreshold": 3,
    "bilateralDomainThreshold": 2,
    "councilOnPublicContract": true,
    "councilOnMigration": true,
    "councilHelpers": ["risk-scout", "implementation-strategist", "testability-scout"],
    "discoveryHelpers": ["requirements-scout", "architecture-scout"],
    "councilSeats": [
      {
        "role": "agentflow:architect",
        "focus": "architecture and system boundaries",
        "required": true
      },
      {
        "role": "agentflow:tester",
        "focus": "testability and failure evidence",
        "required": true
      }
    ],
    "maxDelegates": 3,
    "maxDepth": 1,
    "maxIterations": 3,
    "fallbackModes": ["sequential", "manual"]
  },
  "extensions": {
    "enabledPacks": ["extensions/my-engineering-approach"]
  },
  "roleMethods": {
    "bindings": {
      "agentflow:analyst": [
        {
          "method": "agentflow:method:event-storming",
          "parameters": { "includeExternalActors": true }
        }
      ],
      "agentflow:developer": ["agentflow:method:tdd"]
    }
  },
  "platformRegistry": {
    "additionalPlatforms": []
  },
  "routing": {
    "defaultMode": "single-agent",
    "agents": {},
    "roles": {}
  }
}
```

Key routing and identity fields:

- `collaboration` controls deterministic complexity routing and portable execution limits without
  changing the lifecycle taxonomy. Projects may tune sensitive surfaces, domain thresholds,
  council/discovery helper roles, fallbacks, and delegate/depth/iteration bounds. Canonical council
  seats for role acceptance may be supplied as structured `councilSeats` entries with `role`,
  `focus`, and `required`; the handover owner is excluded and remains the decision owner. See
  [`role-collaboration.md`](role-collaboration.md).
  `sensitiveSurfaces` adds project-specific sensitive areas; built-in security/auth/data/infra/billing
  controls and the high-assurance human gate cannot be removed by this setting. An empty
  `fallbackModes` list blocks unavailable required intents instead of silently degrading them.

- `roleMethods.bindings` selects typed, role-bound method plays. Methods may add inputs, outputs,
  evidence, behavior, templates, and validators, but cannot transfer ownership, change core
  transitions, widen authority, or weaken gates. Inspect the effective contract with
  `node bin/cli.mjs roles resolve <role> --json`; see [`roles/methods.md`](roles/methods.md).

- `platformRegistry.additionalPlatforms` — optional identity-only registry entries for future
  harnesses/runtimes. Each entry has `slug`, `displayName`, `kind` (`agent-runtime | harness |
human`), and `routable: false`. Built-ins live in `manifests/runtime-platforms.json`; see
  [`runtime-platforms.md`](runtime-platforms.md). Registering identity does not invent route adapter,
  execution target, transport, or model.
- `routing.defaultMode` — defaults to `single-agent`; routing is optional and missing routing config
  keeps role execution with the current executor.
- `routing.agents.<slug>` — enables one routable registered platform (`agy`, `codex`, `claude`,
  `grok`, or `pi`) and points to its documented call/handover workflow.
- `routing.agents.<slug>.availabilityProbe` — optional `{ "executable": "codex", "args":
["--version"] }` probe. Routing invokes the executable directly with `shell: false`.
  Shell-string `availabilityCommand` values are unsupported.
- `routing.agents.<slug>.defaultExecutionTarget` — the `executionTarget` a bare mention of this
  agent slug resolves to (for example `claude-cli`, not `anthropic-api`) when routing selects it or
  when another agent asks "with `<slug>`" without an explicit target. Must be one of that slug's
  valid execution targets; omitting it falls back to the agent's built-in local-CLI default
  (`claude-cli`, `agy-cli`, `codex-cli`, `grok-cli`, or `pi-parent`). See
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
node bin/cli.mjs sdlc validate-authority --json
node scripts/resolve-role-route.mjs --role developer --current claude --json
node scripts/resolve-execution-target.mjs --agent claude --requested "with claude" --current-agent pi --json
node bin/cli.mjs providers inspect claude-cli --json
node bin/cli.mjs collaboration plan --mode advisory --provider claude-cli --json
node scripts/validate-extension-packs.mjs --allow-empty
node scripts/integration-lifecycle.mjs --event path/to/pull_request_event.json
node bin/cli.mjs doctor-env --json
```

See `docs/agent-routing.md` for the route-resolution and ticket handover comment workflow. See
`agents/templates/stack-conventions.md` for the companion doc that carries a project's role-persona
domain checklists (the parts of `docs/stack-conventions.md` this config file doesn't cover).

## Domain and operational authority

`sdlc.config.json` owns roles, paths, transitions, vocabulary, evidence policy, and action gates.
This file owns branches, CI commands, routing, extensions, provider/source bindings, and adoption
preferences. A domain field duplicated here fails `sdlc validate-authority`. Preview the deterministic
owner-precedence migration before applying it:

```bash
node bin/cli.mjs sdlc migrate-authority plan --target /path/to/project
node bin/cli.mjs sdlc migrate-authority apply --target /path/to/project --confirm <plan-token>
```

## Seed-once files

Transactional adoption seeds missing project-owned files such as `AGENTS.md`,
`docs/stack-conventions.md`, and `sdlc.config.json`. Existing seed-once files are never overwritten.
Managed-file conflicts block the plan until the project owner resolves them.
