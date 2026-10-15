# Project setup choices

Use this guide after installing the framework into a consuming project. It turns the major choices into a short checklist so teams can adopt the workflow without rediscovering policy in every session.

The safe default is **single-agent**, multi-role execution: one executor moves through the phases in [`docs/agent-workflow.md`](agent-workflow.md), records role-pass evidence, opens a PR, and leaves merge ownership to a human/operator unless told otherwise. Optional multi-agent routing is available when a project explicitly configures it.

## Execution substrate selection (`S0` / `S1` / `S2`)

OpenRig is optional. AgentFlow adapts its execution topology to the CLIs, model capacity, and orchestration tools installed on your machine:

| Substrate Tier                                      | Requirements                                                               | Best For                                                                    | How Roles & Reviews Run                                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`S0`: Single-CLI + Native L2 Subagents**          | 1 agent CLI (`agy`, `claude`, `codex`, or `pi`)                            | Individual developers, single subscription, `P0`–`P2` tasks                 | Single parent session runs workflow phases and spawns native L2 subagents (`effort: low` for discovery/QA; fresh subagent for Phase 6 review with `selfReviewDisclosure`). |
| **`S1`: Multi-CLI Orthogonal Routing (No OpenRig)** | 2+ agent CLIs (e.g., `agy` + `codex` or `claude` + `agy`), no `rig` daemon | Cross-model Four-Eyes independence without persistent tmux daemons          | `resolve-role-route.mjs` routes Builder (e.g., `Gemini 4 Argon`) and Reviewer (e.g., `GPT-6 Astra`) to distinct CLIs (`effort: medium`).                                   |
| **`S2`: OpenRig Lean 4-Seat Squad**                 | OpenRig (`rig`) + 1–3 agent CLIs                                           | Autonomous multi-slice queues, parallel `.worktrees/*`, continuous steering | Persistent 4-seat delivery squad (`orch.arch`, `dev.build`, `dev.qa`, `rev.review`) + L2 subagents inside `.worktrees/<branch>`. See [`OPENRIG.md`](../OPENRIG.md).        |

## Quick checklist

1. **Choose execution substrate (`S0`, `S1`, or `S2`)** — inspect local CLIs and OpenRig availability via `agentflow-sdlc doctor-env`.
2. **Choose routable platforms** — decide which built-in local adapters are available: `claude`,
   `codex`, `agy`, and/or `pi`. Evidence may use any identity from runtime platform registry.
3. **Choose execution mode & effort policy** — keep `single-agent` (`S0`) unless multi-CLI routing (`S1`) or OpenRig (`S2`) adds clear value; keep default loop effort at `medium` (`low` for QA/discovery) to prevent high-effort context degradation.
4. **Choose role owners/fallbacks** — if multi-agent routing is allowed, assign orthogonal owners and fallbacks per role.
5. **Choose branch strategy** — set trunk, integration, protected branches, and allowed work branch prefixes.
6. **Choose validation commands** — list the CI-equivalent commands copied into PR manifests.
7. **Choose bounded-work rules** — define small safe paths and sensitive areas that require higher assurance.
8. **Record merge expectations** — human/operator merge by default; document any explicit auto-merge command.
9. **Enable integration lifecycle automation** — install/keep `.github/workflows/integration-lifecycle.yml` so issues close when PRs merge into the configured integration branch.
10. **Choose release versioning** — keep default `main.minor.fix` or configure SemVer, CalVer, custom tags, package version source, and release approval expectations.
11. **Validate environment** — run `agentflow-sdlc doctor-env` to check tools and install guidance without installing anything.
12. **Validate setup** — run the validators before treating the project as configured.

## Minimal single-agent config (`S0`)

Start here when a project wants the default workflow and no external role routing.

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

## Release versioning choices

The default release strategy is `main.minor.fix`: `main` for breaking/compatibility-impacting releases, `minor` for additive backwards-compatible capabilities, and `fix` for corrections. Projects can choose SemVer names, CalVer/date-based versions, custom tag formats, package-backed versions, or no package metadata. Document choices in `agent-workflow.config.json` under `releaseVersioning` and see [`release-versioning.md`](release-versioning.md).

Setup prompts:

- Which release strategy should this project use: default `main.minor.fix`, SemVer, CalVer, or custom?
- Which branch creates releases: `main`, `development`, or a release-candidate branch?
- Which file, if any, owns package version metadata?
- What tag format is expected?
- Who must approve tags, pushes, and GitHub Releases?

