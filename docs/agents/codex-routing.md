# Codex routing workflow

Use this guide when route resolution selects `codex` as the role owner or fallback.

## Execution targets

`codex` has two distinct execution targets — never treat them as interchangeable:

- `codex-cli` — local Codex CLI execution, typically `codex exec` unless configured otherwise. This
  is the default execution target for `codex` and what a bare `with codex` should resolve to unless
  project config or the request says otherwise.
- `provider-api` — any provider-backed model call, distinct from local CLI execution even when the
  model brand matches the Codex brand.

Resolve which one an ambiguous request means before launching work:

```bash
node scripts/resolve-execution-target.mjs --agent codex --requested "with codex" --current-agent claude --json
```

See `docs/execution-targets.md` for the full concept reference.

## Availability check

Default setup check:

```bash
codex --version
```

If this command fails, treat `codex` as unavailable and try the next configured fallback.

## Call workflow

1. Resolve the role route and confirm `selectedAgent` is `codex`.
2. Post a ticket handover comment using `agents/templates/handover-comment.md` when control changes from another agent or when `codex` is selected as a fallback.
3. Invoke Codex with the issue number, role, branch, previous role-pass summary, acceptance criteria, and expected return artifact, plus the resolved execution target (`codex-cli` or `provider-api`).
4. Require Codex to sign the role-pass with `Actual executor identity: codex` and record `Executor: codex-cli` (or `provider-api`) with the matching `Transport` and `Delegation boundary`.

## Return contract

Codex must return:

- role-pass status: `pass`, `blocked`, `returned`, or `skipped`;
- inputs read;
- decisions/findings;
- open questions or `none`;
- next-phase contract;
- validation evidence when the role requires it.

The initiating executor must validate the returned role-pass before incorporating it into workflow-status or PR evidence.
