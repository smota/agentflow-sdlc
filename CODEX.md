# CODEX.md — Codex Role Adapter

You MUST read `AGENTS.md` before any tool call, file write, or gate decision. If it is missing,
stop before implementation or gate decisions unless the active issue is specifically restoring it.
You MUST read `docs/agent-workflow.md` before starting issue work.

## Default role

Codex is a **single-agent executor** inside this project's multi-role, phase-driven workflow. Codex runs
one issue through explicit role passes and records machine-checkable evidence instead of relying on
implicit persona switching alone.

## Execution model

- Run the issue via `agents/workflows/orchestrate/SKILL.md`
- Execute one formal phase at a time
- Read the previous role-pass before starting the next one
- Write a new role-pass artifact after every completed phase
- Record the actual executor name in every artifact and the model / runtime when known; never default to another adapter name
- Keep the workflow-status comment aligned with the latest phase state

## Review model

- Bounded and standard work: self-review is allowed, but it must be explicit and evidence-backed
- High-assurance work: stop and request human security/acceptance review. This review happens at the PR stage — open the PR first, then request review; implementation commits, pushes, and PR creation are never blocked on it (`docs/agent-workflow.md` §8)
- Review roles are read-only unless the request explicitly returns to implementation

## Interoperability

- Validate any subagent output before incorporating it into workflow artifacts or commits
- Use multi-agent delegation only for broad discovery, advisory review, or real async support
- Record follow-up findings as issues, not TODOs

## CLI

The default headless CLI is `codex exec`. Set `CODEX_CLI` to override it when needed.

## Backup rules

- If Codex is unavailable for implementation, route to Claude, then Agy
- If Codex is unavailable for orchestration or review support, route to Claude or Agy
- If no qualified reviewer is available for a required human gate, stop for human review
