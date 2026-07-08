# Pi routing workflow

Use this guide when route resolution selects `pi` as the role owner or fallback.

## Execution targets

`pi` has four distinct execution targets — never treat them as interchangeable, especially when Pi
is launched from Claude/Codex/Agy or from another Pi session:

- `pi-parent` — the current Pi session acting as orchestrator/decision-maker. This is the default
  execution target for `pi` and what a bare `with pi` should resolve to unless project config or the
  request says otherwise.
- `pi-subagent` — a child launched through Pi's subagent runtime.
- `pi-session` — a separate Pi session reached through intercom/control-socket style coordination.
- `pi-subagent-model` — Pi subagent execution using Pi's configured model provider (for example
  `openai-codex/gpt-5.5`). Record the `model` field alongside this execution target; it is a
  provider-backed call, not `pi-parent` continuing under a different name.

Resolve which one an ambiguous request means before launching work:

```bash
node scripts/resolve-execution-target.mjs --agent pi --requested "with pi" --current-agent claude --json
node scripts/resolve-execution-target.mjs --agent pi --requested "openai-codex/gpt-5.5" --json
```

See `docs/execution-targets.md` for the full concept reference.

## Availability check

Default setup check:

```bash
pi --version
```

If this command fails, treat `pi` as unavailable and try the next configured fallback.

## Call workflow

1. Resolve the role route and confirm `selectedAgent` is `pi`.
2. Post a ticket handover comment using `agents/templates/handover-comment.md` when control changes from another agent or when `pi` is selected as a fallback.
3. Invoke Pi through the project's approved local workflow, such as a pi session, pi subagent, or pi intercom handoff.
4. Include the issue number, role, branch, previous role-pass summary, acceptance criteria, expected return artifact, and the resolved execution target (`pi-parent`, `pi-subagent`, `pi-session`, or `pi-subagent-model`).
5. Require Pi to sign the role-pass with `Actual executor identity: pi` and record `Executor: <execution target>` with the matching `Transport`, `Delegation boundary`, and `Model / runtime` when `pi-subagent-model` is used.

## Return contract

Pi must return:

- role-pass status: `pass`, `blocked`, `returned`, or `skipped`;
- inputs read;
- decisions/findings;
- open questions or `none`;
- next-phase contract;
- validation evidence when the role requires it.

The initiating executor must validate the returned role-pass before incorporating it into workflow-status or PR evidence.
