# Agent routing and handovers

Project-configurable role routing lets a consuming project choose which local agent CLI should own each workflow role. Routing is optional: without `agent-workflow.config.json` routing settings, every role stays with the current executor and the workflow remains single-agent.

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

- selected agent;
- configured owner;
- fallback attempts;
- selection reason;
- handover workflow doc;
- whether a ticket handover comment is required.

If routing config is missing or the role is not configured, the resolver selects the current executor and reports `single-agent` mode.

## Validation

Validate project routing config with:

```bash
node scripts/validate-role-routing.mjs
```

Validation checks supported agent slugs, owner/fallback shape, duplicate fallbacks, owner duplication, and referenced handover docs.

## Handover comments

Ticket comments are the canonical durable evidence for handovers. Use `agents/templates/handover-comment.md` whenever:

- execution changes from one agent CLI to another;
- a configured owner falls back to another agent due to setup, quota, or availability;
- a role returns work to an earlier phase;
- a human review or human decision is requested;
- a session ends before the next role can continue.

Do not include secrets, credentials, private prompts, or unrelated local machine details in handover comments. For routine same-agent phase transitions, prefer the workflow-status comment unless a separate handover comment adds meaningful continuity.

## Agent-specific workflow docs

Each enabled agent in routing config should reference a handover guide:

- `docs/agents/agy-routing.md`
- `docs/agents/codex-routing.md`
- `docs/agents/claude-routing.md`
- `docs/agents/pi-routing.md`
