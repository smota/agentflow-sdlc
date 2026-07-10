# Agent handoff governance

This extension pack defines how work moves safely between agents, subagents, sessions, and humans. It is stack-neutral and complements the core SDLC workflow by adding stricter handoff, provenance, delegation, and review-boundary evidence.

## Use this pack when

- more than one agent, session, worktree, or human reviewer participates;
- async work needs a durable continuation record;
- review or acceptance must be transferred without losing context;
- the team needs a clear single-writer/multiple-reviewer boundary.

## What this pack adds

- Handoff comment and async handoff templates.
- Required provenance fields: launcher, executor, transport, delegation boundary, model/runtime, and merge owner.
- Role-pass addendum for handoff-specific evidence.
- Human review request shape for high-assurance or explicit human gates.
- Review boundary guidance: reviewers inspect and return findings; implementers patch.
- Single-writer/multiple-reviewer coordination rules.

## What this pack excludes

This pack does not define product, stack, or compliance rules. It also does not require multi-agent execution. Single-agent projects can enable it to standardize human handoffs and PR-stage review requests.

## Role-pass expectations

- **Orchestrator:** state why a handoff is needed and who owns the next action.
- **Sender:** include scope, context, decisions, evidence, open questions, and stop conditions.
- **Receiver:** acknowledge the handoff, verify inputs, and record any missing context before acting.
- **Reviewer:** stay read-only unless work is explicitly returned to implementation.
- **Implementer:** remain the single writer for the same branch/worktree unless an isolated worktree is intentionally assigned.

## Validation

Run from the repository root after enabling the pack:

```bash
node scripts/validate-extension-packs.mjs --run-validators
```
