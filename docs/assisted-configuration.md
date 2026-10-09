# Refine your setup

Use this page for a later, small change to a project that already uses AgentFlow: its posture,
branches, a check, or its CI commands. The entry is `agentflow-sdlc onboarding refine`. It works
like [adoption](get-started.md): preview, confirm, apply, read the same readiness report, and undo
if you need to.

Refinement changes only this project's `agent-workflow.config.json` and AgentFlow's record of it.
It never installs anything, and it never changes another agent's harness. A project that is not
adopted yet, or that has a framework update waiting, is sent to [adoption](get-started.md#preview)
first.

## Look at the current settings

These are read-only:

```bash
agentflow-sdlc config doctor --target /path/to/project --json
agentflow-sdlc config inspect --target /path/to/project --json
agentflow-sdlc onboarding verify --target /path/to/project --json
```

`config doctor` reports blockers and warnings across configuration authority, workflow settings,
domain policy, posture capability, harness defaults, roles and methods, extension packs, and
adapters. Zero blockers does not certify readiness for any posture.

## Preview a change

Write only the settings to change in a changes file. Objects merge into the current
configuration; a list or a value replaces the current one.

```json
{
  "posture": "delegated",
  "ciCommands": ["pnpm lint", "pnpm test"],
  "branching": { "trunk": "main", "integration": "development" }
}
```

```bash
agentflow-sdlc onboarding refine --target /path/to/project --changes changes.json
```

This writes nothing. The `preview` lists the configuration file, the lock that records it, and the
transaction record kept for undo. The `report` is the readiness report the change would lead to,
and `digest` is what you confirm.

The postures are `advisory`, `assisted`, `delegated`, and `autonomous`. Choose one the project's
tests and CI can sustain; `config doctor` reports when they cannot.

## Add a check

A project with no test command or check cannot verify any change, and the readiness report says
so. Add the command your project already runs:

```json
{ "ciCommands": ["npm test"] }
```

For a check a run can verify against an acceptance contract, add `delivery.checks` and
`delivery.contracts` the same way, as described in [run operations](run-operations.md#inspect-and-configure).

## Confirm and apply

```bash
agentflow-sdlc onboarding apply --target /path/to/project --changes changes.json --confirm <digest>
```

Apply previews again from the same changes file and writes only when `--confirm` matches. Leaving
out `--confirm` declines, and a preview that no longer matches the project is refused as stale.
Either way nothing is written, and the report says why.

## Verify

The apply prints the readiness report. To read it again:

```bash
agentflow-sdlc onboarding verify --target /path/to/project --journey refinement --json
```

Governed-change readiness stays `false`: changing settings is not a product change.

## Undo

The apply's report gives the exact command:

```bash
agentflow-sdlc onboarding undo --target /path/to/project --receipt .agentflow/transactions/<id>/receipt.json --confirm <receipt-token> --journey refinement
```

Undo restores the prior configuration bytes exactly. It refuses when the file changed after the
apply.

## Other settings

`sdlc.config.json`, the harness defaults under `.agentflow/`, role routing and extension packs are
not part of refinement. Change them with your usual review, and check them with `config doctor`.

## Sync other agents' harnesses (only on request)

`config sync` generates skill, role, plugin and settings adapters for other agent harnesses. It is
a maintainer operation, separate from refinement. Run it only when you ask for exactly that, after
reviewing its preview:

```bash
agentflow-sdlc config sync --dry-run --target /path/to/project
agentflow-sdlc config sync --apply --target /path/to/project
```

It is not a transaction: an error can leave earlier operations applied, and there is no automatic
undo. Use version control to review or restore affected files.

## Hand a refinement to an agent

Print the handoff prompt with `agentflow-sdlc config prompt --target /path/to/project`, or copy it:

```text
Use the AgentFlow SDLC refinement guide:
https://github.com/smota/agentflow-sdlc/blob/main/docs/assisted-configuration.md

Apply it to this project: /path/to/project

You are acting as an assisted configuration collaborator. Follow the refinement journey:
1. Inspect: Run `agentflow-sdlc config doctor --json` and `agentflow-sdlc config inspect --json` read-only to understand the current configuration state and posture.
2. Clarify Intent: Ask me what to change (autonomy posture, branches, a check, or CI commands).
3. Preview: Write only those settings to changes.json and run `agentflow-sdlc onboarding refine --target "/path/to/project" --changes changes.json`. Show me the preview and its readiness report. Do not apply until I confirm.
4. Apply: Once I confirm, run `agentflow-sdlc onboarding apply --target "/path/to/project" --changes changes.json --confirm <digest>`. It changes only this project. Runtimes manage their own skill discovery; change no other agent's harness unless I ask for that by name.
5. Verify: Report the readiness report and its undo command, then re-run `agentflow-sdlc config doctor`; report unresolved warnings and their disposition.
```
