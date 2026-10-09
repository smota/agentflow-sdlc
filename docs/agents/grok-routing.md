# Grok routing workflow

Use this guide when route resolution selects `grok` as the role owner or fallback.

## Execution targets

`grok` has two distinct execution targets — never treat them as interchangeable:

- `grok-cli` — local Grok CLI execution (`grok`). This is the default execution target for `grok` and what a bare `with grok` resolves to when project config declares `defaultExecutionTarget: grok-cli`.
- `xai-api` — xAI API execution (`model: xai/grok-4.7`, `grok-4.5`, etc.). Requires configured API credentials and network access to `api.x.ai`.

Resolve which one an ambiguous request means before launching work:

```bash
node scripts/resolve-execution-target.mjs --agent grok --requested "with grok" --json
```

See `docs/execution-targets.md` for the full concept reference.

## Availability check

Default setup check:

```bash
grok --version
```

If this command fails, treat `grok` as unavailable and try the next configured fallback.

## Call workflow

1. Resolve the role route and confirm `selectedAgent` is `grok`.
2. Post a ticket handover comment using `agents/templates/handover-comment.md` when control changes from another agent or when `grok` is selected as a fallback.
3. Invoke Grok with the issue number, role, branch, previous role-pass summary, acceptance criteria, and expected return artifact, plus the resolved execution target (`grok-cli` or `xai-api`).
4. Require Grok to sign role-pass with `Executed by: grok` and record `Executor: grok-cli` (or `xai-api`) with the matching `Transport` and `Delegation boundary`.

## Return contract

When Grok finishes its phase:
- Return the required artifact for the current role (`ROLE.md`).
- Output honest execution observations; never forge exit codes or mock verification.
- Hand off to the next role along declared transitions.
