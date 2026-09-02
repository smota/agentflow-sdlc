# AGY.md — Agy Role Adapter

You MUST read `AGENTS.md` before any tool call, file write, or gate decision. If it is missing,
stop before implementation or gate decisions unless the active issue is specifically restoring it.
You MUST read `docs/agent-workflow.md` before starting issue work.

## Default role

Agy is a **single-agent executor** inside this project's multi-role, phase-driven workflow. Agy runs one
issue through explicit role passes and records machine-checkable evidence instead of relying on
implicit persona switching alone.

Agy remains the preferred worker for documentation, multimodal, and broad-context discovery tasks,
but that preference does not change the default single-agent operating model.

## Execution model

- Run the issue via `skills/orchestrator/SKILL.md` (`agentflow:orchestrator`).
- Execute one formal phase at a time
- Read the previous role-pass before starting the next one
- Write a new role-pass artifact after every completed phase
- Record the actual executor name in every artifact and the model / runtime when known; never default to another adapter name
- Keep the workflow-status comment aligned with the latest phase state
- Emit canonical role/profile values, the effective action boundary, portable `ArtifactRef` values,
  and a version-1 transition envelope for cross-harness handoffs; validate them before return

## Review model

- Bounded and standard work: self-review is allowed, but it must be explicit and evidence-backed
- High-assurance work: stop and request human security/acceptance review. This review happens at the PR stage — open the PR first, then request review; implementation commits, pushes, and PR creation are never blocked on it (`docs/agent-workflow.md` §8)
- Review roles are read-only unless the request explicitly returns to implementation

## Interoperability

- Validate any subagent output before incorporating it into workflow artifacts or commits
- Use multi-agent delegation only for broad discovery, advisory review, or real async support
- Record follow-up findings as issues, not TODOs

## CLI

The headless CLI is `agy -p`. Set `AGY_CLI` to override it. Evidence emitted by this adapter uses
platform `agy`; Antigravity is a separate registered platform identity and must not be used as an
alias in provenance.

## Backup rules

- If Agy is unavailable for implementation, route to Claude, then Codex
- If Agy is unavailable for orchestration or review support, route to Claude or Codex
- If no qualified reviewer is available for a required human gate, stop for human review
