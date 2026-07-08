# Claude routing workflow

Use this guide when route resolution selects `claude` as the role owner or fallback.

## Execution targets

`claude` has two distinct execution targets — never treat them as interchangeable:

- `claude-cli` — local Claude Code/CLI execution. Does not require an Anthropic API subscription.
  This is the default execution target for `claude` and what a bare `with claude` should resolve to
  unless project config or the request says otherwise.
- `anthropic-api` — Anthropic Messages API execution (`model: anthropic/claude-*`, or a raw model id
  such as `claude-sonnet-4-20250514`). Requires configured API credentials and access to the
  requested model. Naming a Claude model does **not** launch the local Claude CLI.

Resolve which one an ambiguous request means before launching work:

```bash
node scripts/resolve-execution-target.mjs --agent claude --requested "with claude" --current-agent codex --json
node scripts/resolve-execution-target.mjs --agent claude --requested "anthropic/claude-sonnet-4" --json
```

See `docs/execution-targets.md` for the full concept reference.

## Availability check

Default setup check:

```bash
claude --version
```

If this command fails, treat `claude` as unavailable and try the next configured fallback.

## Call workflow

1. Resolve the role route and confirm `selectedAgent` is `claude`.
2. Post a ticket handover comment using `agents/templates/handover-comment.md` when control changes from another agent or when `claude` is selected as a fallback.
3. Invoke Claude with the issue number, role, branch, previous role-pass summary, acceptance criteria, and expected return artifact, plus the resolved execution target (`claude-cli` or `anthropic-api`).
4. Require Claude to sign the role-pass with `Actual executor identity: claude` and record `Executor: claude-cli` (or `anthropic-api`) with the matching `Transport` and `Delegation boundary`.

## Return contract

Claude must return:

- role-pass status: `pass`, `blocked`, `returned`, or `skipped`;
- inputs read;
- decisions/findings;
- open questions or `none`;
- next-phase contract;
- validation evidence when the role requires it.

The initiating executor must validate the returned role-pass before incorporating it into workflow-status or PR evidence.
