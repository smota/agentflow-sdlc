# Agy routing workflow

Use this guide when route resolution selects `agy` as the role owner or fallback.

## Execution targets

`agy` has two distinct execution targets — never treat them as interchangeable:

- `agy-cli` — local Agy CLI/runtime execution, when available. This is the default execution target
  for `agy` and what a bare `with agy` should resolve to unless project config or the request says
  otherwise.
- `agy-session` — an Agy-owned session/worktree, or an external agent session reached through the
  documented handoff mechanism. Distinct from any provider-backed model call or generic handoff:
  record which mechanism (worktree vs. reached session) was actually used.

Resolve which one an ambiguous request means before launching work:

```bash
node scripts/resolve-execution-target.mjs --agent agy --requested "with agy" --current-agent claude --json
```

See `docs/execution-targets.md` for the full concept reference.

## Availability check

Default setup check:

```bash
agy --version
```

If this command fails, treat `agy` as unavailable and try the next configured fallback.

## Call workflow

1. Resolve the role route and confirm `selectedAgent` is `agy`.
2. Post a ticket handover comment using `agents/templates/handover-comment.md` when control changes from another agent or when `agy` is selected as a fallback.
3. Invoke Agy with the issue number, role, branch, previous role-pass summary, acceptance criteria, and expected return artifact, plus the resolved execution target (`agy-cli` or `agy-session`).
4. Require Agy to sign the role-pass with `Actual executor identity: agy` and record `Executor: agy-cli` (or `agy-session`) with the matching `Transport` and `Delegation boundary`.

## Return contract

Agy must return:

- role-pass status: `pass`, `blocked`, `returned`, or `skipped`;
- inputs read;
- decisions/findings;
- open questions or `none`;
- next-phase contract;
- validation evidence when the role requires it.

The initiating executor must validate the returned role-pass before incorporating it into workflow-status or PR evidence.
