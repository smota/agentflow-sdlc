# Pi routing workflow

Use this guide when route resolution selects `pi` as the role owner or fallback.

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
4. Include the issue number, role, branch, previous role-pass summary, acceptance criteria, and expected return artifact.
5. Require Pi to sign the role-pass with `Actual executor identity: pi`.

## Return contract

Pi must return:

- role-pass status: `pass`, `blocked`, `returned`, or `skipped`;
- inputs read;
- decisions/findings;
- open questions or `none`;
- next-phase contract;
- validation evidence when the role requires it.

The initiating executor must validate the returned role-pass before incorporating it into workflow-status or PR evidence.