## Integration lifecycle automation

Adopting projects should keep the framework-owned `.github/workflows/integration-lifecycle.yml` and
`scripts/integration-lifecycle.mjs` installed through transactional adoption. The workflow needs these token
permissions:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: read
```

For integration-branch PRs, use `Implements #...` for implemented issues and `Refs #...` for related
issues. After the PR merges into the configured integration branch, the automation comments on issues
referenced by implementation/closure keywords such as `Implements #...` or `Closes #...`, applies
configured labels, and closes them. It intentionally ignores `Refs #...` related issues. Track
release to trunk/main with a separate promotion issue.

## Optional multi-agent routing config

Use this only when the project has a reason to route specific roles to different local agent CLIs.
`routing.roles` is the project's `roleAlternationPlan`; see
[`agent-workflow.md` §4a](agent-workflow.md#4a-role-alternation-and-attribution-multi-agent-mode)
for how planned ownership becomes evidenced multi-agent claims.

```json
{
  "routing": {
    "defaultMode": "optional-multi-agent",
    "agents": {
      "pi": {
        "enabled": true,
        "availabilityProbe": { "executable": "pi", "args": ["--version"] },
        "callWorkflowDoc": "docs/agents/pi-routing.md"
      },
      "claude": {
        "enabled": true,
        "availabilityProbe": { "executable": "claude", "args": ["--version"] },
        "defaultExecutionTarget": "claude-cli",
        "callWorkflowDoc": "docs/agents/claude-routing.md"
      },
      "agy": {
        "enabled": true,
        "availabilityProbe": { "executable": "agy", "args": ["--version"] },
        "defaultExecutionTarget": "agy-cli",
        "callWorkflowDoc": "docs/agents/agy-routing.md"
      },
      "codex": {
        "enabled": true,
        "availabilityProbe": { "executable": "codex", "args": ["--version"] },
        "callWorkflowDoc": "docs/agents/codex-routing.md"
      }
    },
    "roles": {
      "analyst": { "owner": "pi", "fallbacks": ["claude", "agy", "codex"] },
      "architect": { "owner": "agy", "fallbacks": ["pi", "claude", "codex"] },
      "implementation-planner": { "owner": "pi", "fallbacks": ["claude", "agy", "codex"] },
      "developer": { "owner": "claude", "fallbacks": ["codex", "agy", "pi"] },
      "tester": { "owner": "pi", "fallbacks": ["claude", "codex"] },
      "review": { "owner": "agy", "fallbacks": ["codex", "pi"] },
      "technical-writer": { "owner": "claude", "fallbacks": ["agy", "codex", "pi"] },
      "pr-readiness": { "owner": "pi", "fallbacks": ["agy", "codex"] }
    }
  }
}
```

This example keeps `developer` (`claude`) and `review` (`agy`) on different agents, which is
required unless a run explicitly records a `Self-review disclosure`. Routing is optional. If
routing config is absent or a role is not configured, the resolver keeps execution with the current
single agent — single-agent mode never requires a role attribution matrix. When ownership changes
or a fallback is used, record that in handover evidence.

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

## Environment validation

Run this before the first issue to make missing tools explicit without changing the machine:

```bash
agentflow-sdlc doctor-env --target /path/to/project
agentflow-sdlc doctor-env --target /path/to/project --json
```

`doctor-env` is read-only. It checks required tools, configured optional agent/runtime availability commands, and prints installation options when something is missing. It never runs install commands, edits shell profiles, authenticates GitHub, or installs packages.

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

## Changing settings later

To change posture, branches, a check, or CI commands in an adopted project, use
[Refine your setup](assisted-configuration.md): preview, confirm, apply, and undo, changing only
this project. Use `config doctor` and `config inspect` to read the current state:

```bash
agentflow-sdlc config doctor --target /path/to/project --json
agentflow-sdlc config inspect --target /path/to/project
```

`config sync` changes other agents' harnesses. It is not part of refinement; run it only when you
ask for exactly that, as described under
[sync other agents' harnesses](assisted-configuration.md#sync-other-agents-harnesses-only-on-request).

## Compliance notes

Keep project choices committed and easy to review. If the project changes agents, branch policy, validation commands, or bounded-work rules, update this config and the related docs in the same PR. If a related improvement is out of scope, open a follow-up issue instead of leaving hidden TODOs.
