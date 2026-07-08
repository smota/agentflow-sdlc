# Agent routing and handovers

Project-configurable role routing lets a consuming project choose which local agent CLI should own each workflow role. Routing is optional: without `agent-workflow.config.json` routing settings, every role stays with the current executor and the workflow remains single-agent.

The `routing.roles` table below is the project's **`roleAlternationPlan`** — the planned
role-to-agent assignment recorded before implementation starts. See
[`agent-workflow.md`](agent-workflow.md#4a-role-alternation-and-attribution-multi-agent-mode) for
the full role-alternation and attribution concepts (`roleIntelligence`, `contextBoundary`,
`independenceBoundary`, `roleAttributionMatrix`, `multiAgentClaim`, `selfReviewDisclosure`) that
turn this plan into evidenced, machine-checkable multi-agent claims.

An agent slug names _who_ owns a role. It does not say _how_ that role runs. See
[`execution-targets.md`](execution-targets.md) for the `executionTarget`, `transport`,
`launcher`, `executor`, and `delegationBoundary` concepts that make the "how" explicit — required
reading before treating a bare mention like `with claude`, `with agy`, or `with pi` as sufficient to
launch work.

## Supported agent slugs

The initial supported agent CLI slugs are:

- `agy`
- `codex`
- `claude`
- `pi`

Use these exact lowercase slugs in `agent-workflow.config.json`, role-pass artifacts, workflow-status comments, and handover comments.

## Route resolution

Before a phase starts, the orchestrator may resolve the route for that role:

```bash
node scripts/resolve-role-route.mjs --role developer --current claude --json
```

Use `--no-availability-check` in tests or dry runs when local CLI availability should not affect the result.

The resolver returns a machine-readable decision with:

- selected agent (`selectedAgent`, the agent slug);
- configured owner;
- fallback attempts;
- selection reason;
- `launcher` (the resolving agent) and `executor` (the resolved `executionTarget` for the selected
  agent, e.g. `claude-cli`, `codex-cli`) — see [`execution-targets.md`](execution-targets.md);
- `transport` and `delegationBoundary` for the resolved execution target;
- handover workflow doc;
- whether a ticket handover comment is required.

If routing config is missing or the role is not configured, the resolver selects the current executor and reports `single-agent` mode, with `executor` defaulting to that agent's built-in local-CLI execution target.

For a chat-level or free-text mention that role routing does not cover — a bare `with claude`/`with agy`/`with pi`, or a raw model identifier — resolve it deterministically before launching work:

```bash
node scripts/resolve-execution-target.mjs --agent claude --requested "with claude" --current-agent pi --json
```

This exits non-zero with `requiresClarification: true` when the request is genuinely ambiguous, instead of silently inheriting the launcher's current model or provider. See [`execution-targets.md`](execution-targets.md#resolving-ambiguous-requests).

## Validation

Validate project routing config with:

```bash
node scripts/validate-role-routing.mjs
```

Validation checks supported agent slugs, owner/fallback shape, duplicate fallbacks, owner duplication, referenced handover docs, and — when set — that `routing.agents.<slug>.defaultExecutionTarget` is a valid execution target for that agent slug.

Validate that a run's evidence backs up its `multiAgentClaim` with `node scripts/validate-pr-manifest.mjs --path <manifest>` (checks the `## Role attribution matrix` whenever `Mode: multi-agent`) or, for a non-PR-manifest evidence surface, `node scripts/validate-role-attribution.mjs --path <file>`. See [`agent-workflow.md` §4a](agent-workflow.md#4a-role-alternation-and-attribution-multi-agent-mode).

## Example: Pi + Claude CLI + Agy role alternation

A project that wants deterministic multi-agent role alternation assigns distinct owners per role
instead of leaving every role with one agent. This example keeps `developer` and `review` on
different intelligences (`claude` vs. `agy`), which is required unless a `Self-review disclosure`
is recorded:

```json
{
  "routing": {
    "defaultMode": "optional-multi-agent",
    "agents": {
      "pi": { "enabled": true, "callWorkflowDoc": "docs/agents/pi-routing.md" },
      "claude": { "enabled": true, "callWorkflowDoc": "docs/agents/claude-routing.md" },
      "agy": { "enabled": true, "callWorkflowDoc": "docs/agents/agy-routing.md" },
      "codex": { "enabled": true, "callWorkflowDoc": "docs/agents/codex-routing.md" }
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

This `routing.roles` table is the `roleAlternationPlan`. At execution time each phase's role-pass
records the actual `roleIntelligence` (which may differ from the plan on fallback), and the
workflow-status comment/PR manifest aggregate those rows into the `roleAttributionMatrix` with
`Mode: multi-agent`. A project that has no reason to alternate roles keeps
`routing.defaultMode: "single-agent"` (or omits `routing` entirely) — single-agent mode remains
fully valid and never requires this table.

## Handover comments

Ticket comments are the canonical durable evidence for handovers in every workflow mode. The
orchestrator owns posting or updating `agents/templates/handover-comment.md` for each role
transition, including routine same-agent single-agent transitions.

Use the handover comment/thread whenever:

- one role hands off to the next role in the normal phase sequence;
- execution changes from one agent CLI to another;
- a configured owner falls back to another agent due to setup, quota, or availability;
- a role returns work to an earlier phase;
- a human review or human decision is requested;
- a session ends before the next role can continue.

Do not include secrets, credentials, private prompts, or unrelated local machine details in handover
comments. Prefer one managed `<!-- agent-handover -->` thread per issue when a project wants less
comment noise; one comment per transition is also valid when a fully chronological issue timeline is
preferred.

## Agent-specific workflow docs

Each enabled agent in routing config should reference a handover guide:

- `docs/agents/agy-routing.md`
- `docs/agents/codex-routing.md`
- `docs/agents/claude-routing.md`
- `docs/agents/pi-routing.md`
