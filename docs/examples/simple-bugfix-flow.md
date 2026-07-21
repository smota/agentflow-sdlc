# Example: simple bugfix flow

This example shows the smallest useful AgentFlow SDLC path for a normal bug or documentation defect.

## 1. Issue

```markdown
## Background & Problem Statement

A documented command references an outdated option, causing new contributors to fail setup.

## Requirements

- [ ] Correct the command.
- [ ] Preserve surrounding instructions.

## Acceptance criteria

- [ ] README shows the corrected command.
- [ ] `pnpm format:check` passes.

## Workflow classification

- Profile: bounded
- Risk: low
- Effort: low
- Change surfaces: docs
```

## 2. Role evidence

The single executor records each phase in local role-pass notes and summarizes durable evidence in GitHub:

- Analyst: confirms the command mismatch and acceptance criteria.
- Architect: chooses a docs-only bounded profile.
- Developer planning: names `README.md` and `pnpm format:check`.
- Developer: updates only the command.
- Tester: records the exact validation command and result.
- Review: performs explicit evidence-backed self-review.
- Tech writer: confirms no additional docs are needed.
- PR readiness: confirms issue references, validation, and merge owner.

## 3. PR manifest excerpt

```markdown
Implements #123

## Summary

- Corrected the setup command in README.

## Validation

Status: passed

- `pnpm format:check` — passed

## Agent review

Mode: single-agent
Implemented by: pi
Self-review disclosure: bounded docs-only change; reviewer phase was evidence-backed self-review.

## Follow-up issues

None.
```

## Why this helps

The fix is small, but the evidence still answers what changed, why, how it was checked, and what remains.
