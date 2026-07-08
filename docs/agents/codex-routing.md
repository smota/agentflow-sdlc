# Codex routing workflow

Use this guide when route resolution selects `codex` as the role owner or fallback.

## Availability check

Default setup check:

```bash
codex --version
```

If this command fails, treat `codex` as unavailable and try the next configured fallback.

## Call workflow

1. Resolve the role route and confirm `selectedAgent` is `codex`.
2. Post a ticket handover comment using `agents/templates/handover-comment.md` when control changes from another agent or when `codex` is selected as a fallback.
3. Invoke Codex with the issue number, role, branch, previous role-pass summary, acceptance criteria, and expected return artifact.
4. Require Codex to sign the role-pass with `Actual executor identity: codex`.

## Return contract

Codex must return:

- role-pass status: `pass`, `blocked`, `returned`, or `skipped`;
- inputs read;
- decisions/findings;
- open questions or `none`;
- next-phase contract;
- validation evidence when the role requires it.

The initiating executor must validate the returned role-pass before incorporating it into workflow-status or PR evidence.
