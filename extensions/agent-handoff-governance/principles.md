# Principles

## Handoffs are explicit contracts

A handoff names the next owner, expected action, evidence already gathered, open questions, and stop conditions. It is not a vague status update.

## Provenance is separate from role

Record who launched the work, who executed it, how it was transported, and what delegation boundary applied. Do not infer these fields from a role name or adapter file.

## One writer per worktree

Keep one active writer for a branch/worktree. Use additional agents or humans as reviewers, advisors, or isolated-worktree implementers with clear boundaries.

## Review is read-only by default

Reviewers inspect, decide, and return findings. They do not patch code unless the workflow explicitly returns to implementation and assigns writer ownership.

## Async work needs a resume point

Cross-session or async work must leave enough context for another executor to resume: branch, issue, phase, evidence, commands run, risks, and next action.

## Human gates are blocking merge gates, not hidden assumptions

When human review is required, open the PR with evidence, request the review explicitly, and block merge until the decision is recorded.
