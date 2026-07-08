# Project setup choices

Use this guide after installing the framework into a consuming project. It turns the major choices into a short checklist so teams can adopt the workflow without rediscovering policy in every session.

The safe default is **single-agent**, multi-role execution: one executor moves through the phases in [`docs/agent-workflow.md`](agent-workflow.md), records role-pass evidence, opens a PR, and leaves merge ownership to a human/operator unless told otherwise. Optional multi-agent routing is available when a project explicitly configures it.

## Quick checklist

1. **Choose enabled agents** — decide which local CLIs are available: `claude`, `codex`, `agy`, and/or `pi`.
2. **Choose execution mode** — keep `single-agent` unless role routing adds clear value.
3. **Choose role owners/fallbacks** — if multi-agent routing is allowed, assign owners and fallbacks per role.
4. **Choose branch strategy** — set trunk, integration, protected branches, and allowed work branch prefixes.
5. **Choose validation commands** — list the CI-equivalent commands copied into PR manifests.
6. **Choose bounded-work rules** — define small safe paths and sensitive areas that require higher assurance.
7. **Record merge expectations** — human/operator merge by default; document any explicit auto-merge command.
8. **Validate setup** — run the validators before treating the project as configured.

## Minimal single-agent config

Start here when a project wants the default workflow and no role routing.

```json
{
  "ciCommands": ["pnpm lint", "pnpm test", "pnpm build"],
  "bounded": {
    "allowedExactPaths": ["README.md"],
    "allowedPathPrefixes": ["docs/", "src/"],
    "deniedPathFragments": ["/auth/", "/billing/", "/migrations/"]
  },
  "branching": {
    "trunk": "main",
    "integration": "main",
    "directEditDeniedBranches": ["main"],
    "defaultPrTarget": "main",
    "workBranchPrefixes": ["work/", "fix/", "feature/", "chore/"],
    "requireBoundedWorkBranch": true
  },
  "routing": {
    "defaultMode": "single-agent"
  }
}
```

This keeps every role with the active executor. It still records phase evidence, handover comments when required, workflow-status comments, commits, and PR manifests.

## Optional multi-agent routing config

Use this only when the project has a reason to route specific roles to different local agent CLIs.

```json
{
  "routing": {
    "defaultMode": "single-agent",
    "agents": {
      "claude": {
        "enabled": true,
        "availabilityCommand": "claude --version",
        "callWorkflowDoc": "docs/agents/claude-routing.md"
      },
      "codex": {
        "enabled": true,
        "availabilityCommand": "codex --version",
        "callWorkflowDoc": "docs/agents/codex-routing.md"
      },
      "agy": {
        "enabled": true,
        "availabilityCommand": "agy --version",
        "callWorkflowDoc": "docs/agents/agy-routing.md"
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
      "tester": { "owner": "codex", "fallbacks": ["claude", "pi"] },
      "review": { "owner": "claude", "fallbacks": ["codex", "pi"] },
      "tech-writer": { "owner": "agy", "fallbacks": ["claude", "codex", "pi"] },
      "pr-readiness": { "owner": "claude", "fallbacks": ["codex", "pi"] }
    }
  }
}
```

Routing is optional. If routing config is absent or a role is not configured, the resolver keeps execution with the current single agent. When ownership changes or a fallback is used, record that in handover evidence.

## Branch strategy choices

A simple project can use `main` as both trunk and default PR target. This repository uses a two-tier `development -> main` policy with no `staging` branch:

```json
{
  "branching": {
    "trunk": "main",
    "releaseCandidate": null,
    "integration": "development",
    "directEditDeniedBranches": ["main", "development"],
    "defaultPrTarget": "development",
    "promotionOrder": ["development", "main"],
    "workBranchPrefixes": ["work/", "feature/", "fix/", "hotfix/", "spike/", "chore/"],
    "compatibilityBranchPrefixes": ["issue/", "wt/", "claude/"],
    "requireBoundedWorkBranch": true
  }
}
```

A project with staged promotion can separate integration, release-candidate, and trunk branches:

```json
{
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
  }
}
```

See [`project-config.md`](project-config.md) for the full config contract and [`agent-routing.md`](agent-routing.md) for route resolution and handover details.

## Setup validation

Run these commands from the consuming project after editing `agent-workflow.config.json`:

```bash
node scripts/validate-role-routing.mjs
node scripts/resolve-role-route.mjs --role developer --current claude --json
node scripts/validate-branch-strategy.mjs
node scripts/resolve-branch-strategy.mjs --json
node scripts/validate-bounded.mjs --json
```

Before PR readiness, also run the repository's normal validation commands and include the results in the PR manifest.

## Compliance notes

Keep project choices committed and easy to review. If the project changes agents, branch policy, validation commands, or bounded-work rules, update this config and the related docs in the same PR. If a related improvement is out of scope, open a follow-up issue instead of leaving hidden TODOs.
