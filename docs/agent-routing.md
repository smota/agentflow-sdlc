# Agent routing and handovers

Project-configurable role routing lets a consuming project choose which local agent CLI should own each workflow role. Routing is optional: without `agent-workflow.config.json` routing settings, every role stays with the current executor and the workflow remains single-agent.

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
