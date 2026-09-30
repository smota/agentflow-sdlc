# AGENTS.md — Repository Policy

This file is the required first-read policy document for agents working in this project. Adapter files (`CLAUDE.md`, `CODEX.md`, `AGY.md`) are entry points for specific agent CLIs; this file is the shared authority they must defer to.

If this file is missing in a checkout, stop before implementation or gate decisions and create a process follow-up unless the active issue is specifically restoring this file. Do not silently substitute another document as the single source of truth.

## Required reading order

Before issue work, architecture proposals, file writes, commits, or gate decisions, read:

1. `AGENTS.md`
2. the active runtime's adapter instructions, when configured by that runtime
3. `docs/agent-workflow.md`
4. `docs/issue-standards.md`
5. the active issue or `SPEC.md`

## Governed delivery and shared authority

Governed delivery and lifecycle contracts are defined in the shared framework documentation:

- SDLC definitions and operating model: `docs/sdlc-definition.md`
- Evidence contracts and role-pass schemas: `docs/evidence-contracts.md`
- Lifecycle boundaries and transition authority: `docs/lifecycle-boundaries.md`

## Operating principles

- **Single-agent execution by default**: One executor works through formal role-based phases.
- **Machine-checkable evidence**: Every phase records structured evidence (launcher, executor, transport, delegation boundary).
- **Durable workflow state**: GitHub issues, PR bodies, commits, and status comments are the durable source of truth. Scratch files in `.agent-runs/` are not committed.
- **Branch discipline**: Work on issue-scoped feature/work branches. Never make implementation edits directly on protected branches.
- **Review and safety**: Bounded and standard work may use explicit, evidence-backed self-review. High-assurance work requires human security and acceptance review on the open PR before merge. Review roles are read-only unless returned to implementation.
- **Tooling and validation**: Run repository validators before PR readiness. Preserve integrity of policy files and validate generated output.
