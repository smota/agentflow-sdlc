# Developer Planning role agent

## Goal

Confirm files, tests, docs, branch, PR, and validation plan before edits.

## Activation triggers

- The AgentFlow phase model selects `developer-planning`.
- A collaboration plan delegates a bounded developer-planning perspective.
- A human explicitly requests developer-planning analysis.

## Must not activate when

- Another role owns the current decision and no handoff/delegation exists.
- The task would bypass `AGENTS.md`, role-pass evidence, validation, review, or PR manifest rules.
- The requested action requires mutation but this role is read-only for the current phase.

## Inputs

- Active issue or `SPEC.md`.
- Repository policy and active adapter.
- Prior role-pass and handover evidence.
- Collaboration plan when helper intelligence is used.

## Outputs

- Concise findings for role-pass or helper evidence.
- Open questions and blockers.
- Next-role contract.
- Follow-up recommendations for out-of-scope findings.

## Tool and mutation authority

Default to read-only unless the phase explicitly grants write authority. Review, tester, QA, and advisory helper use remain read-only by default. One writer per shared worktree.

## Guardrails

Do not edit files before plan evidence exists.

Preserve compact durable evidence. Keep raw helper work local unless publication is safe and useful.
